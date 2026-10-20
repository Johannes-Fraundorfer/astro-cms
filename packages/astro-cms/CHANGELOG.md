# Changelog

Entries marked **Action needed** require changes in sites that upgrade; the
`cms-upgrade` skill works through them.

## 0.5.0

Public release: the package is now on npm under the MIT license.

- **Action needed** (sites that installed an earlier version): versions up to
  0.4.1 came from GitHub Packages. Remove the `@johannes-fraundorfer:registry`
  and `//npm.pkg.github.com/` lines from the site's `.npmrc` (delete the file
  if nothing else is in it), then `npm install @johannes-fraundorfer/astro-cms@latest`.
  The `NPM_TOKEN` build variable on the host is no longer needed and can be
  removed. If the same lines are in the home folder's `.npmrc`, remove them
  there too, or npm keeps asking GitHub.
- **Recommended**: set a `CMS_SESSION_SECRET` secret to a random value
  (`openssl rand -base64 32`). It's mixed into the session signing key, so a
  stolen session cookie can't be used to guess the password offline. Setting
  it signs everyone out once.
- `init` no longer writes `.npmrc`; `doctor` warns when one still points the
  package at GitHub Packages.
- Setup skill: secrets guidance (long random password, session secret,
  repo-only GitHub token, Cloudflare Access), and the Cloudflare adapter is
  installed with npm instead of `astro add`.
- Releases are published from GitHub Actions with npm provenance.

## 0.4.1

Dashboard styling; no changes needed in sites.

- Published / Draft is now one segmented control with a coloured underline on
  the active state (square corners, no round pills with dots), so it no longer
  resembles other CMS dashboards.
- The "GitHub" chip next to the logo is gone. The "Local" chip still shows when
  publishing writes files instead of committing.

## 0.4.0

Video uploads are opt-in. Includes fixes from the first field test on an
existing site.

- **Action needed** (only if a type name isn't lowercase kebab-case): the
  build now stops on type names like `customDevelopment`, which built fine
  but couldn't be opened in the dashboard. Rename the type
  (`custom-development`) and its folder in `src/content/`, and update
  `_ref` values that point at it (`"customDevelopment:…"`).
- Sites that added `vite.optimizeDeps.include` for React by hand to get a
  non-blank dashboard can remove it: the integration now pre-bundles the
  dashboard's dependencies itself.
- Changing `cms.config.ts` now clears Astro's content cache, so a new or
  changed field shows up in the next dev run or build instead of being
  silently dropped until `.astro/` is deleted.
- `init` adds `.wrangler/`, `.dev.vars`, `.astro/` and `dist/` to
  `.gitignore` when missing (local database files and secrets were getting
  committed).
- `doctor` also checks `session: false`, `nodejs_compat`, type names and the
  `.gitignore` entries.
- Types: `preview` is optional on blocks, and `cmsDocumentPaths` returns
  typed params and props, so `Astro.props.slug` passes `astro check`.

- New `video` field type, stored as `{ src, title? }`. Editors paste a link to
  a video on a CDN, see it in a preview player, and add a title for screen
  readers. `cmsVideo(value)` returns `{ src, title, type }` for components,
  and `cms.field(path, "video")` marks one for the canvas.
- Video uploads when the site binds an R2 bucket as `CMS_MEDIA`: files up to
  2 GB upload from the browser in 10 MB parts (a Worker request is capped at
  100 MB), with progress and cancel. Uploads go straight to the bucket, never
  into the repo. Set `media.videoUrl` to the bucket's public URL to serve
  them from there; otherwise the site streams them at `/_cms/media/…`, with
  range requests so players can seek.
- Content types can be dragged into a different order within their group in
  the dashboard's left column. The order is stored in D1 (new `cms_settings`
  table, created automatically) and shared by all editors; types added to the
  config later appear at the end of their group.
- Canvas: hovering a full-width section no longer adds a horizontal scrollbar
  (outlines are drawn in a clipping layer), and a section's toolbar sits
  inside the section, pinned to the top while it scrolls past, so the pointer
  can reach its buttons without leaving the section.
- Image field buttons wrap instead of overflowing a narrow form panel.

## 0.3.0

- `npx astro-cms init` asks about the stack: framework, hosting, publishing
  (GitHub or local files), repository and branch, languages and the live URL.
  It detects what it can (dependencies, wrangler config, git remote) and
  offers that as the default. Every answer is also a flag (`--framework`,
  `--host`, `--publish`, `--repo`, `--branch`, `--locales`, `--site-url`,
  `--yes`), so agents can pass what they asked the user.
- Unsupported frameworks (Next.js, Nuxt, SvelteKit) and hosts (Vercel,
  Netlify) are listed but refused with an explanation; nothing is changed.
- `init` writes a starting `cms.config.ts` from the answers (never over an
  existing one) and adds the `@/*` alias to a plain-JSON `tsconfig.json`.
- The cms-setup skill starts by asking these questions.

## 0.2.1

Security fixes from a review; no changes needed in sites.

- SVG uploads: the check for scripts now decodes entities and whitespace
  first, so obfuscated `javascript:` links and `<svg/onload=…>` are refused.
  It also refuses external stylesheets, entity declarations, animated
  `href`/event attributes and non-image `data:` URLs. This matters once an
  SVG is published, because it's then served from the site's own origin.
- The dashboard and login page send `X-Frame-Options: DENY` and
  `frame-ancestors 'none'`, so other sites can't embed them.
- `/_cms/asset/?src=` only redirects to paths on the same site.

## 0.2.0

- `npx astro-cms` command: `init` writes `.npmrc` and the type reference and
  installs the agent skills, `sync-skills` refreshes them, `doctor` checks a
  site's setup.
- Agent skills ship with the package: `cms-setup`, `cms-add-block`,
  `cms-upgrade`, with a shared API reference.
- **Action needed** (only for sites set up before 0.2.0): run
  `npx astro-cms sync-skills` once to install the skills.

## 0.1.0

First release as a package: dashboard with live canvas, drafts and publishing
through git, translations, media library, navigation and footer editing, bulk
actions, and the D1 storage adapter.
