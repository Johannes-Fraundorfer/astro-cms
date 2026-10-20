import type { APIRoute } from "astro";
import {
  SESSION_COOKIE,
  clearFailures,
  cmsPassword,
  createSession,
  isLockedOut,
  recordFailure,
  safeNext,
  timingSafeEqual,
} from "../server/auth.ts";

export const prerender = false;

const back = (redirect: (path: string, status?: 301 | 302 | 303 | 307 | 308) => Response, next: string, error: string) =>
  redirect(`/admin/login?error=${error}&next=${encodeURIComponent(next)}`, 303);

/** `POST /api/cms/auth/login` (form post from the login page) and `POST /api/cms/auth/logout`. */
export const POST: APIRoute = async ({ params, request, cookies, redirect, clientAddress }) => {
  if (params.action === "logout") {
    cookies.delete(SESSION_COOKIE, { path: "/" });
    return redirect("/admin/login?signedOut=1", 303);
  }
  if (params.action !== "login") return new Response("Not found", { status: 404 });

  const form = await request.formData();
  const next = safeNext(form.get("next")?.toString() ?? null);
  const password = cmsPassword();
  if (!password) return back(redirect, next, "unset");

  const ip = request.headers.get("cf-connecting-ip") ?? clientAddress ?? "unknown";
  if (await isLockedOut(ip)) return back(redirect, next, "locked");

  const given = form.get("password")?.toString() ?? "";
  if (!timingSafeEqual(given, password)) {
    await recordFailure(ip);
    // Slows down guessing without needing a timer per client.
    await new Promise((r) => setTimeout(r, 600));
    return back(redirect, next, "wrong");
  }

  await clearFailures(ip);
  const session = await createSession(password);
  cookies.set(SESSION_COOKIE, session.value, {
    path: "/",
    httpOnly: true,
    secure: new URL(request.url).protocol === "https:",
    sameSite: "strict",
    maxAge: session.maxAge,
  });
  return redirect(next, 303);
};
