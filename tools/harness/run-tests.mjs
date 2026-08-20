// The test harness.
//
// Runner choice: Node's built-in `node:test` driven through `tsx`. Both were already in the tree
// (tsx is a cli/ devDependency; node:test ships with the Node 22 this repo already requires), so
// the whole suite costs zero new runtime dependencies. Vitest would bring ~40 packages and a
// bundler's worth of config to run assertions against pure functions that need neither — its
// real advantages (browser mode, module mocking, watch UI) are things nothing here wants. If this
// repo ever needs to test React components, revisit: that is the point where vitest earns its
// weight.
//
// What "self-healing" means here, precisely — see docs/testing.md for the long version:
//   IT DOES     re-run a failing test on its own, with backoff, to find out whether the failure
//               reproduces.
//   IT DOES     report anything that only passed on a retry as FLAKY, never as passed.
//   IT DOES NOT retry a test that fails consistently, and does not soften, skip, or rewrite it.
//   IT DOES NOT touch source files. Auto-fixing lives in `pnpm check --heal`, and only for
//               formatting and `eslint --fix` — never for an assertion.
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { exec, formatMs, ROOT } from "./lib.mjs";

/** Where the suites live. Kept as an explicit list rather than a recursive glob so a stray
 * `*.test.ts` under node_modules or a store's theme can never be picked up and run. */
const TEST_GLOBS = ["cli/test/**/*.test.ts", "shared/test/**/*.test.ts"];

const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [250, 1000];

const REPORTER = fileURLToPath(new URL("./json-reporter.mjs", import.meta.url));

function parse(stdout) {
  const results = [];
  for (const line of stdout.split("\n")) {
    if (!line.startsWith("{")) continue;
    try {
      results.push(JSON.parse(line));
    } catch {
      // A line the reporter did not write — a stray console.log from a test, most likely.
    }
  }
  return results;
}

async function runNodeTest({ namePattern } = {}) {
  const args = [
    "--import",
    "tsx",
    "--test",
    "--test-reporter",
    REPORTER,
    "--test-reporter-destination",
    "stdout",
  ];
  if (namePattern) args.push("--test-name-pattern", namePattern);
  args.push(...TEST_GLOBS);
  const { stdout, stderr, code, ms } = await exec(process.execPath, args, { capture: true });
  return { results: parse(stdout), stdout, stderr, code, ms };
}

/** Escapes a test name for `--test-name-pattern`, which takes a regular expression. */
function exactly(name) {
  return `^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function runTests({ onLine = () => {} } = {}) {
  const first = await runNodeTest();
  const byName = new Map(first.results.map((r) => [r.name, r]));

  // A crash before any test ran (a syntax error, an unresolvable import) produces no results at
  // all. That is a hard failure and must not be mistaken for an empty, passing suite.
  if (first.results.length === 0) {
    return {
      ok: false,
      ms: first.ms,
      passed: 0,
      failed: 0,
      skipped: 0,
      flaky: [],
      failures: [{ name: "(suite did not run)", file: "", error: (first.stderr || first.stdout).slice(0, 4000) }],
    };
  }

  const failed = first.results.filter((r) => r.status === "failed");
  const flaky = [];
  const stillFailing = [];

  for (const failure of failed) {
    let recovered = false;
    for (let attempt = 2; attempt <= MAX_ATTEMPTS && !recovered; attempt++) {
      await sleep(BACKOFF_MS[attempt - 2] ?? 1000);
      onLine(`  retrying "${failure.name}" (attempt ${attempt}/${MAX_ATTEMPTS})`);
      const retry = await runNodeTest({ namePattern: exactly(failure.name) });
      const match = retry.results.find((r) => r.name === failure.name);
      // No match means the pattern selected nothing — treat it as unresolved rather than passed.
      if (match?.status === "passed") recovered = true;
    }
    if (recovered) {
      // Deliberately not counted as a pass. Every test here is a pure function over fabricated
      // input with no network, clock or filesystem involved, so a result that changes between two
      // identical runs means shared state between tests — a real defect that a green tick would
      // bury.
      flaky.push({ name: failure.name, file: failure.file, error: failure.error });
      byName.get(failure.name).status = "flaky";
    } else {
      stillFailing.push(failure);
    }
  }

  const results = [...byName.values()];
  return {
    ok: stillFailing.length === 0,
    ms: first.ms,
    passed: results.filter((r) => r.status === "passed").length,
    failed: stillFailing.length,
    skipped: results.filter((r) => r.status === "skipped").length,
    flaky,
    failures: stillFailing.map((f) => ({ name: f.name, file: f.file, error: f.error })),
    results,
  };
}

/** Two artefacts, both small enough to live in git: a machine-readable record and something a
 * person can read in a pull request without a JSON viewer. Individual passing tests are counted
 * but not listed — a 400-line file regenerated on every run is a merge conflict, not a record. */
export function writeResults(summary, { dir = `${ROOT}test-results` } = {}) {
  mkdirSync(dir, { recursive: true });
  const record = {
    timestamp: new Date().toISOString(),
    node: process.version,
    ok: summary.ok,
    counts: {
      passed: summary.passed,
      failed: summary.failed,
      skipped: summary.skipped,
      flaky: summary.flaky.length,
    },
    durationMs: summary.ms,
    flaky: summary.flaky.map((f) => ({ name: f.name, file: relative(f.file) })),
    failures: summary.failures.map((f) => ({ name: f.name, file: relative(f.file), error: f.error })),
  };
  writeFileSync(`${dir}/latest.json`, `${JSON.stringify(record, null, 2)}\n`);

  const lines = [
    "# Test results",
    "",
    `Last run: ${record.timestamp} (Node ${record.node})`,
    "",
    `- **${record.ok ? "passed" : "FAILED"}** in ${formatMs(record.durationMs)}`,
    `- ${record.counts.passed} passed, ${record.counts.failed} failed, ${record.counts.skipped} skipped, ${record.counts.flaky} flaky`,
    "",
  ];
  if (record.flaky.length > 0) {
    lines.push(
      "## Flaky",
      "",
      "These failed and then passed on a retry. They are **not** counted as passing — every test",
      "here is a pure function over fabricated input, so a changing result means shared state.",
      "",
      ...record.flaky.map((f) => `- \`${f.name}\` — ${f.file}`),
      "",
    );
  }
  if (record.failures.length > 0) {
    lines.push("## Failures", "", ...record.failures.flatMap((f) => [`### ${f.name}`, "", `\`${f.file}\``, "", "```", f.error ?? "", "```", ""]));
  }
  writeFileSync(`${dir}/summary.md`, lines.join("\n"));
  return record;
}

function relative(file) {
  return file?.startsWith(ROOT) ? file.slice(ROOT.length) : (file ?? "");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const summary = await runTests({ onLine: (l) => console.log(l) });
  const record = writeResults(summary);
  console.log(
    `tests: ${record.counts.passed} passed, ${record.counts.failed} failed, ${record.counts.flaky} flaky (${formatMs(record.durationMs)})`,
  );
  for (const f of summary.failures) {
    console.log(`\n✗ ${f.name}\n  ${relative(f.file)}\n${(f.error ?? "").replace(/^/gm, "    ")}`);
  }
  for (const f of summary.flaky) console.log(`~ FLAKY ${f.name} — ${relative(f.file)}`);
  process.exit(summary.ok ? 0 : 1);
}
