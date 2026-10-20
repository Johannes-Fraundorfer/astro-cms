import { defineBlock, defineConfig, defineType, type Field } from "@johannes-fraundorfer/astro-cms/config";

const button: Field[] = [
  { name: "buttonLabel", title: "Button Label", type: "string", description: "Leave empty to hide the button." },
  { name: "buttonHref", title: "Button Link", type: "link" },
];

export default defineConfig({
  // Publishing writes the JSON files locally; nothing is committed.
  publish: { target: "local" },

  types: [
    defineType({
      name: "settings",
      title: "General",
      kind: "singleton",
      icon: "⚙",
      group: "Global Settings",
      preview: { title: "siteName" },
      fields: [
        { name: "siteName", title: "Site Name", type: "string", required: true },
        { name: "description", title: "Default Meta Description", type: "text", rows: 3 },
      ],
    }),
    defineType({
      name: "home",
      title: "Home",
      kind: "singleton",
      icon: "⌂",
      group: "Pages",
      preview: { title: "title" },
      url: "/",
      fields: [
        { name: "title", title: "Page Title", type: "string", required: true },
        { name: "sections", type: "blocks", of: ["hero", "text", "cta"] },
      ],
    }),
    defineType({
      name: "articles",
      title: "Articles",
      kind: "collection",
      icon: "✎",
      group: "Collections",
      preview: { title: "title", subtitle: "excerpt", media: "cover" },
      url: "/articles/{slug}",
      fields: [
        { name: "title", type: "string", required: true },
        { name: "slug", title: "URL Slug", type: "slug", source: "title", required: true },
        { name: "excerpt", type: "text", rows: 2 },
        { name: "cover", title: "Cover Image", type: "image" },
        { name: "body", type: "richText" },
      ],
    }),
  ],

  blocks: [
    defineBlock({
      name: "hero",
      title: "Hero",
      icon: "H",
      preview: { title: "heading", media: "image" },
      fields: [
        { name: "heading", type: "string", required: true },
        { name: "text", type: "text", rows: 3 },
        ...button,
        { name: "image", type: "image" },
        { name: "video", type: "video", description: "Plays muted on a loop in place of the image." },
      ],
    }),
    defineBlock({
      name: "text",
      title: "Rich Text",
      icon: "¶",
      preview: { title: "content" },
      fields: [{ name: "content", type: "richText" }],
    }),
    defineBlock({
      name: "cta",
      title: "Call to Action",
      icon: "→",
      preview: { title: "heading" },
      fields: [{ name: "heading", type: "string", required: true }, { name: "text", type: "text", rows: 2 }, ...button],
    }),
  ],
});
