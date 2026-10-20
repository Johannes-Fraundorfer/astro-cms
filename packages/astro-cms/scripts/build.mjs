// Builds dist/: TypeScript compiles .ts/.tsx (JSX included, so sites need no
// React setup); .astro, .css and hand-written .d.ts files are copied with
// their relative imports pointed at the compiled .js files.
import { execFileSync } from "node:child_process";
import { cp, readdir, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "src");
const dist = join(root, "dist");

await rm(dist, { recursive: true, force: true });

const tsc = join(root, "node_modules", "typescript", "bin", "tsc");
const fallback = join(root, "..", "..", "node_modules", "typescript", "bin", "tsc");
const bin = await readFile(tsc).then(() => tsc, () => fallback);
execFileSync(process.execPath, [bin, "-p", join(root, "tsconfig.build.json")], { stdio: "inherit" });

const toJs = (text) =>
  text.replace(/((?:from\s+|import\s*\(?\s*)["'])(\.{1,2}\/[^"']+?)\.tsx?(["'])/g, "$1$2.js$3");

async function copyAssets(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const from = join(dir, entry.name);
    if (entry.isDirectory()) {
      await copyAssets(from);
      continue;
    }
    const to = join(dist, relative(src, from));
    if (entry.name.endsWith(".astro") || entry.name.endsWith(".d.ts")) {
      await mkdir(dirname(to), { recursive: true });
      await writeFile(to, toJs(await readFile(from, "utf8")));
    } else if (entry.name.endsWith(".css")) {
      await mkdir(dirname(to), { recursive: true });
      await cp(from, to);
    }
  }
}
await copyAssets(src);

// tsc keeps `.ts` specifiers in the declarations it emits; point them at .js too.
async function fixDeclarations(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = join(dir, entry.name);
    if (entry.isDirectory()) await fixDeclarations(file);
    else if (entry.name.endsWith(".d.ts")) await writeFile(file, toJs(await readFile(file, "utf8")));
  }
}
await fixDeclarations(dist);
console.log("Built", relative(process.cwd(), dist) || "dist");
