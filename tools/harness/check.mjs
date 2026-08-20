// The build quality gate. `pnpm check` runs this; `pnpm build` runs it first and refuses to build
// if it fails.
//
// Healing (`--heal`, on by default outside CI) applies the two classes of fix that need no
// judgement — whitespace normalisation and `eslint --fix` — and re-runs the step. Everything else
// is reported and fails. Nothing here can make a failing assertion pass; see docs/testing.md.
import { checkFormatting } from "./format.mjs";
import { exec, bold, cyan, dim, printSummary, red, step } from "./lib.mjs";
import { runLint } from "./lint.mjs";
import { runTests, writeResults } from "./run-tests.mjs";

const args = process.argv.slice(2);
// CI must never rewrite the tree it is judging: a green build that only went green because the
// pipeline edited the source is not a signal anyone can act on.
const heal = args.includes("--heal") || (!args.includes("--no-heal") && !process.env.CI);
const quick = args.includes("--quick");

const output = [];
const record = (name, text) => text?.trim() && output.push({ name, text: text.trim() });

// The in-progress line is redrawn in place, so it only exists on a terminal. Piped into a log it
// would be a trail of escape sequences around output nobody can read.
const live = process.stdout.isTTY && !process.env.CI;

async function timed(name, fn) {
  if (live) process.stdout.write(`${dim("·")} ${name}…\u001b[0G`);
  const started = Date.now();
  const result = await fn();
  if (live) process.stdout.write("\u001b[2K\u001b[0G");
  return step(name, { ...result, ms: Date.now() - started });
}

/** A step that is just "run this command and expect zero". */
function command(name, cmd, cmdArgs, options) {
  return timed(name, async () => {
    const { code, stdout, stderr } = await exec(cmd, cmdArgs, { ...options, capture: true });
    if (code !== 0) record(name, `${stdout}\n${stderr}`);
    return { ok: code === 0 };
  });
}

const steps = [];

// The static guard on git-pr.ts runs first and cheaply: it is the one check whose failure means
// "this build could push something it must never push", and it costs milliseconds.
steps.push(await command("git-pr safety", process.execPath, ["cli/scripts/verify-git-pr-safety.mjs"]));

steps.push(
  await timed("format", async () => {
    let { offenders } = await checkFormatting();
    if (offenders.length > 0 && heal) {
      await checkFormatting({ fix: true });
      ({ offenders } = await checkFormatting());
      if (offenders.length === 0) return { ok: true, healed: true, detail: "normalised whitespace" };
    }
    if (offenders.length > 0) {
      record("format", offenders.map((o) => `${o.file}: ${o.problems.join(", ")}`).join("\n"));
      return { ok: false, detail: `${offenders.length} file(s) — run \`pnpm check --heal\`` };
    }
    return { ok: true, detail: "clean" };
  }),
);

steps.push(
  await timed("lint", async () => {
    let result = await runLint();
    let healed = false;
    if (!result.ok && heal) {
      await runLint({ fix: true });
      result = await runLint();
      healed = result.ok;
    }
    if (!result.ok) record("lint", result.output);
    return { ok: result.ok, healed, detail: result.detail };
  }),
);

// shared/ must be emitted before cli/ can be typechecked — cli imports it as a package, so it
// resolves against shared/dist/*.d.ts rather than the source.
steps.push(await command("build shared types", "pnpm", ["--filter", "@barrel/site-audit-shared", "build"]));

const typechecks = await Promise.all([
  command("typecheck cli", "pnpm", ["exec", "tsc", "-p", "cli/tsconfig.json", "--noEmit"]),
  command("typecheck web", "pnpm", ["exec", "tsc", "-p", "web/tsconfig.json", "--noEmit"]),
  command("typecheck tests", "pnpm", ["exec", "tsc", "-p", "tsconfig.test.json"]),
]);
steps.push(...typechecks);

let flaky = [];
if (quick) {
  steps.push(step("tests", { ok: true, ms: 0, skipped: true, detail: "--quick" }));
} else {
  steps.push(
    await timed("tests", async () => {
      const summary = await runTests({ onLine: (l) => process.stdout.write(`${dim(l)}\n`) });
      writeResults(summary);
      flaky = summary.flaky;
      if (!summary.ok) {
        record(
          "tests",
          summary.failures.map((f) => `✗ ${f.name}\n${(f.error ?? "").replace(/^/gm, "    ")}`).join("\n\n"),
        );
      }
      return {
        ok: summary.ok,
        detail: `${summary.passed} passed, ${summary.failed} failed, ${summary.flaky.length} flaky`,
      };
    }),
  );
}

for (const { name, text } of output) {
  process.stdout.write(`\n${red(bold(`── ${name} ──`))}\n${text}\n`);
}

const ok = printSummary("check", steps, { flaky });
if (ok && heal && steps.some((s) => s.healed)) {
  process.stdout.write(
    `\n${cyan("Files were rewritten to get here.")} Review the diff before committing — the harness fixes\nformatting and lint, never behaviour.\n`,
  );
}
process.exit(ok ? 0 : 1);
