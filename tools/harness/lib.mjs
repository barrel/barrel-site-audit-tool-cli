// Shared plumbing for the check harness. Kept dependency-free and in plain .mjs so the gate can
// run before anything is built and without a TypeScript loader in the picture — a quality gate
// that needs the project to be healthy before it can tell you the project is unhealthy is not a
// gate.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

export const ROOT = fileURLToPath(new URL("../../", import.meta.url));

const useColour = process.stdout.isTTY && !process.env.NO_COLOR;
const wrap = (code) => (s) => (useColour ? `\u001b[${code}m${s}\u001b[0m` : s);
export const bold = wrap("1");
export const dim = wrap("2");
export const red = wrap("31");
export const green = wrap("32");
export const yellow = wrap("33");
export const cyan = wrap("36");

/** Runs a command to completion. Never throws on a non-zero exit — the caller decides what a
 * failure means, and a harness that dies mid-suite reports less than one that carries on. */
export function exec(command, args, { cwd = ROOT, env, capture = false } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => (stdout += d));
    child.stderr?.on("data", (d) => (stderr += d));
    child.on("error", (err) => resolve({ code: 127, stdout, stderr: stderr + String(err), ms: Date.now() - started }));
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr, ms: Date.now() - started }));
  });
}

export function formatMs(ms) {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

/** A step's verdict. `healed` records that the harness changed files to get here — the caller
 * still sees it as a pass, but the summary says so out loud rather than presenting a repaired
 * run as a clean one. */
export function step(name, { ok, ms, detail = "", healed = false, skipped = false }) {
  return { name, ok, ms, detail, healed, skipped };
}

export function printSummary(title, steps, { flaky = [] } = {}) {
  const width = Math.max(...steps.map((s) => s.name.length), 12);
  process.stdout.write(`\n${bold(title)}\n`);
  for (const s of steps) {
    const mark = s.skipped ? dim("skip") : s.ok ? (s.healed ? yellow("fixed") : green(" ok ")) : red("FAIL");
    const detail = s.detail ? `  ${dim(s.detail)}` : "";
    process.stdout.write(`  ${mark}  ${s.name.padEnd(width)}  ${dim(formatMs(s.ms).padStart(6))}${detail}\n`);
  }
  if (flaky.length > 0) {
    process.stdout.write(
      `\n${yellow(`${flaky.length} test(s) only passed on a retry — treated as flaky, not as passing:`)}\n`,
    );
    for (const f of flaky) process.stdout.write(`  ${yellow("~")} ${f.file} › ${f.name}\n`);
  }
  const failed = steps.filter((s) => !s.ok);
  const total = steps.reduce((sum, s) => sum + s.ms, 0);
  process.stdout.write(
    failed.length === 0
      ? `\n${green("✓")} everything passed ${dim(`(${formatMs(total)})`)}\n`
      : `\n${red("✗")} ${failed.length} step(s) failed: ${failed.map((s) => s.name).join(", ")} ${dim(`(${formatMs(total)})`)}\n`,
  );
  return failed.length === 0;
}
