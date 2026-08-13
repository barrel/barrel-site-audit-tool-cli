// Applies an approved fix to a fresh branch in the store's linked GitHub repo and opens a PR —
// and nothing more. This module may ONLY ever call octokit's `pulls.list` and `pulls.create`.
// It must NEVER call `pulls.merge`, `pulls.updateBranch`, `repos.merge`, `repos.mergeUpstream`,
// or any branch-protection endpoint — enforced by cli/scripts/verify-git-pr-safety.mjs, run as
// part of `pnpm build`. Merging a fix is entirely GitHub's normal PR review, outside this tool.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { authenticatedCloneUrl } from "./github.js";

const BRANCH_PREFIX = "barrel-fix/";

export class DriftError extends Error {}
export class AlreadyMergedError extends Error {
  constructor(
    public prUrl: string,
    public prNumber: number,
  ) {
    super(`This fix was already merged in PR #${prNumber}: ${prUrl}`);
  }
}

export interface FixFinding {
  id: string;
  title: string;
  severity: string;
  category: string;
  description: string;
  recommendation?: string;
}

export interface ApplyFixParams {
  owner: string;
  repo: string;
  /** Store's configured default branch, if known — falls back to whatever the fresh clone's
   * remote HEAD resolves to when omitted. */
  baseBranch?: string;
  filePath: string;
  newContent: string;
  baseContentSha256: string;
  finding: FixFinding;
  reportUrl?: string;
  token: string;
}

export interface ApplyFixResult {
  branch: string;
  prUrl: string;
  prNumber: number;
}

function run(cmd: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0
        ? resolve(stdout)
        : reject(new Error(`${cmd} ${args.join(" ")} exited ${code}${stderr ? `: ${stderr.trim()}` : ""}`)),
    );
  });
}

/** Deterministic per finding (not random) — retries of the same finding reuse the same branch,
 * which is what makes recovering from a partial failure (pushed but PR creation failed) safe:
 * retrying never creates a second, orphaned branch. */
export function deriveBranchName(findingId: string, title: string): string {
  const hash = createHash("sha256").update(findingId).digest("hex").slice(0, 10);
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${BRANCH_PREFIX}${slug}-${hash}`;
}

/** The actual enforcement point for "this tool never pushes to a protected/default branch" —
 * called before any network call, and again immediately before the push itself. */
function assertSafeBranch(branch: string, baseBranch: string): void {
  if (!branch.startsWith(BRANCH_PREFIX)) {
    throw new Error(`Refusing to push "${branch}" — not one of this tool's own ${BRANCH_PREFIX}* branches.`);
  }
  if (branch === baseBranch) {
    throw new Error(`Refusing to push directly to base branch "${baseBranch}".`);
  }
}

/** Deliberately the opposite of link-repo.ts's cloneInto(): keeps .git (never stripped), lives
 * in its own mkdtemp dir, and is thrown away after one commit — never stores/<slug>/theme/,
 * which has no git history and is the live input to ordinary Theme Check audits. */
async function createIsolatedClone(
  owner: string,
  repo: string,
  baseBranch: string | undefined,
  token: string,
): Promise<{ dir: string; actualBaseBranch: string }> {
  const dir = mkdtempSync(join(tmpdir(), "barrel-fix-"));
  try {
    const cloneUrl = authenticatedCloneUrl(`https://github.com/${owner}/${repo}.git`, token);
    const args = ["clone", "--depth", "1"];
    if (baseBranch) args.push("--branch", baseBranch, "--single-branch");
    args.push(cloneUrl, dir);
    await run("git", args, tmpdir());
    const actualBaseBranch = (await run("git", ["-C", dir, "rev-parse", "--abbrev-ref", "HEAD"], dir)).trim();
    return { dir, actualBaseBranch };
  } catch (err) {
    rmSync(dir, { recursive: true, force: true });
    throw err;
  }
}

/** Aborts if the file vanished (the audited theme/ snapshot has drifted from the real repo) or
 * if its current content in the FRESH clone doesn't match what the fix was generated against
 * (someone pushed a newer commit) — never silently overwrites either case. */
function writeFixedFile(cloneDir: string, filePath: string, newContent: string, baseContentSha256: string): void {
  const abs = join(cloneDir, filePath);
  if (!existsSync(abs)) {
    throw new DriftError(`"${filePath}" no longer exists on this branch — re-run "Suggest fix" to regenerate.`);
  }
  const current = readFileSync(abs, "utf-8");
  const currentHash = createHash("sha256").update(current).digest("hex");
  if (currentHash !== baseContentSha256) {
    throw new DriftError(
      `"${filePath}" has changed on GitHub since this fix was generated — re-run "Suggest fix" to regenerate against the latest version.`,
    );
  }
  writeFileSync(abs, newContent, "utf-8");
}

