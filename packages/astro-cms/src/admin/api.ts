import type { BlockType, DocumentType, ValidationError } from "../schema.ts";

export type Data = Record<string, any>;
export type Status = "published" | "changed" | "draft" | "empty" | "missing";

export interface Locale {
  code: string;
  title: string;
}

export interface Schema {
  types: DocumentType[];
  blocks: BlockType[];
  terminal: boolean;
  terminalToken?: string;
  publishTarget: "local" | "github";
  i18n?: { locales: Locale[]; defaultLocale: string };
  /** Live site, when set: the dashboard reports when a publish is deployed. */
  deployUrl?: string;
  /** False when the dashboard runs without a login (astro dev with no CMS_PASSWORD). */
  signedIn: boolean;
  /** Whether the site has a media bucket, so video fields can upload. */
  videoUploads: boolean;
  /** Sidebar order of content types as editors arranged it; types not listed follow in config order. */
  typeOrder: string[];
}

export interface DocSummary {
  type: string;
  id: string;
  title: string;
  subtitle?: string;
  media?: string;
  status: Status;
  updatedAt?: number;
  publishedAt?: number;
  path?: string;
  locale?: string;
}

export interface DocDetail extends DocSummary {
  draft?: Data;
  published?: Data;
  publishedPath?: string;
  /** For a missing translation: the default locale's content, shown in its place. */
  fallback?: Data;
  usedBy: DocSummary[];
  /** Status per locale code, for localized types. */
  translations: Record<string, Status>;
  /** Set by publish: the commit to watch for on the live site. */
  deploy?: Deploy;
}

export interface Deploy {
  sha?: string;
  since: number;
}

export type DeployState =
  | { state: "live"; liveSha: string }
  | { state: "building"; liveSha?: string }
  | { state: "failed"; detailsUrl?: string }
  | { state: "unknown"; reason: string };

export interface Asset {
  /** What an image field stores: `@/assets/…` or `/_cms/asset/…`. */
  value: string;
  url: string;
  name: string;
  folder: string;
  /** An upload that isn't in the repo yet; it's added when a document using it is published. */
  pending: boolean;
  width?: number;
  height?: number;
  size?: number;
  /** How many documents use it, drafts and published versions both. */
  uses: number;
  usedIn: { type: string; id: string; locale: string; title: string }[];
  /** Its alt text in the current locale: the saved default, else what it last had. */
  alt?: string;
  /** How many of its documents are in the current locale, where saving alt text can apply. */
  altUses: number;
  /** Unused, and not a file the site's code might import. */
  deletable: boolean;
}

export class ApiError extends Error {
  constructor(message: string, public status: number, public detail?: unknown) {
    super(message);
  }
  get fieldErrors() {
    return Array.isArray(this.detail) ? (this.detail as ValidationError[]) : [];
  }
}

let locale: string | undefined;

/** Every call after this reads and writes that locale's versions. */
export const setLocale = (code: string | undefined) => {
  locale = code;
};

async function call<T>(path: string, init?: RequestInit, loc = locale): Promise<T> {
  const url = loc ? `${path}${path.includes("?") ? "&" : "?"}locale=${encodeURIComponent(loc)}` : path;
  const res = await fetch(`/api/cms/${url}`, {
    ...init,
    headers: init?.body instanceof FormData ? init.headers : { "content-type": "application/json", ...init?.headers },
  });
  if (res.status === 401) {
    location.href = `/admin/login?next=${encodeURIComponent(location.pathname)}`;
    throw new ApiError("Signed out", 401);
  }
  const body = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) throw new ApiError(body.error ?? res.statusText, res.status, body.detail);
  return body as T;
}

const upload = (key: string, uploadId: string) => `key=${encodeURIComponent(key)}&uploadId=${encodeURIComponent(uploadId)}`;

const doc = (type: string, id: string) => `documents/${encodeURIComponent(type)}/${encodeURIComponent(id)}`;

