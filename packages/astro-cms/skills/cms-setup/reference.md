# astro-cms reference

Package `@johannes-fraundorfer/astro-cms`. Entry points:

| Import | What it holds |
| --- | --- |
| `@johannes-fraundorfer/astro-cms` | The Astro integration: `cms({ config, storage? })` |
| `@johannes-fraundorfer/astro-cms/config` | `defineConfig`, `defineType`, `defineBlock`, types |
| `@johannes-fraundorfer/astro-cms/runtime` | Reading content in pages and components |
| `@johannes-fraundorfer/astro-cms/collections` | `cmsCollections(config)` for `src/content.config.ts` |
| `@johannes-fraundorfer/astro-cms/env` | Types; referenced from `src/env.d.ts` |

## Content on disk

- Published content is JSON in the site repo: `src/content/<type>/<id>.json`.
  Singletons use the type name as id: `src/content/home/home.json`.
- Translations (with `i18n`): `src/content/<type>/<locale>/<id>.json`.
- Published images: `src/assets/cms/…`, stored in content as `{ "src": "@/assets/cms/x.png", "alt": "…" }`.
  The `@/*` → `src/*` tsconfig path is required for these to resolve.
- Drafts and unpublished uploads live in the storage adapter (D1), never in git.
- Block items carry `_type`, `_key` (unique, 8 chars) and optionally `_label`
  (an editor's name for the section).

## cms.config.ts

```ts
import { defineBlock, defineConfig, defineType } from "@johannes-fraundorfer/astro-cms/config";

export default defineConfig({
  publish: { target: "github", github: { repo: "owner/repo", branch: "main" } }, // or { target: "local" }
  deploy: { url: "https://live-site.example" },          // optional: deploy status in the dashboard
  i18n: { defaultLocale: "en", locales: [{ code: "en", title: "English" }, { code: "de", title: "Deutsch" }] }, // optional
  media: { folders: ["src/assets/graphics"] },            // optional: extra folders in the media library
  terminal: false,                                        // dev-only terminal drawer
  types: [/* defineType(...) */],
  blocks: [/* defineBlock(...) */],
});
```

### Types

```ts
defineType({
  name: "projects",            // lowercase kebab-case: folder name in src/content, the id in refs, part of dashboard URLs
  title: "Projects",
  kind: "collection",          // or "singleton" (exactly one document, id = name)
  icon: "◆",                   // one glyph
  group: "Collections",        // heading in the structure pane
  preview: { title: "title", subtitle: "client", media: "cover" }, // list rows
  url: "/work/{slug}",         // public path; omit for types without a page
  previewPath: "/",            // for page-less types (navigation, footer): where the canvas shows them
  localized: true,             // default true when i18n is set; false = shared across languages
  fields: [/* … */],
});
```

### Blocks

Reusable field groups for `blocks` fields (page sections, cards, menu items):

```ts
defineBlock({ name: "hero", title: "Hero", icon: "H", preview: { title: "heading", media: "image" }, fields: [/* … */] });
```

`preview` is optional on blocks: without it, rows show the block's title (useful
for a block whose only field is a list).

### Fields

Every field: `name`, optional `title`, `description`, `required` (blocks publishing while empty).

| type | Stored value | Extra options |
| --- | --- | --- |
| `string` | string | `placeholder` |
| `text` | string (multi-line) | `rows`, `placeholder` |
| `richText` | sanitized HTML (p, h2–h4, strong, em, a, lists, blockquote, code) | |
| `slug` | string | `source` (field to generate from) |
| `number` | number | `min`, `max`, `integer` |
| `boolean` | boolean | |
| `date` | `YYYY-MM-DD` | |
| `select` | string | `options`: strings or `{ title, value }` |
| `image` | `{ src, alt }` | |
| `video` | `{ src, title? }`: an `https://` URL, or `/_cms/media/…` for an upload | |
| `url` | string (web, mail, tel, `/path`, `#anchor` only) | |
| `link` | `{ _ref: "type:id" }` or `{ href }`, plus `newTab?` | `to`: allowed types (default: all with `url`) |
| `reference` | `{ _ref: "type:id" }` | `to` (required) |
| `references` | `[{ _key, _ref }]` | `to` (required) |
| `blocks` | `[{ _type, _key, …fields }]` | `of`: block names |
| `object` | nested object | `fields` |
| `secret` | string, hidden in the dashboard | never render it into pages |

