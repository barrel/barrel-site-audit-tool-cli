import { writeFileSync } from "node:fs";
import chalk from "chalk";
import { nanoid } from "nanoid";
import type {
  ConsentFleetReport,
  ConsentFleetRow,
  ConsentFleetStatus,
  ConsentSection,
  ConsentSiteEntry,
} from "@barrel/site-audit-shared";
import { CONSENT_INDEX_BLOB_PATH, consentFleetBlobPath, consentScreenshotBlobPath, consentSiteBlobPath } from "@barrel/site-audit-shared";
import { analyzeConsent } from "../analyzers/consent/index.js";
import { runCmpInventory } from "../analyzers/consent/engine.js";
import { activeSites, loadRegistryWithProblems, registryPath, seedRegistry } from "../analyzers/consent/registry.js";
import { readBlobJson, writeBlobBinary, writeBlobJson } from "../blob.js";
import { cliInvocation } from "../paths.js";
import { normalizeAuditUrl } from "../url.js";

export interface ConsentScanOptions {
  /** A slug from sites.yml, or a bare URL for an ad-hoc scan of a site not in the registry. */
  target?: string;
  site?: string;
  /** The variadic form: any mix of registry slugs and URLs. Duplicates are collapsed. */
  targets?: string[];
  seed?: boolean;
  fromRepos?: boolean;
  inventory?: boolean;
  region?: string;
  concurrency?: number;
  retry?: boolean;
  upload?: boolean;
  json?: string;
  junit?: string;
  budgetMinutes?: number;
}

export async function consentScanCommand(options: ConsentScanOptions): Promise<void> {
  if (options.seed) return void (await runSeed(options));

  const sites = resolveTargets(options);
  if (sites.length === 0) {
    console.log(chalk.yellow(`No sites to scan.`));
    console.log(chalk.gray(`  Add them to ${registryPath()}, or run \`${cliInvocation()} consent-scan --seed\` to draft it.`));
    console.log(chalk.gray(`  You can also scan any URL directly: \`${cliInvocation()} consent-scan https://example.com\``));
    return;
  }

  if (options.inventory) return void (await runInventory(sites, options));

  const scanId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${nanoid(6)}`;
  const region = options.region ?? "us";
  const started = Date.now();

  console.log(chalk.bold(`\nPrivacy Compliance — ${sites.length} site(s), region ${region}\n`));

  const rows = await mapWithConcurrency(sites, options.concurrency ?? 4, async (site) => {
    const siteStart = Date.now();
    process.stdout.write(chalk.gray(`  → ${site.slug} …\n`));
    try {
      const section = await analyzeConsent(normalizeAuditUrl(site.url), {
        expectedCmp: site.cmp,
        expect: site.expect,
        region,
        retryOnBlocker: options.retry !== false,
        budgetMs: options.budgetMinutes ? options.budgetMinutes * 60_000 : undefined,
        uploadScreenshot:
          options.upload === false
            ? undefined
            : (state, image) => writeBlobBinary(consentScreenshotBlobPath(site.slug, scanId, state), image, "image/jpeg"),
      });
      printSiteLine(site, section);
      // The comprehensive per-site report reads this. Written per site rather than folded into
      // the fleet blob so the fleet table doesn't pay for detail it never renders. Never fatal:
      // losing the detail blob must not lose the scan.
      if (options.upload !== false) {
        await writeBlobJson(consentSiteBlobPath(scanId, site.slug), section).catch(() => undefined);
      }
      return toRow(site, section, Date.now() - siteStart);
    } catch (err: any) {
      const message = String(err?.message ?? err).slice(0, 200);
      console.log(`  ${chalk.red("✗")} ${chalk.bold(site.slug)} — ${message}`);
      return errorRow(site, message, Date.now() - siteStart);
    }
  });

  const report: ConsentFleetReport = {
    id: scanId,
    createdAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    region,
    rows,
    totals: {
      sites: rows.length,
      ok: rows.filter((r) => r.status === "ok").length,
      issues: rows.filter((r) => r.status === "issues").length,
      blocked: rows.filter((r) => r.status === "blocked").length,
      errored: rows.filter((r) => r.status === "error").length,
    },
  };

  printSummary(report);
  if (options.json) writeFileSync(options.json, JSON.stringify(report, null, 2));
  if (options.junit) writeFileSync(options.junit, toJUnit(report));
  if (options.upload !== false) await publish(report);

  // Non-zero only on a confirmed blocker. A blocked or errored site is a gap in coverage, not a
  // compliance failure, and failing CI for a storefront that happened to be down would train
  // people to ignore the signal.
  const blockers = rows.reduce((sum, r) => sum + r.totals.blockers, 0);
  if (blockers > 0) {
    console.log(chalk.red(`\n${blockers} blocker-severity failure(s) across the fleet.`));
    process.exitCode = 1;
  }
}

/* ── targets ─────────────────────────────────────────────────────────────────────────────── */

/** A bare hostname is a site, not a registry slug.
 *
 * Slugs are dot-free by construction (`drinkwaterloo-com`), so the dot is what separates the two
 * without ambiguity. Worth handling because the overwhelmingly common way to arrive here is a
 * pasted column of domains, and rejecting `blueair.com` with "no such site in sites.yml" is a
 * confusing answer to an obviously well-formed request. */
function looksLikeUrl(target: string): boolean {
  return /^https?:\/\//i.test(target) || /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(\/|$)/i.test(target);
}

function normalizeTarget(target: string): string {
  return /^https?:\/\//i.test(target) ? target : `https://${target}`;
}

