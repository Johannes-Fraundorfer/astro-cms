import config from "virtual:cms/config";
import { mediaBucket } from "virtual:cms/storage";
import { slugify } from "../schema.ts";
import type { UploadedPart } from "../storage/types.ts";

export const MEDIA_PREFIX = "/_cms/media/";

/**
 * Videos upload in parts, straight into the bucket: a Worker request body is
 * capped at 100 MB, so a whole file can't go in one request. R2 needs parts of
 * at least 5 MB, except the last.
 */
export const PART_SIZE = 10 * 1024 * 1024;
const MAX_SIZE = 2 * 1024 * 1024 * 1024;

const TYPES: Record<string, string> = {
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "video/x-m4v": "m4v",
};

/** Keys the CMS created itself; anything else is refused. */
const KEY = /^videos\/[a-z0-9-]{1,40}-[0-9a-f]{16}\.(mp4|webm|mov|m4v)$/;

export class VideoError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const videoUploads = () => !!mediaBucket();

function bucket() {
  const b = mediaBucket();
  if (!b) throw new VideoError(501, "Video uploads need a CMS_MEDIA R2 bucket. Paste a video link instead.");
  return b;
}

function requireKey(key: unknown) {
  if (typeof key !== "string" || !KEY.test(key)) throw new VideoError(400, "Unknown upload");
  return key;
}

/** Where a stored video is watched from: the bucket's public URL, else this site. */
export function videoSrc(key: string) {
  const base = config.media?.videoUrl?.replace(/\/+$/, "");
  return base ? `${base}/${key}` : `${MEDIA_PREFIX}${key}`;
}

export async function startUpload({ name, type, size }: { name?: unknown; type?: unknown; size?: unknown }) {
  const ext = typeof type === "string" ? TYPES[type] : undefined;
  if (!ext) throw new VideoError(415, "Only MP4, WebM and MOV videos are supported");
  if (typeof size !== "number" || size <= 0) throw new VideoError(400, "Empty file");
  if (size > MAX_SIZE) throw new VideoError(413, "Videos can be up to 2 GB");
  const base = typeof name === "string" ? name.replace(/\.[^.]*$/, "") : "";
  const random = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const key = `videos/${slugify(base).slice(0, 40) || "video"}-${random}.${ext}`;
  const upload = await bucket().createMultipartUpload(key, { httpMetadata: { contentType: type as string } });
  return { key: upload.key, uploadId: upload.uploadId, partSize: PART_SIZE };
}

export async function uploadPart(key: unknown, uploadId: unknown, part: unknown, body: ArrayBuffer) {
  const n = Number(part);
  if (!Number.isInteger(n) || n < 1 || n > 10000) throw new VideoError(400, "Bad part number");
  if (typeof uploadId !== "string" || !uploadId) throw new VideoError(400, "Missing upload id");
  if (!body.byteLength || body.byteLength > PART_SIZE) throw new VideoError(400, "Bad part size");
  return bucket().resumeMultipartUpload(requireKey(key), uploadId).uploadPart(n, body);
}

export async function completeUpload(key: unknown, uploadId: unknown, parts: unknown) {
  if (typeof uploadId !== "string" || !uploadId) throw new VideoError(400, "Missing upload id");
  const list = Array.isArray(parts)
    ? parts.filter((p): p is UploadedPart => Number.isInteger(p?.partNumber) && typeof p?.etag === "string")
    : [];
  if (!list.length) throw new VideoError(400, "No parts uploaded");
  const k = requireKey(key);
  await bucket().resumeMultipartUpload(k, uploadId).complete(list);
  return { src: videoSrc(k) };
}

export async function abortUpload(key: unknown, uploadId: unknown) {
  if (typeof uploadId !== "string" || !uploadId) return;
  await bucket().resumeMultipartUpload(requireKey(key), uploadId).abort().catch(() => {});
}

/** `bytes=a-b`, `bytes=a-` or `bytes=-n` against a file of `size` bytes. Multiple ranges aren't supported. */
function parseRange(header: string | null, size: number) {
  const m = header?.match(/^bytes=(\d*)-(\d*)$/);
  if (!m || (!m[1] && !m[2])) return undefined;
  const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
  const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  return start <= end && start < size ? { offset: start, length: end - start + 1 } : null;
}

/**
 * Serves a video from the bucket. Players seek with range requests, so those
 * are answered with the requested bytes only.
 */
export async function serveVideo(key: string | undefined, request: Request) {
  const b = mediaBucket();
  if (!b || !key || !KEY.test(key)) return new Response("Not found", { status: 404 });
  const head = await b.head(key);
  if (!head) return new Response("Not found", { status: 404 });
  const range = parseRange(request.headers.get("range"), head.size);
  const headers = new Headers({
    "content-type": head.httpMetadata?.contentType ?? "application/octet-stream",
    "accept-ranges": "bytes",
    etag: head.httpEtag,
    "cache-control": "public, max-age=31536000, immutable",
    "x-content-type-options": "nosniff",
  });
  if (range === null) {
    headers.set("content-range", `bytes */${head.size}`);
    return new Response(null, { status: 416, headers });
  }
  const obj = await b.get(key, range ? { range } : undefined);
  if (!obj) return new Response("Not found", { status: 404 });
  if (!range) {
    headers.set("content-length", String(head.size));
    return new Response(obj.body, { headers });
  }
  headers.set("content-range", `bytes ${range.offset}-${range.offset + range.length - 1}/${head.size}`);
  headers.set("content-length", String(range.length));
  return new Response(obj.body, { status: 206, headers });
}
