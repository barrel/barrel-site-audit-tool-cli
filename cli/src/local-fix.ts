// Applies an AI-suggested fix straight into a local git checkout the user already has open —
// no clone, no branch, no commit, no GitHub API calls. The file is left unstaged so the user's
// own git/editor shows the diff, and nothing reaches disk until they choose to commit it
// themselves — deliberately the simplest, most conservative option: see git-pr.ts for the
// clone-branch-PR flow used for stores whose theme code isn't already on this machine.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { createHash } from "node:crypto";

export class DriftError extends Error {}

function contentHash(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/** Aborts if filePath would escape themeDir, if the file vanished since the fix was suggested,
 * or if its current content no longer matches what the fix was generated against (someone else
 * edited it in the meantime) — never silently overwrites any of those. Returns the absolute path
 * written, for display back to the user. */
export function applyFixLocally(themeDir: string, filePath: string, newContent: string, baseContentSha256: string): string {
  const abs = resolve(themeDir, filePath);
  const rel = relative(themeDir, abs);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`Refusing to write outside the theme directory: "${filePath}"`);
  }
  if (!existsSync(abs)) {
    throw new DriftError(`"${filePath}" no longer exists — re-run "Suggest fix" to regenerate.`);
  }
  const current = readFileSync(abs, "utf-8");
  if (contentHash(current) !== baseContentSha256) {
    throw new DriftError(`"${filePath}" has changed on disk since this fix was generated — re-run "Suggest fix" to regenerate against the latest version.`);
  }
  writeFileSync(abs, newContent, "utf-8");
  return abs;
}
