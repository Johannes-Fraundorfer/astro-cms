import { defineMiddleware } from "astro:middleware";
import { SESSION_COOKIE, authRequired, verifySession } from "./server/auth.ts";
import { overlayScript } from "./overlay.ts";

const PROTECTED = /^\/(admin|api\/cms|_cms)(\/|$)/;
// Unpublished uploads stay reachable without a session because the image
// pipeline fetches them server-side; their keys are unguessable. Videos are
// what the live site plays.
const PUBLIC = /^\/(admin\/login|api\/cms\/auth\/|_cms\/version$|_cms\/(asset|media)\/[^?]+$)/;

/** Everything the dashboard uses sits behind a session cookie from /admin/login. */
async function checkAuth(ctx: Parameters<Parameters<typeof defineMiddleware>[0]>[0]) {
  if (!PROTECTED.test(ctx.url.pathname) || PUBLIC.test(ctx.url.pathname)) return undefined;
  if (!authRequired()) return undefined;
  if (await verifySession(ctx.cookies.get(SESSION_COOKIE)?.value)) return undefined;
  if (ctx.url.pathname.startsWith("/admin")) {
    return ctx.redirect(`/admin/login?next=${encodeURIComponent(ctx.url.pathname + ctx.url.search)}`, 302);
  }
  return new Response(JSON.stringify({ error: "Your session ended. Sign in again." }), {
    status: 401,
    headers: { "content-type": "application/json" },
  });
}

export const onRequest = defineMiddleware(async (ctx, next) => {
  const denied = await checkAuth(ctx);
  if (denied) return denied;

  const response = await next();
  // The dashboard and login page are never framed by another site (clickjacking).
  if (/^\/admin(\/|$)/.test(ctx.url.pathname)) {
    try {
      response.headers.set("x-frame-options", "DENY");
      response.headers.set("content-security-policy", "frame-ancestors 'none'");
    } catch {
      /* immutable headers (a redirect): nothing to frame */
    }
  }
  if (!ctx.url.pathname.startsWith("/_cms/preview")) return response;
  if (!response.headers.get("content-type")?.includes("text/html")) return response;

  const html = await response.text();
  const tag = `<script>${overlayScript}</script>`;
  const at = html.lastIndexOf("</body>");
  const rewritten = new Response(at === -1 ? html + tag : html.slice(0, at) + tag + html.slice(at), response);
  rewritten.headers.delete("content-length");
  rewritten.headers.set("cache-control", "no-store");
  // The preview only ever loads inside the dashboard on the same origin.
  rewritten.headers.set("x-frame-options", "SAMEORIGIN");
  rewritten.headers.set("x-robots-tag", "noindex");
  return rewritten;
});
