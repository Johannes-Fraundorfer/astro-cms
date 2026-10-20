import type { APIRoute } from "astro";
import { handle } from "../server/api.ts";

export const prerender = false;

export const ALL: APIRoute = (ctx) => handle(ctx);
