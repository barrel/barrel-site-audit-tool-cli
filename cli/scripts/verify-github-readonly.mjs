// Static guard: the GitHub *connector* is read-only, and this is what makes that a fact rather
// than an intention. Run as a prerequisite to `pnpm build` (see package.json), alongside its
// sibling verify-git-pr-safety.mjs.
//
// GitHub's OAuth Apps have no read-only scope covering private repository contents — `repo` is
// all-or-nothing — so the token the connector holds is technically write-capable. The guarantee
// therefore has to live in the code, and a guarantee that lives in code needs something that
// notices when a future edit quietly drops it. That's this.
//
// cli/src/git-pr.ts is deliberately NOT covered here: it is the one sanctioned write path in the
// tool (the human-gated "Suggest fix" pull-request flow) and has its own, narrower guard.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const READ_ONLY_MODULES = [
  "github.ts",
  "github-checkout.ts",
  "theme-source.ts",
  "commands/repos.ts",
  "commands/link-repo.ts",
];

// Every Octokit namespace method that changes something on GitHub's side, plus the git
// subcommands that write to a remote. Matched on the call shape (`.pulls.create(`), so a mention
// in a comment or a variable named `createdAt` doesn't trip it.
const FORBIDDEN_PATTERNS = [
  // Octokit: anything that creates, updates, deletes, merges or dispatches.
  /\.\s*(repos|pulls|issues|git|actions|checks|orgs|teams|users|apps)\s*\.\s*(create|update|delete|merge|replace|add|remove|set|transfer|dispatch|upload|rename|fork)\w*\s*\(/,
  // Raw REST calls with a mutating verb.
  /octokit\.request\(\s*["'`]\s*(POST|PUT|PATCH|DELETE)/i,
  /method:\s*["'`](POST|PUT|PATCH|DELETE)["'`]/i,
  // fetch() against the GitHub API with a mutating method.
  /fetch\([^)]*api\.github\.com[^)]*method/i,
  // git subcommands that reach a remote or create history.
  /["'`](push|commit|merge|rebase|tag|remote)["'`]\s*,/,
  /spawn\(\s*["'`]git["'`][^)]*\b(push|commit|merge|rebase)\b/,
];

let failed = false;

for (const relative of READ_ONLY_MODULES) {
  const target = fileURLToPath(new URL(`../src/${relative}`, import.meta.url));
  const source = readFileSync(target, "utf-8");
  // Comments are prose about the constraint (this file's own patterns appear in them), not code.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  for (const pattern of FORBIDDEN_PATTERNS) {
    const match = code.match(pattern);
    if (match) {
      console.error(
        `cli/src/${relative} contains what looks like a GitHub write: ${match[0].trim()}\n` +
          `  The GitHub connector must stay read-only. If this is genuinely needed, it belongs in\n` +
          `  cli/src/git-pr.ts behind the human-gated "Suggest fix" flow — not here.`,
      );
      failed = true;
    }
  }
}

if (failed) process.exit(1);

console.log(`GitHub connector read-only check passed (${READ_ONLY_MODULES.length} modules, no write calls found).`);
