import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

export function findRepoRoot(startDir = process.cwd()): string {
  let dir = startDir;
  for (let i = 0; i < 20; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    "Could not find repo root (no pnpm-workspace.yaml found in any parent directory). Run barrel-audit from within the barrel-site-audit repo.",
  );
}

export function storesDir(root = findRepoRoot()): string {
  return join(root, "stores");
}

export function storeDir(slug: string, root = findRepoRoot()): string {
  return join(storesDir(root), slug);
}

export function storeThemeDir(slug: string, root = findRepoRoot()): string {
  return join(storeDir(slug, root), "theme");
}

export function storeConfigPath(slug: string, root = findRepoRoot()): string {
  return join(storeDir(slug, root), "config.json");
}
