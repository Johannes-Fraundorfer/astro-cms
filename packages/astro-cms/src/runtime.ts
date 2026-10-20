import { getCollection, getEntry } from "astro:content";
import config from "virtual:cms/config";
import {
  defaultLocale,
  documentPath,
  getType,
  isLocalized,
  locales,
  localizePath,
  refKey,
  storageId,
  walkImages,
  SAFE_HREF,
  SAFE_VIDEO_SRC,
  type LinkValue,
} from "./schema.ts";

type Data = Record<string, any>;

export interface CmsEntry<T extends Data = Data> {
  type: string;
  /** The document's id, shared by its translations. */
  id: string;
  /** The locale that was asked for. */
  locale: string;
  /** Where that locale's version is (or would be) stored: `atlas` or `de/atlas`. */
  sid: string;
  data: T;
  /** True when no translation exists and `data` is the default locale's. */
  fallback?: boolean;
}

interface AstroLike {
  locals: Pick<App.Locals, "cmsPreview" | "cmsDrafts">;
  url: URL;
  props?: Record<string, any>;
  params?: Record<string, string | undefined>;
}

/** Context for build-time calls such as `getStaticPaths`, which only ever see published content. */
export const BUILD = { locals: {}, url: new URL("http://build.local") } satisfies AstroLike;

export const DEFAULT_LOCALE = defaultLocale(config);
export const LOCALES = locales(config);

/** The page's locale: from props (so the dashboard preview can set it), else the route param. */
export const cmsLocale = (Astro: AstroLike): string =>
  Astro.props?.locale ?? Astro.params?.locale ?? DEFAULT_LOCALE;

/** Internal links get the locale prefix: `/work` → `/de/work`. */
export const localizeHref = (href: string | undefined, locale: string) => localizePath(config, href, locale);

const images = import.meta.glob("/src/assets/**/*.{png,jpg,jpeg,webp,avif,gif,svg}", {
  eager: true,
  import: "default",
}) as Record<string, ImageMetadata>;

/** Maps a stored image path (`@/assets/…`, or a relative one from older content) to the imported image. */
export function resolveImage(value: string): ImageMetadata | string {
  if (value.startsWith("@/assets/")) return images[`/src/${value.slice(2)}`] ?? value;
  const relative = value.match(/^(?:\.\.\/)+(assets\/.*)$/);
  if (relative) return images[`/src/${relative[1]}`] ?? value;
  return value;
}

/**
 * Draft data holds raw values: published images as `@/assets/…` paths and
 * unpublished uploads as `/_cms/asset/…`. Uploads become absolute URLs so the
 * image pipeline fetches them as an allowed remote rather than a static asset.
 */
function hydrate(Astro: AstroLike, type: string, data: Data) {
  const copy = structuredClone(data);
  const def = getType(config, type);
  if (def) {
    walkImages(config, def.fields, copy, (value, set) =>
      set(value.startsWith("/_cms/asset/") ? new URL(value, Astro.url.origin).href : resolveImage(value)),
    );
  }
  return copy;
}

async function drafts(Astro: AstroLike) {
  if (!Astro.locals.cmsPreview) return undefined;
  Astro.locals.cmsDrafts ??= import("./server/db.ts").then(async ({ allRows }) => {
    const map = new Map<string, Data>();
    for (const row of await allRows()) {
      if (row.draft) map.set(refKey(row.type, row.id), JSON.parse(row.draft));
    }
    return map;
  });
  return Astro.locals.cmsDrafts;
}

/** One stored version: its draft inside the dashboard preview, its published version everywhere else. */
async function stored<T extends Data>(Astro: AstroLike, type: string, sid: string): Promise<T | undefined> {
  const draft = (await drafts(Astro))?.get(refKey(type, sid));
  if (draft) return hydrate(Astro, type, draft) as T;
  const entry = await getEntry(type as never, sid);
  return entry ? (entry as { data: T }).data : undefined;
}