/** Builds an ad-hoc registry entry for a URL that isn't in sites.yml. */
function adHocEntry(url: string): ConsentSiteEntry {
  const host = new URL(url).hostname.replace(/^www\./, "");
  return { slug: host.replace(/[^a-z0-9]+/gi, "-"), client: host, url, cmp: "unknown", regions: ["us"] };
}

function resolveTargets(options: ConsentScanOptions): ConsentSiteEntry[] {
  // `targets` is the variadic form; `target`/`site` are the older single-value callers.
  const targets = (options.targets?.length ? options.targets : [options.target ?? options.site])
    .filter((t): t is string => Boolean(t && t.trim()))
    .map((t) => t.trim());

  if (targets.length === 0) {
    const { registry, incomplete } = loadRegistryWithProblems();
    reportIncomplete(incomplete);
    return activeSites(registry);
  }

  // Only load the registry when at least one target could be a slug — a pasted list of URLs
  // should not fail because sites.yml happens to be missing or malformed.
  const needsRegistry = targets.some((t) => !looksLikeUrl(t));
  const registry = needsRegistry ? loadRegistryWithProblems() : null;
  if (registry) reportIncomplete(registry.incomplete);

  const seen = new Set<string>();
  const resolved: ConsentSiteEntry[] = [];
  for (const target of targets) {
    const entry = looksLikeUrl(target)
      ? adHocEntry(normalizeTarget(target))
      : registry!.registry.sites.find((s) => s.slug === target);
    if (!entry) {
      throw new Error(`No site "${target}" in ${registryPath()}. Pass a full URL to scan it ad hoc.`);
    }
    // Two URLs that differ only by trailing slash or www are the same scan; running both would
    // double the wall clock and put two rows for one site in front of the reader.
    const key = entry.url.replace(/\/+$/, "").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    resolved.push(entry);
  }
  return resolved;
}

function reportIncomplete(incomplete: string[]): void {
  if (incomplete.length > 0) {
    console.log(chalk.yellow(`  ${incomplete.length} registry entr(ies) skipped — missing slug or url: ${incomplete.join(", ")}`));
  }
}

/* ── seed ────────────────────────────────────────────────────────────────────────────────── */

