---
name: cms-upgrade
description: Upgrade a site to a newer version of astro-cms — read what changed, update the package and skills, apply any required changes to config, pages or components, and verify. Use when asked to update or upgrade the CMS, pull in CMS fixes or features, or when the site is behind the latest @johannes-fraundorfer/astro-cms release.
---

# Upgrade astro-cms

## 1. See where the site is

- Installed version: `npx astro-cms --version`.
- Latest version: `npm view @johannes-fraundorfer/astro-cms version`.
- Versions up to 0.4.0 came from GitHub Packages; from 0.5.0 the package is on
  npm. If the site's `.npmrc` (or the user's home `.npmrc`) maps
  `@johannes-fraundorfer` to `npm.pkg.github.com`, npm still asks GitHub and
  never sees newer versions. Remove those lines first (the home one is the
  user's: tell them, don't edit it).
- Read `node_modules/@johannes-fraundorfer/astro-cms/CHANGELOG.md` after
  updating, for every version between the two. Entries marked **Action needed**
  require changes in the site; list them before touching anything.

## 2. Update

1. `npm install @johannes-fraundorfer/astro-cms@latest`.
2. If the host builds with npm 10 and the machine has npm 11:
   `npx -y npm@10 install --package-lock-only`.
3. `npx astro-cms sync-skills` so the skills match the new version.
4. Re-read the updated skills' reference for anything the changelog points to.

## 3. Apply the required changes

Work through each **Action needed** entry in order, oldest first. Typical kinds:

- A renamed or moved import: update every import in the site.
- A new config option with a required value: add it to `cms.config.ts`.
- A changed runtime helper: update the pages and components that call it.
- A content format change: the changelog says whether the CMS still reads the
  old format. If it doesn't, convert the JSON in `src/content` with a script,
  check the diff, and never hand-edit content in bulk.
- New hosting requirements (a binding, a route in `run_worker_first`, a secret):
  do the file changes, and tell the user about secrets they must set.

Keep the site's own customizations: its content model, components and styling
are the site's, not the package's.

## 4. Verify

1. `npx astro-cms doctor` shows no ✗.
2. `npx astro check` and `npx astro build` pass.
3. In `astro dev`: the public pages look as before, and `/admin` loads, shows
   the pages on the canvas and saves an edit.
4. Commit with a message naming the old and new version and the changes made.
