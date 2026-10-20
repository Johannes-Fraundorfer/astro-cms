export interface FieldBase {
  name: string;
  title?: string;
  description?: string;
  /** Publishing is blocked while a required field is empty. */
  required?: boolean;
}

export type Field =
  | (FieldBase & { type: "string"; placeholder?: string })
  | (FieldBase & { type: "text"; rows?: number; placeholder?: string })
  | (FieldBase & { type: "slug"; source?: string })
  | (FieldBase & { type: "number"; min?: number; max?: number; integer?: boolean })
  | (FieldBase & { type: "boolean" })
  | (FieldBase & { type: "date" })
  | (FieldBase & {
      type: "select";
      options: (string | { title: string; value: string })[];
    })
  | (FieldBase & { type: "image" })
  /**
   * A video by URL: a file on a CDN, or an upload when the site has a
   * `CMS_MEDIA` R2 bucket. Stored as `{ src, title? }`; videos never go into the repo.
   */
  | (FieldBase & { type: "video" })
  | (FieldBase & { type: "richText" })
  | (FieldBase & { type: "secret" })
  | (FieldBase & { type: "url" })
  /**
   * A link to a page on the site or an external URL. Stored as `{ _ref }` for a
   * page, so it follows slug changes and the page's locale, or `{ href }`.
   */
  | (FieldBase & { type: "link"; to?: string[] })
  /** One link to another document. Stored as `{ _ref: "type:id" }`. */
  | (FieldBase & { type: "reference"; to: string[] })
  /** An ordered list of links to other documents. */
  | (FieldBase & { type: "references"; to: string[] })
  /** An ordered list of blocks, each one of the named block types. */
  | (FieldBase & { type: "blocks"; of: string[] })
  | (FieldBase & { type: "object"; fields: Field[] });

export type FieldType = Field["type"];

export interface Preview {
  /** Field shown as the row title. */
  title: string;
  /** Field shown under the title. */
  subtitle?: string;
  /** Image field shown as the row thumbnail. */
  media?: string;
}

export interface BlockType {
  name: string;
  title: string;
  /** Single character or short glyph shown in lists. */
  icon?: string;
  /** What a block's row shows in lists. Without it, rows show the block's title. */
  preview?: Preview;
  fields: Field[];
}

export interface DocumentType {
  name: string;
  title: string;
  /** `singleton` types hold exactly one document whose id is the type name. */
  kind: "collection" | "singleton";
  icon?: string;
  /** Heading the type is listed under in the structure pane. */
  group?: string;
  preview: Preview;
  /**
   * Public path of a document, with `{field}` placeholders, e.g. `/work/{slug}`.
   * Omit for types that don't render a page of their own.
   */
  url?: string;
  /** Translated per locale when the config has `i18n`. Defaults to true. */
  localized?: boolean;
  /**
   * For types without a `url` (navigation, footer): the page the dashboard
   * canvas shows them on, unless they were opened from another page.
   */
  previewPath?: string;
  fields: Field[];
}

export interface Locale {
  code: string;
  title: string;
}

export interface CmsConfig {
  /** Embedded terminal in the dashboard. Only ever available under `astro dev`. */
  terminal?: boolean;
  publish?: {
    /**
     * `local` writes published content into `src/content` and `src/assets/cms`.
     * `github` commits the same files to a repository, which triggers a rebuild.
     */
    target: "local" | "github";
    github?: { repo: string; branch?: string };
  };
  /** Document-level translations: default locale at `src/content/<type>/<id>.json`, others at `<type>/<locale>/<id>.json` and `/<locale>/…`. */
  i18n?: { locales: Locale[]; defaultLocale: string };
  media?: {
    /** Asset folders shown in the media library, besides `src/assets/cms`. */
    folders?: string[];
    /**
     * Public URL of the `CMS_MEDIA` R2 bucket (its custom domain or r2.dev
     * address). Uploaded videos link there. Without it they're served through
     * the site at `/_cms/media/…`, which works but skips the bucket's CDN cache.
     */
    videoUrl?: string;
  };
  /** Live site, used to report when a publish has been deployed. */
  deploy?: { url: string };
  types: DocumentType[];
  blocks?: BlockType[];
}

