// Applies an approved fix to a fresh branch in the store's linked GitHub repo and opens a PR —
// and nothing more. This module may ONLY ever call octokit's `pulls.list` and `pulls.create`.
// It must NEVER call `pulls.merge`, `pulls.updateBranch`, `repos.merge`, `repos.mergeUpstream`,
// or any branch-protection endpoint — enforced by cli/scripts/verify-git-pr-safety.mjs, run as
// part of `pnpm build`. Merging a fix is entirely GitHub's normal PR review, outside this tool.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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

function contentHash(s: string): string {
  return createHash("sha256").update(s).digest("hex");
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

/** Deliberately the opposite of link-repo.ts's cloneInto(): keeps .git (never stripped) and is
 * fully owned by this module — never stores/<slug>/theme/, which has no git history and is the
 * live input to ordinary Theme Check audits. Clones into whatever destDir the caller provides,
 * disposable (mkdtemp) or persistent (stores/<slug>/fixes/<branch>/) alike. */
async function cloneRepo(owner: string, repo: string, baseBranch: string | undefined, token: string, destDir: string): Promise<string> {
  mkdirSync(dirname(destDir), { recursive: true });
  if (existsSync(destDir)) rmSync(destDir, { recursive: true, force: true });
  const cloneUrl = authenticatedCloneUrl(`https://github.com/${owner}/${repo}.git`, token);
  const args = ["clone", "--depth", "1"];
  if (baseBranch) args.push("--branch", baseBranch, "--single-branch");
  args.push(cloneUrl, destDir);
  await run("git", args, dirname(destDir));
  return (await run("git", ["-C", destDir, "rev-parse", "--abbrev-ref", "HEAD"], destDir)).trim();
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
  if (contentHash(current) !== baseContentSha256) {
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
 * if neither — the three outcomes callers need to stay idempotent under retry. */
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

// ---------------------------------------------------------------------------
// Multi-step flow: prepare a local branch once, then let the caller choose any
// combination of "open in editor" / "test live" / "push & open PR" against it.
// ---------------------------------------------------------------------------

export interface PrepareFixParams {
  owner: string;
  repo: string;
  baseBranch?: string;
  filePath: string;
  newContent: string;
  baseContentSha256: string;
  findingId: string;
  findingTitle: string;
  token: string;
  /** Persistent directory to clone into (survives across requests), e.g.
   * stores/<slug>/fixes/<branch>/ — as opposed to a disposable mkdtemp dir. */
  workDir: string;
}

export interface PreparedFix {
  cloneDir: string;
  branch: string;
  baseBranch: string;
  filePath: string;
}

interface FixMeta {
  baseBranch: string;
  writtenContentSha256: string;
}

// Stashed inside .git/ (never part of the working tree git itself tracks) so re-cloning can be
// skipped on repeat calls for the same fix (open editor, then test live, then push all reuse the
// same clone) without losing track of which base branch this was cloned from.
function metaPath(workDir: string): string {
  return join(workDir, ".git", "barrel-fix-meta.json");
}

function readMeta(workDir: string): FixMeta | null {
  try {
    return JSON.parse(readFileSync(metaPath(workDir), "utf-8"));
  } catch {
    return null;
  }
}

function writeMeta(workDir: string, meta: FixMeta): void {
  writeFileSync(metaPath(workDir), JSON.stringify(meta), "utf-8");
}

/** Idempotent: repeat calls with the SAME suggested content reuse the existing clone/branch (so
 * "open in editor", "test live", and "push" can all build on one prepared checkout). A call with
 * DIFFERENT content (the finding was regenerated) discards the stale clone and starts over rather
 * than silently mixing old and new fixes. */
export async function prepareLocalFixBranch(params: PrepareFixParams): Promise<PreparedFix> {
  const branchName = deriveBranchName(params.findingId, params.findingTitle);
  if (params.baseBranch) assertSafeBranch(branchName, params.baseBranch);

  const meta = existsSync(join(params.workDir, ".git")) ? readMeta(params.workDir) : null;
  if (meta && meta.writtenContentSha256 === contentHash(params.newContent)) {
    return { cloneDir: params.workDir, branch: branchName, baseBranch: meta.baseBranch, filePath: params.filePath };
  }

  const actualBaseBranch = await cloneRepo(params.owner, params.repo, params.baseBranch, params.token, params.workDir);
  assertSafeBranch(branchName, actualBaseBranch);
  await run("git", ["checkout", "-b", branchName], params.workDir);
  writeFixedFile(params.workDir, params.filePath, params.newContent, params.baseContentSha256);
  writeMeta(params.workDir, { baseBranch: actualBaseBranch, writtenContentSha256: contentHash(params.newContent) });

  return { cloneDir: params.workDir, branch: branchName, baseBranch: actualBaseBranch, filePath: params.filePath };
}

export interface CommitAndPushParams {
  prepared: PreparedFix;
  owner: string;
  repo: string;
  finding: FixFinding;
  reportUrl?: string;
  token: string;
}

/** Commits whatever is currently sitting in the prepared clone (which may include manual edits
 * made via "Open in VS Code", not just the originally-suggested content) and pushes it. If an
 * open PR already exists for this branch, returns it unchanged rather than re-pushing. */
export async function commitAndPushFix(params: CommitAndPushParams): Promise<ApplyFixResult> {
  const { prepared } = params;
  assertSafeBranch(prepared.branch, prepared.baseBranch);

  const { Octokit } = await import("@octokit/rest");
  const octokit = new Octokit({ auth: params.token });

  const existing = await findExistingFixPr(octokit, params.owner, params.repo, prepared.branch);
  if (existing) return { branch: prepared.branch, prUrl: existing.url, prNumber: existing.number };

  await run("git", ["add", "-A"], prepared.cloneDir);
  const status = (await run("git", ["status", "--porcelain"], prepared.cloneDir)).trim();
  if (status) {
    await run(
      "git",
      [
        "-c",
        "user.name=Barrel Site Audit",
        "-c",
        "user.email=site-audit@barrelny.com",
        "commit",
        "-m",
        buildCommitMessage(params.finding, prepared.filePath, params.reportUrl),
      ],
      prepared.cloneDir,
    );
  }

  assertSafeBranch(prepared.branch, prepared.baseBranch); // re-checked immediately before the push itself
  const cloneUrlWithToken = authenticatedCloneUrl(`https://github.com/${params.owner}/${params.repo}.git`, params.token);
  // --force is scoped to only ever affect refs/heads/barrel-fix/* because assertSafeBranch above
  // already requires the branch to start with that prefix — safe to force because this branch is
  // disposable and solely owned by this tool; it's what makes retrying after a partial failure
  // (pushed, but PR creation failed) safe rather than erroring on a stale ref.
  await run("git", ["push", "--force", cloneUrlWithToken, `HEAD:refs/heads/${prepared.branch}`], prepared.cloneDir);

  const pr = await octokit.pulls.create({
    owner: params.owner,
    repo: params.repo,
    title: `Fix: ${params.finding.title} (${prepared.filePath})`,
    head: prepared.branch,
    base: prepared.baseBranch,
    body: buildPrBody(params.finding, prepared.filePath, params.reportUrl),
    maintainer_can_modify: true,
  });

  return { branch: prepared.branch, prUrl: pr.data.html_url, prNumber: pr.data.number };
}

export function cleanupLocalFixBranch(cloneDir: string): void {
  rmSync(cloneDir, { recursive: true, force: true });
}

/** One-shot convenience path used when nobody prepared a persistent clone first (e.g. clicking
 * "Push branch & open PR" directly, with no prior "Open in VS Code" / "Test live"): prepares into
 * a disposable temp dir, commits and pushes, and always cleans up afterwards. */
export async function applyFixAndOpenPr(params: ApplyFixParams): Promise<ApplyFixResult> {
  const branchName = deriveBranchName(params.finding.id, params.finding.title);
  if (params.baseBranch) assertSafeBranch(branchName, params.baseBranch); // fail before any network call when possible

  const { Octokit } = await import("@octokit/rest");
  const octokit = new Octokit({ auth: params.token });
  const existing = await findExistingFixPr(octokit, params.owner, params.repo, branchName);
  if (existing) return { branch: branchName, prUrl: existing.url, prNumber: existing.number };

  const cloneDir = mkdtempSync(join(tmpdir(), "barrel-fix-"));
  try {
    const prepared = await prepareLocalFixBranch({
      owner: params.owner,
      repo: params.repo,
      baseBranch: params.baseBranch,
      filePath: params.filePath,
      newContent: params.newContent,
      baseContentSha256: params.baseContentSha256,
      findingId: params.finding.id,
      findingTitle: params.finding.title,
      token: params.token,
      workDir: cloneDir,
    });
    return await commitAndPushFix({
      prepared,
      owner: params.owner,
      repo: params.repo,
      finding: params.finding,
      reportUrl: params.reportUrl,
      token: params.token,
    });
  } finally {
    rmSync(cloneDir, { recursive: true, force: true });
  }
}
