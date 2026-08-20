// ESLint with a baseline.
//
// ESLint was added to a repo that had never run it, and it found sixteen pre-existing problems.
// Two ways to handle that, and only one of them survives contact with a working week: turn the
// offending rules off (which is how a lint config becomes decorative), or record what was already
// there and fail only on what is new. This does the second.
//
// The baseline is deliberately keyed by file + rule and NOT by line number: an unrelated edit
// three lines above should not resurrect a known problem, and a *second* violation of the same
// rule in the same file should not slip in behind the first — so counts are recorded too, and a
// count going up is a failure. A count going down updates the baseline via `--update-baseline`,
// which is the only direction that can be applied without review.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { exec, ROOT } from "./lib.mjs";

const BASELINE_PATH = fileURLToPath(new URL("../lint-baseline.json", import.meta.url));

function readBaseline() {
  try {
    return JSON.parse(readFileSync(BASELINE_PATH, "utf-8"));
  } catch {
    return { note: "", entries: {} };
  }
}

/** `{ "web/lib/release-notes.ts": { "no-useless-escape": 10 } }` */
function tally(results) {
  const entries = {};
  for (const file of results) {
    const relative = file.filePath.startsWith(ROOT) ? file.filePath.slice(ROOT.length) : file.filePath;
    for (const message of file.messages) {
      if (message.severity !== 2) continue;
      const rule = message.ruleId ?? "(parse error)";
      entries[relative] ??= {};
      entries[relative][rule] = (entries[relative][rule] ?? 0) + 1;
    }
  }
  return entries;
}

export async function runLint({ fix = false, updateBaseline = false } = {}) {
  const args = ["eslint", ".", "--format", "json"];
  if (fix) args.push("--fix");
  const { stdout, stderr, code } = await exec("pnpm", ["exec", ...args], { capture: true });

  let results;
  try {
    results = JSON.parse(stdout);
  } catch {
    // ESLint failed before it could report anything — a broken config, usually. Surfacing its
    // stderr is the only useful thing to do; pretending the lint passed is not.
    return { ok: false, detail: "eslint could not run", output: stderr || stdout, exitCode: code };
  }

  const current = tally(results);
  const baseline = readBaseline();

  if (updateBaseline) {
    writeFileSync(BASELINE_PATH, `${JSON.stringify({ ...baseline, entries: current }, null, 2)}\n`);
    return { ok: true, detail: "baseline rewritten", output: "", exitCode: 0 };
  }

  const regressions = [];
  for (const [file, rules] of Object.entries(current)) {
    for (const [rule, count] of Object.entries(rules)) {
      const allowed = baseline.entries?.[file]?.[rule] ?? 0;
      if (count > allowed) regressions.push({ file, rule, count, allowed });
    }
  }

  const improvements = [];
  for (const [file, rules] of Object.entries(baseline.entries ?? {})) {
    for (const [rule, allowed] of Object.entries(rules)) {
      const count = current[file]?.[rule] ?? 0;
      if (count < allowed) improvements.push({ file, rule, count, allowed });
    }
  }

  const lines = [];
  for (const r of regressions) {
    lines.push(`  ${r.file}: ${r.rule} — ${r.count} problem(s), baseline allows ${r.allowed}`);
    const detail = results
      .find((f) => f.filePath.endsWith(r.file))
      ?.messages.filter((m) => m.ruleId === r.rule)
      .slice(0, 5);
    for (const m of detail ?? []) lines.push(`      ${r.file}:${m.line}:${m.column}  ${m.message}`);
  }
  if (improvements.length > 0) {
    lines.push(
      `  ${improvements.length} baseline entr${improvements.length === 1 ? "y is" : "ies are"} now clean — run \`pnpm lint:baseline\` to lock the improvement in.`,
    );
  }

  const baselined = Object.values(baseline.entries ?? {}).reduce(
    (sum, rules) => sum + Object.values(rules).reduce((a, b) => a + b, 0),
    0,
  );
  return {
    ok: regressions.length === 0,
    detail: regressions.length === 0 ? `${baselined} known problem(s) baselined` : `${regressions.length} new problem(s)`,
    output: lines.join("\n"),
    exitCode: regressions.length === 0 ? 0 : 1,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await runLint({
    fix: process.argv.includes("--fix"),
    updateBaseline: process.argv.includes("--update-baseline"),
  });
  if (result.output) console.log(result.output);
  console.log(`lint: ${result.detail}`);
  process.exit(result.exitCode);
}
