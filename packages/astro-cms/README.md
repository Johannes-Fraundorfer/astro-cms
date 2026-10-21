# @johannes-fraundorfer/astro-cms

A visual CMS for Astro sites that lives inside the site itself. Editors get a
dashboard at `/admin` with a live canvas of the real pages: click text to edit
it in place, rearrange sections, upload images, translate pages, then publish.
Content is stored as JSON in the site's own repository; publishing commits it
to GitHub and the host rebuilds the site.

No separate CMS service, no external database for content, no monthly fee:
the site and its editor are one Cloudflare deployment.

## How it works

- **You (the developer)** describe the content in `cms.config.ts`: page types,
  collections (projects, posts) and section blocks (hero, FAQ, …) with their
  fields. Pages read that content and mark editable elements, so the canvas
  knows what's clickable. The public pages stay static and fast.
- **Editors** sign in at `/admin` with the site's password. Changes are saved
  as drafts (in Cloudflare D1) and only go live on **Publish**.
- **Publish** writes the content as JSON (and new images into
  `src/assets/cms/`), commits it to the site's GitHub repository, and the host
  rebuilds. The dashboard shows when the new version is live.
- Your code and the content live in the same repository, so content has
  history, can be reviewed, and moves with the site.

## Who it's for

Good fit:

- New Astro sites, or sites built from components, where a client or
  non-developer edits text, images and sections.
- Freelancers and small teams who want to hand a site over with an editor and
  without a CMS subscription.

Limits today:

