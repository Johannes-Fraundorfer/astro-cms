import { ELEMENT_NODE, TEXT_NODE, parse, render, type Node } from "ultrahtml";
import { SAFE_HREF, SAFE_VIDEO_SRC, getBlock, type CmsConfig, type Field } from "../schema.ts";

const KEEP = new Set([
  "p", "br", "strong", "b", "em", "i", "u", "s", "a", "ul", "ol", "li",
  "h2", "h3", "h4", "blockquote", "code",
]);
const DROP = new Set(["script", "style", "iframe", "object", "embed", "template", "noscript", "svg", "math"]);

/**
 * Allowlist sanitizer for rich text. Pure JavaScript (ultrahtml's parser), so
 * it runs on any host: kept tags lose every attribute except a safe `href`,
 * dropped tags go with their content, anything else is unwrapped.
 */
export async function sanitizeHtml(html: string) {
  const doc = parse(html);
  const clean = (nodes: Node[]): Node[] =>
    nodes.flatMap((node): Node[] => {
      if (node.type === TEXT_NODE) return [node];
      if (node.type !== ELEMENT_NODE) return [];
      const tag = String(node.name).toLowerCase();
      if (DROP.has(tag)) return [];
      const children = clean(node.children ?? []);
      if (!KEEP.has(tag)) return children;
      const href = tag === "a" && typeof node.attributes?.href === "string" ? node.attributes.href.trim() : "";
      const attributes: Record<string, string> = {};
      if (href && SAFE_HREF.test(href)) {
        attributes.href = href;
        if (/^https?:/i.test(href)) attributes.rel = "noopener";
      }
      return [{ ...node, name: tag, attributes, children }];
    });
  doc.children = clean(doc.children ?? []);
  return render(doc);
}

/** Sanitizes rich text and drops links (such as `javascript:`) and video sources that aren't web URLs, in place. */
export async function sanitizeDoc(config: CmsConfig, fields: Field[], data: Record<string, unknown> | undefined) {
  if (!data) return;
  for (const field of fields) {
    const value = data[field.name];
    if (field.type === "richText" && typeof value === "string") {
      data[field.name] = await sanitizeHtml(value);
    } else if (field.type === "url" && typeof value === "string" && value.trim() && !SAFE_HREF.test(value.trim())) {
      delete data[field.name];
    } else if (field.type === "video" && value && typeof value === "object") {
      const video = value as { src?: unknown; title?: unknown };
      if (typeof video.src !== "string" || !SAFE_VIDEO_SRC.test(video.src.trim())) delete video.src;
      else video.src = video.src.trim();
      if (typeof video.title !== "string") delete video.title;
    } else if (field.type === "link" && value && typeof value === "object") {
      const link = value as { href?: unknown };
      if (typeof link.href === "string" && link.href.trim() && !SAFE_HREF.test(link.href.trim())) delete link.href;
    } else if (field.type === "object" && value && typeof value === "object") {
      await sanitizeDoc(config, field.fields, value as Record<string, unknown>);
    } else if (field.type === "blocks" && Array.isArray(value)) {
      for (const item of value) {
        const block = getBlock(config, item?._type);
        if (block) await sanitizeDoc(config, block.fields, item);
      }
    }
  }
}
