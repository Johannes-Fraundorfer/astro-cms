declare module "virtual:cms/config" {
  const config: import("./schema.ts").CmsConfig;
  export default config;
}

/** The storage adapter the integration picked (`storage` option), e.g. ./storage/d1.ts. */
declare module "virtual:cms/storage" {
  export function database(): import("./storage/types.ts").SqlDatabase;
  /** Where uploaded videos go; undefined when the site has no bucket. */
  export function mediaBucket(): import("./storage/types.ts").MediaBucket | undefined;
}

declare const __CMS_DEV__: boolean;
declare const __CMS_DEV_TOKEN__: string;
declare const __CMS_BUILD_TIME__: number;
/** The commit this build was made from. */
declare const __CMS_BUILD_SHA__: string;

declare namespace App {
  interface Locals {
    /** Set while rendering inside the dashboard canvas: pages read drafts. */
    cmsPreview?: boolean;
    cmsDrafts?: Promise<Map<string, Record<string, unknown>>>;
  }
}
