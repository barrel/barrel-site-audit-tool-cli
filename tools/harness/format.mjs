// A whitespace-only formatter, deliberately not Prettier.
//
// Prettier would reformat every file in the repo on its first run — thousands of lines of churn
// that buries real changes in review, in exchange for settling arguments nobody in this codebase
// is having. What is left here is the subset that is unambiguously a defect rather than a taste:
// a stray tab, a CRLF that turns a one-line diff into a whole-file diff, a missing final newline
// that makes `git diff` say "\ No newline at end of file" forever. Every rule below can be fixed
// by a mechanical edit with no judgement involved, which is exactly what makes it safe to
// auto-apply.
//
// Markdown is excluded: two trailing spaces are a line break there, and "fixing" them changes the
// rendered document.
import { readFileSync, writeFileSync } from "node:fs";
import { exec, ROOT } from "./lib.mjs";

const EXTENSIONS = [".ts", ".tsx", ".mjs", ".cjs", ".js", ".jsx", ".json"];

// Machine-written files. `stores/*/config.json` and everything under test-results/ are rewritten
// by the tool itself with JSON.stringify, so any fix applied here is undone by the next run —
// reporting them would train everyone to ignore this check.
const GENERATED = [/^stores\//, /^test-results\//];

async function trackedFiles() {
  const { stdout, code } = await exec("git", ["ls-files", "-z"], { capture: true });
  if (code !== 0) return [];
  return stdout
    .split("\0")
    .filter(Boolean)
    .filter((f) => EXTENSIONS.some((e) => f.endsWith(e)))
    .filter((f) => !GENERATED.some((re) => re.test(f)));
}

/** Returns the problems in one file's text, plus the text it should have been. */
function inspect(text) {
  const problems = [];
  let fixed = text;

  if (fixed.charCodeAt(0) === 0xfeff) {
    problems.push("byte-order mark");
    fixed = fixed.slice(1);
  }
  if (/\r/.test(fixed)) {
    problems.push("carriage returns");
    fixed = fixed.replace(/\r\n?/g, "\n");
  }
  if (/^\t+/m.test(fixed)) {
    // Only leading tabs — a tab inside a string literal or a template is content, not indentation.
    problems.push("tab indentation");
    fixed = fixed.replace(/^\t+/gm, (m) => "  ".repeat(m.length));
  }
  if (/[ \t]+$/m.test(fixed)) {
    problems.push("trailing whitespace");
    fixed = fixed.replace(/[ \t]+$/gm, "");
  }
  if (fixed.length > 0 && !fixed.endsWith("\n")) {
    problems.push("no final newline");
    fixed += "\n";
  }
  if (/\n{2,}$/.test(fixed)) {
    problems.push("blank lines at end of file");
    fixed = `${fixed.replace(/\n+$/, "")}\n`;
  }

  return { problems, fixed };
}

/** @returns {Promise<{ offenders: Array<{ file: string, problems: string[] }>, fixedCount: number }>} */
export async function checkFormatting({ fix = false } = {}) {
  const offenders = [];
  let fixedCount = 0;
  for (const file of await trackedFiles()) {
    const path = new URL(file, `file://${ROOT}`);
    let text;
    try {
      text = readFileSync(path, "utf-8");
    } catch {
      continue; // deleted between `git ls-files` and here
    }
    const { problems, fixed } = inspect(text);
    if (problems.length === 0) continue;
    if (fix) {
      writeFileSync(path, fixed);
      fixedCount += 1;
    } else {
      offenders.push({ file, problems });
    }
  }
  return { offenders, fixedCount };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const fix = process.argv.includes("--fix");
  const { offenders, fixedCount } = await checkFormatting({ fix });
  if (fix) {
    console.log(`format: rewrote ${fixedCount} file(s)`);
    process.exit(0);
  }
  for (const o of offenders) console.log(`${o.file}: ${o.problems.join(", ")}`);
  console.log(offenders.length === 0 ? "format: clean" : `format: ${offenders.length} file(s) need --fix`);
  process.exit(offenders.length === 0 ? 0 : 1);
}
