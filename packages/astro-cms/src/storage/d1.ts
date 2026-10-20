import { env } from "cloudflare:workers";
import type { MediaBucket, SqlDatabase } from "./types.ts";

/** Cloudflare D1, from the `CMS_DB` binding in wrangler.jsonc. */
export function database(): SqlDatabase {
  const db = (env as { CMS_DB?: SqlDatabase }).CMS_DB;
  if (!db) throw new Error("[cms] The CMS_DB D1 binding is missing from wrangler.jsonc");
  return db;
}

/** Cloudflare R2, from the optional `CMS_MEDIA` binding. Without it, video fields take links only. */
export function mediaBucket(): MediaBucket | undefined {
  return (env as { CMS_MEDIA?: MediaBucket }).CMS_MEDIA;
}