Video fields take a link to a file on a CDN (MP4 or WebM; `.m3u8` streams
play natively only in Safari). With a `CMS_MEDIA` R2 bucket bound, editors can
also upload videos (up to 2 GB), which go straight into the bucket and never
into the repo. Put a poster image or playback options (autoplay, loop) in
fields next to it: those are design choices per section, not part of the video.

Prefer `link` over `url` for anything an editor points at a page: it follows
slug changes and adds the locale prefix.

## Runtime (in .astro files)

```ts
import {
  cmsEntry, cmsList, cmsFind, cmsResolve,            // read content
  cmsAttrs,                                          // mark markup for the canvas
  cmsImage, cmsVideo, cmsLink, cmsLinkAttrs, cmsEscape, // shape values for components
  cmsLocale, cmsLocalePaths, cmsDocumentPaths, localizeHref, // languages
  BUILD, DEFAULT_LOCALE, LOCALES,
} from "@johannes-fraundorfer/astro-cms/runtime";
```

| Function | Returns |
| --- | --- |
| `cmsEntry(Astro, type, id, locale?)` | `{ type, id, locale, sid, data, fallback? }` or undefined. Drafts inside the dashboard preview, published content elsewhere. Missing translations fall back to the default locale. |
| `cmsList(Astro, type, locale?)` | every document of a type |
| `cmsFind(Astro, type, field, value, locale?)` | first document whose `data[field] === value` |
| `cmsResolve(Astro, refs, locale?)` | documents for `[{ _ref }]`, skipping deleted ones |
| `cmsImage(value)` | `{ src, alt? }` for an image field (src is ImageMetadata or a URL) |
| `cmsVideo(value)` | `{ src, title?, type? }` for a video field (`type` guessed from the extension), or undefined |
| `cmsLink(Astro, value, locale?)` | href string for a `link` field, or undefined |
| `cmsLinkAttrs(Astro, value, locale?)` | `{ href?, target?, rel? }` to spread onto `<a>` |
| `cmsEscape(text)` | HTML-escaped text for props that render with `set:html` |
| `cmsLocale(Astro)` | the page's locale (props first, then the `locale` route param) |
| `cmsLocalePaths()` | `getStaticPaths` result for a `[...locale]` page |
| `cmsDocumentPaths(type, param?, field?)` | `getStaticPaths` for a template page, one path per document per locale. `param` is the route param (`"slug"` for `[slug].astro`), `field` the document field it's read from (defaults to `param`). Props are typed, so `Astro.props.slug` type-checks. |
| `BUILD` | a stand-in for `Astro` inside `getStaticPaths`, which has no `Astro` |

In `getStaticPaths`, always pass `BUILD` (there are no drafts at build time).

### Marking markup for the canvas

```astro
---
const cms = cmsAttrs(Astro);
---
<main {...cms.doc(page)}>                               <!-- which document this markup belongs to -->
  <section {...cms.field(`sections.${i}`, "block", "Hero")}>     <!-- a block item: purple tab, section tools -->
    <h1 {...cms.field(`sections.${i}.heading`, "text", "Heading")}>{heading}</h1>
    <p {...cms.field(`sections.${i}.text`, "multiline", "Text")}>{text}</p>
    <div {...cms.field(`sections.${i}.content`, "rich", "Text")} set:html={content} />
    <img {...cms.field(`sections.${i}.image`, "image", "Image")} … />
    <video {...cms.field(`sections.${i}.video`, "video", "Video")} autoplay muted loop playsinline>
      <source src={video.src} type={video.type} />
    </video>
  </section>
</main>
```

