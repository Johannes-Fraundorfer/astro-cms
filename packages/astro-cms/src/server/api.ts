import type { APIContext } from "astro";
import config from "virtual:cms/config";
import {
  clean,
  collectImages,
  collectRefs,
  defaultLocale,
  documentPath,
  emptyData,
  getType,
  isLocalized,
  locales,
  localizePath,
  mapImages,
  newKey,
  normalizeImagePath,
  refKey,
  ID,
  slugify,
  storageId,
  validate,
  walkImages,
} from "../schema.ts";
import {
  assetAlts,
  clearDraft,
  deleteAsset,
  deleteAssetMeta,
  getSetting,
  listAssets,
  markPublished,
  markUnpublished,
  moveAssetMeta,
  putAsset,
  saveDraft,
  setAssetAlt,
  setSetting,
} from "./db.ts";
import { current, getDoc, listDocs, summarize, type Doc } from "./content.ts";
import { sanitizeDoc } from "./sanitize.ts";
import { authRequired } from "./auth.ts";
import { ASSET_PREFIX, PUBLISHED_ASSET_DIR, assetWrite, commit, type FileWrite } from "./publish.ts";
import { deployState } from "./deploy.ts";
import { VideoError, abortUpload, completeUpload, startUpload, uploadPart, videoUploads } from "./videos.ts";

type Data = Record<string, unknown>;

