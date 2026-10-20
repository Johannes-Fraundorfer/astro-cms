#!/usr/bin/env node
// astro-cms: mechanical setup for a site. The content modelling and wiring
// that needs judgement is done by an agent following the cms-setup skill.
//
//   npx astro-cms init          ask about the stack, then set up config, types and skills
//   npx astro-cms sync-skills   refresh the skills from the installed version
//   npx astro-cms doctor        check the site's setup and say what's missing

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync, lstatSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, relative } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const PKG = "@johannes-fraundorfer/astro-cms";
const SCOPE = "@johannes-fraundorfer";
const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const version = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8")).version;
const site = process.cwd();

const read = (p) => (existsSync(join(site, p)) ? readFileSync(join(site, p), "utf8") : undefined);
const firstExisting = (...names) => names.find((n) => existsSync(join(site, n)));
const say = (...lines) => console.log(lines.join("\n"));

function requireAstroSite() {
  if (!existsSync(join(site, "package.json")) || !firstExisting("astro.config.mjs", "astro.config.ts", "astro.config.js")) {
    console.error("Run this in the root of an Astro site (where astro.config and package.json are).");
    process.exit(1);
  }
}

/* --------------------------------- skills --------------------------------- */

function syncSkills() {
  const source = join(pkgRoot, "skills");
  const names = readdirSync(source, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  for (const name of names) {
    const target = join(site, ".agents", "skills", name);
    rmSync(target, { recursive: true, force: true });
    mkdirSync(dirname(target), { recursive: true });
    cpSync(join(source, name), target, { recursive: true });

    // Claude Code reads .claude/skills; a relative link keeps one source of truth.
    const link = join(site, ".claude", "skills", name);
    mkdirSync(dirname(link), { recursive: true });
    let isLink = false;
    try {
      isLink = lstatSync(link).isSymbolicLink();
    } catch {
      /* missing */
    }
    if (isLink) continue;
    rmSync(link, { recursive: true, force: true });
    try {
      symlinkSync(relative(dirname(link), target), link, "dir");
    } catch {
      // Windows without symlink rights: a copy works the same, sync-skills refreshes it.
      cpSync(target, link, { recursive: true });
    }
  }
  say(`Skills from ${PKG} ${version}: ${names.join(", ")} → .agents/skills (linked from .claude/skills)`);
}

/* ---------------------------------- init ---------------------------------- */

function ensureLines(file, lines) {
  const current = read(file) ?? "";
  const missing = lines.filter((l) => !current.split(/\r?\n/).some((have) => have.trim() === l));
  if (!missing.length) return false;
  const prefix = current && !current.endsWith("\n") ? "\n" : "";
  mkdirSync(dirname(join(site, file)), { recursive: true });
  writeFileSync(join(site, file), current + prefix + missing.join("\n") + "\n");
  return true;
}

/*
 * The stack questions. Each has a flag, so agents (which can't answer prompts)
 * ask the user themselves and pass the answers. Options marked `later` are
 * listed so the question reads right, but aren't supported yet.
 */
const FRAMEWORKS = [
  { value: "astro", label: "Astro" },
  { value: "next", label: "Next.js", later: true },
  { value: "nuxt", label: "Nuxt", later: true },
  { value: "sveltekit", label: "SvelteKit", later: true },
];
const HOSTS = [
  { value: "cloudflare", label: "Cloudflare Workers" },
  { value: "vercel", label: "Vercel", later: true },
  { value: "netlify", label: "Netlify", later: true },
];
const PUBLISH = [
  { value: "github", label: "GitHub: publishing commits to the repo and the host rebuilds (for live sites)" },
  { value: "local", label: "Local files only: publishing writes the JSON, you commit yourself" },
];

function detectStack() {
  const pkg = JSON.parse(read("package.json") ?? "{}");
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const framework = deps.astro ? "astro" : deps.next ? "next" : deps.nuxt ? "nuxt" : deps["@sveltejs/kit"] ? "sveltekit" : undefined;
  const host =
    deps["@astrojs/cloudflare"] || firstExisting("wrangler.jsonc", "wrangler.json", "wrangler.toml")
      ? "cloudflare"
      : deps["@astrojs/vercel"] || firstExisting("vercel.json")
        ? "vercel"
        : deps["@astrojs/netlify"] || firstExisting("netlify.toml")
          ? "netlify"
          : undefined;
  let repo;
  try {
    const url = execFileSync("git", ["remote", "get-url", "origin"], { cwd: site, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    repo = url.match(/github\.com[:/](.+?\/.+?)(\.git)?$/)?.[1];
  } catch {
    /* not a git repo */
  }
  let branch;
  try {
    branch = execFileSync("git", ["branch", "--show-current"], { cwd: site, stdio: ["ignore", "pipe", "ignore"] }).toString().trim() || undefined;
  } catch {
    /* not a git repo */
  }
  return { framework, host, repo, branch };
}

async function askAll(flags) {
  const found = detectStack();
  const interactive = process.stdin.isTTY && !flags.yes;
  const rl = interactive ? createInterface({ input: process.stdin, output: process.stdout }) : undefined;

  const choose = async (question, options, given, detected) => {
    if (given) return given;
    if (!rl) return detected ?? options[0].value;
    say("", question);
    options.forEach((o, i) => say(`  ${i + 1}) ${o.label}${o.later ? "  (not supported yet)" : ""}${o.value === detected ? "  ← detected" : ""}`));
    const fallback = Math.max(0, options.findIndex((o) => o.value === detected)) + 1;
    const answer = (await rl.question(`Choose 1-${options.length} [${fallback}]: `)).trim();
    return options[(Number(answer) || fallback) - 1]?.value ?? options[fallback - 1].value;
  };
  const text = async (question, given, fallback) => {
    if (given !== undefined) return given;
    if (!rl) return fallback;
    const answer = (await rl.question(`${question}${fallback ? ` [${fallback}]` : ""}: `)).trim();
    return answer || fallback;
  };

  try {
    const framework = await choose("Which framework is the site built with?", FRAMEWORKS, flags.framework, found.framework);
    const host = await choose("Where is it hosted?", HOSTS, flags.host, found.host);
    const unsupported = [FRAMEWORKS.find((f) => f.value === framework), HOSTS.find((h) => h.value === host)].filter((o) => !o || o.later);
    if (unsupported.length) return { framework, host, unsupported };

    const publish = await choose("How should publishing work?", PUBLISH, flags.publish, found.repo ? "github" : "local");
    const repo = publish === "github" ? await text("GitHub repository (owner/name)", flags.repo, found.repo) : undefined;
    const branch = publish === "github" ? await text("Branch the host builds from", flags.branch, found.branch ?? "main") : undefined;
    const locales = (await text("Languages, comma-separated, default first (e.g. en or en,de)", flags.locales, "en"))
      .split(",")
      .map((l) => l.trim().toLowerCase())
      .filter(Boolean);
    const siteUrl = await text("Live site URL, for deploy status (optional)", flags["site-url"], "");
    return { framework, host, publish, repo, branch, locales, siteUrl };
  } finally {
    rl?.close();
  }
}

/** A starting cms.config.ts from the answers; the content types are modelled afterwards (cms-setup skill). */
function starterConfig({ publish, repo, branch, locales, siteUrl }) {
  const names = { en: "English", de: "Deutsch", fr: "Français", es: "Español", it: "Italiano", nl: "Nederlands", pt: "Português", pl: "Polski" };
  const lines = [
    `import { defineConfig, defineType } from "${PKG}/config";`,
    "",
    "export default defineConfig({",
    publish === "github"
      ? `  publish: { target: "github", github: { repo: "${repo}", branch: "${branch}" } },`
      : `  publish: { target: "local" },`,
  ];
  if (siteUrl) lines.push(`  deploy: { url: "${siteUrl}" },`);
  if (locales.length > 1) {
    lines.push("  i18n: {", `    defaultLocale: "${locales[0]}",`, "    locales: [");
    for (const code of locales) lines.push(`      { code: "${code}", title: "${names[code] ?? code.toUpperCase()}" },`);
    lines.push("    ],", "  },");
  }
  lines.push(
    "",
    "  // Content types and blocks: modelled from the site's pages by the cms-setup skill.",
    "  types: [",
    "    defineType({",
    '      name: "settings",',
    '      title: "General",',
    '      kind: "singleton",',
    '      icon: "⚙",',
    '      group: "Global Settings",',
    '      preview: { title: "siteName" },',
    "      fields: [",
    '        { name: "siteName", title: "Site Name", type: "string", required: true },',
    '        { name: "description", title: "Default Meta Description", type: "text", rows: 3 },',
    "      ],",
    "    }),",
    "  ],",
    "  blocks: [],",
    "});",
    "",
  );
  return lines.join("\n");
}

/** Local state and secrets that must never be committed: Cloudflare's local database and uploads, the local secrets file, build output. */
const IGNORED = [".wrangler/", ".dev.vars", ".astro/", "dist/"];

/** Entries from IGNORED missing in .gitignore, accepting `dist`, `/dist` and `/dist/` for `dist/`. */
function missingIgnores() {
  const have = new Set((read(".gitignore") ?? "").split(/\r?\n/).map((l) => l.trim().replace(/^\//, "").replace(/\/$/, "")));
  return IGNORED.filter((entry) => !have.has(entry.replace(/\/$/, "")));
}

/** Adds the `@/*` alias to tsconfig.json when the file is plain JSON; otherwise says what to add. */
function ensureAlias() {
  const raw = read("tsconfig.json");
  if (!raw || /"@\/\*"\s*:/.test(raw)) return "ok";
  try {
    const json = JSON.parse(raw);
    json.compilerOptions ??= {};
    json.compilerOptions.paths = { "@/*": ["./src/*"], ...json.compilerOptions.paths };
    writeFileSync(join(site, "tsconfig.json"), JSON.stringify(json, null, 2) + "\n");
    return "added";
  } catch {
    return "manual"; // comments or trailing commas: leave the file to a person or agent
  }
}

async function init(argv) {
  const { values: flags } = parseArgs({
    args: argv,
    options: {
      framework: { type: "string" },
      host: { type: "string" },
      publish: { type: "string" },
      repo: { type: "string" },
      branch: { type: "string" },
      locales: { type: "string" },
      "site-url": { type: "string" },
      yes: { type: "boolean", short: "y" },
    },
  });
  if (!existsSync(join(site, "package.json"))) {
    console.error("Run this in the root of the site (where package.json is).");
    process.exit(1);
  }

  const answers = await askAll(flags);
  if (answers.unsupported) {
    say(
      "",
      `Not supported yet: ${answers.unsupported.map((o) => o?.label ?? "that choice").join(" and ")}.`,
      "Today astro-cms runs on Astro sites hosted on Cloudflare Workers. Other frameworks and hosts",
      "are planned as adapters on the same core. Nothing was changed.",
    );
    process.exitCode = 2;
    return;
  }

  const changed = [];
  if (ensureLines("src/env.d.ts", ['/// <reference types="astro/client" />', `/// <reference types="${PKG}/env" />`])) changed.push("src/env.d.ts");
  const ignores = missingIgnores();
  if (ignores.length && ensureLines(".gitignore", ["", "# astro-cms: local state and secrets", ...ignores])) changed.push(".gitignore");
  const alias = ensureAlias();
  if (alias === "added") changed.push("tsconfig.json");
  if (!firstExisting("cms.config.ts", "cms.config.mjs")) {
    writeFileSync(join(site, "cms.config.ts"), starterConfig(answers));
    changed.push("cms.config.ts");
  }
  if (changed.length) say("", `Updated ${changed.join(", ")}.`);
  if (alias === "manual") say('Add to tsconfig.json → compilerOptions: "paths": { "@/*": ["./src/*"] }');
  syncSkills();

  const flagLine = [
    `--framework ${answers.framework}`,
    `--host ${answers.host}`,
    `--publish ${answers.publish}`,
    answers.repo && `--repo ${answers.repo}`,
    answers.branch && `--branch ${answers.branch}`,
    `--locales ${answers.locales.join(",")}`,
    answers.siteUrl && `--site-url ${answers.siteUrl}`,
  ]
    .filter(Boolean)
    .join(" ");
  say(
    "",
    "Next: ask your coding agent to set up the CMS (it follows the cms-setup skill).",
    "It models the content, wires the integration and pages, and prepares Cloudflare.",
    "Check progress any time: npx astro-cms doctor",
    "",
    `Same answers without questions: npx astro-cms init ${flagLine}`,
  );
}

/* --------------------------------- doctor --------------------------------- */

function doctor() {
  requireAstroSite();
  const results = [];
  const check = (ok, label, fix) => results.push({ ok, label, fix });
  const info = (label) => results.push({ ok: null, label });

  const installed = findInstalled();
  check(!!installed, `${PKG} installed${installed ? ` (${installed.version}${installed.linked ? ", linked from a workspace" : ""})` : ""}`, `npm install ${PKG}`);
  // Versions up to 0.4.0 came from GitHub Packages; a leftover mapping hides newer ones on npm.
  check(!/^\s*@johannes-fraundorfer:registry\s*=.*npm\.pkg\.github\.com/m.test(read(".npmrc") ?? ""), ".npmrc doesn't send the package to GitHub Packages", `remove the ${SCOPE}:registry and npm.pkg.github.com lines from .npmrc (the package is on npm now)`);

  const configFile = firstExisting("astro.config.mjs", "astro.config.ts", "astro.config.js");
  const astroConfig = read(configFile) ?? "";
  check(astroConfig.includes(`"${PKG}"`) || astroConfig.includes(`'${PKG}'`), `${configFile} imports the integration`, `import cms from "${PKG}" and add cms({ config }) to integrations`);
  check(/cms\s*\(\s*\{[^}]*config/.test(astroConfig), `${configFile} adds cms({ config })`, "integrations: [cms({ config: cmsConfig })]");
  check(/@astrojs\/cloudflare/.test(astroConfig), "Cloudflare adapter (needed by the d1 storage adapter)", "npm install @astrojs/cloudflare wrangler, then adapter: cloudflare() in " + configFile);
  check(/session\s*:\s*false/.test(astroConfig), `${configFile} sets session: false (no KV namespace the CMS doesn't use)`, "add session: false next to adapter");

  check(!!firstExisting("cms.config.ts", "cms.config.mjs"), "cms.config.ts exists", "describe the content with defineConfig from astro-cms/config");
  const typeNames = [...(read(firstExisting("cms.config.ts", "cms.config.mjs") ?? "") ?? "").matchAll(/defineType\(\s*\{\s*name\s*:\s*["']([^"']+)["']/g)].map((m) => m[1]);
  const badNames = typeNames.filter((n) => !/^[a-z0-9][a-z0-9-]{0,79}$/.test(n));
  check(!badNames.length, "type names are lowercase kebab-case", `rename ${badNames.map((n) => `"${n}"`).join(", ")} (they are part of dashboard URLs)`);
  check(/cmsCollections/.test(read("src/content.config.ts") ?? ""), "src/content.config.ts registers cmsCollections", "export const collections = cmsCollections(cms)");
  check((read("src/env.d.ts") ?? "").includes(`${PKG}/env`), "src/env.d.ts references the CMS types", "npx astro-cms init");
  check(/"@\/\*"\s*:/.test(read("tsconfig.json") ?? ""), 'tsconfig.json maps "@/*" to src/* (published images use it)', '"paths": { "@/*": ["./src/*"] }');

  const wranglerFile = firstExisting("wrangler.jsonc", "wrangler.json", "wrangler.toml");
  const wrangler = read(wranglerFile) ?? "";
  check(!!wranglerFile && /CMS_DB/.test(wrangler), "wrangler config binds a D1 database as CMS_DB", "npx wrangler d1 create <site>-cms, then add it as binding CMS_DB");
  check(!!wranglerFile && /nodejs_compat/.test(wrangler), "wrangler config enables nodejs_compat", '"compatibility_flags": ["nodejs_compat"]');
  const routes = ["/admin", "/api/cms/*", "/_cms/*"];
  check(!!wranglerFile && routes.every((r) => wrangler.includes(`"${r}"`)), "run_worker_first sends /admin, /api/cms/* and /_cms/* to the worker", `"run_worker_first": ["/admin", "/admin/*", "/api/cms/*", "/_cms/*", "/_image"]`);

  const ignores = missingIgnores();
  check(!ignores.length, ".gitignore keeps local state and secrets out of git", `add ${ignores.join(", ")} to .gitignore (or run npx astro-cms init)`);

  const marked = countMatches(join(site, "src"), /cmsAttrs\(/);
  info(`${marked} file(s) in src mark editable markup with cmsAttrs`);
  const cmsConfig = read(firstExisting("cms.config.ts", "cms.config.mjs") ?? "") ?? "";
  if (/target:\s*["']github["']/.test(cmsConfig)) {
    info("Publishing to GitHub: the deployed site needs the secrets CMS_PASSWORD and CMS_GITHUB_TOKEN (wrangler secret put).");
  }

  for (const r of results) {
    if (r.ok === null) say(`  • ${r.label}`);
    else say(`  ${r.ok ? "✓" : "✗"} ${r.label}${r.ok ? "" : `\n      → ${r.fix}`}`);
  }
  const failed = results.filter((r) => r.ok === false).length;
  say("", failed ? `${failed} thing(s) to fix.` : "Setup looks complete.");
  process.exitCode = failed ? 1 : 0;
}

/** The installed package, looking up the folder tree the way Node resolves it (workspaces hoist to the root). */
function findInstalled() {
  for (let dir = site; ; dir = dirname(dir)) {
    const path = join(dir, "node_modules", ...PKG.split("/"));
    if (existsSync(join(path, "package.json"))) {
      const { version } = JSON.parse(readFileSync(join(path, "package.json"), "utf8"));
      return { version, linked: lstatSync(path).isSymbolicLink() };
    }
    if (dirname(dir) === dir) return undefined;
  }
}

function countMatches(dir, pattern) {
  if (!existsSync(dir)) return 0;
  let n = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) n += countMatches(p, pattern);
    else if (/\.(astro|ts|tsx|js|mjs)$/.test(entry.name) && pattern.test(readFileSync(p, "utf8"))) n++;
  }
  return n;
}

/* ----------------------------------- cli ---------------------------------- */

const command = process.argv[2];
if (command === "init") await init(process.argv.slice(3));
else if (command === "sync-skills") {
  requireAstroSite();
  syncSkills();
} else if (command === "doctor") doctor();
else if (command === "--version" || command === "-v") say(version);
else {
  say(
    `astro-cms ${version}`,
    "",
    "  init          ask about the stack, then write config, types and the agent skills",
    "                flags: --framework --host --publish --repo --branch --locales --site-url --yes",
    "  sync-skills   refresh the skills after updating the package",
    "  doctor        check the site's setup and list what's missing",
  );
}
