import { getSecret } from "astro:env/server";
import config from "virtual:cms/config";

export type DeployState =
  | { state: "live"; liveSha: string }
  | { state: "building"; liveSha?: string }
  | { state: "failed"; detailsUrl?: string }
  | { state: "unknown"; reason: string };

async function liveVersion(): Promise<{ sha: string; builtAt: number } | undefined> {
  // A deployed dashboard is the live site, so its own build is the live build.
  if (!__CMS_DEV__) return { sha: __CMS_BUILD_SHA__, builtAt: __CMS_BUILD_TIME__ };
  if (!config.deploy?.url) return undefined;
  try {
    const res = await fetch(new URL("/_cms/version", config.deploy.url), { cache: "no-store" });
    return res.ok ? ((await res.json()) as { sha: string; builtAt: number }) : undefined;
  } catch {
    return undefined;
  }
}

/** Cloudflare's build reports to GitHub as a check run; reading it needs the token's Checks permission. */
async function failedCheck(sha: string) {
  const repo = config.publish?.github?.repo;
  const token = getSecret("CMS_GITHUB_TOKEN");
  if (!repo || !token || !sha) return undefined;
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/commits/${sha}/check-runs`, {
      headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "user-agent": "astro-cms" },
    });
    if (!res.ok) return undefined;
    const { check_runs } = (await res.json()) as {
      check_runs: { status: string; conclusion: string | null; html_url?: string; details_url?: string }[];
    };
    const failed = check_runs.find((c) => c.status === "completed" && ["failure", "cancelled", "timed_out"].includes(c.conclusion ?? ""));
    return failed ? { detailsUrl: failed.details_url ?? failed.html_url } : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Builds run in push order, so any build that started after a publish
 * contains it: a live build newer than the publish means the publish is live.
 */
export async function deployState(sha: string, since: number): Promise<DeployState> {
  const live = await liveVersion();
  if (!live) return { state: "unknown", reason: "Set deploy.url in cms.config.ts to track deploys." };
  if ((sha && live.sha === sha) || live.builtAt > since) return { state: "live", liveSha: live.sha };
  const failed = await failedCheck(sha);
  if (failed) return { state: "failed", ...failed };
  return { state: "building", liveSha: live.sha };
}
