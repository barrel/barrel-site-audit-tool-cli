export interface GithubRepoChoice {
  fullName: string;
  description: string | null;
  private: boolean;
  defaultBranch: string;
  updatedAt: string;
  cloneUrl: string;
}

/** Repos the token's owner can see, most-recently-updated first. Paginates up to `limit`.
 * `token` comes from getGithubToken() (github-auth.ts) — the OAuth device-flow login. */
export async function listGithubRepos(token: string, limit = 200): Promise<GithubRepoChoice[]> {
  const { Octokit } = await import("@octokit/rest");
  const octokit = new Octokit({ auth: token });

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
      });
    }
    if (data.length < 100) break;
  }
  return repos.slice(0, limit);
}

/** Embeds the OAuth token into an https clone URL so `git clone` can authenticate
 * non-interactively. Never log or persist the return value — it carries the token. */
export function authenticatedCloneUrl(cloneUrl: string, token: string): string {
  return cloneUrl.replace("https://", `https://x-access-token:${token}@`);
}
