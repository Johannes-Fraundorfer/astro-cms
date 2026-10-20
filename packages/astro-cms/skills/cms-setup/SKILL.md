---
name: cms-setup
description: Add the astro-cms visual editor to an Astro site — model the site's content, move hardcoded text into CMS content, mark components for the live canvas, and prepare hosting. Use when someone wants to make a site editable, add a CMS or admin dashboard, let a client edit content, or set up @johannes-fraundorfer/astro-cms in a project.
---

# Set up astro-cms in a site

The package does the mechanical parts (`npx astro-cms init`, `npx astro-cms doctor`).
This skill is the judgement: what should be editable, how to model it, and how to
wire pages to it without breaking the site. API details are in
[reference.md](reference.md); read it before writing config or components.

Work in the order below and keep the site building after each step. Show the
user the proposed content model (step 3) before writing it.

## 1. Ask the setup questions

Ask the user these together (with your question tool if you have one), using
what you can detect from `package.json`, the wrangler config and
`git remote get-url origin` as the suggested answers:

| Question | Options | Flag |
| --- | --- | --- |
| Framework | Astro. Next.js, Nuxt and SvelteKit are planned, not supported yet | `--framework astro` |
| Hosting | Cloudflare Workers. Vercel and Netlify are planned, not supported yet | `--host cloudflare` |
| Publishing | `github`: publishing commits to the repo and the host rebuilds (live sites). `local`: publishing writes files, the user commits | `--publish github` |
| Repository and branch (GitHub publishing) | `owner/name`, the branch the host builds from | `--repo owner/name --branch main` |
| Languages | default first, e.g. `en` or `en,de` | `--locales en,de` |
| Live site URL (optional) | for the deploy status in the dashboard | `--site-url https://…` |

If the framework or host isn't supported yet, stop and say so; don't
improvise an adapter.

## 2. Install

1. Check the site is ready: an Astro 7+ project, in a GitHub repository if
   editors will publish from the deployed dashboard. If the package is already
   installed, run `npx astro-cms doctor` and skip what's done.
