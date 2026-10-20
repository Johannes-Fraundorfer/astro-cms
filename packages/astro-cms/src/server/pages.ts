import type { AstroComponentFactory } from "astro/runtime/server/index.js";

interface PageModule {
  default: AstroComponentFactory;
}

const modules = import.meta.glob<PageModule>("/src/pages/**/*.astro", { eager: true });

type Segment = { kind: "static"; value: string } | { kind: "param"; name: string } | { kind: "rest"; name: string };

interface Route {
  file: string;
  segments: Segment[];
  module: PageModule;
  score: number[];
}

function parse(file: string): Route | undefined {
  const rel = file.replace(/^\/src\/pages\//, "").replace(/\.astro$/, "");
  const parts = rel.split("/").filter((p) => p !== "index");
  if (parts.some((p) => p.startsWith("_"))) return undefined;
  const segments: Segment[] = parts.map((p) => {
    const rest = p.match(/^\[\.\.\.(\w+)\]$/);
    if (rest) return { kind: "rest", name: rest[1] };
    const param = p.match(/^\[(\w+)\]$/);
    if (param) return { kind: "param", name: param[1] };
    return { kind: "static", value: p };
  });
  // Astro's priority: more segments first, static before dynamic, rest last.
  const rank = { static: 0, param: 1, rest: 2 } as const;
  return {
    file,
    segments,
    module: modules[file],
    score: [segments.some((s) => s.kind === "rest") ? 1 : 0, -segments.length, ...segments.map((s) => rank[s.kind])],
  };
}

const routes = Object.keys(modules)
  .map(parse)
  .filter((r): r is Route => !!r && !/\/404$/.test(r.file.replace(/\.astro$/, "")))
  .sort((a, b) => {
    for (let i = 0; i < Math.max(a.score.length, b.score.length); i++) {
      const d = (a.score[i] ?? 0) - (b.score[i] ?? 0);
      if (d) return d;
    }
    return 0;
  });

/** Matches path parts against route segments; a rest segment may take any number of parts, including none. */
function matchSegments(segments: Segment[], parts: string[]): Record<string, string> | undefined {
  if (!segments.length) return parts.length ? undefined : {};
  const [seg, ...restSegs] = segments;
  if (seg.kind === "rest") {
    for (let take = parts.length; take >= 0; take--) {
      const tail = matchSegments(restSegs, parts.slice(take));
      if (tail) return take ? { [seg.name]: parts.slice(0, take).join("/"), ...tail } : tail;
    }
    return undefined;
  }
  const [part, ...rest] = parts;
  if (part === undefined) return undefined;
  if (seg.kind === "static" && part !== seg.value) return undefined;
  const tail = matchSegments(restSegs, rest);
  if (!tail) return undefined;
  return seg.kind === "param" ? { [seg.name]: part, ...tail } : tail;
}

/** Finds the page file Astro would serve for a path, and its route params. */
export function matchPage(path: string, isLocale: (value: string) => boolean = () => true) {
  const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
  for (const route of routes) {
    const params = matchSegments(route.segments, parts);
    // A `[...locale]` segment only ever holds a locale code.
    if (params && (params.locale === undefined || isLocale(params.locale))) return { Page: route.module.default, params };
  }
  return undefined;
}
