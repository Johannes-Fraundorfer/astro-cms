// @ts-check
import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";
import cms from "@johannes-fraundorfer/astro-cms";
import cmsConfig from "./cms.config.ts";

const isDev = process.argv.includes("dev");

export default defineConfig({
  site: "https://example.com",
  adapter: cloudflare({ imageService: isDev ? "passthrough" : "compile" }),
  integrations: [cms({ config: cmsConfig })],
});
