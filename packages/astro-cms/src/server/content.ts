import config from "virtual:cms/config";
import { allRows, getRow, type DocRow } from "./db.ts";
import {
  defaultLocale,
  documentPath,
  getType,
  isLocalized,
  localizePath,
  previewOf,
  refKey,
  splitStorageId,
  storageId,
} from "../schema.ts";

type Data = Record<string, unknown>;

const files = import.meta.glob("/src/content/**/*.json", {
  eager: true,
  import: "default",
}) as Record<string, Data>;

/** Published data as it exists in the files the site was built from, keyed by `type:storageId`. */
function fileData() {
  const out = new Map<string, Data>();
  for (const [path, data] of Object.entries(files)) {
    const [, , , type, ...rest] = path.split("/");
    out.set(refKey(type, rest.join("/").replace(/\.json$/, "")), structuredClone(data));
  }
  return out;
}

/** When the file data above was read; this module reloads whenever a content file changes. */
const filesLoadedAt = Date.now();

/**
 * Files are the published source, but they lag behind a publish: a deployed
 * site until it rebuilds, `astro dev` until the file change reloads this module.
 * Until then, the snapshot saved at publish time wins.
 */
function publishedOf(row: DocRow | undefined | null, file: Data | undefined) {
  const filesAsOf = __CMS_DEV__ ? filesLoadedAt : __CMS_BUILD_TIME__;
  // A newer publish, or a newer unpublish/delete (published cleared), overrides the file.
  if (row && (row.published_at ?? 0) > filesAsOf) return row.published ? (JSON.parse(row.published) as Data) : undefined;
  return file;
}

/** `missing`: a translation that doesn't exist yet; the page falls back to the default locale. */
export type Status = "published" | "changed" | "draft" | "empty" | "missing";

export interface Doc {
  type: string;
  /** The document's id, shared by all its translations. */
  id: string;
  locale: string;
  /** Where this locale version is stored: `home`, or `de/home`. */
  sid: string;
  draft?: Data;
  published?: Data;
  /** For a missing translation: the default locale's content, shown in its place. */
  fallback?: Data;
  draftUpdatedAt?: number;
  publishedAt?: number;
  status: Status;
}

function toDoc(type: string, sid: string, row: DocRow | undefined | null, file: Data | undefined): Doc {
  const { id, locale } = splitStorageId(config, sid);
  const published = publishedOf(row, file);
  const draft = row?.draft ? (JSON.parse(row.draft) as Data) : undefined;
  return {
    type,
    id,
    locale,
    sid,
    draft,
    published,
    draftUpdatedAt: row?.draft_updated_at ?? undefined,
    publishedAt: row?.published_at ?? undefined,
    status: draft ? (published ? "changed" : "draft") : published ? "published" : "empty",
  };
}

/** Every stored locale version, keyed by `type:storageId`. */
async function storedDocs() {
  const rows = await allRows();
  const fileMap = fileData();
  const byRef = new Map(rows.map((r) => [refKey(r.type, r.id), r]));
  const refs = new Set([...fileMap.keys(), ...byRef.keys()]);
  for (const t of config.types) if (t.kind === "singleton") refs.add(refKey(t.name, t.name));

  const out = new Map<string, Doc>();
  for (const ref of refs) {
    const i = ref.indexOf(":");
    const [t, sid] = [ref.slice(0, i), ref.slice(i + 1)];
    if (!getType(config, t)) continue;
    out.set(ref, toDoc(t, sid, byRef.get(ref), fileMap.get(ref)));
  }
  return out;
}

/** A document in one locale: its translation, or a `missing` placeholder over the default locale. */
function inLocale(stored: Map<string, Doc>, base: Doc, locale: string): Doc {
  const type = getType(config, base.type)!;
  if (!isLocalized(config, type) || locale === defaultLocale(config)) return base;
  const sid = storageId(config, base.id, locale);
  const translated = stored.get(refKey(base.type, sid));
  if (translated && translated.status !== "empty") return translated;
  return { type: base.type, id: base.id, locale, sid, fallback: current(base), status: "missing" };
}

function isListed(doc: Doc) {
  return doc.status !== "empty" || getType(config, doc.type)?.kind === "singleton";
}

export async function listDocs(type?: string, locale = defaultLocale(config)) {
  const stored = await storedDocs();
  const docs: Doc[] = [];
  for (const doc of stored.values()) {
    if (doc.locale !== defaultLocale(config)) continue;
    if (type && doc.type !== type) continue;
    if (!isListed(doc)) continue;
    docs.push(inLocale(stored, doc, locale));
  }
  return docs;
}

export async function getDoc(type: string, id: string, locale = defaultLocale(config)) {
  const baseRow = await getRow(type, id);
  const base = toDoc(type, id, baseRow, fileData().get(refKey(type, id)));
  if (!isListed(base)) return undefined;
  const def = getType(config, type);
  if (!def || !isLocalized(config, def) || locale === defaultLocale(config)) return base;
  const sid = storageId(config, id, locale);
  const translated = toDoc(type, sid, await getRow(type, sid), fileData().get(refKey(type, sid)));
  if (translated.status !== "empty") return translated;
  return { type, id, locale, sid, fallback: current(base), status: "missing" } satisfies Doc;
}

export const current = (doc: Doc) => doc.draft ?? doc.published ?? doc.fallback ?? {};

export function summarize(doc: Doc) {
  const type = getType(config, doc.type)!;
  const data = current(doc);
  const preview = previewOf(type.preview, data);
  return {
    type: doc.type,
    id: doc.id,
    locale: doc.locale,
    title: preview.title || (type.kind === "singleton" ? type.title : "Untitled"),
    subtitle: preview.subtitle,
    media: preview.media,
    status: doc.status,
    updatedAt: doc.draftUpdatedAt ?? doc.publishedAt,
    publishedAt: doc.publishedAt,
    path: localizePath(config, documentPath(type, data), doc.locale),
  };
}
