import type { AstroIntegration } from "astro";
import { envField } from "astro/config";
import type { Plugin, ViteDevServer } from "vite";
import { createHash, randomUUID } from "node:crypto";
import { execFile, execSync } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import type { IncomingMessage } from "node:http";
import { configProblems, type CmsConfig } from "./schema.ts";

export interface CmsOptions {
  config: CmsConfig;
  /**
   * Where drafts and unpublished uploads are stored. `d1` (Cloudflare D1,
   * binding `CMS_DB`) is the only adapter so far; others implement
   * `storage/types.ts` and are added here.
   */
  storage?: "d1";
}

const STORAGE = { d1: "./storage/d1.ts" } as const;

/**
 * The dashboard's browser dependencies. Vite only pre-bundles what it finds
 * importing from the site's own code, and these are imported from inside this
 * package, so without the list React is served as raw CommonJS under
 * `astro dev` and the dashboard stays blank.
 */
const CLIENT_DEPS = [
  "react",
  "react-dom",
  "react-dom/client",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
  "@dnd-kit/core",
  "@dnd-kit/sortable",
  "@dnd-kit/utilities",
  "react-resizable-panels",
  "@xterm/xterm",
  "@xterm/addon-fit",
];

/**
 * A file next to this one. Published builds run from compiled `.js` files, so
 * `.ts` references resolve to their `.js` output there.
 */
const compiled = import.meta.url.endsWith(".js");
const here = (p: string) => fileURLToPath(new URL(compiled ? p.replace(/\.tsx?$/, ".js") : p, import.meta.url));

export default function cms({ config, storage = "d1" }: CmsOptions): AstroIntegration {
  const token = randomUUID();

  return {
    name: "astro-cms",
    hooks: {
      "astro:config:setup": ({ command, config: astroConfig, injectRoute, addMiddleware, updateConfig }) => {
        const root = fileURLToPath(astroConfig.root);
        const problems = configProblems(config);
        if (problems.length) throw new Error(`[astro-cms] cms.config.ts:\n  - ${problems.join("\n  - ")}`);
        clearStaleContent(root, fileURLToPath(astroConfig.cacheDir));

        injectRoute({ pattern: "/admin/login", entrypoint: here("./routes/login.astro"), prerender: false });
        injectRoute({ pattern: "/admin/[...path]", entrypoint: here("./routes/admin.astro"), prerender: false });
        injectRoute({ pattern: "/api/cms/auth/[action]", entrypoint: here("./routes/auth.ts"), prerender: false });
        injectRoute({ pattern: "/api/cms/[...path]", entrypoint: here("./routes/api.ts"), prerender: false });
        injectRoute({ pattern: "/_cms/preview/[...path]", entrypoint: here("./routes/preview.astro"), prerender: false });
        injectRoute({ pattern: "/_cms/asset/[...key]", entrypoint: here("./routes/asset.ts"), prerender: false });
        injectRoute({ pattern: "/_cms/media/[...key]", entrypoint: here("./routes/media.ts"), prerender: false });
        injectRoute({ pattern: "/_cms/version", entrypoint: here("./routes/version.ts"), prerender: false });
        addMiddleware({ entrypoint: here("./middleware.ts"), order: "pre" });

        const dev = command === "dev";
        // Unpublished uploads are served by the site itself; allowing its own
        // host lets the image pipeline fetch them in the preview.
        const ownHosts = ["localhost", "127.0.0.1"];
        if (astroConfig.site) ownHosts.push(new URL(astroConfig.site).hostname);
        if (config.deploy?.url) ownHosts.push(new URL(config.deploy.url).hostname);
        updateConfig({
          // Secrets are read through astro:env, which every adapter supports.
          env: {
            schema: {
              CMS_PASSWORD: envField.string({ context: "server", access: "secret", optional: true }),
              CMS_SESSION_SECRET: envField.string({ context: "server", access: "secret", optional: true }),
              CMS_GITHUB_TOKEN: envField.string({ context: "server", access: "secret", optional: true }),
            },
          },
          image: {
            remotePatterns: [
              ...(astroConfig.image.remotePatterns ?? []),
              ...ownHosts.map((hostname) => ({ hostname, pathname: "/_cms/asset/**" })),
            ],
          },
          vite: {
            // `pkg > dep` resolves each one from this package, wherever npm put it.
            optimizeDeps: { include: CLIENT_DEPS.map((dep) => `@johannes-fraundorfer/astro-cms > ${dep}`) },
            plugins: [
              cmsVitePlugin({
                root,
                storage: here(STORAGE[storage]),
                token,
                dev,
                terminal: dev && !!config.terminal,
                git: config.publish?.target === "github" ? (config.publish.github?.branch ?? "main") : undefined,
              }),
            ],
            define: {
              __CMS_DEV__: JSON.stringify(dev),
              __CMS_DEV_TOKEN__: JSON.stringify(dev ? token : ""),
              __CMS_BUILD_TIME__: JSON.stringify(Date.now()),
              __CMS_BUILD_SHA__: JSON.stringify(buildSha(root)),
            },
          },
        });
      },
    },
  };
}

