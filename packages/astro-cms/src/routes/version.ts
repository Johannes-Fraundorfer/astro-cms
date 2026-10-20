import type { APIRoute } from "astro";

export const prerender = false;

/** Which commit the running site was built from; lets a dashboard tell when a publish is live. */
export const GET: APIRoute = () =>
  new Response(JSON.stringify({ sha: __CMS_BUILD_SHA__, builtAt: __CMS_BUILD_TIME__ }), {
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
    },
  });
