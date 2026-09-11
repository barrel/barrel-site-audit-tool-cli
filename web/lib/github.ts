/**
 * The GitHub connector, dashboard side — read-only.
 *
 * A deliberate mirror of cli/src/github.ts rather than an import of it: `web/` deploys standalone
 * and cannot import from `cli/`, the same reason lib/shared.ts mirrors shared/src/types.ts. Keep
 * the two in step — in particular the search-qualifier sanitising, which is the part that would be
 * quietly wrong rather than broken if it drifted.
 *
 * Every call here is a read. The connector never writes to a client's repository from this app;
 * the one sanctioned write path in the tool is the CLI's human-gated "Suggest fix" pull-request
 * flow (cli/src/git-pr.ts), which runs on the auditor's own machine and has its own static guard.
 */
import { Octokit } from "@octokit/rest";
import { getGithubAccessToken } from "./github-session";

export interface GithubRepoChoice {
  fullName: string;
  description: string | null;
  private: boolean;
  defaultBranch: string;
  updatedAt: string;
  archived: boolean;
  language: string | null;
}

export interface GithubUser {
  login: string;
  name: string | null;
  avatarUrl: string | null;
}

export class NotConnectedError extends Error {
  constructor() {
    super("This browser is not connected to GitHub.");
    this.name = "NotConnectedError";
  }
}

async function client(): Promise<Octokit> {
  const token = await getGithubAccessToken();
  if (!token) throw new NotConnectedError();
  return new Octokit({ auth: token });
}

export async function githubUser(): Promise<GithubUser> {
  const { data } = await (await client()).users.getAuthenticated();
  return { login: data.login, name: data.name ?? null, avatarUrl: data.avatar_url ?? null };
}

/** Every org this login can see, so the picker can offer them as a filter. On a big instance this
 * is the difference between searching thousands of repos and searching the hundreds that could
 * plausibly be a client's. */
export async function githubOrgs(): Promise<string[]> {
  const octokit = await client();
  const orgs: string[] = [];
  for (let page = 1; page <= 3; page++) {
    const { data } = await octokit.orgs.listForAuthenticatedUser({ per_page: 100, page });
    orgs.push(...data.map((o) => o.login));
    if (data.length < 100) break;
  }
  return orgs.sort((a, b) => a.localeCompare(b));
}

/** Strips everything from a typed search box that GitHub would read as a qualifier or an operator
 * rather than as part of a repo name — so a pasted `fork:only` or a stray `org:` can't quietly
 * redirect the search somewhere the caller didn't intend. Mirror of the CLI's sanitizeSearchTerm. */
function sanitizeSearchTerm(raw: string): string {
  return raw
    .trim()
    .replace(/\b\w+:[^\s]*/g, " ")
    .replace(/[^\w.\-/ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Searches repositories server-side, which is the only way to find a repo on an instance with
 * more of them than a picker can list. With no search term it lists the most recently updated
 * instead, so an empty search box still shows something useful. */
export async function searchGithubRepos(opts: {
  query?: string;
  org?: string;
  limit?: number;
  includeArchived?: boolean;
}): Promise<GithubRepoChoice[]> {
  const octokit = await client();
  const limit = Math.min(Math.max(opts.limit ?? 30, 1), 100);
  const term = sanitizeSearchTerm(opts.query ?? "");

  if (!term) {
    const { data } = await octokit.repos.listForAuthenticatedUser({
      per_page: 100,
      sort: "updated",
      affiliation: "owner,collaborator,organization_member",
    });
    return data
      .map(toChoice)
      .filter((r) => (!opts.org || r.fullName.startsWith(`${opts.org}/`)) && (opts.includeArchived || !r.archived))
      .slice(0, limit);
  }

  const qualifiers = [`${term} in:name`];
  if (opts.org) qualifiers.push(`org:${opts.org}`);
  if (!opts.includeArchived) qualifiers.push("archived:false");

  const { data } = await octokit.search.repos({
    q: qualifiers.join(" "),
    per_page: limit,
    sort: "updated",
    order: "desc",
  });
  return data.items.map(toChoice);
}

// Both endpoints return the same fields under the same names; only their TS types differ.
function toChoice(r: {
  full_name: string;
  description?: string | null;
  private: boolean;
  default_branch?: string;
  updated_at?: string | null;
  pushed_at?: string | null;
  archived?: boolean;
  language?: string | null;
}): GithubRepoChoice {
  return {
    fullName: r.full_name,
    description: r.description ?? null,
    private: r.private,
    defaultBranch: r.default_branch ?? "main",
    updatedAt: r.updated_at ?? r.pushed_at ?? "",
    archived: r.archived ?? false,
    language: r.language ?? null,
  };
}

export function splitFullName(fullName: string): [string, string] {
  const cleaned = fullName
    .trim()
    .replace(/^https?:\/\/github\.com\//i, "")
    .replace(/\.git$/i, "")
    .replace(/^\/+|\/+$/g, "");
  const parts = cleaned.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`"${fullName}" is not an owner/repo pair — expected something like "barrel/client-theme".`);
  }
  return [parts[0], parts[1]];
}

export async function githubRepo(fullName: string): Promise<GithubRepoChoice> {
  const [owner, repo] = splitFullName(fullName);
  const { data } = await (await client()).repos.get({ owner, repo });
  return toChoice(data);
}

/** The branches of one repo, newest activity first, so the picker can offer a branch rather than
 * asking someone to type one. Capped: a repo with 400 stale branches doesn't need to send all of
 * them to a dropdown. */
export async function githubBranches(fullName: string, limit = 50): Promise<string[]> {
  const [owner, repo] = splitFullName(fullName);
  const { data } = await (await client()).repos.listBranches({ owner, repo, per_page: Math.min(limit, 100) });
  return data.map((b) => b.name);
}

export interface ThemeLocation {
  subdir: string;
  found: boolean;
  truncated: boolean;
}

// The one file every Shopify theme is required to have — a far sharper signal than assets/ or
// config/, which appear in plenty of repos that are not themes. Same rule as the CLI's
// looksLikeShopifyTheme(), applied to a repo listing instead of a directory.
const THEME_MARKER = "layout/theme.liquid";

/** Finds the Shopify theme root inside a repo without cloning it — one tree read.
 *
 * Called before a connection is saved, so "this repo keeps its theme in theme/" is discovered at
 * the moment someone connects it rather than surfacing weeks later as a report with an empty
 * Theme Code section. Only the shallowest match counts: a repo with a real theme at the root and a
 * vendored copy three levels down should audit the real one. */
export async function findThemeRootInRepo(fullName: string, ref: string): Promise<ThemeLocation> {
  const [owner, repo] = splitFullName(fullName);
  const { data } = await (await client()).git.getTree({ owner, repo, tree_sha: ref, recursive: "1" });

  const matches = (data.tree ?? [])
    .map((entry) => entry.path ?? "")
    .filter((path) => path === THEME_MARKER || path.endsWith(`/${THEME_MARKER}`))
    .sort((a, b) => a.split("/").length - b.split("/").length);

  if (matches.length === 0) return { subdir: "", found: false, truncated: Boolean(data.truncated) };
  return {
    subdir: matches[0].slice(0, Math.max(0, matches[0].length - THEME_MARKER.length - 1)),
    found: true,
    truncated: Boolean(data.truncated),
  };
}