async function runSeed(options: ConsentScanOptions): Promise<void> {
  const result = await seedRegistry({ includeRepos: options.fromRepos });
  if (result.added.length === 0) {
    console.log(chalk.gray(`No new sites to add — ${registryPath()} already covers every local store.`));
  } else {
    console.log(chalk.green(`Added ${result.added.length} site(s) to ${registryPath()}:`));
    for (const s of result.added) console.log(chalk.gray(`  ${s.slug}  ${s.url}`));
  }
  if (result.paused.length > 0) {
    console.log(
      chalk.yellow(`\n${result.paused.length} seeded as paused — *.myshopify.com is a staging host, not the storefront:`),
    );
    console.log(chalk.gray(`  ${result.paused.join(", ")}`));
    console.log(chalk.gray(`  Replace the url with the production domain and set status: active to include them.`));
  }
  if (result.unresolvedRepos.length > 0) {
    console.log(
      chalk.yellow(`\n${result.unresolvedRepos.length} repo(s) have no production URL on record and were not added:`),
    );
    console.log(chalk.gray(`  ${result.unresolvedRepos.slice(0, 40).join(", ")}${result.unresolvedRepos.length > 40 ? " …" : ""}`));
    console.log(chalk.gray(`\n  A theme repo almost never contains its own live domain, so these can't be derived.`));
    console.log(chalk.gray(`  Add the ones that are live clients to sites.yml by hand — that one pass is the whole setup cost.`));
  }
  console.log(chalk.gray(`\n${result.total} site(s) in the registry. Review it, then run \`${cliInvocation()} consent-scan\`.`));
}

/* ── inventory ───────────────────────────────────────────────────────────────────────────── */

async function runInventory(sites: ConsentSiteEntry[], options: ConsentScanOptions): Promise<void> {
  console.log(chalk.bold(`\nCMP inventory — ${sites.length} site(s)\n`));
  const results = await mapWithConcurrency(sites, options.concurrency ?? 4, async (site) => {
    const res = await runCmpInventory(normalizeAuditUrl(site.url), site.cmp);
    const label = res.error ? chalk.red(`unreachable — ${res.error}`) : res.cmp === "none" ? chalk.red("none detected") : chalk.green(res.cmpLabel);
    const banner = res.error ? "" : res.bannerVisible ? chalk.gray("  banner ✓") : chalk.yellow("  no banner");
    console.log(`  ${site.slug.padEnd(28)} ${label}${banner}`);
    return { site, res };
  });

  const none = results.filter((r) => !r.res.error && r.res.cmp === "none");
  console.log("");
  if (none.length > 0) {
    console.log(chalk.red(`${none.length} site(s) with no CMP at all: ${none.map((r) => r.site.slug).join(", ")}`));
  } else {
    console.log(chalk.green("Every reachable site has a consent-management platform."));
  }
  console.log(chalk.gray(`\nInventory is presence only — run without --inventory to test whether consent actually works.`));
}

/* ── rows & output ───────────────────────────────────────────────────────────────────────── */

function toRow(site: ConsentSiteEntry, section: ConsentSection, durationMs: number): ConsentFleetRow {
  const failed = section.tests.filter((t) => t.status === "fail" || t.status === "flaky");
  const everythingBlocked = section.totals.pass === 0 && section.totals.fail === 0;
  const status: ConsentFleetStatus = everythingBlocked ? "blocked" : failed.length > 0 ? "issues" : "ok";
  return {
    slug: site.slug,
    client: site.client ?? site.slug,
    url: site.url,
    cmp: section.cmp,
    status,
    score: section.score,
    totals: section.totals,
    failedIds: failed.map((t) => t.id),
    failedTests: failed,
    tests: section.tests.map((t) =>
      t.status === "fail" || t.status === "flaky" ? t : { ...t, evidence: undefined },
    ),
    durationMs,
  };
}

function errorRow(site: ConsentSiteEntry, error: string, durationMs: number): ConsentFleetRow {
  return {
    slug: site.slug,
    client: site.client ?? site.slug,
    url: site.url,
    cmp: "none",
    status: "error",
    score: 0,
    totals: { pass: 0, fail: 0, blocked: 0, skipped: 0, flaky: 0, blockers: 0 },
    failedIds: [],
    failedTests: [],
    tests: [],
    error,
    durationMs,
  };
}

