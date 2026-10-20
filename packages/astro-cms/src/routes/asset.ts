import type { APIRoute } from "astro";
import { getAsset } from "../server/db.ts";
import { resolveImage } from "../runtime.ts";

export const prerender = false;

/**
 * `/_cms/asset/<key>` serves an upload that hasn't been published yet.
 * `/_cms/asset/?src=<value>` resolves any stored image value to a viewable URL.
 */
export const GET: APIRoute = async ({ params, url, redirect }) => {
  const src = url.searchParams.get("src");
  if (src) {
    const resolved = resolveImage(src);
    const target = typeof resolved === "string" ? resolved : resolved.src;
    // Only paths on this site: anything else would make this an open redirect.
    if (!target.startsWith("/") || target.startsWith("//")) return new Response("Not found", { status: 404 });
    return redirect(target, 302);
  }
  const key = params.key;
  if (!key) return new Response("Not found", { status: 404 });
  const asset = await getAsset(key);
  if (!asset) return new Response("Not found", { status: 404 });
  return new Response(asset.bytes, {
    headers: {
      "content-type": asset.contentType,
      "cache-control": "private, max-age=3600",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
    },
  });
};