/**
 * Astro's content cache only notices a change to content.config.ts itself, not
 * to cms.config.ts it imports. After a schema change it would keep serving
 * entries parsed with the old schema (a new field silently missing), so the
 * cache is cleared whenever cms.config.ts changes.
 */
function clearStaleContent(root: string, cacheDir: string) {
  const file = ["cms.config.ts", "cms.config.mjs"].map((f) => resolve(root, f)).find(existsSync);
  if (!file) return;
  const hash = createHash("sha256").update(readFileSync(file)).digest("hex");
  const marker = resolve(cacheDir, "cms-config.hash");
  const previous = existsSync(marker) ? readFileSync(marker, "utf8") : "";
  if (previous === hash) return;
  if (previous) {
    for (const store of [resolve(root, ".astro", "data-store.json"), resolve(cacheDir, "data-store.json")]) {
      rmSync(store, { force: true });
    }
  }
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(marker, hash);
}

/** The commit being built: CI hosts provide it (Cloudflare, Vercel, Netlify), locally git does. */
function buildSha(root: string) {
  const ci = process.env.WORKERS_CI_COMMIT_SHA || process.env.VERCEL_GIT_COMMIT_SHA || process.env.COMMIT_REF;
  if (ci) return ci;
  try {
    return execSync("git rev-parse HEAD", { cwd: root, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "";
  }
}

type PluginOptions = { root: string; storage: string; token: string; dev: boolean; terminal: boolean; git?: string };

function cmsVitePlugin(opts: PluginOptions): Plugin {
  const configFile = resolve(opts.root, "cms.config.ts");
  return {
    name: "astro-cms",
    enforce: "pre",
    resolveId(id) {
      if (id === "virtual:cms/config") return configFile;
      if (id === "virtual:cms/storage") return opts.storage;
    },
    configureServer(server) {
      server.middlewares.use("/__cms/fs", (req, res) => {
        handleFs(opts, req)
          .then((sha) => {
            res.statusCode = 200;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ sha }));
          })
          .catch((err: Error & { status?: number }) => {
            res.statusCode = err.status ?? 500;
            res.end(err.message);
          });
      });
      if (opts.terminal) attachTerminal(server, opts);
    },
  };
}

/* ------------------------------ Local writes ------------------------------ */

const WRITABLE = ["src/content/", "src/assets/cms/"];

async function readBody(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function fail(status: number, message: string): never {
  throw Object.assign(new Error(message), { status });
}

function safePath(root: string, rel: string) {
  const normal = rel.replace(/\\/g, "/");
  if (!WRITABLE.some((p) => normal.startsWith(p)) || normal.split("/").includes("..")) {
    fail(400, `Refusing to write outside ${WRITABLE.join(", ")}: ${rel}`);
  }
  const abs = resolve(root, normal);
  if (!abs.startsWith(resolve(root) + sep)) fail(400, `Path escapes the project: ${rel}`);
  return abs;
}

async function handleFs(opts: PluginOptions, req: IncomingMessage) {
  if (req.method !== "POST") fail(405, "POST only");
  if (req.headers["x-cms-token"] !== opts.token) fail(403, "Bad token");
  const { writes = [], deletes = [], message = "content: update" } = JSON.parse(await readBody(req)) as {
    writes?: { path: string; content: string; encoding?: "utf8" | "base64" }[];
    deletes?: string[];
    message?: string;
  };
  for (const w of writes) {
    const abs = safePath(opts.root, w.path);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, w.encoding === "base64" ? Buffer.from(w.content, "base64") : w.content);
  }
  for (const d of deletes) await rm(safePath(opts.root, d), { force: true });
  if (opts.git) return commitAndPush(opts.root, opts.git, [...writes.map((w) => w.path), ...deletes], message);
  return undefined;
}

