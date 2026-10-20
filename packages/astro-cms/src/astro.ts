import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";
import type { SchemaContext } from "astro:content";
import { getBlock, type CmsConfig, type Field } from "./schema.ts";

type ImageHelper = SchemaContext["image"];

const refSchema = z.object({ _ref: z.string() });

function fieldSchema(
  config: CmsConfig,
  field: Field,
  image: ImageHelper,
  blocks: Map<string, z.ZodType>,
): z.ZodType {
  switch (field.type) {
    case "number":
      return z.number();
    case "boolean":
      return z.boolean();
    case "image":
      // `{ src, alt }`, or a bare path from before alt text lived on the image.
      return z.union([image(), z.object({ src: image(), alt: z.string().optional() })]);
    case "video":
      return z.object({ src: z.string().optional(), title: z.string().optional() });
    case "reference":
      return refSchema;
    case "link":
      // Older content stored button links as a plain path.
      return z.union([z.string(), z.object({ _ref: z.string().optional(), href: z.string().optional(), newTab: z.boolean().optional() })]);
    case "references":
      return z.array(refSchema.extend({ _key: z.string() }));
    case "object":
      return objectSchema(config, field.fields, image, blocks);
    case "blocks":
      return z.array(
        z.lazy(() => {
          const members = field.of.map((name) => blockSchema(config, name, image, blocks));
          return members.length === 1
            ? members[0]
            : z.union(members as [z.ZodType, z.ZodType, ...z.ZodType[]]);
        }),
      );
    default:
      return z.string();
  }
}

function objectSchema(
  config: CmsConfig,
  fields: Field[],
  image: ImageHelper,
  blocks: Map<string, z.ZodType>,
) {
  // Every field is optional at build time; `required` is enforced on publish,
  // so a half-finished document can never break the site build.
  return z.object(
    Object.fromEntries(
      fields.map((f) => [f.name, fieldSchema(config, f, image, blocks).optional()]),
    ),
  );
}

function blockSchema(
  config: CmsConfig,
  name: string,
  image: ImageHelper,
  blocks: Map<string, z.ZodType>,
): z.ZodType {
  const cached = blocks.get(name);
  if (cached) return cached;
  const block = getBlock(config, name);
  if (!block) throw new Error(`[cms] Unknown block type "${name}"`);
  const schema = objectSchema(config, block.fields, image, blocks).extend({
    _type: z.literal(name),
    _key: z.string(),
  });
  blocks.set(name, schema);
  return schema;
}

/** One content collection per CMS type, read from `src/content/<type>/*.json`. */
export function cmsCollections(config: CmsConfig) {
  return Object.fromEntries(
    config.types.map((type) => [
      type.name,
      defineCollection({
        // Ids are file paths: `home`, or `de/home` for a translation. Without this the loader takes a `slug` field as the
        // id, which would change a document's identity whenever its URL changes.
        loader: glob({
          pattern: "**/*.json",
          base: `./src/content/${type.name}`,
          generateId: ({ entry }) => entry.replace(/\.json$/, ""),
        }),
        schema: ({ image }) => objectSchema(config, type.fields, image, new Map()),
      }),
    ]),
  );
}
