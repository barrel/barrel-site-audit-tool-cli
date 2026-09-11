// Ephemeral, read-only checkouts of a connected GitHub repo — the `"read"` half of the connector.
//
// A `"pull"`-mode connection clones a repo into stores/<slug>/theme/ once and audits that snapshot
// from then on. A `"read"`-mode connection keeps nothing: every run downloads the ref's tarball
// into a temp directory, the analyzers read it, and it is deleted. Two consequences worth knowing:
// every audit sees the branch as it is right now rather than as it was the day someone pulled it,
// and no client code is left sitting on the auditor's disk afterwards.
//
// Read-only by construction, like github.ts, and covered by the same build guard
// (scripts/verify-github-readonly.mjs): a tarball download is a GET, `tar -x` writes only inside
// the temp directory it is handed, and no git remote is ever contacted — which is also why this
// uses the archive endpoint rather than `git clone`. There is no working repository here that a
// later edit could accidentally commit or push from.
import { spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdtempSync, rmSync } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { splitFullName } from "./github.js";

export interface RepoCheckout {
  /** The theme root — the extracted repo, plus `subdir` when the theme lives one level down. */
  dir: string;
  /** Where the tarball was extracted. `dir` is this or a directory inside it. */
  root: string;
  /** The commit the tarball was cut from, for the record of what a report actually read. */
  ref: string;
  /** Idempotent. Safe to call from a `finally` that may run after an earlier cleanup. */
  cleanup: () => void;
}

// Every live checkout, so a signal can delete them even though it skips every `finally` block.
// Same reasoning as installBrowserCleanup() in shutdown.ts, which calls into this.
const liveCheckouts = new Set<string>();

/** Deletes every temp checkout this process created. Called from the signal handlers in
 * shutdown.ts — a Ctrl+C or a Stop from the dashboard would otherwise leave a full copy of a
 * client's theme in the system temp directory. */
export function cleanupAllRepoCheckouts(): void {
  for (const dir of [...liveCheckouts]) {
    rmSync(dir, { recursive: true, force: true });
    liveCheckouts.delete(dir);
  }
}

/** GitHub's tarball endpoint answers with a redirect to a signed codeload URL. Followed manually,
 * with the Authorization header dropped on the hop: the signed URL needs no credential, and
 * letting fetch replay a GitHub token onto a different host is exactly the kind of leak that is
 * easy to add and hard to notice. */
async function fetchTarball(token: string, owner: string, repo: string, ref: string): Promise<Response> {
  const url = `https://api.github.com/repos/${owner}/${repo}/tarball/${encodeURIComponent(ref)}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "barrel-site-audit",
  };

  const first = await fetch(url, { headers, redirect: "manual" });
  if (first.status >= 300 && first.status < 400) {
    const location = first.headers.get("location");
    if (!location) throw new Error(`GitHub redirected the archive request for ${owner}/${repo} without a location.`);
    const followed = await fetch(location, { headers: { "User-Agent": "barrel-site-audit" } });
    if (!followed.ok || !followed.body) {
      throw new Error(`Downloading ${owner}/${repo}@${ref} failed (${followed.status} ${followed.statusText}).`);
    }
    return followed;
  }

  if (!first.ok || !first.body) {
    const detail =
      first.status === 404
        ? ` — either the repo doesn't exist, the branch "${ref}" doesn't, or this GitHub login can't see it.`
        : "";
    throw new Error(`Downloading ${owner}/${repo}@${ref} failed (${first.status} ${first.statusText})${detail}`);
  }
  return first;
}

function extract(tarball: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // --strip-components=1 drops the "<owner>-<repo>-<sha>/" wrapper GitHub puts every archive in.
    // System tar, not a dependency: macOS, Linux and Windows 10+ all ship one, and the alternative
    // is pulling a tar implementation into the CLI to unpack a file we just wrote ourselves.
    const child = spawn("tar", ["-xzf", tarball, "--strip-components=1", "-C", dest], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (err) =>
      reject(new Error(`Could not run tar to unpack the repo archive: ${err.message}`)),
    );
    child.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`tar exited with code ${code}${stderr ? `: ${stderr.trim()}` : ""}`)),
    );
  });
}

/** Downloads `fullName` at `ref` into a fresh temp directory and returns the theme root inside it.
 *
 * `subdir` is the path within the repo to the theme (from the store's `themeSubdir`, or from
 * findThemeRootInRepo()); pass "" for a theme at the repo root. Throws if that path isn't in the
 * archive, rather than handing back a directory the analyzers would report as an empty theme. */
export async function checkoutRepoToTemp(opts: {
  token: string;
  fullName: string;
  ref: string;
  subdir?: string;
}): Promise<RepoCheckout> {
  const [owner, repo] = splitFullName(opts.fullName);
  const root = mkdtempSync(join(tmpdir(), `barrel-audit-repo-`));
  liveCheckouts.add(root);

  const cleanup = () => {
    rmSync(root, { recursive: true, force: true });
    liveCheckouts.delete(root);
  };

  try {
    const response = await fetchTarball(opts.token, owner, repo, opts.ref);
    const tarball = join(root, "repo.tar.gz");
    await pipeline(Readable.fromWeb(response.body as never), createWriteStream(tarball));
    await extract(tarball, root);
    rmSync(tarball, { force: true });

    const dir = opts.subdir ? join(root, opts.subdir) : root;
    if (!existsSync(dir)) {
      throw new Error(
        `${opts.fullName}@${opts.ref} has no "${opts.subdir}" directory, which is where this store's ` +
          `theme is recorded as living. Re-connect the repo to pick the theme path up again.`,
      );
    }
    return { dir, root, ref: opts.ref, cleanup };
  } catch (err) {
    cleanup();
    throw err;
  }
}