export const defineConfig = (config: CmsConfig) => config;
export const defineType = (type: DocumentType) => type;
export const defineBlock = (block: BlockType) => block;

/* --------------------------------- Helpers -------------------------------- */

/** Document ids, and type names (a singleton's id is its type name): they appear in dashboard URLs. */
export const ID = /^[a-z0-9][a-z0-9-]{0,79}$/;

/** Problems in a config that would break the dashboard even though the site builds. */
export function configProblems(config: CmsConfig) {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const t of config.types) {
    if (!ID.test(t.name)) {
      const suggestion = slugify(t.name.replace(/([a-z0-9])([A-Z])/g, "$1-$2"));
      problems.push(`Type name "${t.name}" must be lowercase letters, digits and dashes${suggestion ? ` (e.g. "${suggestion}")` : ""}: it's part of the dashboard's URLs and document ids.`);
    }
    if (seen.has(t.name)) problems.push(`Type name "${t.name}" is used twice.`);
    seen.add(t.name);
  }
  const blocks = new Set<string>();
  for (const b of config.blocks ?? []) {
    if (blocks.has(b.name)) problems.push(`Block name "${b.name}" is used twice.`);
    blocks.add(b.name);
  }
  return problems;
}

export const SEP = ":";
export const refKey = (type: string, id: string) => `${type}${SEP}${id}`;
export const parseRef = (ref: string) => {
  const i = ref.indexOf(SEP);
  return { type: ref.slice(0, i), id: ref.slice(i + 1) };
};

export const fieldTitle = (f: Pick<FieldBase, "name" | "title">) =>
  f.title ?? f.name.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());

export const slugify = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

export const defaultLocale = (config: CmsConfig) => config.i18n?.defaultLocale ?? "en";
export const locales = (config: CmsConfig): string[] => config.i18n?.locales.map((l) => l.code) ?? [defaultLocale(config)];
export const isLocalized = (config: CmsConfig, type: DocumentType) => !!config.i18n && type.localized !== false;

/** Where a document's locale version is stored: `home` for the default locale, `de/home` otherwise. */
export function storageId(config: CmsConfig, id: string, locale?: string) {
  return !locale || locale === defaultLocale(config) ? id : `${locale}/${id}`;
}

export function splitStorageId(config: CmsConfig, sid: string) {
  const i = sid.indexOf("/");
  return i === -1 ? { id: sid, locale: defaultLocale(config) } : { id: sid.slice(i + 1), locale: sid.slice(0, i) };
}

/** `/about` → `/de/about` for non-default locales; external links and anchors stay as they are. */
export function localizePath(config: CmsConfig, path: string | undefined, locale?: string) {
  if (!path || !path.startsWith("/") || path.startsWith("//")) return path;
  if (!locale || locale === defaultLocale(config)) return path;
  return path === "/" ? `/${locale}` : `/${locale}${path}`;
}

export const newKey = () => Math.random().toString(36).slice(2, 10);

/** Resolves `/work/{slug}` against a document's data. */
export function documentPath(type: DocumentType, data: Record<string, unknown>) {
  if (!type.url) return undefined;
  let missing = false;
  const path = type.url.replace(/\{(\w+)\}/g, (_, key) => {
    const value = data[key];
    if (typeof value !== "string" || !value) missing = true;
    return typeof value === "string" ? value : "";
  });
  // A slug of `index` is the folder's own page: `/index` → `/`.
  return missing ? undefined : path.replace(/\/{2,}/g, "/").replace(/\/index$/, "") || "/";
}

export function getType(config: CmsConfig, name: string) {
  return config.types.find((t) => t.name === name);
}