function buildCommitMessage(finding: FixFinding, filePath: string, reportUrl?: string): string {
  return [
    `Fix: ${finding.title}`,
    "",
    `Severity: ${finding.severity} (${finding.category})`,
    `File: ${filePath}`,
    `Finding: ${finding.id}`,
    "AI-generated by Barrel Site Audit — reviewed and approved via the dashboard before this commit was made.",
    ...(reportUrl ? ["", `Report: ${reportUrl}`] : []),
  ].join("\n");
}

function buildPrBody(finding: FixFinding, filePath: string, reportUrl?: string): string {
  return [
    "## What changed",
    finding.recommendation ?? finding.description,
    "",
    `**File:** \`${filePath}\``,
    "",
    "## Why",
    finding.description,
    "",
    "## Severity",
    `**${finding.severity}** (${finding.category})`,
    "",
    "---",
    "⚠️ **AI-generated by Barrel Site Audit — has not been reviewed by a human.** Review the diff " +
      "carefully (especially against the theme's real surrounding markup/CSS/JS) before merging. " +
      "This tool never merges PRs itself.",
    "",
    `Finding: \`${finding.id}\``,
    ...(reportUrl ? [`Report: ${reportUrl}`] : []),
  ].join("\n");
}

/** Resumes an in-flight fix instead of duplicating it: returns the open PR if one already
 * targets this branch, throws AlreadyMergedError if this exact fix was already merged, or null
 * if neither — the three outcomes applyFixAndOpenPr needs to stay idempotent under retry. */
async function findExistingFixPr(
  octokit: any,
  owner: string,
  repo: string,
  branchName: string,
): Promise<{ url: string; number: number } | null> {
  const { data } = await octokit.pulls.list({ owner, repo, head: `${owner}:${branchName}`, state: "all", per_page: 5 });
  const open = data.find((pr: any) => pr.state === "open");
  if (open) return { url: open.html_url, number: open.number };
  const merged = data.find((pr: any) => pr.merged_at);
  if (merged) throw new AlreadyMergedError(merged.html_url, merged.number);
  return null;
}

export async function applyFixAndOpenPr(params: ApplyFixParams): Promise<ApplyFixResult> {
  const branchName = deriveBranchName(params.finding.id, params.finding.title);
  if (params.baseBranch) assertSafeBranch(branchName, params.baseBranch); // fail before any network call when possible

  const { Octokit } = await import("@octokit/rest");
  const octokit = new Octokit({ auth: params.token });

  const existing = await findExistingFixPr(octokit, params.owner, params.repo, branchName);
  if (existing) return { branch: branchName, prUrl: existing.url, prNumber: existing.number };

  let cloneDir: string | null = null;
  try {
    const { dir, actualBaseBranch } = await createIsolatedClone(params.owner, params.repo, params.baseBranch, params.token);
    cloneDir = dir;
    assertSafeBranch(branchName, actualBaseBranch);

    await run("git", ["checkout", "-b", branchName], cloneDir);
    writeFixedFile(cloneDir, params.filePath, params.newContent, params.baseContentSha256);
    await run("git", ["add", "--", params.filePath], cloneDir);
    await run(
      "git",
      [
        "-c",
        "user.name=Barrel Site Audit",
        "-c",
        "user.email=site-audit@barrelny.com",
        "commit",
        "-m",
        buildCommitMessage(params.finding, params.filePath, params.reportUrl),
      ],
      cloneDir,
    );

    assertSafeBranch(branchName, actualBaseBranch); // re-checked immediately before the push itself
    const cloneUrlWithToken = authenticatedCloneUrl(`https://github.com/${params.owner}/${params.repo}.git`, params.token);
    // --force is scoped to only ever affect refs/heads/barrel-fix/* because assertSafeBranch
    // above already requires branchName to start with that prefix — safe to force because this
    // branch is disposable and solely owned by this tool; it's what makes retrying after a
    // partial failure (pushed, but PR creation failed) safe rather than erroring on a stale ref.
    await run("git", ["push", "--force", cloneUrlWithToken, `HEAD:refs/heads/${branchName}`], cloneDir);

    const pr = await octokit.pulls.create({
      owner: params.owner,
      repo: params.repo,
      title: `Fix: ${params.finding.title} (${params.filePath})`,
      head: branchName,
      base: actualBaseBranch,
      body: buildPrBody(params.finding, params.filePath, params.reportUrl),
      maintainer_can_modify: true,
    });

    return { branch: branchName, prUrl: pr.data.html_url, prNumber: pr.data.number };
  } finally {
    if (cloneDir) rmSync(cloneDir, { recursive: true, force: true });
  }
}
