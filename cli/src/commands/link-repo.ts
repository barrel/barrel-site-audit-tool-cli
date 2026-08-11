import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import chalk from "chalk";
import { confirm, search } from "@inquirer/prompts";
import type { StoreConfig } from "@barrel/site-audit-shared";
import { storeConfigPath, storeThemeDir } from "../paths.js";
import { resolveStore, themeDirHasContent } from "../store.js";
import { authenticatedCloneUrl, listGithubRepos, type GithubRepoChoice } from "../github.js";
import { clearCachedGithubToken, getGithubToken } from "../github-auth.js";

export interface LinkRepoArgs {
  slug: string;
  repo?: string;
  branch?: string;
  relogin?: boolean;
}

export interface LinkRepoOptions {
  /** "owner/repo" — skips the interactive picker when provided. */
  repo?: string;
  /** Defaults to the repo's default branch when omitted. */
  branch?: string;
  /** Skip the "this will overwrite theme/" confirmation, e.g. when the caller already knows it's empty. */
  force?: boolean;
  /** Discard any cached GitHub token first, forcing a fresh device-flow login. */
  relogin?: boolean;
}

function relativeTime(iso: string): string {
  if (!iso) return "unknown";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

async function pickRepoInteractively(token: string): Promise<GithubRepoChoice> {
  const spinner = chalk.gray("Fetching your GitHub repositories...");
  console.log(spinner);
  const repos = await listGithubRepos(token);
  if (repos.length === 0) {
    throw new Error("No repositories found for this GitHub token.");
  }

  const fullName = await search<string>({
    message: "Select a GitHub repository to clone into this store's theme/ folder:",
    source: (input) => {
      const filtered = !input ? repos : repos.filter((r) => r.fullName.toLowerCase().includes(input.toLowerCase()));
      return filtered.slice(0, 50).map((r) => ({
        value: r.fullName,
        name: `${r.fullName}${r.private ? " (private)" : ""} — updated ${relativeTime(r.updatedAt)}`,
        description: r.description ?? undefined,
      }));
    },
  });

  const repo = repos.find((r) => r.fullName === fullName);
  if (!repo) throw new Error(`Could not resolve repository "${fullName}".`);
  return repo;
}

function cloneInto(cloneUrl: string, dest: string, branch?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = ["clone", "--depth", "1"];
    if (branch) args.push("--branch", branch, "--single-branch");
    args.push(cloneUrl, dest);

    const child = spawn("git", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`git clone exited with code ${code}${stderr ? `: ${stderr.trim()}` : ""}`));
    });
    child.on("error", (err) => reject(err));
  });
}

/** Shared by the standalone `link-repo` command and the inline prompt `run` offers on a
 * brand-new store with no theme code yet. Prompts to pick a repo (unless opts.repo is given),
 * clones it into stores/<slug>/theme/, strips the nested .git, and records the link in
 * config.json — so future audits pick up the theme code + structure analyzers automatically. */
export async function linkRepoInteractive(config: StoreConfig, opts: LinkRepoOptions = {}): Promise<void> {
  if (opts.relogin) clearCachedGithubToken();
  const token = await getGithubToken();
  const themeDir = storeThemeDir(config.slug);

  let cloneUrl: string;
  let branch: string | undefined;
  let fullName: string;

  if (opts.repo) {
    fullName = opts.repo;
    cloneUrl = `https://github.com/${opts.repo}.git`;
    branch = opts.branch;
  } else {
    const chosen = await pickRepoInteractively(token);
    fullName = chosen.fullName;
    cloneUrl = chosen.cloneUrl;
    branch = opts.branch ?? chosen.defaultBranch;
  }

  if (!opts.force && themeDirHasContent(themeDir)) {
    const overwrite = await confirm({
      message: `stores/${config.slug}/theme/ already has files in it — clear it and clone ${fullName} in its place?`,
      default: false,
    });
    if (!overwrite) {
      console.log(chalk.gray("Cancelled — theme/ left untouched."));
      return;
    }
  }

  rmSync(themeDir, { recursive: true, force: true });

  console.log(chalk.bold(`Cloning ${fullName}${branch ? ` (${branch})` : ""} into stores/${config.slug}/theme/ ...`));
  await cloneInto(authenticatedCloneUrl(cloneUrl, token), themeDir, branch);

  rmSync(join(themeDir, ".git"), { recursive: true, force: true });

  const configPath = storeConfigPath(config.slug);
  const latest = existsSync(configPath) ? (JSON.parse(readFileSync(configPath, "utf-8")) as StoreConfig) : config;
  writeFileSync(
    configPath,
    JSON.stringify({ ...latest, githubRepo: fullName, ...(branch ? { githubBranch: branch } : {}) }, null, 2),
  );

  console.log(chalk.green(`Cloned ${fullName} into stores/${config.slug}/theme/`));
}

export async function linkRepoCommand({ slug, repo, branch, relogin }: LinkRepoArgs): Promise<void> {
  const config = resolveStore(slug);
  await linkRepoInteractive(config, { repo, branch, relogin });
  console.log(chalk.gray(`Run: pnpm barrel-audit run ${config.slug}`));
}