/** One document in a locale, falling back to the default locale when it isn't translated. */
export async function cmsEntry<T extends Data = Data>(
  Astro: AstroLike,
  type: string,
  id: string,
  locale = DEFAULT_LOCALE,
): Promise<CmsEntry<T> | undefined> {
  const def = getType(config, type);
  const localized = !!def && isLocalized(config, def) && locale !== DEFAULT_LOCALE;
  const sid = localized ? storageId(config, id, locale) : id;
  if (localized) {
    const data = await stored<T>(Astro, type, sid);
    if (data) return { type, id, locale, sid, data };
  }
  const base = await stored<T>(Astro, type, id);
  if (!base) return undefined;
  return { type, id, locale, sid, data: base, fallback: localized };
}

/** Every document of a type in a locale, with drafts overlaid inside the dashboard preview. */
export async function cmsList<T extends Data = Data>(Astro: AstroLike, type: string, locale = DEFAULT_LOCALE) {
  const ids = new Set<string>();
  for (const e of (await getCollection(type as never)) as { id: string }[]) if (!e.id.includes("/")) ids.add(e.id);
  for (const ref of (await drafts(Astro))?.keys() ?? []) {
    if (ref.startsWith(`${type}:`) && !ref.slice(type.length + 1).includes("/")) ids.add(ref.slice(type.length + 1));
  }
  const out: CmsEntry<T>[] = [];
  for (const id of ids) {
    const entry = await cmsEntry<T>(Astro, type, id, locale);
    if (entry) out.push(entry);
  }
  return out;
}

export async function cmsFind<T extends Data = Data>(
  Astro: AstroLike,
  type: string,
  field: string,
  value: unknown,
  locale = DEFAULT_LOCALE,
) {
  return (await cmsList<T>(Astro, type, locale)).find((e) => e.data[field] === value);
}

/** Resolves `{ _ref }` values to their documents in a locale, dropping any that no longer exist. */
export async function cmsResolve<T extends Data = Data>(
  Astro: AstroLike,
  refs: { _ref: string }[] | undefined,
  locale = DEFAULT_LOCALE,
) {
  const out: CmsEntry<T>[] = [];
  for (const { _ref } of refs ?? []) {
    const i = _ref.indexOf(":");
    const entry = await cmsEntry<T>(Astro, _ref.slice(0, i), _ref.slice(i + 1), locale);
    if (entry) out.push(entry);
  }
  return out;
}

/** `getStaticPaths` for a page that exists once per locale (a `[...locale]` route). */
export function cmsLocalePaths() {
  return LOCALES.map((locale) => ({
    params: { locale: locale === DEFAULT_LOCALE ? undefined : locale },
    props: { locale },
  }));
}

/**
 * `getStaticPaths` for a template page: one path per document per locale. The
 * route param `param` (e.g. `[slug]`) gets each document's `field` value,
 * which is the param's name unless given. Props carry both, typed, so
 * `Astro.props.slug` type-checks.
 */
export async function cmsDocumentPaths<P extends string = "slug">(type: string, param: P = "slug" as P, field: string = param) {
  const paths: { params: { locale: string | undefined } & Record<P, string>; props: { locale: string } & Record<P, string> }[] = [];
  for (const locale of LOCALES) {
    for (const entry of await cmsList(BUILD, type, locale)) {
      const value = entry.data[field];
      if (typeof value !== "string" || !value) continue;
      const key = { [param]: value } as Record<P, string>;
      paths.push({
        params: { locale: locale === DEFAULT_LOCALE ? undefined : locale, ...key },
        props: { locale, ...key },
      });
    }
  }
  return paths;
}

/**
 * Resolves a link field to an href in a locale: a page link to that page's
 * current URL (with the locale prefix), a typed URL as it is. Links to pages
 * that no longer exist resolve to undefined, so they can be left out.
 */