- **Astro 7** sites hosted on **Cloudflare Workers** only (D1 for drafts,
  optionally R2 for videos). Other frameworks and hosts are on the
  [roadmap](https://github.com/Johannes-Fraundorfer/astro-cms#beyond-astro-roadmap).
- **One shared password per site**: no per-editor accounts, roles or
  change log of who edited what.
- **Existing sites** take more work: older Astro versions need upgrading
  first, and pages that are one big block of HTML (for example a Webflow
  export) have to be split into section components before editors can
  rearrange them.
- It's **0.x**: an update can need small changes in the site. The
  [changelog](CHANGELOG.md) marks those as **Action needed**.

## Quick start

```bash
npm install @johannes-fraundorfer/astro-cms
npx astro-cms init
```

`init` asks a few questions (hosting, publishing, repository, languages, live
URL), writes a starting `cms.config.ts`, adds the type reference and `@/*`
alias, updates `.gitignore`, and installs agent skills into `.agents/skills`
and `.claude/skills`.

**With a coding agent** (Claude Code, Codex, …): ask it to *"set up the CMS"*.
The `cms-setup` skill walks it through modelling the content, wiring the pages
and preparing Cloudflare, and it asks you before anything that touches your
accounts.

**By hand**: follow the steps below. Check progress any time with:

```bash
npx astro-cms doctor
```

## Setup by hand

1. Install the package and the Cloudflare adapter:

   ```bash
   npm install @johannes-fraundorfer/astro-cms @astrojs/cloudflare wrangler
   ```

2. Add the adapter and the integration:

   ```js
   // astro.config.mjs
   import { defineConfig } from "astro/config";
   import cloudflare from "@astrojs/cloudflare";
   import cms from "@johannes-fraundorfer/astro-cms";
   import cmsConfig from "./cms.config.ts";

   export default defineConfig({
     site: "https://example.com",
     adapter: cloudflare(),
     session: false, // the CMS doesn't use Astro sessions; avoids a KV namespace
     integrations: [cms({ config: cmsConfig, storage: "d1" })],
   });
   ```

   Pages stay prerendered; only `/admin`, `/api/cms/*` and `/_cms/*` run on
   request.

3. Describe the content in `cms.config.ts` with `defineConfig`, `defineType`
   and `defineBlock` from `@johannes-fraundorfer/astro-cms/config`. Type names
   are lowercase kebab-case (`case-studies`).

4. Register the content collections:

   ```ts
   // src/content.config.ts
   import cms from "../cms.config.ts";
   import { cmsCollections } from "@johannes-fraundorfer/astro-cms/collections";

   export const collections = cmsCollections(cms);
   ```

5. Map `@/*` to `src/*` in `tsconfig.json` (published images are stored as
   `@/assets/…` paths), and add the CMS types to `src/env.d.ts`:

   ```json
   { "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }
   ```

   ```ts
   /// <reference types="@johannes-fraundorfer/astro-cms/env" />
   ```

6. Read content in pages and mark what's editable:

   ```astro
   ---
   import { cmsEntry, cmsAttrs } from "@johannes-fraundorfer/astro-cms/runtime";

   const page = await cmsEntry(Astro, "home", "home");
   const cms = cmsAttrs(Astro);
   ---
   <main {...cms.doc(page)}>
     <h1 {...cms.field("title", "text", "Title")}>{page?.data.title}</h1>
   </main>
   ```

   The `cms.*` attributes only render inside the dashboard preview, so the
   published HTML stays clean. The full API (lists, references, links, images,
   videos, translations, section blocks) is in
   [the reference](skills/cms-setup/reference.md).

7. Cloudflare (`wrangler.jsonc`): a D1 database for drafts, and the dashboard
   routes sent to the Worker:

   ```jsonc
   {
     "main": "@astrojs/cloudflare/entrypoints/server",
     "compatibility_flags": ["nodejs_compat"],
     "assets": {
       "directory": "./dist",
       "binding": "ASSETS",
       "run_worker_first": ["/admin", "/admin/*", "/api/cms/*", "/_cms/*", "/_image"]
     },
     // Leave out database_id and Wrangler creates the database on the first deploy.
     "d1_databases": [{ "binding": "CMS_DB", "database_name": "<site>-cms" }]
   }
   ```

8. Publishing: in `cms.config.ts`, set
   `publish: { target: "github", github: { repo: "owner/site", branch: "main" } }`,
   and connect the repository to the Worker in Cloudflare (Workers Builds), so
   each commit rebuilds the site.

9. Secrets on the Worker:

   ```bash
   npx wrangler secret put CMS_PASSWORD
   npx wrangler secret put CMS_SESSION_SECRET
   npx wrangler secret put CMS_GITHUB_TOKEN
   ```

   - `CMS_PASSWORD`: the editors' login, and the only thing between the
     internet and the dashboard. Make it long and random (20+ characters from
     a password manager).
   - `CMS_SESSION_SECRET`: any random value, e.g. `openssl rand -base64 32`.
   - `CMS_GITHUB_TOKEN`: a fine-grained token for the site's repository only,
     with Contents read/write and Checks read.

   Locally, put `CMS_PASSWORD` in `.dev.vars`, or leave it out to use the
   dashboard without a login under `astro dev`. See
   [SECURITY.md](https://github.com/Johannes-Fraundorfer/astro-cms/blob/main/SECURITY.md).

10. Optional, video uploads: bind an R2 bucket as `CMS_MEDIA` and set
    `media.videoUrl` in `cms.config.ts` to its public URL. Without a bucket,
    `video` fields take links to videos hosted elsewhere.

    ```jsonc
    "r2_buckets": [{ "binding": "CMS_MEDIA", "bucket_name": "<site>-media" }]
    ```

Then run `astro dev` and open `/admin`.

## Updating

```bash
npm install @johannes-fraundorfer/astro-cms@latest
npx astro-cms sync-skills
```

Read the [changelog](CHANGELOG.md) for every version in between; entries
marked **Action needed** require a change in the site. With an agent, ask it to
*"upgrade the CMS"* (the `cms-upgrade` skill).

## Other hosts

Host-specific code sits behind small seams, so another host is an addition
rather than a rewrite:

- Storage: `src/storage/types.ts` is the SQL interface the CMS needs (D1's
  shape), plus an optional object store for videos (R2's shape). A new
  adapter implements them and is registered in `src/index.ts`.
- Secrets are read through `astro:env`, which every Astro adapter supports.
- Rich text is sanitized in plain JavaScript, not with a host API.

## Problems and contributions

Bugs and ideas: [GitHub issues](https://github.com/Johannes-Fraundorfer/astro-cms/issues).
Security problems: report them privately, as described in
[SECURITY.md](https://github.com/Johannes-Fraundorfer/astro-cms/blob/main/SECURITY.md).

## License

MIT