function printSiteLine(site: ConsentSiteEntry, section: ConsentSection): void {
  const t = section.totals;
  const blockers = t.blockers > 0 ? chalk.red(`${t.blockers} blocker`) : null;
  const fails = t.fail > 0 ? chalk.yellow(`${t.fail} fail`) : null;
  const parts = [blockers, fails, chalk.green(`${t.pass} pass`), t.blocked ? chalk.gray(`${t.blocked} blocked`) : null]
    .filter(Boolean)
    .join(chalk.gray(" · "));
  const mark = t.blockers > 0 ? chalk.red("✗") : t.fail > 0 ? chalk.yellow("!") : chalk.green("✓");
  console.log(`  ${mark} ${chalk.bold(site.slug.padEnd(26))} ${chalk.gray(section.cmp.padEnd(15))} ${parts}`);
}

function printSummary(report: ConsentFleetReport): void {
  const { totals } = report;
  console.log(chalk.bold(`\n${"─".repeat(64)}`));
  console.log(
    `  ${chalk.green(`${totals.ok} clean`)} · ${chalk.yellow(`${totals.issues} with issues`)} · ` +
      `${chalk.gray(`${totals.blocked} blocked`)} · ${chalk.red(`${totals.errored} unreachable`)}` +
      chalk.gray(`   (${Math.round(report.durationMs / 1000)}s)`),
  );

  const worst = report.rows.filter((r) => r.totals.blockers > 0).sort((a, b) => b.totals.blockers - a.totals.blockers);
  if (worst.length > 0) {
    console.log(chalk.red(`\n  Blocker-severity failures — consent is not working on these sites:`));
    for (const r of worst) {
      console.log(`    ${chalk.bold(r.slug)}  ${chalk.gray(r.url)}`);
      console.log(chalk.gray(`      failed: ${r.failedIds.join(", ")}`));
    }
  }
  console.log("");
}

/* ── publishing ──────────────────────────────────────────────────────────────────────────── */

async function publish(report: ConsentFleetReport): Promise<void> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.log(chalk.gray("  BLOB_READ_WRITE_TOKEN not set — results not published to the dashboard."));
    return;
  }
  try {
    await writeBlobJson(consentFleetBlobPath(report.id), report);
    const index = (await readBlobJson<{ scans: Array<Record<string, unknown>> }>(CONSENT_INDEX_BLOB_PATH)) ?? { scans: [] };
    index.scans = [
      { id: report.id, createdAt: report.createdAt, region: report.region, totals: report.totals },
      ...index.scans.filter((s) => s.id !== report.id),
    ].slice(0, 200);
    await writeBlobJson(CONSENT_INDEX_BLOB_PATH, index);
    console.log(chalk.gray(`  Published — /consent on the report dashboard.`));
  } catch (err: any) {
    console.log(chalk.yellow(`  Could not publish results: ${String(err?.message ?? err).slice(0, 120)}`));
  }
}

/* ── JUnit ───────────────────────────────────────────────────────────────────────────────── */

function xmlEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** JUnit XML so a scan can gate a PR later without any rework — every CI system reads it. */
function toJUnit(report: ConsentFleetReport): string {
  const suites = report.rows
    .map((row) => {
      const cases = row.failedIds.length
        ? row.failedIds
            .map(
              (id) =>
                `    <testcase classname="${xmlEscape(row.slug)}" name="${xmlEscape(id)}">\n` +
                `      <failure message="${xmlEscape(`${id} failed`)}"/>\n    </testcase>`,
            )
            .join("\n")
        : `    <testcase classname="${xmlEscape(row.slug)}" name="consent"/>`;
      return (
        `  <testsuite name="${xmlEscape(row.slug)}" tests="${Math.max(row.failedIds.length, 1)}" ` +
        `failures="${row.failedIds.length}" errors="${row.status === "error" ? 1 : 0}">\n${cases}\n  </testsuite>`
      );
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites name="consent-qa" time="${report.durationMs / 1000}">\n${suites}\n</testsuites>\n`;
}

/* ── concurrency ─────────────────────────────────────────────────────────────────────────── */

/** Each worker drives its own headless Chrome through five browser contexts, so this cap is
 * about local CPU and memory, not a third-party quota. Four is comfortable on a laptop. */
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}