- `doc(entry)` goes on an element containing everything of that document.
  A page can hold several documents (a page plus the navigation, say);
  each gets its own `doc`.
- `field(path, kind, label)`: `path` is the dotted data path from the
  document root (`sections.2.heading`, `items.0.children.1.label`).
  Kinds: `text` (single line, edited in place), `multiline`, `rich` (HTML,
  edited in place), `image` and `video` (open the field in the panel), `block` (a list
  item: gets the section toolbar for move, add, duplicate and remove).
- The attributes render nothing outside the dashboard preview, so published
  HTML stays clean. Put them on the element that holds the text itself, not a
  wrapper, or in-place editing replaces the wrapper's children.
- Components receive the path as a prop (`path="sections.2"`) and build child
  paths from it.

### Pages

- The preview renders page files directly and passes route params as **props**
  (it skips `getStaticPaths`, which only lists published documents). Read
  params as `Astro.props.slug ?? Astro.params.slug`, and the locale with
  `cmsLocale(Astro)`.
- Pages built from sections loop over the `blocks` field and pick a component
  per `_type`; the order in the data is the order on the page.
- The overlay script is injected before `</body>`, so every previewed page
  needs a normal HTML document with a body.

## Integration and hosting

```js
// astro.config.mjs
import cloudflare from "@astrojs/cloudflare";
import cms from "@johannes-fraundorfer/astro-cms";
import cmsConfig from "./cms.config.ts";

export default defineConfig({
  adapter: cloudflare(),                 // pages stay prerendered; only CMS routes run on request
  integrations: [cms({ config: cmsConfig, storage: "d1" })],
});
```

Routes the integration adds: `/admin`, `/admin/login`, `/api/cms/*`,
`/_cms/preview/*`, `/_cms/asset/*`, `/_cms/media/*`, `/_cms/version`.

Cloudflare (`wrangler.jsonc`):

```jsonc
"assets": { "directory": "./dist", "binding": "ASSETS",
  "run_worker_first": ["/admin", "/admin/*", "/api/cms/*", "/_cms/*", "/_image"] },
"d1_databases": [{ "binding": "CMS_DB", "database_name": "<site>-cms", "database_id": "<from wrangler d1 create>" }],
// Optional, for video uploads. Without it, video fields take links only.
"r2_buckets": [{ "binding": "CMS_MEDIA", "bucket_name": "<site>-media" }]
```

Only add the bucket when the site needs uploaded videos (`npx wrangler r2
bucket create <site>-media`). Give it a public custom domain or enable its
r2.dev address and set `media.videoUrl` in `cms.config.ts` to that URL, so
videos are served from Cloudflare's cache. Without `videoUrl` they stream
through the Worker at `/_cms/media/…`, which works but counts every request.

Secrets, read through `astro:env`:

| Name | Where | Purpose |
| --- | --- | --- |
| `CMS_PASSWORD` | Worker secret; `.dev.vars` locally (optional) | Dashboard login. Without it, `astro dev` needs no login and a deployed site refuses all logins. Use a long random value: logins are limited to 10 failures per IP per 15 minutes, which slows guessing but can't stop it from many IPs. |
| `CMS_SESSION_SECRET` | Worker secret (recommended) | Random value mixed into the session signing key, so a stolen session cookie can't be used to guess the password offline. Changing it, or the password, signs everyone out. |
| `CMS_GITHUB_TOKEN` | Worker secret | Fine-grained token, Contents read/write (+ Checks read for failed-build reporting) on the site repo only. Needed to publish from the deployed dashboard. |

Tokens and passwords are the site owner's to create and paste. Never ask for
them in chat, write them into files, or print them.
