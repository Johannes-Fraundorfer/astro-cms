---
name: cms-add-block
description: Add a new section type (block) to a site that uses astro-cms — config, component, canvas markup and a first example — so editors can add it to pages from the dashboard. Use when asked to add a new section, block, module or component editors can place on pages, like testimonials, FAQ, logos, pricing or a team grid.
---

# Add a block

A block is a section editors can add, reorder and fill on pages. Adding one
touches four places; do them in this order. API details are in
[../cms-setup/reference.md](../cms-setup/reference.md).

## 1. Look at the existing blocks

Read `cms.config.ts` and one existing section component (for example the hero).
Match their conventions: file location, prop names, how `path` and `locale` are
passed, how buttons and images are handled. A new block should look like it was
written with the others.

## 2. Define it in `cms.config.ts`

```ts
defineBlock({
  name: "testimonials",            // lowercase, used as _type in content
  title: "Testimonials",           // what editors see
  icon: "❝",                       // one glyph
  preview: { title: "heading" },   // list row title (and subtitle/media if useful)
  fields: [
    { name: "heading", type: "string" },
    { name: "items", title: "Quotes", type: "blocks", of: ["quote"] },
  ],
}),
defineBlock({
  name: "quote",
  title: "Quote",
  icon: "❞",
  preview: { title: "author", subtitle: "text" },
  fields: [
    { name: "text", type: "text", rows: 3, required: true },
    { name: "author", type: "string", required: true },
    { name: "role", type: "string" },
    { name: "photo", type: "image" },
  ],
}),
```

Then add the name to every `blocks` field it belongs in, usually
`sections.of`. Repeated items (quotes, logos, FAQ entries) are their own small
block inside a `blocks` field, so editors can reorder them.

Reuse existing field helpers (a shared `button` field list, for instance)
instead of redefining them. Use `link` for anything that points at a page.

## 3. Write the component

- Props: each field as a plain value, plus `path` (the item's data path) and
  `locale` if the site is multilingual.
- `cms.field(path, "block", "Testimonials")` on the section's outer element,
  so editors get the section toolbar on the canvas.
- `cms.field(\`${path}.heading\`, "text", "Heading")` on the element that
  directly holds each value. Nested items: `${path}.items.${i}` with kind
  `block`, and their fields below that.
- Images through `cmsImage(value)`, links through `cmsLinkAttrs(Astro, value, locale)`.
- Render nothing (not an empty box) when an optional value is missing.
- Style it with the site's existing tokens and classes.

## 4. Register it on the pages

Every page that renders `sections` maps `_type` to a component. Add the new one
to each of those maps, or it will silently render nothing.

## 5. Give it an example

Add one instance to a page's content JSON (with a unique 8-character `_key`),
or tell the user to add it from the dashboard. An example is the fastest way to
check the markup on the canvas.

## 6. Verify

1. `npx astro check` passes.
2. In `astro dev` → `/admin`: the block appears under "Add item" on pages that
   allow it, a new one is added with empty fields, its fields open in the right
   panel, text edits in place on the canvas, and the section toolbar moves and
   removes it.
3. The published page renders it correctly with the example content.
