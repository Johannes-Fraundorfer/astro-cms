import type { APIRoute } from "astro";
import { serveVideo } from "../server/videos.ts";

export const prerender = false;

/** `/_cms/media/<key>` serves an uploaded video when the bucket has no public URL. */
export const GET: APIRoute = ({ params, request }) => serveVideo(params.key, request);
