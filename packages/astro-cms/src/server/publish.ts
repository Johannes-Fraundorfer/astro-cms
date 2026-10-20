import { getSecret } from "astro:env/server";
import { Buffer } from "node:buffer";
import config from "virtual:cms/config";
import { getAsset } from "./db.ts";

export interface FileWrite {
  path: string;
  content: string;
  encoding?: "utf8" | "base64";
}

export interface Changeset {
  writes: FileWrite[];
  deletes: string[];
  message: string;
}

export const ASSET_PREFIX = "/_cms/asset/";
export const PUBLISHED_ASSET_DIR = "src/assets/cms";

export async function assetWrite(key: string): Promise<FileWrite> {
  const asset = await getAsset(key);
  if (!asset) throw new Error(`Uploaded image ${key} is missing from storage`);
  return { path: `${PUBLISHED_ASSET_DIR}/${key}`, content: Buffer.from(asset.bytes).toString("base64"), encoding: "base64" };
}

/**
 * Applies a changeset to the site's source. Under `astro dev` the files are
 * written into the working tree (and, with the github target, committed and
 * pushed from it, so the local repo never falls behind). A deployed dashboard
 * has no working tree and commits through the GitHub API instead.
 */
/** The pushed commit, so the dashboard can tell when it's live. Absent for local-only publishing. */
export interface CommitResult {
  sha?: string;
  since: number;
}

export async function commit(origin: string, changes: Changeset): Promise<CommitResult> {
  const target = config.publish?.target ?? "local";
  const since = Date.now();
  if (!__CMS_DEV__) {
    if (target === "github") return { sha: await commitToGitHub(changes), since };
    throw new Error('A deployed site can only publish with publish.target set to "github".');
  }
  const res = await fetch(`${origin}/__cms/fs`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-cms-token": __CMS_DEV_TOKEN__ },
    body: JSON.stringify(changes),
  });
  if (!res.ok) throw new Error(await res.text());
  const { sha } = (await res.json()) as { sha?: string };
  return { sha, since };
}

/* ------------------------------ GitHub target ----------------------------- */

async function commitToGitHub(changes: Changeset) {
  const repo = config.publish?.github?.repo;
  const branch = config.publish?.github?.branch ?? "main";
  const token = getSecret("CMS_GITHUB_TOKEN");
  if (!repo || !token) {
    throw new Error("GitHub publishing needs publish.github.repo in cms.config.ts and a CMS_GITHUB_TOKEN secret.");
  }

  const gh = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const res = await fetch(`https://api.github.com/repos/${repo}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "user-agent": "astro-cms",
        "content-type": "application/json",
      },
    });
    if (!res.ok) throw new Error(`GitHub ${path}: ${res.status} ${await res.text()}`);
    return res.json() as Promise<T>;
  };

  const ref = await gh<{ object: { sha: string } }>(`/git/ref/heads/${branch}`);
  const parent = await gh<{ tree: { sha: string } }>(`/git/commits/${ref.object.sha}`);

  const tree = await Promise.all([
    ...changes.writes.map(async (w) => {
      const blob = await gh<{ sha: string }>("/git/blobs", {
        method: "POST",
        body: JSON.stringify({ content: w.content, encoding: w.encoding === "base64" ? "base64" : "utf-8" }),
      });
      return { path: w.path, mode: "100644", type: "blob", sha: blob.sha };
    }),
    ...changes.deletes.map((path) => ({ path, mode: "100644", type: "blob", sha: null })),
  ]);

  const newTree = await gh<{ sha: string }>("/git/trees", {
    method: "POST",
    body: JSON.stringify({ base_tree: parent.tree.sha, tree }),
  });
  const newCommit = await gh<{ sha: string }>("/git/commits", {
    method: "POST",
    body: JSON.stringify({ message: changes.message, tree: newTree.sha, parents: [ref.object.sha] }),
  });
  await gh(`/git/refs/heads/${branch}`, {
    method: "PATCH",
    body: JSON.stringify({ sha: newCommit.sha }),
  });
  return newCommit.sha;
}
