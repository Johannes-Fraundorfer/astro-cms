# astro-cms

A git-backed visual CMS for Astro sites: a dashboard at `/admin` with a live
canvas, drafts, publishing through git, translations and a media library.
Content is JSON in the site's own repository; publishing commits it and the
host rebuilds the site.

```bash
npm install @johannes-fraundorfer/astro-cms
npx astro-cms init
```

Setup, configuration and hosting are in the
[package README](packages/astro-cms/README.md). The package also ships agent
skills (`cms-setup`, `cms-add-block`, `cms-upgrade`), so a coding agent can do
the setup: ask it to "set up the CMS".

Today it runs on Astro 7 sites hosted on Cloudflare Workers (D1 for drafts,
optionally R2 for videos).

## Repository

- `packages/astro-cms`: the package, published to npm as
  `@johannes-fraundorfer/astro-cms`.
- `playground`: a small demo site with placeholder content, for developing
  the CMS.

## Develop

```bash
npm install
npm run dev
```

The playground runs at http://localhost:4321; the dashboard is at `/admin`
(no login locally).

## Release

Publishing runs on GitHub Actions when a version tag is pushed, through npm
trusted publishing (no stored token):

```bash
npm version patch -w @johannes-fraundorfer/astro-cms
git commit -am "Release 0.5.1"
git tag v0.5.1
git push origin main v0.5.1
```

The tag must match the package version.

## Security

See [SECURITY.md](SECURITY.md) for how to report a vulnerability.

## Beyond Astro (roadmap)

The goal is a visual editing layer for any stack. Most of the package is
already framework-neutral; what's Astro-specific is small and sits at the edges.

| Part | Today | Framework-neutral? |
| --- | --- | --- |
| Dashboard (React app) | mounted by an Astro page | yes: it only talks to `/api/cms/*` |
| API, drafts, publishing, media, auth | Astro endpoints | yes: plain `Request → Response` handlers |
| Content on disk | JSON in `src/content` | yes: any framework can read JSON |
| Canvas overlay | injected into previewed pages | yes: it only needs `data-cms-*` attributes |
| Storage | D1 adapter | adapters per host (Turso, Postgres, Blob stores) |
| Reading content, drafts in preview | `astro-cms/runtime` | **per framework** |
| Routes, middleware, build info | Astro integration | **per framework** |
| Rendering a page with drafts | `/_cms/preview` renders the page file | **per framework** |

The plan: split into a core package and thin framework adapters (Astro
first, then Next.js and Nuxt), plus host adapters for storage. `init` already
asks for framework and host and refuses combinations that aren't built yet.

## License

[MIT](LICENSE)