export function getBlock(config: CmsConfig, name: string) {
  return config.blocks?.find((b) => b.name === name);
}

export function emptyValue(field: Field): unknown {
  switch (field.type) {
    case "boolean":
      return false;
    case "blocks":
    case "references":
      return [];
    case "object":
      return Object.fromEntries(field.fields.map((f) => [f.name, emptyValue(f)]));
    default:
      return undefined;
  }
}

export function emptyData(fields: Field[]) {
  return Object.fromEntries(
    fields.map((f) => [f.name, emptyValue(f)]).filter(([, v]) => v !== undefined),
  ) as Record<string, unknown>;
}

/** An image field holds `{ src, alt }`; older content stored the bare `src` string. */
export type ImageValue = string | { src?: string; alt?: string };

export const imageSrc = (v: unknown): string | undefined =>
  typeof v === "string" ? v : v && typeof v === "object" && typeof (v as { src?: unknown }).src === "string" ? (v as { src: string }).src : undefined;

export type VideoValue = { src?: string; title?: string };

/** Video sources: web URLs, or uploads served by the site itself. */
export const SAFE_VIDEO_SRC = /^(https?:\/\/|\/_cms\/media\/)/i;

export type LinkValue = { _ref?: string; href?: string; newTab?: boolean };

/** Types a link field can point to: the ones it names, else every type with a page. */
export const linkTargets = (config: CmsConfig, field: { to?: string[] }) =>
  field.to ?? config.types.filter((t) => t.url).map((t) => t.name);

/** Links in content may only go to web pages, mail, phone or on-page anchors. */
export const SAFE_HREF = /^(https?:|mailto:|tel:|\/|#)/i;

const isEmpty = (v: unknown): boolean =>
  (v !== null && typeof v === "object" && !Array.isArray(v) && "src" in v && isEmpty((v as { src: unknown }).src)) ||
  (v !== null && typeof v === "object" && !Array.isArray(v) && ("_ref" in v || "href" in v) && !(v as LinkValue)._ref && !(v as LinkValue).href?.trim()) ||
  v === undefined ||
  v === null ||
  v === "" ||
  (Array.isArray(v) && v.length === 0) ||
  (typeof v === "string" && v.replace(/<[^>]*>/g, "").trim() === "" && !/<img/i.test(v));

export interface ValidationError {
  path: string;
  message: string;
}

/** Required-field check, run before publishing. */
export function validate(
  config: CmsConfig,
  fields: Field[],
  data: Record<string, unknown> | undefined,
  base = "",
): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const field of fields) {
    const path = base ? `${base}.${field.name}` : field.name;
    const value = data?.[field.name];
    if (field.required && isEmpty(value)) {
      errors.push({ path, message: `${fieldTitle(field)} is required` });
      continue;
    }
    if (field.type === "object" && value && typeof value === "object") {
      errors.push(...validate(config, field.fields, value as Record<string, unknown>, path));
    }
    if (field.type === "blocks" && Array.isArray(value)) {
      value.forEach((item, i) => {
        const block = getBlock(config, (item as { _type: string })._type);
        if (block) errors.push(...validate(config, block.fields, item, `${path}.${i}`));
      });
    }
  }
  return errors;
}

/** Drops empty values so published JSON stays minimal and schema-valid. */
export function clean(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(clean).filter((v) => v !== undefined);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const c = clean(v);
      if (c !== undefined) out[k] = c;
    }
    return out;
  }
  if (value === null || value === "") return undefined;
  return value;
}