class HttpError extends Error {
  constructor(public status: number, message: string, public detail?: unknown) {
    super(message);
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function requireType(name: string) {
  const type = getType(config, name);
  if (!type) throw new HttpError(404, `Unknown type "${name}"`);
  return type;
}

function requireLocale(locale: string | null) {
  const code = locale || defaultLocale(config);
  if (!locales(config).includes(code)) throw new HttpError(400, `Unknown locale "${code}"`);
  return code;
}

async function requireDoc(typeName: string, id: string, locale: string) {
  requireType(typeName);
  const doc = await getDoc(typeName, id, locale);
  if (!doc) throw new HttpError(404, `Document ${typeName}/${id} not found`);
  return doc;
}

async function uniqueId(typeName: string, base: string) {
  const taken = new Set((await listDocs(typeName)).map((d) => d.id));
  const root = slugify(base) || "untitled";
  if (!taken.has(root)) return root;
  for (;;) {
    const id = `${root}-${newKey().slice(0, 4)}`;
    if (!taken.has(id)) return id;
  }
}

async function detail(typeName: string, id: string, locale: string) {
  const doc = await requireDoc(typeName, id, locale);
  const type = requireType(typeName);
  const ref = refKey(typeName, id);
  const usedBy = (await listDocs(undefined, locale))
    .filter((d) => refKey(d.type, d.id) !== ref && collectRefs(current(d)).has(ref))
    .map(summarize);
  const translations: Record<string, string> = {};
  if (isLocalized(config, type)) {
    for (const code of locales(config)) translations[code] = (await getDoc(typeName, id, code))?.status ?? "missing";
  }
  return {
    ...summarize(doc),
    draft: doc.draft,
    published: doc.published,
    fallback: doc.fallback,
    publishedPath: doc.published ? localizePath(config, documentPath(type, doc.published), locale) : undefined,
    usedBy,
    translations,
  };
}

async function publish(origin: string, typeName: string, id: string, locale: string) {
  const type = requireType(typeName);
  const doc = await requireDoc(typeName, id, locale);
  if (doc.status === "missing") throw new HttpError(400, "Create this translation before publishing it");
  const data = structuredClone(current(doc)) as Data;

  const errors = validate(config, type.fields, data);
  if (errors.length) throw new HttpError(422, "Fix the highlighted fields before publishing", errors);

  const uploads: { key: string; set: (v: unknown) => void }[] = [];
  walkImages(config, type.fields, data, (value, set) => {
    if (value.startsWith(ASSET_PREFIX)) uploads.push({ key: value.slice(ASSET_PREFIX.length), set });
    else set(normalizeImagePath(value));
  });

  const writes: FileWrite[] = [];
  for (const { key, set } of uploads) {
    writes.push(await assetWrite(key));
    set(`@/assets/cms/${key}`);
  }

  const out = clean(data) as Data;
  writes.push({ path: `src/content/${typeName}/${doc.sid}.json`, content: `${JSON.stringify(out, null, 2)}\n` });

  const title = summarize(doc).title;
  const suffix = locale === defaultLocale(config) ? "" : ` (${locale})`;
  const result = await commit(origin, { writes, deletes: [], message: `content: publish ${type.title} "${title}"${suffix}` });
  await markPublished(typeName, doc.sid, out);
  // Published uploads now live in the repo. Other drafts that picked the same
  // upload keep the /_cms/asset/ path until they publish, so only unused ones go.
  const stillUsed = await imageUsage();
  await Promise.all(uploads.filter(({ key }) => !stillUsed.has(`${ASSET_PREFIX}${key}`)).map(({ key }) => deleteAsset(key)));
  return result;
}

/**
 * The locale versions an action on `ids` applies to: in the default locale a
 * document and its translations, in another locale just that translation.
 */
async function versionsOf(typeName: string, ids: string[], locale: string) {
  const type = requireType(typeName);
  const codes = locale === defaultLocale(config) ? locales(config) : [locale];
  const out: Doc[] = [];
  for (const id of ids) {
    for (const code of codes) {
      const doc = await getDoc(typeName, id, code);
      if (doc && doc.status !== "missing" && (code === locale || isLocalized(config, type))) out.push(doc);
    }
  }
  return out;
}

const label = (type: { title: string }, docs: Doc[], verb: string, locale: string) => {
  const ids = new Set(docs.map((d) => d.id));
  const what = ids.size === 1 ? `${type.title} "${summarize(docs[0]).title}"` : `${ids.size} ${type.title}`;
  return `content: ${verb} ${what}${locale === defaultLocale(config) ? "" : ` (${locale})`}`;
};

/** Deletes documents, with one commit for all of them. */
async function removeDocs(origin: string, typeName: string, ids: string[], locale: string) {
  const type = requireType(typeName);
  if (type.kind === "singleton" && locale === defaultLocale(config)) throw new HttpError(400, "Singletons can't be deleted");
  const targets = await versionsOf(typeName, ids, locale);
  if (!targets.length) throw new HttpError(404, "Nothing to delete");
  const deletes = targets.filter((d) => d.published).map((d) => `src/content/${typeName}/${d.sid}.json`);
  if (deletes.length) await commit(origin, { writes: [], deletes, message: label(type, targets, "delete", locale) });
  await Promise.all(targets.map((d) => markUnpublished(typeName, d.sid)));
  return new Set(targets.map((d) => d.id)).size;
}

/** Takes documents off the site and keeps their content as drafts, with one commit for all of them. */
async function unpublishDocs(origin: string, typeName: string, ids: string[], locale: string) {
  const type = requireType(typeName);
  const targets = (await versionsOf(typeName, ids, locale)).filter((d) => d.published);
  if (!targets.length) throw new HttpError(400, "Nothing selected is published");
  if (type.kind === "singleton") throw new HttpError(400, `${type.title} can't be unpublished`);
  const result = await commit(origin, {
    writes: [],
    deletes: targets.map((d) => `src/content/${typeName}/${d.sid}.json`),
    message: label(type, targets, "unpublish", locale),
  });
  await Promise.all(targets.map((d) => markUnpublished(typeName, d.sid, current(d))));
  return { count: new Set(targets.map((d) => d.id)).size, deploy: result };
}

async function duplicateDoc(typeName: string, id: string) {
  const type = requireType(typeName);
  if (type.kind === "singleton") throw new HttpError(400, "Singletons can't be duplicated");
  const doc = await requireDoc(typeName, id, defaultLocale(config));
  const data = structuredClone(current(doc)) as Data;
  const titleKey = type.preview.title;
  if (typeof data[titleKey] === "string") data[titleKey] = `${data[titleKey]} (copy)`;
  const slugField = type.fields.find((f) => f.type === "slug");
  const newId = await uniqueId(typeName, `${id}-copy`);
  if (slugField) data[slugField.name] = newId;
  await saveDraft(typeName, newId, data);
  return newId;
}

/* ---------------------------------- Media --------------------------------- */

const libraryFiles = import.meta.glob("/src/assets/**/*.{png,jpg,jpeg,webp,avif,gif,svg}", {
  eager: true,
  import: "default",
}) as Record<string, ImageMetadata>;

const mediaFolders = () => [PUBLISHED_ASSET_DIR, ...(config.media?.folders ?? [])].map((f) => `/${f.replace(/^\/|\/$/g, "")}/`);

type Usage = {
  count: number;
  /** The documents using the image, draft or published. */
  docs: Map<string, { type: string; id: string; locale: string; title: string }>;
  /** The alt text it last had, per locale. */
  alts: Map<string, { alt: string; at: number }>;
};

/**
 * Where each image is used across all documents and locales. Published
 * versions count too: the live site still needs an image a draft dropped.
 */
async function imageUsage() {
  const usage = new Map<string, Usage>();
  for (const locale of locales(config)) {
    for (const doc of await listDocs(undefined, locale)) {
      if (doc.status === "missing") continue;
      const type = getType(config, doc.type)!;
      const at = doc.draftUpdatedAt ?? doc.publishedAt ?? 0;
      const versions = [doc.draft, doc.published].filter((d): d is Data => !!d);
      const seen = new Set<string>();
      for (const [n, data] of versions.entries()) {
        for (const img of collectImages(config, type.fields, data)) {
          const src = normalizeImagePath(img.src);
          const entry = usage.get(src) ?? { count: 0, docs: new Map(), alts: new Map() };
          if (!seen.has(src)) entry.count++;
          seen.add(src);
          entry.docs.set(`${doc.type}:${doc.sid}`, { type: doc.type, id: doc.id, locale, title: summarize(doc).title });
          // The current version's alt text wins over the published one's.
          const prev = entry.alts.get(locale);
          if (img.alt && (!prev || (n === 0 && at >= prev.at))) entry.alts.set(locale, { alt: img.alt, at });
          usage.set(src, entry);
        }
      }
    }
  }
  return usage;
}

/** Published images outside the CMS folder may be imported by the site's code, so only CMS uploads can be deleted. */
const isCmsFile = (value: string) => value.startsWith(`@/${PUBLISHED_ASSET_DIR.slice("src/".length)}/`);

/**
 * Saves a draft of every document version that uses `value`, with its image
 * references rewritten. Returns how many documents changed.
 */
async function rewriteUses(value: string, onlyLocale: string | undefined, rewrite: (img: { src: string; alt?: string }) => { src: string; alt?: string }) {
  let changed = 0;
  for (const locale of onlyLocale ? [onlyLocale] : locales(config)) {
    for (const doc of await listDocs(undefined, locale)) {
      if (doc.status === "missing") continue;
      const type = getType(config, doc.type)!;
      const data = structuredClone(current(doc)) as Data;
      const n = mapImages(config, type.fields, data, (img) => (normalizeImagePath(img.src) === value ? rewrite(img) : undefined));
      if (!n) continue;
      await saveDraft(doc.type, doc.sid, data);
      changed++;
    }
  }
  return changed;
}

async function storeUpload(file: unknown) {
  if (!(file instanceof File)) throw new HttpError(400, "No file uploaded");
  if (!/^image\/(png|jpe?g|webp|avif|gif|svg\+xml)$/.test(file.type)) {
    throw new HttpError(415, "Only PNG, JPG, WebP, AVIF, GIF and SVG images are supported");
  }
  if (file.size > 20 * 1024 * 1024) throw new HttpError(413, "Images can be up to 20 MB");
  if (file.type === "image/svg+xml" && unsafeSvg(await file.text())) {
    throw new HttpError(415, "This SVG contains scripts or embedded content, which isn't allowed");
  }
  const dot = file.name.lastIndexOf(".");
  const ext = dot > 0 ? file.name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, "") : "bin";
  const random = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const key = `${slugify(dot > 0 ? file.name.slice(0, dot) : file.name).slice(0, 40) || "image"}-${random}.${ext}`;
  await putAsset(key, file.type, new Uint8Array(await file.arrayBuffer()));
  return `${ASSET_PREFIX}${key}`;
}

async function mediaLibrary(locale: string) {
  const usage = await imageUsage();
  const defaults = await assetAlts(locale);
  const describe = (value: string) => {
    const u = usage.get(value);
    const docs = [...(u?.docs.values() ?? [])];
    return {
      uses: u?.count ?? 0,
      usedIn: docs,
      // This locale's default, else what it last had here, else anywhere.
      alt: defaults.get(value) ?? u?.alts.get(locale)?.alt ?? [...(u?.alts.values() ?? [])][0]?.alt,
      altUses: docs.filter((d) => d.locale === locale).length,
    };
  };
  const folders = mediaFolders();
  const published = Object.entries(libraryFiles)
    .filter(([path]) => folders.some((f) => path.startsWith(f)))
    .map(([path, meta]) => {
      const value = `@/${path.slice("/src/".length)}`;
      return {
        value,
        url: meta.src,
        name: path.slice(path.lastIndexOf("/") + 1),
        folder: path.slice("/src/".length, path.lastIndexOf("/")),
        pending: false,
        width: meta.width,
        height: meta.height,
        ...describe(value),
        deletable: isCmsFile(value) && !usage.get(value)?.count,
      };
    });
  const pending = (await listAssets()).map((a) => {
    const value = `${ASSET_PREFIX}${a.key}`;
    return {
      value,
      url: value,
      name: a.key,
      folder: "Unpublished uploads",
      pending: true,
      size: a.size,
      createdAt: a.created_at,
      ...describe(value),
      deletable: !usage.get(value)?.count,
    };
  });
  return [...pending.sort((a, b) => b.createdAt - a.createdAt), ...published.sort((a, b) => a.name.localeCompare(b.name))];
}

/**
 * Published SVGs are ordinary files on the site's own origin, where a script
 * in one runs with the site's privileges. Anything that can execute or pull in
 * outside content is refused. Entities and whitespace are normalized first, so
 * `java&#115;cript:` or `on\nload=` can't slip past the checks.
 */
function unsafeSvg(text: string) {
  let decoded: string;
  try {
    decoded = text
    .replace(/&#x([0-9a-f]+);?/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);?/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&(colon|tab|newline|lpar|rpar);/gi, (_, name) => ({ colon: ":", tab: "", newline: "", lpar: "(", rpar: ")" })[name.toLowerCase() as "colon"])
    .toLowerCase();
  } catch {
    return true; // an entity that isn't a real character
  }
  const compact = decoded.replace(/[\s\u0000-\u001f]+/g, "");
  return (
    /<(script|foreignobject|iframe|embed|object|handler|listener)\b/.test(decoded) ||
    /<!entity|<\?xml-stylesheet|@import/.test(compact) ||
    /[\s/"']on[a-z]+\s*=/.test(decoded) ||
    /(java|vb)script:/.test(compact) ||
    /data:(?!image\/(png|jpe?g|gif|webp);)/.test(compact) ||
    /attributename=["']?(on|href|xlink:href)/.test(compact)
  );
}

/* --------------------------------- Router --------------------------------- */

async function route(ctx: APIContext): Promise<Response> {
  const { request } = ctx;
  const url = new URL(request.url);
  const parts = (ctx.params.path ?? "").split("/").filter(Boolean);
  const method = request.method;
  const body = async () => (await request.json().catch(() => ({}))) as Data;
  const locale = requireLocale(url.searchParams.get("locale"));

  // GET /schema
  if (parts[0] === "schema" && method === "GET") {
    return json({
      types: config.types,
      blocks: config.blocks ?? [],
      i18n: config.i18n,
      terminal: __CMS_DEV__ && !!config.terminal,
      terminalToken: __CMS_DEV__ && config.terminal ? __CMS_DEV_TOKEN__ : undefined,
      publishTarget: config.publish?.target ?? "local",
      deployUrl: config.deploy?.url,
      signedIn: authRequired(),
      videoUploads: videoUploads(),
      typeOrder: (await getSetting<string[]>("typeOrder")) ?? [],
    });
  }

  // PUT /order {types} → the sidebar order of content types, shared by all editors
  if (parts[0] === "order" && method === "PUT") {
    const { types } = (await body()) as { types?: unknown };
    const names = new Set(config.types.map((t) => t.name));
    const list = Array.isArray(types) ? types.filter((t): t is string => typeof t === "string" && names.has(t)) : [];
    await setSetting("typeOrder", [...new Set(list)]);
    return json({ ok: true });
  }

  // GET /deploy?sha=&since=  → whether a publish is live yet
  if (parts[0] === "deploy" && method === "GET") {
    const sha = url.searchParams.get("sha") ?? "";
    const since = Number(url.searchParams.get("since")) || 0;
    return json(await deployState(sha, since));
  }

  // GET /search?types=a,b&q=
  if (parts[0] === "search" && method === "GET") {
    const types = (url.searchParams.get("types") ?? "").split(",").filter(Boolean);
    const q = (url.searchParams.get("q") ?? "").toLowerCase();
    const docs = (await listDocs(undefined, locale))
      .filter((d) => !types.length || types.includes(d.type))
      .map(summarize)
      .filter((d) => !q || `${d.title} ${d.subtitle ?? ""}`.toLowerCase().includes(q));
    return json(docs);
  }

  // GET /resolve?path=/de/work/x  → the document a public path belongs to, in that path's locale
  if (parts[0] === "resolve" && method === "GET") {
    const path = (url.searchParams.get("path") ?? "/").replace(/\/+$/, "") || "/";
    const prefix = locales(config).find((l) => l !== defaultLocale(config) && (path === `/${l}` || path.startsWith(`/${l}/`)));
    const inLocale = prefix ?? defaultLocale(config);
    const hit = (await listDocs(undefined, inLocale)).map(summarize).find((d) => d.path === path);
    return json(hit ?? null);
  }

  // /assets: the media library
  if (parts[0] === "assets") {
    if (method === "GET" && !parts[1]) return json(await mediaLibrary(locale));

    // POST /assets → upload
    if (method === "POST" && !parts[1]) {
      const form = await request.formData();
      return json({ src: await storeUpload(form.get("file")) }, 201);
    }

    const value = normalizeImagePath(url.searchParams.get("value") ?? "");
    if (!value.startsWith(ASSET_PREFIX) && !value.startsWith("@/assets/")) throw new HttpError(400, "Unknown image");

    // PATCH /assets?value=&locale= {alt, updateUses} → default alt text, optionally applied where it's used
    if (method === "PATCH" && !parts[1]) {
      const { alt, updateUses } = (await body()) as { alt?: string; updateUses?: boolean };
      const text = typeof alt === "string" ? alt.trim().slice(0, 500) : "";
      await setAssetAlt(value, locale, text);
      const updated = updateUses ? await rewriteUses(value, locale, (img) => ({ src: img.src, alt: text })) : 0;
      return json({ ok: true, updated });
    }

    // POST /assets/replace?value= (file) → upload a new file and use it wherever the old one was
    if (method === "POST" && parts[1] === "replace") {
      const form = await request.formData();
      const src = await storeUpload(form.get("file"));
      const updated = await rewriteUses(value, undefined, (img) => ({ src, alt: img.alt }));
      await moveAssetMeta(value, src);
      if (value.startsWith(ASSET_PREFIX) && !(await imageUsage()).get(value)?.count) {
        await deleteAsset(value.slice(ASSET_PREFIX.length));
      }
      return json({ src, updated });
    }

    // DELETE /assets?value= → unused images only
    if (method === "DELETE" && !parts[1]) {
      const uses = (await imageUsage()).get(value)?.count ?? 0;
      if (uses) throw new HttpError(409, `This image is used in ${uses} ${uses === 1 ? "document" : "documents"}`);
      if (value.startsWith(ASSET_PREFIX)) {
        await deleteAsset(value.slice(ASSET_PREFIX.length));
      } else {
        if (!isCmsFile(value)) throw new HttpError(400, "This image belongs to the site's code and can't be deleted here");
        const path = `src/${value.slice(2)}`;
        if (!libraryFiles[`/${path}`]) throw new HttpError(404, "Image not found");
        await commit(url.origin, { writes: [], deletes: [path], message: `content: delete image ${path.slice(path.lastIndexOf("/") + 1)}` });
      }
      await deleteAssetMeta(value);
      return json({ ok: true });
    }
    throw new HttpError(405, "Method not allowed");
  }

  // /videos: multipart uploads into the media bucket
  if (parts[0] === "videos" && method === "POST") {
    const key = url.searchParams.get("key");
    const uploadId = url.searchParams.get("uploadId");
    // POST /videos {name, type, size} → start
    if (!parts[1]) return json(await startUpload(await body()), 201);
    // POST /videos/part?key=&uploadId=&part= (bytes)
    if (parts[1] === "part") return json(await uploadPart(key, uploadId, url.searchParams.get("part"), await request.arrayBuffer()));
    // POST /videos/complete?key=&uploadId= {parts}
    if (parts[1] === "complete") return json(await completeUpload(key, uploadId, (await body()).parts));
    // POST /videos/abort?key=&uploadId=
    if (parts[1] === "abort") {
      await abortUpload(key, uploadId);
      return json({ ok: true });
    }
  }

  // POST /bulk/:type {action, ids} → one action on several documents
  if (parts[0] === "bulk" && parts[1] && method === "POST") {
    const { action, ids } = (await body()) as { action?: string; ids?: unknown };
    const list = Array.isArray(ids) ? ids.filter((i): i is string => typeof i === "string" && ID.test(i)) : [];
    if (!list.length) throw new HttpError(400, "Nothing selected");
    if (action === "delete") return json({ count: await removeDocs(url.origin, parts[1], list, locale) });
    if (action === "unpublish") return json(await unpublishDocs(url.origin, parts[1], list, locale));
    if (action === "duplicate") {
      const created = [];
      for (const id of list) created.push(await duplicateDoc(parts[1], id));
      return json({ count: created.length, ids: created });
    }
    throw new HttpError(400, "Unknown action");
  }

  if (parts[0] !== "documents") throw new HttpError(404, "Not found");
  const [, typeName, id, action] = parts;

  // GET /documents?type=&locale=
  if (!typeName && method === "GET") {
    const docs = await listDocs(url.searchParams.get("type") ?? undefined, locale);
    return json(docs.map(summarize).sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)));
  }

  // POST /documents/:type  → create (the default locale, plus the current one)
  if (typeName && !id && method === "POST") {
    const type = requireType(typeName);
    if (type.kind === "singleton") throw new HttpError(400, `${type.title} has exactly one document`);
    const { title } = (await body()) as { title?: string };
    const newId = await uniqueId(typeName, title || `untitled-${newKey().slice(0, 4)}`);
    const data = emptyData(type.fields);
    if (title) data[type.preview.title] = title;
    const slugField = type.fields.find((f) => f.type === "slug");
    if (slugField && title) data[slugField.name] = slugify(title);
    await saveDraft(typeName, newId, data);
    if (isLocalized(config, type) && locale !== defaultLocale(config)) {
      await saveDraft(typeName, storageId(config, newId, locale), data);
    }
    return json(await detail(typeName, newId, locale), 201);
  }

  if (!typeName || !id || !ID.test(id)) throw new HttpError(400, "Invalid document id");
  const sid = storageId(config, id, locale);

  if (!action && method === "GET") return json(await detail(typeName, id, locale));

  // PUT /documents/:type/:id → save draft
  if (!action && method === "PUT") {
    const type = requireType(typeName);
    const { data } = (await body()) as { data?: Data };
    if (!data || typeof data !== "object") throw new HttpError(400, "Missing data");
    await sanitizeDoc(config, type.fields, data);
    await saveDraft(typeName, sid, data);
    return json(await detail(typeName, id, locale));
  }

  // DELETE: the default locale takes its translations with it; a translation goes alone.
  if (!action && method === "DELETE") {
    await removeDocs(url.origin, typeName, [id], locale);
    return json({ ok: true });
  }

  if (method !== "POST") throw new HttpError(405, "Method not allowed");

  if (action === "publish") {
    const result = await publish(url.origin, typeName, id, locale);
    return json({ ...(await detail(typeName, id, locale)), deploy: result });
  }

  // POST …/translate?locale=de → start a translation from the default locale's content
  if (action === "translate") {
    const type = requireType(typeName);
    if (!isLocalized(config, type) || locale === defaultLocale(config)) throw new HttpError(400, "Nothing to translate");
    const base = await requireDoc(typeName, id, defaultLocale(config));
    await saveDraft(typeName, sid, structuredClone(current(base)));
    return json(await detail(typeName, id, locale), 201);
  }

  if (action === "discard") {
    const doc = await requireDoc(typeName, id, locale);
    if (!doc.published) throw new HttpError(400, "This version was never published; delete it instead");
    await clearDraft(typeName, sid);
    return json(await detail(typeName, id, locale));
  }

  if (action === "duplicate") {
    const newId = await duplicateDoc(typeName, id);
    return json(await detail(typeName, newId, locale), 201);
  }

  // POST …/unpublish → off the live site, content kept as a draft
  if (action === "unpublish") {
    const { deploy } = await unpublishDocs(url.origin, typeName, [id], locale);
    return json({ ...(await detail(typeName, id, locale)), deploy });
  }

  throw new HttpError(404, "Not found");
}

export async function handle(ctx: APIContext) {
  try {
    return await route(ctx);
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message, detail: err.detail }, err.status);
    if (err instanceof VideoError) return json({ error: err.message }, err.status);
    console.error("[cms]", err);
    return json({ error: err instanceof Error ? err.message : "Unexpected error" }, 500);
  }
}
