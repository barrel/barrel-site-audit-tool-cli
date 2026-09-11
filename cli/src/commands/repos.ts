import chalk from "chalk";
import { getGithubToken } from "../github-auth.js";
import { getGithubUser, listGithubOrgs, relativeRepoTime, searchGithubRepos } from "../github.js";
import { cliInvocation } from "../paths.js";

export interface ReposArgs {
  query?: string;
  org?: string;
  limit?: string;
  archived?: boolean;
  orgs?: boolean;
  json?: boolean;
}

/** `barrel-audit repos [query]` — search the GitHub repos this login can see, without linking
 * anything to a store.
 *
 * The interactive picker in `link-repo` is the usual way in. This exists for the case the picker
 * is bad at: working out *which* repo is the client's before committing to one, on an instance
 * where several have similar names. It is also the copy-paste source for `--repo owner/name`, and
 * `--json` makes it scriptable.
 *
 * Read-only, like the rest of the connector. */
export async function reposCommand(args: ReposArgs): Promise<void> {
  const token = await getGithubToken();

  if (args.orgs) {
    const orgs = await listGithubOrgs(token);
    if (args.json) {
      console.log(JSON.stringify({ orgs }, null, 2));
      return;
    }
    const user = await getGithubUser(token).catch(() => null);
    if (user) console.log(chalk.gray(`Signed in as ${user.login}.`));
    if (orgs.length === 0) {
      console.log(chalk.yellow("This GitHub login isn't a member of any organization."));
      return;
    }
    console.log(chalk.bold(`${orgs.length} org(s):`));
    for (const org of orgs) console.log(`  ${org}`);
    console.log(chalk.gray(`\nNarrow a search with: ${cliInvocation()} repos <query> --org ${orgs[0]}`));
    return;
  }

  const limit = Math.min(Math.max(Number.parseInt(args.limit ?? "30", 10) || 30, 1), 100);
  const repos = await searchGithubRepos(token, {
    query: args.query,
    org: args.org,
    limit,
    includeArchived: args.archived,
  });

  if (args.json) {
    console.log(JSON.stringify({ repos }, null, 2));
    return;
  }

  if (repos.length === 0) {
    console.log(
      chalk.yellow(
        args.query
          ? `No repository matching "${args.query}"${args.org ? ` in ${args.org}` : ""}.`
          : `No repositories visible to this GitHub login${args.org ? ` in ${args.org}` : ""}.`,
      ) + chalk.gray(args.archived ? "" : "\n  Archived repos are excluded — pass --archived to include them."),
    );
    return;
  }

  const width = Math.max(...repos.map((r) => r.fullName.length));
  console.log(
    chalk.bold(
      `${repos.length} repo(s)${args.query ? ` matching "${args.query}"` : ""}${args.org ? ` in ${args.org}` : ""}:`,
    ),
  );
  for (const repo of repos) {
    const meta = [
      repo.private ? "private" : "public",
      repo.language ?? null,
      `updated ${relativeRepoTime(repo.updatedAt)}`,
      repo.archived ? chalk.yellow("archived") : null,
    ].filter(Boolean);
    console.log(`  ${repo.fullName.padEnd(width)}  ${chalk.gray(meta.join(" · "))}`);
    if (repo.description) console.log(`  ${" ".repeat(width)}  ${chalk.gray(repo.description.slice(0, 100))}`);
  }

  console.log(
    chalk.gray(
      `\nConnect one to a store (read-only, nothing kept on disk):` +
        `\n  ${cliInvocation()} link-repo <store slug or URL> --repo ${repos[0].fullName} --mode read` +
        `\nOr pull a copy into stores/<slug>/theme/:` +
        `\n  ${cliInvocation()} link-repo <store slug or URL> --repo ${repos[0].fullName} --mode pull`,
    ),
  );
}