export async function cmsLink(Astro: AstroLike, value: unknown, locale = DEFAULT_LOCALE): Promise<string | undefined> {
  if (!value || typeof value !== "object") return typeof value === "string" ? localizeHref(value, locale) : undefined;
  const { _ref, href } = value as LinkValue;
  if (_ref) {
    const i = _ref.indexOf(":");
    const type = getType(config, _ref.slice(0, i));
    const entry = type && (await cmsEntry(Astro, type.name, _ref.slice(i + 1), locale));
    const path = type && entry ? documentPath(type, entry.data) : undefined;
    return path ? localizePath(config, path, locale) : undefined;
  }
  const url = href?.trim();
  return url && SAFE_HREF.test(url) ? localizeHref(url, locale) : undefined;
}

export type LinkAttrs = { href?: string; target?: string; rel?: string };

/** `href`, plus `target` and `rel` when the link opens in a new tab. No `href` when the link goes nowhere. */
export async function cmsLinkAttrs(Astro: AstroLike, value: unknown, locale = DEFAULT_LOCALE): Promise<LinkAttrs> {
  const href = await cmsLink(Astro, value, locale);
  if (!href) return {};
  const newTab = !!value && typeof value === "object" && !!(value as LinkValue).newTab;
  return newTab ? { href, target: "_blank", rel: "noopener" } : { href };
}

/**
 * Normalizes an image field for components: `{ src, alt }` whether the content
 * stores an object or (older content) just the path.
 */
export function cmsImage(value: unknown): { src: ImageMetadata | string; alt?: string } | undefined {
  if (!value) return undefined;
  if (typeof value === "string") return { src: value };
  const v = value as Record<string, unknown>;
  // A resolved image on its own is ImageMetadata, which also has a `src`.
  if ("format" in v && "width" in v) return { src: v as unknown as ImageMetadata };
  if (!v.src) return undefined;
  return { src: v.src as ImageMetadata | string, alt: typeof v.alt === "string" && v.alt ? v.alt : undefined };
}

/** For props that render inline markup (such as `Card`'s), so CMS text shows as text. */
export const cmsEscape = (value?: string) => value?.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Types browsers need hinted to pick a source; others play without one. */
const VIDEO_TYPES: Record<string, string> = { mp4: "video/mp4", m4v: "video/mp4", webm: "video/webm", m3u8: "application/vnd.apple.mpegurl" };

/**
 * Normalizes a video field for components: `{ src, title, type }`, with `type`
 * guessed from the file extension. Undefined when no video is set.
 * `.m3u8` streams play natively in Safari only; other browsers need hls.js.
 */
export function cmsVideo(value: unknown): { src: string; title?: string; type?: string } | undefined {
  if (!value || typeof value !== "object") return undefined;
  const { src, title } = value as { src?: unknown; title?: unknown };
  if (typeof src !== "string" || !SAFE_VIDEO_SRC.test(src)) return undefined;
  const ext = src.split(/[?#]/)[0].split(".").pop()?.toLowerCase() ?? "";
  return { src, title: typeof title === "string" && title ? title : undefined, type: VIDEO_TYPES[ext] };
}

export type FieldKind = "text" | "multiline" | "rich" | "image" | "video" | "block";

/**
 * Attributes that mark editable markup for the dashboard canvas. They render
 * nothing outside the preview, so the published HTML stays clean.
 */
export function cmsAttrs(Astro: AstroLike) {
  const on = !!Astro.locals.cmsPreview;
  return {
    // The locale's own version, even when it falls back: editing it creates the translation.
    doc: (entry: Pick<CmsEntry, "type" | "sid"> | undefined) =>
      on && entry ? { "data-cms-doc": refKey(entry.type, entry.sid) } : {},
    field: (path: string, kind: FieldKind = "text", label?: string) =>
      on ? { "data-cms-field": path, "data-cms-kind": kind, ...(label ? { "data-cms-label": label } : {}) } : {},
  };
}
