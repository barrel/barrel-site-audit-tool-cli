// Static guard: cli/src/git-pr.ts is the one module in this repo allowed to push branches and
// open PRs against a client's real GitHub repo. It must never merge anything or touch branch
// protection — enforced here by grep rather than a runtime check, so the constraint can't be
// silently dropped by a future edit. Run as a prerequisite to `pnpm build` (see package.json).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const target = fileURLToPath(new URL("../src/git-pr.ts", import.meta.url));
const src = readFileSync(target, "utf-8");

const forbidden = /octokit\.(pulls\.merge|pulls\.updateBranch|repos\.merge|repos\.mergeUpstream|repos\.\w*[Bb]ranch[Pp]rotection)/;

if (forbidden.test(src)) {
  console.error(`git-pr.ts contains a forbidden merge/branch-protection call — this must never merge or touch branch protection.`);
  process.exit(1);
}

console.log("git-pr.ts safety check passed (no merge/branch-protection calls found).");
