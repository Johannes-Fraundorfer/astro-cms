/**
 * The SQL database the CMS keeps drafts, unpublished uploads and login
 * attempts in. It is the subset of Cloudflare D1's API the CMS uses, so D1
 * fits as is; other hosts get a thin wrapper (libSQL/Turso, Postgres, …).
 * Queries use `?` placeholders and SQLite syntax.
 */
export interface SqlStatement {
  bind(...values: unknown[]): SqlStatement;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<unknown>;
}

/**
 * Object storage for uploaded videos, which are too big for the SQL database
 * or the repo. The subset of Cloudflare R2's binding API the CMS uses.
 */
export interface MediaBucket {
  head(key: string): Promise<MediaObject | null>;
  get(key: string, options?: { range?: { offset: number; length: number } }): Promise<(MediaObject & { body: ReadableStream }) | null>;
  delete(key: string): Promise<void>;
  createMultipartUpload(key: string, options?: { httpMetadata?: { contentType?: string } }): Promise<{ key: string; uploadId: string }>;
  resumeMultipartUpload(key: string, uploadId: string): MultipartUpload;
}

export interface MediaObject {
  size: number;
  httpEtag: string;
  httpMetadata?: { contentType?: string };
}

export interface UploadedPart {
  partNumber: number;
  etag: string;
}

export interface MultipartUpload {
  uploadPart(partNumber: number, value: ArrayBuffer): Promise<UploadedPart>;
  complete(parts: UploadedPart[]): Promise<unknown>;
  abort(): Promise<void>;
}

export interface SqlDatabase {
  prepare(sql: string): SqlStatement;
  /** Runs the statements in one transaction. */
  batch(statements: SqlStatement[]): Promise<unknown>;
}
