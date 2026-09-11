// The GitHub connector — read-only by construction.
//
// Every call in this module is a read. Nothing here creates, updates, deletes, pushes or merges
// anything in a client's repository, and that is enforced rather than trusted: the build runs
// scripts/verify-github-readonly.mjs, which greps this file (and github-checkout.ts) for
// write-capable Octokit methods and git subcommands and fails `pnpm build` if one appears.
//
// The one sanctioned write path in this tool is cli/src/git-pr.ts — the separately-gated
// "Suggest fix" PR flow, which has its own static guard (scripts/verify-git-pr-safety.mjs). Do
// not reach for a write here because it happens to be convenient; add it there, behind that gate.
//
// `token` in every signature comes from getGithubToken() (github-auth.ts) — the OAuth device-flow
// login. GitHub's OAuth Apps have no read-only scope that covers private repository contents
// (`repo` is all-or-nothing), which is exactly why the read-only guarantee lives in this module's
// code and its build guard instead of in the scope.

export interface GithubRepoChoice {
  fullName: string;
  description: string | null;
  private: boolean;
  defaultBranch: string;
  updatedAt: string;
  cloneUrl: string;
  /** Present on search results, absent when listing — the picker sorts on it when it has it. */
  archived?: boolean;
  /** Primary language, purely to help a human recognise the right repo in a long list. */
  language?: string | null;
}

export interface GithubUser {
  login: string;
  name: string | null;
  avatarUrl: string | null;
}

export interface RepoSearchOptions {
  /** Free text matched against repo names. Empty/omitted lists instead of searching. */
  query?: string;
  /** Restrict to one org (`org:<name>` qualifier), or to a user's own repos. */
  org?: string;
  limit?: number;
  /** Include archived repos. Off by default: a client's archived theme repo is almost never the
   * one being audited, and on a big org they crowd out the live ones. */
  includeArchived?: boolean;
}

/** GitHub's search endpoint is capped at 100 results per page and rate-limited to 30 requests a
 * minute, so a picker must not page through it greedily. One page is plenty to choose from. */
const SEARCH_PAGE_SIZE = 100;

async function octokitFor(token: string) {
  const { Octokit } = await import("@octokit/rest");
  return new Octokit({ auth: token });
}

/** Who this token belongs to — shown in the CLI and the dashboard so it's obvious *whose* GitHub
 * access a repo list is coming from before anyone links a client's repo with it. */
export async function getGithubUser(token: string): Promise<GithubUser> {
  const octokit = await octokitFor(token);
  const { data } = await octokit.users.getAuthenticated();
  return { login: data.login, name: data.name ?? null, avatarUrl: data.avatar_url ?? null };
}

/** Every org this token can see, so the picker can offer them as a filter. On an account that
 * belongs to a big instance this is the difference between searching 4,000 repos and searching
 * the 400 that could plausibly be a client. */
export async function listGithubOrgs(token: string): Promise<string[]> {
  const octokit = await octokitFor(token);
  const orgs: string[] = [];
  for (let page = 1; page <= 3; page++) {
    const { data } = await octokit.orgs.listForAuthenticatedUser({ per_page: 100, page });
    orgs.push(...data.map((o) => o.login));
    if (data.length < 100) break;
  }
  return orgs.sort((a, b) => a.localeCompare(b));
}

/** Repos the token's owner can see, most-recently-updated first. Paginates up to `limit`.
 *
 * This is the right call for "show me something to start from" and the wrong one for "find the
 * repo I have in mind" on an instance with thousands of repos — the first `limit` by update time
 * is an arbitrary slice of them. searchGithubRepos() is what actually finds a named repo. */
export async function listGithubRepos(token: string, limit = 200): Promise<GithubRepoChoice[]> {
  const octokit = await octokitFor(token);

  const repos: GithubRepoChoice[] = [];
  for (let page = 1; repos.length < limit; page++) {
    const { data } = await octokit.repos.listForAuthenticatedUser({
      per_page: 100,
      page,
      sort: "updated",
      affiliation: "owner,collaborator,organization_member",
    });
    if (data.length === 0) break;
    for (const r of data) {
      repos.push({
        fullName: r.full_name,
        description: r.description,
        private: r.private,
        defaultBranch: r.default_branch ?? "main",
        updatedAt: r.updated_at ?? "",
        cloneUrl: r.clone_url ?? `https://github.com/${r.full_name}.git`,
        archived: r.archived ?? false,
        language: r.language ?? null,
      });
    }
    if (data.length < 100) break;
  }
  return repos.slice(0, limit);
}

/** Search repositories server-side, which is the only way to find a repo on an instance with more
 * repos than any picker can list. Falls back to listGithubRepos() when there is nothing to search
 * for, so a picker can call this unconditionally and get sensible results on an empty input.
 *
 * The query is built, not interpolated raw: a term is matched `in:name` and anything that looks
 * like a qualifier the caller didn't ask for is stripped, so a typed `fork:only` or a stray `org:`
 * can't quietly redirect the search somewhere the caller didn't intend. */