2. `npm install @johannes-fraundorfer/astro-cms` (public on npm, no token).
   If it fails with 401 or 404 from `npm.pkg.github.com`, an old `.npmrc` (in
   the site or the user's home) still points the scope at GitHub Packages:
   remove that line.
3. `npx astro-cms init` with the answers as flags (it can't ask questions when
   an agent runs it). For example:
   `npx astro-cms init --framework astro --host cloudflare --publish github --repo owner/site --branch main --locales en,de --site-url https://example.com`.
   It writes a starting `cms.config.ts` from the answers (publishing, languages,
   deploy URL, a General settings type), adds the type reference to
   `src/env.d.ts` and the `@/*` alias to `tsconfig.json`, and installs these
   skills. It never overwrites an existing `cms.config.ts`.
4. If there is no Cloudflare adapter: `npm install @astrojs/cloudflare wrangler`,
   then add `adapter: cloudflare()` and `session: false` to the Astro config by
   hand (`astro add` prints pages of spinner output).
5. If the host builds with npm 10 and the machine has npm 11, regenerate the
   lockfile with `npx -y npm@10 install --package-lock-only`.

## 3. Model the content

Read every page in `src/pages` and the components they use. For each piece of
text, image and link, decide:

- **Editable content**: headings, body text, images, button labels and links,
  list items (team members, services, projects), SEO title and description.
- **Code**: layout, styling, logos, icons, form logic, anything an editor
  could break or would never change.

Then map it onto types and blocks:

| Site has | Model it as |
| --- | --- |
| A one-off page (home, about) | `singleton` with `url`, fields for SEO, and a `sections` blocks field |
| Pages of the same shape (projects, posts) | `collection` with `url: "/…/{slug}"` and a `slug` field |
| Site-wide text (name, default description) | `singleton` "General", no `url` |
| Navigation and footer | `singleton`s without `url` but with `previewPath: "/"`; menu items as a `blocks` field (a block with optional sub-links becomes a dropdown) |
| A page section (hero, text, cards, CTA) | a `block`, used in `sections` |
| Repeated items inside a section | a `blocks` field of a small block (card, member) |
| A link to another page | a `link` field, not `url` |
| A list of picked documents | `references` |

Guidelines:

- One block per section component, named after what it is ("Hero", "Cards"),
  with fields named after what they hold. Editors see the titles.
- Keep types few. Don't make every sentence a field; group what's edited together.
- Mark fields `required` only when the page breaks without them.
- Add `i18n` only if the site is multilingual. Then pages move to
  `src/pages/[...locale]/…` (see step 5).

Show the user the model as a short list (types → fields, blocks → fields) and
wait for agreement before continuing.

## 4. Write the config and move content

1. Fill in the types and blocks in the `cms.config.ts` that `init` wrote. Its
   publishing, language and deploy settings come from the answers in step 1.
2. `src/content.config.ts`:
   ```ts
   import cms from "../cms.config.ts";
   import { cmsCollections } from "@johannes-fraundorfer/astro-cms/collections";
   export const collections = cmsCollections(cms);
   ```
   If the site already has collections, merge: `{ ...cmsCollections(cms), ...existing }`.
3. `tsconfig.json` has `"paths": { "@/*": ["./src/*"] }` (`init` adds it unless
   the file has comments; then add it by hand).
4. Move the hardcoded content into JSON files under `src/content/<type>/`.
   Copy the text exactly, keep the order of sections, give every block item a
   unique 8-character `_key`, and move images the CMS should manage into
   `src/assets/cms/` as `{ "src": "@/assets/cms/…", "alt": "…" }` with real alt
   text. Rich text becomes HTML strings.
5. Add the integration to `astro.config.*`: `cms({ config: cmsConfig })`.

Run `npx astro check`. Collection schema errors here mean the JSON doesn't match
the config.

## 5. Wire pages and components

For each page:

- Read its document with `cmsEntry` (singletons) or `cmsFind`/`cmsList`
  (collections), and put `{...cms.doc(entry)}` on the element around its content.
- Read route params as `Astro.props.x ?? Astro.params.x`. The dashboard preview
  passes them as props.
- In `getStaticPaths` use `BUILD` in place of `Astro`, or `cmsDocumentPaths`.
- Pages made of sections loop over `sections` and render one component per
  `_type`, passing `path={\`sections.${i}\`}` and the locale.

For each component that shows CMS content:

- Take the values as props plus a `path` prop.
- Put `cms.field(...)` on the element that directly holds each value, with the
  right kind (`text`, `multiline`, `rich`, `image`, `block`). See reference.md.
- Links: spread `cmsLinkAttrs(Astro, value, locale)`. Images: `cmsImage(value)`.
- Keep the component usable without the CMS: props stay plain values.

With `i18n`: move pages to `src/pages/[...locale]/`, use `cmsLocalePaths()` or
`cmsDocumentPaths()` in `getStaticPaths`, read the locale with `cmsLocale(Astro)`,
and pass it to `cmsEntry`, `cmsLink` and `localizeHref`.

After each page, open it in `astro dev` and compare it with how it looked
before: the published site must look identical.

## 6. Hosting

Tell the user what only they can do, and do the rest:

1. D1: `npx wrangler d1 create <site>-cms`, then add the binding `CMS_DB` to
   `wrangler.jsonc` with the returned id.
2. `wrangler.jsonc` → `assets.run_worker_first`:
   `["/admin", "/admin/*", "/api/cms/*", "/_cms/*", "/_image"]`. Without it,
   browser navigations to `/admin` get the static 404 page.
3. The user sets, in the Cloudflare dashboard or with `npx wrangler secret put`:
   - `CMS_PASSWORD`: the editors' login. It's the only thing between the
     internet and the dashboard, so it must be long and random (a password
     manager's 20+ characters), not a word.
   - `CMS_SESSION_SECRET`: a random value (`openssl rand -base64 32`, or a
     password manager). Recommended: without it, a stolen session cookie
     could be used to guess the password offline.
   - `CMS_GITHUB_TOKEN`: a fine-grained token for the site repo only, with
     Contents read/write and Checks read.
   For more protection, put Cloudflare Access in front of `/admin*`.
4. Optional: `deploy: { url }` in `cms.config.ts` for the deploy status chip.

Never ask for these values in chat or write them into files.

## 7. Verify

1. `npx astro-cms doctor` shows no ✗.
2. `npx astro check` and `npx astro build` pass.
3. `astro dev` → `/admin` (no login locally unless `.dev.vars` has `CMS_PASSWORD`):
   every type opens, pages show on the canvas, clicking text edits it in place,
   clicking a section opens it in the right panel, and publishing a small change
   writes the JSON file (local) or commits it (GitHub).
4. The public pages look exactly as before.

## Known problems

- **500 "file does not exist in the optimize deps directory"** after adding
  content types: `npx astro dev stop` (or stop the dev server's node process;
  stopping the shell isn't enough on Windows), move `node_modules/.vite`
  aside, restart.
- **The build refuses a type name** (`customDevelopment`): type names are
  lowercase kebab-case (`custom-development`), because they're part of the
  dashboard's URLs. The folder in `src/content/` follows the name.
- **`/admin` shows the 404 page on the deployed site**: `run_worker_first` is missing.
- **Install or build fails with E401/404 on npm.pkg.github.com**: an old
  `.npmrc` (site or home folder) maps `@johannes-fraundorfer` to GitHub
  Packages, where versions before 0.5.0 lived. Remove that line; the package
  is on npm now.
- **Images don't resolve** (`@/assets/…` errors): the `@/*` tsconfig path is missing.
- **Canvas clicks do nothing on a page**: its content has no `cms.doc(...)` wrapper,
  or the preview can't read the page's params (use props first).
