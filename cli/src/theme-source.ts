// Where one run reads a store's theme code from, and what has to be cleaned up afterwards.
//
// resolveThemeDir() in store.ts answers the same question synchronously and is still the right
// call for anything that only needs a path (a preflight message, a fix that writes back into a
// local checkout). This is its async sibling, for the one mode that has to *fetch* the code
// first: a `"read"` GitHub connection, which materialises the repo into a temp directory for the
// duration of the run and deletes it at the end.
//
// Callers must release() in a `finally`. A signal skips those, which is why github-checkout.ts
// also tracks live checkouts for the handlers in shutdown.ts to delete.
import chalk from "chalk";
import type { StoreConfig } from "@barrel/site-audit-shared";
import { resolveThemeDir } from "./store.js";
import { cliInvocation } from "./paths.js";
import { checkoutRepoToTemp } from "./github-checkout.js";
import { getGithubToken, hasCachedValidGithubToken } from "./github-auth.js";

export interface ThemeSource {
  /** The theme root to hand the analyzers. */
  dir: string;
  /** One line for the log, so a report's reader can tell where its Theme Code section came from. */
  label: string;
  /** Whether `dir` is a temp directory that release() will delete. */
  ephemeral: boolean;
  release: () => void;
}

/** A token for a non-interactive run.
 *
 * getGithubToken() falls back to the device flow, which prints a code and waits for someone to
 * type it into github.com. That is right in a terminal and wrong everywhere else: a run spawned
 * by the dashboard or the local agent would sit there forever on a code nobody is looking at. So
 * outside a TTY this requires an already-cached login and says how to create one. */
async function tokenForRun(): Promise<string> {
  if (process.stdin.isTTY) return await getGithubToken();

  if (!(await hasCachedValidGithubToken())) {
    throw new Error(
      `This store reads its theme code straight from GitHub, but this machine has no GitHub login cached.\n` +
        `  Run \`${cliInvocation()} link-repo --login\` once in a terminal to sign in (a one-time code in your ` +
        `browser), then start this run again.`,
    );
  }
  return await getGithubToken();
}

/** Resolves, and if necessary fetches, the theme code for this run. */
export async function acquireThemeSource(store: StoreConfig): Promise<ThemeSource> {
  if (store.githubMode === "read" && store.githubRepo) {
    const ref = store.githubBranch ?? "HEAD";
    const token = await tokenForRun();
    const checkout = await checkoutRepoToTemp({
      token,
      fullName: store.githubRepo,
      ref,
      subdir: store.themeSubdir,
    });
    return {
      dir: checkout.dir,
      label: `${store.githubRepo}@${ref} (read from GitHub for this run, nothing kept on disk)`,
      ephemeral: true,
      release: checkout.cleanup,
    };
  }

  const dir = resolveThemeDir(store);
  return {
    dir,
    label: store.localThemeDir ? `${dir} (local checkout)` : dir,
    ephemeral: false,
    release: () => {},
  };
}

/** True when this store's theme code has to be fetched before it can be read — i.e. the on-disk
 * path resolveThemeDir() would return is not where a run will actually look. Lets a synchronous
 * preflight skip a "there is no theme code here" error that a fetch is about to make untrue. */
export function themeSourceIsRemote(store: StoreConfig): boolean {
  return store.githubMode === "read" && Boolean(store.githubRepo);
}

export function describeRemoteThemeSource(store: StoreConfig): string {
  return chalk.gray(
    `Theme code for ${store.name} is read from ${store.githubRepo}` +
      `${store.githubBranch ? ` (${store.githubBranch})` : ""}` +
      `${store.themeSubdir ? ` at ${store.themeSubdir}/` : ""} on every run — no copy is kept on disk.`,
  );
}
