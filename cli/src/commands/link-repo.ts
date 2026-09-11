import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import chalk from "chalk";
import { confirm, search, select } from "@inquirer/prompts";
import type { StoreConfig } from "@barrel/site-audit-shared";
import { cliInvocation, storeConfigPath, storeThemeDir } from "../paths.js";
import { resolveStore, themeDirHasContent } from "../store.js";
import {
  authenticatedCloneUrl,
  findThemeRootInRepo,
  getGithubRepo,
  getGithubUser,
  listGithubOrgs,
  relativeRepoTime,
  searchGithubRepos,
  type GithubRepoChoice,
} from "../github.js";
import { clearCachedGithubToken, getGithubToken } from "../github-auth.js";
import { mirrorStoreConfig } from "../store-sync.js";

export type LinkRepoMode = "pull" | "read";

export interface LinkRepoArgs {
  slug: string;
  repo?: string;
  branch?: string;
  mode?: string;
  org?: string;
  force?: boolean;
  relogin?: boolean;
}

export interface LinkRepoOptions {
  /** "owner/repo" — skips the interactive picker when provided. */
  repo?: string;
  /** Defaults to the repo's default branch when omitted. */
  branch?: string;
  /** "pull" clones into stores/<slug>/theme/; "read" keeps nothing on disk and re-reads the
   * branch on every run. Prompted for when omitted and there's a terminal to prompt in. */
  mode?: LinkRepoMode;
  /** Scope the repo picker's search to one GitHub org, for an instance with thousands of repos. */
  org?: string;
  /** Skip the "this will overwrite theme/" confirmation, e.g. when the caller already knows it's empty. */
  force?: boolean;
  /** Discard any cached GitHub token first, forcing a fresh device-flow login. */
  relogin?: boolean;
}

export function parseLinkRepoMode(raw: string | undefined): LinkRepoMode | undefined {
  if (raw === undefined) return undefined;
  if (raw === "pull" || raw === "read") return raw;
  throw new Error(`--mode must be "pull" (clone into theme/) or "read" (read from GitHub each run), not "${raw}".`);
}

/** The repo picker.
 *
 * Every keystroke queries GitHub's search API rather than filtering a list held in memory: on an
 * instance with thousands of repositories, any list short enough to fetch up front is an
 * arbitrary slice of them, and the repo someone is looking for is usually not in it. Searching
 * server-side means the picker can find a repo whose last commit was three years ago.
 *
 * `org` narrows it further when given. Results are cached per query string for the life of the
 * prompt, because inquirer re-runs `source` on every render (including arrow-key navigation), and
 * the search endpoint allows 30 requests a minute. */
async function pickRepoInteractively(token: string, org?: string): Promise<GithubRepoChoice> {
  const user = await getGithubUser(token).catch(() => null);
  if (user) console.log(chalk.gray(`Signed in to GitHub as ${user.login}.`));
  console.log(
    chalk.gray(
      org
        ? `Searching repositories in ${org} — type to search, GitHub-side.`
        : `Type to search every repository you can see. Pass --org <name> to narrow it to one org.`,
    ),
  );

  const seen = new Map<string, GithubRepoChoice>();
  const cache = new Map<string, GithubRepoChoice[]>();

  const fullName = await search<string>({
    message: "GitHub repository:",
    source: async (input) => {
      const key = (input ?? "").trim().toLowerCase();
      let results = cache.get(key);
      if (!results) {
        results = await searchGithubRepos(token, { query: key, org, limit: 50 });
        cache.set(key, results);
      }
      for (const r of results) seen.set(r.fullName, r);

      if (results.length === 0) {
        return [
          {
            value: "",
            name: key ? `No repository matching "${key}"` : "No repositories found",
            disabled: true,
          },
        ];
      }

      return results.map((r) => ({
        value: r.fullName,
        name:
          `${r.fullName}${r.private ? " (private)" : ""}` +
          `${r.language ? ` · ${r.language}` : ""} · updated ${relativeRepoTime(r.updatedAt)}`,
        description: r.description ?? undefined,
      }));
    },
  });

  const repo = seen.get(fullName);
  if (!repo) throw new Error(`Could not resolve repository "${fullName}".`);
  return repo;
}

