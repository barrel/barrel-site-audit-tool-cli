#!/usr/bin/env node
/**
 * Diffs a laptop report against a sandbox report for the same storefront, section by section.
 *
 * The output is deliberately ordered by what would make you abandon the plan first:
 *
 *   1. COVERAGE — a section that one runner produced and the other didn't. This is the finding
 *      that matters most and the easiest to miss, because a missing section is not an error: it
 *      renders as an absent heading, which reads as "nothing to flag" rather than "never looked".
 *      A cluster of these on the browser-driven sections (consent, pixels, UX) is the signature of
 *      a datacenter IP being challenged by bot protection.
 *   2. VERDICTS — pass/fail checks that disagree. A flipped verdict is a wrong statement about a
 *      client's site, which costs more than a wrong number.
 *   3. SCORES — the numbers. Expected to move for Lighthouse and to be identical for everything
 *      read from an HTTP response; anything that contradicts that split is worth understanding
 *      before trusting either runner.
 *
 * Usage:  node tools/sandbox-probe/compare.mjs ./probe-out
 *         node tools/sandbox-probe/compare.mjs ./probe-out --json
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const dir = resolve(process.argv[2] ?? "./probe-out");
const asJson = process.argv.includes("--json");

/** Sections whose verdicts come only from an HTTP response, HTML, or a TLS handshake — no
 * browser, no CPU timing. These are expected to be byte-identical between runners, so a
 * difference here is a real signal (usually geography or a client-side redirect), not noise. */
const HTTP_ONLY_SECTIONS = new Set(["health", "security", "geoSeo", "agentReadiness"]);

/** Sections that drive a real browser. Absence here, on one runner only, is the bot-protection
 * signature this probe exists to look for. */
const BROWSER_SECTIONS = new Set(["performance", "accessibility", "consent", "pixels", "ux", "adaScope", "sitespeed"]);

function loadPairs() {
  if (!existsSync(dir)) {
    console.error(`No such directory: ${dir}`);
    console.error(`Pass the probe's output directory, or run the probe first (see --help in probe.mjs).`);
    process.exit(1);
  }
  const files = readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "sandbox-summary.json");
  const bySlug = new Map();
  for (const file of files) {
    const match = file.match(/^(local|sandbox)-(.+)\.json$/);
    if (!match) continue;
    const [, side, slug] = match;
    const entry = bySlug.get(slug) ?? {};
    try {
      entry[side] = JSON.parse(readFileSync(join(dir, file), "utf8"));
    } catch (err) {
      console.error(`Could not parse ${file}: ${err.message}`);
      continue;
    }
    bySlug.set(slug, entry);
  }
  return bySlug;
}

/** Every number worth comparing, flattened to dotted paths, so adding a section to the report
 * doesn't mean editing a list here. Only leaf numbers — a score, a count, a measurement. */
function flattenNumbers(value, path = "", out = {}) {
  if (typeof value === "number" && Number.isFinite(value)) {
    out[path] = value;
    return out;
  }
  if (Array.isArray(value)) {
    // Arrays of findings are compared by length, not element-wise: the same site audited twice
    // can legitimately order findings differently, and a count difference is the real signal.
    out[`${path}.length`] = value.length;
    return out;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      flattenNumbers(child, path ? `${path}.${key}` : key, out);
    }
  }
  return out;
}

/** Pass/fail-shaped verdicts, keyed by something stable enough to line up across two runs.
 * Checks carry an `id` or a `title`; anything with neither can't be paired and is skipped rather
 * than guessed at. */
function collectVerdicts(sections) {
  const verdicts = new Map();
  const walk = (value, trail) => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item, trail);
      return;
    }
    if (!value || typeof value !== "object") return;

    const key = value.id ?? value.title ?? value.name ?? value.check ?? null;
    const verdict = value.status ?? value.result ?? value.verdict ?? value.rating ?? null;
    if (key && typeof verdict === "string") verdicts.set(`${trail}: ${key}`, verdict);

    for (const [childKey, child] of Object.entries(value)) {
      walk(child, trail || childKey);
    }
  };
  for (const [name, section] of Object.entries(sections ?? {})) walk(section, name);
  return verdicts;
}

function pct(local, sandbox) {
  if (local === 0) return sandbox === 0 ? "0%" : "n/a";
  return `${(((sandbox - local) / Math.abs(local)) * 100).toFixed(0)}%`;
}