const run = promisify(execFile);

/**
 * Commits only the published paths, leaving any other work in the tree alone,
 * then pushes so the host rebuilds. A remote that moved ahead (someone
 * published from the deployed dashboard) is rebased onto first.
 */
async function commitAndPush(root: string, branch: string, paths: string[], message: string) {
  const git = (...args: string[]) => run("git", args, { cwd: root, windowsHide: true });
  try {
    await git("add", "-A", "--", ...paths);
    const staged = await git("diff", "--cached", "--name-only", "--", ...paths);
    if (staged.stdout.trim()) await git("commit", "-m", message, "--", ...paths);
    try {
      await git("push", "origin", `HEAD:${branch}`);
    } catch {
      await git("pull", "--rebase", "--autostash", "origin", branch);
      await git("push", "origin", `HEAD:${branch}`);
    }
    return (await git("rev-parse", "HEAD")).stdout.trim();
  } catch (err) {
    const detail = (err as { stderr?: string }).stderr?.trim() || (err as Error).message;
    fail(502, `Saved the files, but git couldn't commit and push them: ${detail}`);
  }
}

/* -------------------------------- Terminal -------------------------------- */

function defaultShell() {
  if (process.platform === "win32") return { file: "powershell.exe", args: ["-NoLogo"] };
  return { file: process.env.SHELL || "/bin/bash", args: ["-l"] };
}

function attachTerminal(server: ViteDevServer, opts: { root: string; token: string }) {
  const httpServer = server.httpServer;
  if (!httpServer) return;

  const wssPromise = import("ws").then(({ WebSocketServer }) => new WebSocketServer({ noServer: true }));

  // The Cloudflare Vite plugin forwards every upgrade to the worker, which
  // answers 404 and drops the socket. Terminal upgrades are taken before any
  // listener sees them.
  const emit = httpServer.emit;
  httpServer.emit = function (this: typeof httpServer, event: string, ...args: unknown[]) {
    if (event === "upgrade") {
      const [req] = args as [IncomingMessage];
      if (new URL(req.url ?? "/", "http://localhost").pathname === "/__cms/terminal") {
        onUpgrade(...(args as Parameters<typeof onUpgrade>));
        return true;
      }
    }
    return emit.call(this, event, ...args);
  } as typeof httpServer.emit;

  async function onUpgrade(req: IncomingMessage, socket: import("node:stream").Duplex, head: Buffer) {
    const url = new URL(req.url ?? "/", "http://localhost");

    const host = (req.headers.origin ? new URL(req.headers.origin).hostname : "") || "";
    const local = ["localhost", "127.0.0.1", "[::1]", "::1"].includes(host);
    if (!local || url.searchParams.get("token") !== opts.token) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      return socket.destroy();
    }

    const wss = await wssPromise;
    wss.handleUpgrade(req, socket, head, async (ws) => {
      let pty: typeof import("@lydell/node-pty");
      try {
        pty = await import("@lydell/node-pty");
      } catch {
        ws.send("\r\n\x1b[31mTerminal unavailable: install @lydell/node-pty.\x1b[0m\r\n");
        return ws.close();
      }
      const { file, args } = defaultShell();
      const cols = Number(url.searchParams.get("cols")) || 80;
      const rows = Number(url.searchParams.get("rows")) || 24;
      const proc = pty.spawn(file, args, {
        name: "xterm-256color",
        cols,
        rows,
        cwd: opts.root,
        env: { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor" } as Record<string, string>,
      });

      proc.onData((data) => ws.readyState === ws.OPEN && ws.send(data));
      proc.onExit(({ exitCode }) => {
        if (ws.readyState === ws.OPEN) {
          ws.send(`\r\n\x1b[2m[process exited with code ${exitCode}]\x1b[0m\r\n`);
          ws.close();
        }
      });
      ws.on("message", (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          if (msg.type === "input") proc.write(msg.data);
          if (msg.type === "resize") proc.resize(Math.max(2, msg.cols | 0), Math.max(2, msg.rows | 0));
        } catch {
          /* ignore malformed frames */
        }
      });
      ws.on("close", () => {
        try {
          proc.kill();
        } catch {
          /* already gone */
        }
      });
    });
  }
}
