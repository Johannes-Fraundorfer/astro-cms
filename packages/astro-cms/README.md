# @johannes-fraundorfer/astro-cms

Content editing for Astro sites: a dashboard at `/admin` with a live canvas,
drafts, publishing through git, translations and a media library. Content is
stored as JSON in the site's repository; publishing commits it and the host
rebuilds the site.

## Requirements

- Astro 7 with an on-demand adapter. Pages stay prerendered; only `/admin`,
  `/api/cms/*` and `/_cms/*` run on request.
- A storage adapter for drafts and unpublished uploads. Available: `d1`
  (Cloudflare D1).
- For publishing from the deployed dashboard: a GitHub repository the host
  builds from, and a fine-grained token with Contents read/write (plus Checks
  read, to report failed builds).

## Install

1. Add the package and the integration:

   ```js
   // astro.config.mjs
   import cms from "@johannes-fraundorfer/astro-cms";
   import cmsConfig from "./cms.config.ts";

   export default defineConfig({
     adapter: cloudflare(),
     integrations: [cms({ config: cmsConfig, storage: "d1" })],
   });
   ```

2. Describe the content in `cms.config.ts` with `defineConfig`, `defineType`
   and `defineBlock` from `@johannes-fraundorfer/astro-cms/config`.

3. Register the content collections:

   ```ts
   // src/content.config.ts
   import cms from "../cms.config.ts";
   import { cmsCollections } from "@johannes-fraundorfer/astro-cms/collections";

   export const collections = cmsCollections(cms);
   ```

4. Map `@/*` to `src/*` in `tsconfig.json`. Published images are stored as
   `@/assets/…` paths, which resolve through it:

   ```json
   { "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }
   ```

5. Add the CMS types to `src/env.d.ts`:

   ```ts
   /// <reference types="@johannes-fraundorfer/astro-cms/env" />
   ```

6. Read content in pages with `cmsEntry`, `cmsList` and friends from
   `@johannes-fraundorfer/astro-cms/runtime`, and mark editable markup with `cmsAttrs` so the canvas
   can select it.

7. Cloudflare: add a D1 database bound as `CMS_DB`, route the dashboard to the
   worker in `wrangler.jsonc`, and set the secrets:

   ```jsonc
   "assets": { "run_worker_first": ["/admin", "/admin/*", "/api/cms/*", "/_cms/*", "/_image"] },
   "d1_databases": [{ "binding": "CMS_DB", "database_name": "<site>-cms", "database_id": "<id>" }]
   ```

   ```bash
   npx wrangler secret put CMS_PASSWORD
   npx wrangler secret put CMS_SESSION_SECRET
   npx wrangler secret put CMS_GITHUB_TOKEN
   ```

   `CMS_PASSWORD` is the only thing between the internet and the dashboard:
   make it long and random. `CMS_SESSION_SECRET` is any random value (e.g.
   `openssl rand -base64 32`). `CMS_GITHUB_TOKEN` is a fine-grained token for
   the site's repository only. See [SECURITY.md](https://github.com/Johannes-Fraundorfer/astro-cms/blob/main/SECURITY.md).

   Locally, put `CMS_PASSWORD` in `.dev.vars`, or leave it out to use the
   dashboard without a login under `astro dev`.

8. Optional, for video uploads: bind an R2 bucket as `CMS_MEDIA` and set
   `media.videoUrl` to its public URL. Without a bucket, `video` fields take
   links to videos hosted elsewhere.

   ```jsonc
   "r2_buckets": [{ "binding": "CMS_MEDIA", "bucket_name": "<site>-media" }]
   ```

## Other hosts

Host-specific code sits behind small seams, so another host is an addition
rather than a rewrite:

- Storage: `src/storage/types.ts` is the SQL interface the CMS needs (D1's
  shape), plus an optional object store for videos (R2's shape). A new
  adapter implements them and is registered in `src/index.ts`.
- Secrets are read through `astro:env`, which every Astro adapter supports.
- Rich text is sanitized in plain JavaScript, not with a host API.

## License

MIT