export async function searchGithubRepos(token: string, opts: RepoSearchOptions = {}): Promise<GithubRepoChoice[]> {
  const limit = Math.min(opts.limit ?? 50, SEARCH_PAGE_SIZE);
  const term = sanitizeSearchTerm(opts.query ?? "");

  if (!term) {
    const listed = await listGithubRepos(token, Math.max(limit, 100));
    const scoped = opts.org ? listed.filter((r) => r.fullName.startsWith(`${opts.org}/`)) : listed;
    return scoped.filter((r) => opts.includeArchived || !r.archived).slice(0, limit);
  }

  const octokit = await octokitFor(token);
  const qualifiers = [`${term} in:name`];
  if (opts.org) qualifiers.push(`org:${opts.org}`);
  if (!opts.includeArchived) qualifiers.push("archived:false");

  const { data } = await octokit.search.repos({
    q: qualifiers.join(" "),
    per_page: limit,
    sort: "updated",
    order: "desc",
  });

  return data.items.map((r) => ({
    fullName: r.full_name,
    description: r.description,
    private: r.private,
    defaultBranch: r.default_branch ?? "main",
    updatedAt: r.updated_at ?? r.pushed_at ?? "",
    cloneUrl: r.clone_url ?? `https://github.com/${r.full_name}.git`,
    archived: r.archived ?? false,
    language: r.language ?? null,
  }));
}

/** Strips everything from a typed search box that GitHub would read as a qualifier or an operator
 * rather than as part of a repo name. What survives is a plain term. */
function sanitizeSearchTerm(raw: string): string {
  return raw
    .trim()
    .replace(/\b\w+:[^\s]*/g, " ") // org:, user:, fork:, archived:, is:, ...
    .replace(/[^\w.\-/ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function getGithubRepo(token: string, fullName: string): Promise<GithubRepoChoice> {
  const [owner, repo] = splitFullName(fullName);
  const octokit = await octokitFor(token);
  const { data } = await octokit.repos.get({ owner, repo });
  return {
    fullName: data.full_name,
    description: data.description,
    private: data.private,
    defaultBranch: data.default_branch ?? "main",
    updatedAt: data.updated_at ?? "",
    cloneUrl: data.clone_url ?? `https://github.com/${data.full_name}.git`,
    archived: data.archived ?? false,
    language: data.language ?? null,
  };
}

/** "owner/repo" → ["owner", "repo"], with a real error rather than an undefined halfway through
 * the next API call when someone passes a bare name or a full URL. */
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

export interface ThemeLocation {
  /** Path within the repo to the Shopify theme root — "" when the theme sits at the repo root. */
  subdir: string;
  /** False when no layout/theme.liquid was found anywhere the scan looked. */
  found: boolean;
  /** True when GitHub truncated the tree, so `found: false` means "not in what we could see"
   * rather than "not in the repo". Worth surfacing: it is the one case where a connection can be
   * correct and still look wrong. */
  truncated: boolean;
}

// A theme root is wherever layout/theme.liquid is — the one file every Shopify theme must have,
// and a far sharper signal than the presence of assets/ or config/, which show up in plenty of
// repos that are not themes at all. Same rule as looksLikeShopifyTheme() in store.ts, applied to
// a repo listing instead of a directory.
const THEME_MARKER = "layout/theme.liquid";

/** Finds the Shopify theme root inside a repo without cloning it — one tree read, no checkout.
 *
 * Used before a `"read"`-mode connection is saved, so "this repo keeps its theme in theme/" is
 * discovered at the moment someone connects it rather than surfacing as an empty Theme Code
 * section in a report weeks later. Only the shallowest match is returned: a repo with a real theme
 * at the root and a vendored copy three levels down should audit the real one. */
export async function findThemeRootInRepo(token: string, fullName: string, ref?: string): Promise<ThemeLocation> {
  const [owner, repo] = splitFullName(fullName);
  const octokit = await octokitFor(token);
  const treeRef = ref ?? (await getGithubRepo(token, fullName)).defaultBranch;

  const { data } = await octokit.git.getTree({ owner, repo, tree_sha: treeRef, recursive: "1" });
  const truncated = Boolean(data.truncated);

  const matches = (data.tree ?? [])
    .map((entry) => entry.path ?? "")
    .filter((path) => path === THEME_MARKER || path.endsWith(`/${THEME_MARKER}`))
    .sort((a, b) => a.split("/").length - b.split("/").length);

  if (matches.length === 0) return { subdir: "", found: false, truncated };
  return { subdir: matches[0].slice(0, Math.max(0, matches[0].length - THEME_MARKER.length - 1)), found: true, truncated };
}

/** Embeds the OAuth token into an https clone URL so `git clone` can authenticate
 * non-interactively. Never log or persist the return value — it carries the token. */
export function authenticatedCloneUrl(cloneUrl: string, token: string): string {
  return cloneUrl.replace("https://", `https://x-access-token:${token}@`);
}

export function relativeRepoTime(iso: string): string {
  if (!iso) return "unknown";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}
