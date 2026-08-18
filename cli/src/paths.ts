import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

function findRepoRootOrNull(startDir = process.cwd()): string | null {
  let dir = startDir;
  for (let i = 0; i < 20; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** Throws unless run from inside a barrel-site-audit checkout — only `serve` needs this (the
 * dashboard-driven local agent, which spawns `pnpm barrel-audit ...` and manages stores/<slug>/
 * for many client sites at once, so it only makes sense inside this monorepo). Everything else
 * that needs a place to store data should use `dataRoot()` instead, which also works when the
 * CLI is installed globally and run against an arbitrary repo elsewhere. */
export function findRepoRoot(startDir = process.cwd()): string {
  const found = findRepoRootOrNull(startDir);
  if (!found) {
    throw new Error(
      "Could not find repo root (no pnpm-workspace.yaml found in any parent directory). Run barrel-audit from within the barrel-site-audit repo.",
    );
  }
  return found;
}

function globalDataDir(): string {
  return join(homedir(), ".barrel-audit");
}

/** Where stores/config/.env live. Inside a barrel-site-audit checkout this is the repo root
 * (dev usage, `pnpm barrel-audit ...`) — same as always. Anywhere else (the CLI installed
 * globally via npm and run against a store's own repo) it falls back to ~/.barrel-audit so the
 * tool works without ever needing a barrel-site-audit checkout on disk. */
export function dataRoot(): string {
  return findRepoRootOrNull() ?? globalDataDir();
}

/** How to spell "run this CLI again" in a message to the user. Inside a checkout that's the
 * `pnpm barrel-audit` script; from a global install there's no package.json to resolve it, so
 * suggesting `pnpm barrel-audit ...` there just earns an ERR_PNPM_NO_IMPORTER_MANIFEST_FOUND. */
export function cliInvocation(): string {
  return findRepoRootOrNull() ? "pnpm barrel-audit" : "barrel-audit";
}

export function storesDir(root = dataRoot()): string {
  return join(root, "stores");
}

export function storeDir(slug: string, root = dataRoot()): string {
  return join(storesDir(root), slug);
}

export function storeThemeDir(slug: string, root = dataRoot()): string {
  return join(storeDir(slug, root), "theme");
}

/** Persistent working directory for an in-progress AI fix branch — separate from theme/ (which
 * has no git history and is overwritten on every audit run). Survives across the prepare/
 * open-editor/preview/push steps so a fix can be edited or tested locally before anything is
 * pushed. Safe to delete any time; it's recreated fresh from GitHub on the next "Suggest fix". */
export function storeFixDir(slug: string, branch: string, root = dataRoot()): string {
  return join(storeDir(slug, root), "fixes", branch);
}

export function storeConfigPath(slug: string, root = dataRoot()): string {
  return join(storeDir(slug, root), "config.json");
}