/** Calls `visit` for every image field value, depth-first. */
export function walkImages(
  config: CmsConfig,
  fields: Field[],
  data: Record<string, unknown> | undefined,
  visit: (value: string, set: (next: unknown) => void) => void,
) {
  if (!data) return;
  for (const field of fields) {
    const value = data[field.name];
    if (field.type === "image" && typeof value === "string") {
      visit(value, (next) => (data[field.name] = next));
    } else if (field.type === "image" && value && typeof value === "object" && typeof (value as { src?: unknown }).src === "string") {
      const img = value as { src: unknown };
      visit(img.src as string, (next) => (img.src = next));
    } else if (field.type === "object" && value && typeof value === "object") {
      walkImages(config, field.fields, value as Record<string, unknown>, visit);
    } else if (field.type === "blocks" && Array.isArray(value)) {
      for (const item of value) {
        const block = getBlock(config, item?._type);
        if (block) walkImages(config, block.fields, item, visit);
      }
    }
  }
}

export type ImageRef = { src: string; alt?: string };

/**
 * Rewrites image values in place. `visit` gets each image as `{ src, alt }` and
 * returns its replacement, or undefined to leave it. Returns how many changed.
 */
export function mapImages(
  config: CmsConfig,
  fields: Field[],
  data: Record<string, unknown> | undefined,
  visit: (img: ImageRef) => ImageRef | undefined,
): number {
  if (!data) return 0;
  let changed = 0;
  for (const field of fields) {
    const value = data[field.name];
    if (field.type === "image") {
      const img =
        typeof value === "string"
          ? { src: value }
          : value && typeof value === "object" && typeof (value as ImageRef).src === "string"
            ? (value as ImageRef)
            : undefined;
      const next = img && visit({ src: img.src, alt: img.alt });
      if (next) {
        data[field.name] = next.alt ? next : { src: next.src };
        changed++;
      }
    } else if (field.type === "object" && value && typeof value === "object") {
      changed += mapImages(config, field.fields, value as Record<string, unknown>, visit);
    } else if (field.type === "blocks" && Array.isArray(value)) {
      for (const item of value) {
        const block = getBlock(config, item?._type);
        if (block) changed += mapImages(config, block.fields, item, visit);
      }
    }
  }
  return changed;
}

/** Collects every `_ref` in a document, used for "used on" backlinks. */
export function collectRefs(value: unknown, out = new Set<string>()) {
  if (Array.isArray(value)) value.forEach((v) => collectRefs(v, out));
  else if (value && typeof value === "object") {
    const ref = (value as { _ref?: unknown })._ref;
    if (typeof ref === "string") out.add(ref);
    Object.values(value).forEach((v) => collectRefs(v, out));
  }
  return out;
}

export function previewOf(preview: Preview | undefined, data: Record<string, unknown> | undefined) {
  const text = (key?: string) => {
    const v = key ? data?.[key] : undefined;
    return typeof v === "string" ? v.replace(/<[^>]*>/g, "").trim() : undefined;
  };
  return {
    title: text(preview?.title),
    subtitle: text(preview?.subtitle),
    media: preview?.media ? imageSrc(data?.[preview.media]) : undefined,
  };
}

/**
 * Published images are stored as `@/assets/…`, which resolves the same from any
 * content folder depth. Older content used paths relative to the JSON file.
 */
export const normalizeImagePath = (value: string) => value.replace(/^(\.\.\/)+assets\//, "@/assets/");

/** Every image in a document with its alt text, for usage counts in the media library. */
export function collectImages(
  config: CmsConfig,
  fields: Field[],
  data: Record<string, unknown> | undefined,
  out: { src: string; alt?: string }[] = [],
) {
  if (!data) return out;
  for (const field of fields) {
    const value = data[field.name];
    if (field.type === "image") {
      const src = imageSrc(value);
      if (src) out.push({ src, alt: typeof value === "object" && value ? (value as { alt?: string }).alt : undefined });
    } else if (field.type === "object" && value && typeof value === "object") {
      collectImages(config, field.fields, value as Record<string, unknown>, out);
    } else if (field.type === "blocks" && Array.isArray(value)) {
      for (const item of value) {
        const block = getBlock(config, item?._type);
        if (block) collectImages(config, block.fields, item, out);
      }
    }
  }
  return out;
}