async function pickMode(fullName: string, slug: string): Promise<LinkRepoMode> {
  return await select<LinkRepoMode>({
    message: `How should audits of ${slug} read ${fullName}?`,
    default: "read",
    choices: [
      {
        value: "read",
        name: "Read it from GitHub on each run (nothing kept on disk)",
        description:
          "Every audit downloads the branch as it is at that moment, reads it, and deletes it. " +
          "No copy of the client's code is left on this machine.",
      },
      {
        value: "pull",
        name: `Pull a copy into stores/${slug}/theme/`,
        description:
          "Clones once. Later audits read that snapshot until you pull again — the right choice " +
          "if you want the code on disk to look at, or to audit offline.",
      },
    ],
  });
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

/** Merges the connection into the store's config.json (re-reading it first, so a field written by
 * something else while the picker was open isn't clobbered) and pushes the shared copy to Blob. */
async function saveConnection(
  config: StoreConfig,
  connection: Pick<StoreConfig, "githubRepo" | "githubBranch" | "githubMode" | "themeSubdir" | "githubConnectedBy">,
): Promise<void> {
  const configPath = storeConfigPath(config.slug);
  const latest = existsSync(configPath) ? (JSON.parse(readFileSync(configPath, "utf-8")) as StoreConfig) : config;
  const linked: StoreConfig = {
    ...latest,
    ...connection,
    githubConnectedAt: new Date().toISOString(),
  };
  // themeSubdir is meaningful only when the theme isn't at the repo root; carrying an empty string
  // would have every later run look for a directory called "".
  if (!connection.themeSubdir) delete linked.themeSubdir;
  writeFileSync(configPath, JSON.stringify(linked, null, 2));
  // Awaited, unlike saveStoreConfig's background mirror: this is the fact a cloud run depends on
  // (which repo to read), and this command has nothing else to do afterwards.
  await mirrorStoreConfig(linked);
}

/** Connects a GitHub repo to a store, read-only, in one of two modes.
 *
 * Shared by the standalone `link-repo` command and the inline prompt `run` offers on a brand-new
 * store with no theme code yet. Prompts for the repo (unless opts.repo is given) and for the mode
 * (unless opts.mode is given, or there's no TTY — in which case `"read"` is the default, since it
 * is the one that needs no writable stores/ directory).
 *
 * Neither mode writes anything to the repository. */
export async function linkRepoInteractive(config: StoreConfig, opts: LinkRepoOptions = {}): Promise<void> {
  if (opts.relogin) clearCachedGithubToken();
  const token = await getGithubToken();

  let chosen: GithubRepoChoice;
  if (opts.repo) {
    chosen = await getGithubRepo(token, opts.repo);
  } else {
    chosen = await pickRepoInteractively(token, opts.org);
  }

  const fullName = chosen.fullName;
  const branch = opts.branch ?? chosen.defaultBranch;
  const mode = opts.mode ?? (process.stdin.isTTY ? await pickMode(fullName, config.slug) : "read");

  const user = await getGithubUser(token).catch(() => null);

  if (mode === "read") {
    await connectReadOnly(config, { token, fullName, branch, connectedBy: user?.login });
    return;
  }

  await pullIntoThemeDir(config, { token, chosen, branch, force: opts.force, connectedBy: user?.login });
}

/** `"read"` mode: record the connection and nothing else. Finds the theme root inside the repo
 * first — one tree read, no checkout — so "this repo keeps its theme in theme/" is discovered now
 * rather than surfacing weeks later as a report with an empty Theme Code section. */
async function connectReadOnly(
  config: StoreConfig,
  args: { token: string; fullName: string; branch: string; connectedBy?: string },
): Promise<void> {
  console.log(chalk.gray(`Looking for the Shopify theme root in ${args.fullName} (${args.branch})...`));
  const location = await findThemeRootInRepo(args.token, args.fullName, args.branch);

  if (!location.found) {
    console.log(
      chalk.yellow(
        `No layout/theme.liquid found in ${args.fullName} (${args.branch})` +
          `${location.truncated ? " — GitHub truncated the file listing, so it may be there and simply not visible in one read" : ""}.`,
      ) +
        chalk.gray(
          `\n  Connecting anyway: theme code review will error out on the next run rather than quietly` +
            `\n  producing an empty section, and you can re-connect with a different branch.`,
        ),
    );
  } else if (location.subdir) {
    console.log(chalk.gray(`Theme root found at ${location.subdir}/ inside the repo.`));
  }

  await saveConnection(config, {
    githubRepo: args.fullName,
    githubBranch: args.branch,
    githubMode: "read",
    themeSubdir: location.subdir || undefined,
    githubConnectedBy: args.connectedBy,
  });

  console.log(
    chalk.green(`Connected ${args.fullName} (${args.branch}) to ${config.slug}, read-only.`) +
      chalk.gray(
        `\n  Every audit downloads that branch, reads it, and deletes it — no copy is kept on this machine,` +
          `\n  and nothing is ever written back to the repo.`,
      ),
  );
}

/** `"pull"` mode: the original behaviour. Clones into stores/<slug>/theme/ and strips the nested
 * .git, so the snapshot can never be committed or pushed from by accident. */
async function pullIntoThemeDir(
  config: StoreConfig,
  args: { token: string; chosen: GithubRepoChoice; branch: string; force?: boolean; connectedBy?: string },
): Promise<void> {
  const themeDir = storeThemeDir(config.slug);
  const fullName = args.chosen.fullName;

  if (!args.force && themeDirHasContent(themeDir)) {
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

  console.log(chalk.bold(`Cloning ${fullName} (${args.branch}) into stores/${config.slug}/theme/ ...`));
  await cloneInto(authenticatedCloneUrl(args.chosen.cloneUrl, args.token), themeDir, args.branch);

  // No .git in the audited copy, on purpose: it is a read-only snapshot for the analyzers, and a
  // repository sitting there is one `git push` away from being something else.
  rmSync(join(themeDir, ".git"), { recursive: true, force: true });

  await saveConnection(config, {
    githubRepo: fullName,
    githubBranch: args.branch,
    githubMode: "pull",
    githubConnectedBy: args.connectedBy,
  });

  console.log(chalk.green(`Cloned ${fullName} into stores/${config.slug}/theme/`));
}

export async function linkRepoCommand({ slug, repo, branch, mode, org, force, relogin }: LinkRepoArgs): Promise<void> {
  const config = resolveStore(slug);
  await linkRepoInteractive(config, { repo, branch, mode: parseLinkRepoMode(mode), org, force, relogin });
  console.log(chalk.gray(`Run: ${cliInvocation()} run ${config.slug}`));
}

/** `link-repo --login`: sign in to GitHub (or re-sign-in) without touching any store.
 *
 * Exists because a run started from the dashboard or the local agent can't do the device flow —
 * it prints a code into a log nobody is watching — so the login has to be establishable on its
 * own, ahead of time, in a terminal. */
export async function githubLoginCommand(opts: { relogin?: boolean } = {}): Promise<void> {
  if (opts.relogin) clearCachedGithubToken();
  const token = await getGithubToken();
  const user = await getGithubUser(token);
  const orgs = await listGithubOrgs(token).catch(() => []);
  console.log(chalk.green(`Signed in to GitHub as ${user.login}${user.name ? ` (${user.name})` : ""}.`));
  if (orgs.length > 0) console.log(chalk.gray(`  Orgs visible: ${orgs.join(", ")}`));
  console.log(chalk.gray(`  Cached for later runs. Nothing in this tool writes to a repo through this login except`));
  console.log(chalk.gray(`  the separately-confirmed "Suggest fix" pull-request flow.`));
}