export const api = {
  schema: () => call<Schema>("schema"),
  list: (type: string) => call<DocSummary[]>(`documents?type=${encodeURIComponent(type)}`),
  search: (types: string[] = [], q = "") =>
    call<DocSummary[]>(`search?types=${encodeURIComponent(types.join(","))}&q=${encodeURIComponent(q)}`),
  resolve: (path: string) => call<DocSummary | null>(`resolve?path=${encodeURIComponent(path)}`),
  get: (type: string, id: string) => call<DocDetail>(doc(type, id)),
  /** Takes the locale explicitly: a save can land after the dashboard switched language. */
  save: (type: string, id: string, data: Data, loc: string | undefined) =>
    call<DocDetail>(doc(type, id), { method: "PUT", body: JSON.stringify({ data }) }, loc),
  create: (type: string, title?: string) =>
    call<DocDetail>(`documents/${encodeURIComponent(type)}`, { method: "POST", body: JSON.stringify({ title }) }),
  publish: (type: string, id: string) => call<DocDetail>(`${doc(type, id)}/publish`, { method: "POST", body: "{}" }),
  discard: (type: string, id: string) => call<DocDetail>(`${doc(type, id)}/discard`, { method: "POST", body: "{}" }),
  duplicate: (type: string, id: string) =>
    call<DocDetail>(`${doc(type, id)}/duplicate`, { method: "POST", body: "{}" }),
  remove: (type: string, id: string) => call<{ ok: true }>(doc(type, id), { method: "DELETE" }),
  unpublish: (type: string, id: string) => call<DocDetail>(`${doc(type, id)}/unpublish`, { method: "POST", body: "{}" }),
  bulk: (type: string, action: "delete" | "duplicate" | "unpublish", ids: string[]) =>
    call<{ count: number; ids?: string[]; deploy?: Deploy }>(`bulk/${encodeURIComponent(type)}`, {
      method: "POST",
      body: JSON.stringify({ action, ids }),
    }),
  translate: (type: string, id: string) =>
    call<DocDetail>(`${doc(type, id)}/translate`, { method: "POST", body: "{}" }),
  saveTypeOrder: (types: string[]) => call<{ ok: true }>("order", { method: "PUT", body: JSON.stringify({ types }) }),
  assets: () => call<Asset[]>("assets"),
  removeAsset: (value: string) => call<{ ok: true }>(`assets?value=${encodeURIComponent(value)}`, { method: "DELETE" }),
  setAssetAlt: (value: string, alt: string, updateUses: boolean) =>
    call<{ ok: true; updated: number }>(`assets?value=${encodeURIComponent(value)}`, {
      method: "PATCH",
      body: JSON.stringify({ alt, updateUses }),
    }),
  replaceAsset: (value: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return call<{ src: string; updated: number }>(`assets/replace?value=${encodeURIComponent(value)}`, { method: "POST", body: form });
  },
  deploy: (d: Deploy) => call<DeployState>(`deploy?sha=${encodeURIComponent(d.sha ?? "")}&since=${d.since}`),
  videoStart: (file: File) =>
    call<{ key: string; uploadId: string; partSize: number }>("videos", {
      method: "POST",
      body: JSON.stringify({ name: file.name, type: file.type, size: file.size }),
    }),
  videoPart: (key: string, uploadId: string, part: number, bytes: Blob) =>
    call<{ partNumber: number; etag: string }>(`videos/part?${upload(key, uploadId)}&part=${part}`, {
      method: "POST",
      body: bytes,
      headers: { "content-type": "application/octet-stream" },
    }),
  videoComplete: (key: string, uploadId: string, parts: { partNumber: number; etag: string }[]) =>
    call<{ src: string }>(`videos/complete?${upload(key, uploadId)}`, { method: "POST", body: JSON.stringify({ parts }) }),
  videoAbort: (key: string, uploadId: string) =>
    call<{ ok: true }>(`videos/abort?${upload(key, uploadId)}`, { method: "POST", body: "{}" }),
  upload: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return call<{ src: string }>("assets", { method: "POST", body: form });
  },
};

/** What the server supports, set once the schema has loaded. */
export const features = { videoUploads: false };

/** A viewable URL for any stored image value. */
export const imageUrl = (value: string) =>
  value.startsWith("/_cms/asset/") ? value : `/_cms/asset/?src=${encodeURIComponent(value)}`;

export function timeAgo(ms?: number) {
  if (!ms) return undefined;
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 45) return "just now";
  const units: [number, string][] = [[60, "minute"], [3600, "hour"], [86400, "day"], [2592000, "month"]];
  for (let i = units.length - 1; i >= 0; i--) {
    const [size, name] = units[i];
    if (s >= size) {
      const n = Math.round(s / size);
      return `${n} ${name}${n === 1 ? "" : "s"} ago`;
    }
  }
  return "just now";
}
