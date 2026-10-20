import { getBlock, type BlockType, type CmsConfig, type Field } from "../schema.ts";

export type Path = (string | number)[];

export const parsePath = (s: string): Path => s.split(".").map((p) => (/^\d+$/.test(p) ? Number(p) : p));
export const pathKey = (p: Path) => p.join(".");

export function getIn(obj: unknown, path: Path): any {
  let cur: any = obj;
  for (const seg of path) {
    if (cur == null) return undefined;
    cur = cur[seg as any];
  }
  return cur;
}

export function setIn<T>(obj: T, path: Path, value: unknown): T {
  if (!path.length) return value as T;
  const [head, ...rest] = path;
  const base: any = Array.isArray(obj) ? [...obj] : { ...(obj as object) };
  base[head as any] = setIn(base[head as any] ?? (typeof rest[0] === "number" ? [] : {}), rest, value);
  return base;
}

export type Target =
  | { kind: "block"; path: Path; block: BlockType; value: any }
  | { kind: "field"; path: Path; field: Field; value: any };

/** Resolves a data path to the schema that describes it. */
export function resolveTarget(config: CmsConfig, fields: Field[], data: unknown, path: Path): Target | undefined {
  let current = fields;
  for (let i = 0; i < path.length; i++) {
    const field = current.find((f) => f.name === path[i]);
    if (!field) return undefined;
    const soFar = path.slice(0, i + 1);
    if (i === path.length - 1) return { kind: "field", path: soFar, field, value: getIn(data, soFar) };
    if (field.type === "object") {
      current = field.fields;
    } else if (field.type === "blocks" && typeof path[i + 1] === "number") {
      const itemPath = path.slice(0, i + 2);
      const item = getIn(data, itemPath);
      const block = item && getBlock(config, item._type);
      if (!block) return undefined;
      if (i + 1 === path.length - 1) return { kind: "block", path: itemPath, block, value: item };
      current = block.fields;
      i++;
    } else {
      return undefined;
    }
  }
  return undefined;
}

/** The closest block containing a path, if any. */
export function enclosingBlock(config: CmsConfig, fields: Field[], data: unknown, path: Path) {
  for (let n = path.length; n > 0; n--) {
    const t = resolveTarget(config, fields, data, path.slice(0, n));
    if (t?.kind === "block") return t;
  }
  return undefined;
}