function compare(slug, pair) {
  const report = { slug, coverage: [], verdicts: [], scores: [], missing: [] };

  if (!pair.local || !pair.sandbox) {
    report.missing.push(pair.local ? "sandbox report absent — the audit failed or was blocked" : "local report absent");
    return report;
  }

  const localSections = pair.local.sections ?? {};
  const sandboxSections = pair.sandbox.sections ?? {};
  const names = new Set([...Object.keys(localSections), ...Object.keys(sandboxSections)]);

  for (const name of [...names].sort()) {
    const inLocal = localSections[name] != null;
    const inSandbox = sandboxSections[name] != null;
    if (inLocal !== inSandbox) {
      report.coverage.push({
        section: name,
        present: inLocal ? "local only" : "sandbox only",
        // The distinction that decides whether the plan survives.
        severity: BROWSER_SECTIONS.has(name) ? "blocking" : HTTP_ONLY_SECTIONS.has(name) ? "unexpected" : "note",
      });
    }
  }

  const localVerdicts = collectVerdicts(localSections);
  const sandboxVerdicts = collectVerdicts(sandboxSections);
  for (const [key, localValue] of localVerdicts) {
    const sandboxValue = sandboxVerdicts.get(key);
    if (sandboxValue !== undefined && sandboxValue !== localValue) {
      report.verdicts.push({ check: key, local: localValue, sandbox: sandboxValue });
    }
  }

  const localNumbers = flattenNumbers(localSections);
  const sandboxNumbers = flattenNumbers(sandboxSections);
  for (const [key, localValue] of Object.entries(localNumbers)) {
    const sandboxValue = sandboxNumbers[key];
    if (sandboxValue === undefined || sandboxValue === localValue) continue;
    const section = key.split(".")[0];
    report.scores.push({
      metric: key,
      local: localValue,
      sandbox: sandboxValue,
      delta: sandboxValue - localValue,
      change: pct(localValue, sandboxValue),
      expected: HTTP_ONLY_SECTIONS.has(section) ? "should be identical" : "may legitimately differ",
    });
  }

  // Biggest relative movement first, and the "should be identical" ones surfaced regardless of
  // size — a 2-point drift in a section that reads only HTTP responses matters more than a
  // 20-point Lighthouse swing that was predicted.
  report.scores.sort((a, b) => {
    if (a.expected !== b.expected) return a.expected === "should be identical" ? -1 : 1;
    return Math.abs(b.delta) - Math.abs(a.delta);
  });

  report.runner = { local: pair.local.runner ?? null, sandbox: pair.sandbox.runner ?? null };
  return report;
}

const pairs = loadPairs();
if (pairs.size === 0) {
  console.error(`No report pairs found in ${dir}.`);
  console.error(`Expected files named local-<slug>.json and sandbox-<slug>.json.`);
  console.error(`Run the probe both ways first:`);
  console.error(`  node tools/sandbox-probe/probe.mjs --local https://store.com`);
  console.error(`  node tools/sandbox-probe/probe.mjs https://store.com`);
  process.exit(1);
}

const reports = [...pairs].map(([slug, pair]) => compare(slug, pair));

if (asJson) {
  console.log(JSON.stringify(reports, null, 2));
  process.exit(0);
}

for (const report of reports) {
  console.log(`\n${"=".repeat(78)}\n${report.slug}\n${"=".repeat(78)}`);

  for (const note of report.missing) console.log(`  !! ${note}`);
  if (report.missing.length > 0) continue;

  console.log(`\n1. COVERAGE — sections one runner produced and the other did not`);
  if (report.coverage.length === 0) {
    console.log(`   Both runners produced every section. This is the result you want.`);
  } else {
    for (const row of report.coverage) {
      const flag = row.severity === "blocking" ? "BLOCKING" : row.severity === "unexpected" ? "UNEXPECTED" : "note";
      console.log(`   [${flag}] ${row.section} — ${row.present}`);
    }
    if (report.coverage.some((r) => r.severity === "blocking")) {
      console.log(`\n   A browser-driven section missing from the sandbox only is the signature of`);
      console.log(`   bot protection treating a datacenter IP differently. Read the .log file.`);
    }
  }

  console.log(`\n2. VERDICTS — pass/fail checks that disagree (${report.verdicts.length})`);
  if (report.verdicts.length === 0) {
    console.log(`   None. Every check that ran on both runners reached the same verdict.`);
  } else {
    for (const row of report.verdicts.slice(0, 25)) {
      console.log(`   ${row.check}\n     local=${row.local}  sandbox=${row.sandbox}`);
    }
    if (report.verdicts.length > 25) console.log(`   ... and ${report.verdicts.length - 25} more (--json for all)`);
  }

  const shouldMatch = report.scores.filter((s) => s.expected === "should be identical");
  const mayDiffer = report.scores.filter((s) => s.expected !== "should be identical");

  console.log(`\n3. SCORES`);
  console.log(`   Sections that read only HTTP responses — these should be identical (${shouldMatch.length} differ):`);
  if (shouldMatch.length === 0) console.log(`     Nothing differs. As expected.`);
  for (const row of shouldMatch.slice(0, 20)) {
    console.log(`     ${row.metric}: ${row.local} -> ${row.sandbox}  (${row.delta > 0 ? "+" : ""}${row.delta}, ${row.change})`);
  }

  console.log(`\n   Browser/CPU-dependent — movement here is expected (${mayDiffer.length} differ, largest first):`);
  for (const row of mayDiffer.slice(0, 20)) {
    console.log(`     ${row.metric}: ${row.local} -> ${row.sandbox}  (${row.delta > 0 ? "+" : ""}${row.delta}, ${row.change})`);
  }
  if (mayDiffer.length > 20) console.log(`     ... and ${mayDiffer.length - 20} more (--json for all)`);

  console.log(`\n   Runner: local=${JSON.stringify(report.runner.local)}`);
  console.log(`         sandbox=${JSON.stringify(report.runner.sandbox)}`);
}

console.log(
  `\n${"-".repeat(78)}\nHow to read this: coverage gaps decide whether cloud runs are viable at all;` +
    `\nverdict flips decide whether they can be shown to a client; score drift only decides` +
    `\nwhether existing baselines survive the switch.\n`,
);
