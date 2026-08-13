import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import type { OpportunityImpact, SitespeedAdvice, SitespeedSection } from "@barrel/site-audit-shared";

// sitespeed.io's package.json only exports "./lib/sitespeed.js" (the run() function, not a CLI
// entry) — its actual CLI script at bin/sitespeed.js isn't a resolvable subpath. Resolve the
// exported main entry, then walk up two directories (lib/sitespeed.js -> lib -> package root)
// to find bin/sitespeed.js as a plain filesystem path (require.resolve's exports restriction
// only applies to module resolution, not to spawning a file by path).
const SITESPEED_PKG_ROOT = dirname(dirname(createRequire(import.meta.url).resolve("sitespeed.io")));
const SITESPEED_BIN = join(SITESPEED_PKG_ROOT, "bin", "sitespeed.js");

type CoachCategoryKey = "performance" | "bestpractice" | "privacy";

const CATEGORY_LABELS: Record<CoachCategoryKey, string> = {
  performance: "Performance",
  bestpractice: "Best Practice",
  privacy: "Privacy",
};

const SEVERITY_MAP: Record<string, OpportunityImpact> = {
  error: "high",
  warn: "medium",
  info: "low",
};

interface CoachAdviceItem {
  advice: string;
  description: string;
  score: number;
  severity: string;
  weight: number;
  title: string;
}

interface CoachCategory {
  score: number;
  adviceList: Record<string, CoachAdviceItem>;
}

interface CoachPageSummary {
  advice: {
    score: number;
    performance: CoachCategory;
    bestpractice: CoachCategory;
    privacy: CoachCategory;
  };
}

interface Stat {
  median?: number;
}

function runSitespeed(url: string, outputFolder: string, iterations: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      SITESPEED_BIN,
      url,
      "-n",
      String(iterations),
      "--outputFolder",
      outputFolder,
      "--plugins.add",
      "analysisstorer",
      "--plugins.remove",
      "screenshot",
      "--visualMetrics",
      "false",
      "--browsertime.headless",
      "true",
      "--browsertime.chrome.args",
      "no-sandbox",
    ];
    const child = spawn(process.execPath, args, { stdio: "ignore" });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`sitespeed.io exited with code ${code}`))));
    child.on("error", reject);
  });
}

/** Runs sitespeed.io (Browsertime + its Coach plugin) against a single URL as a second,
 * independent performance signal alongside Lighthouse — different methodology (median across
 * N real-browser iterations, Coach's own performance/best-practice/privacy rule set) surfaces
 * different issues than a single synthetic Lighthouse trace. This spawns a separate CLI
 * subprocess with its own browser automation, so it's noticeably heavier/slower than the rest
 * of the suite — opt-in via `--sitespeed` rather than on by default. Returns null (never
 * throws) on any failure (missing Chrome, network issues, unexpected output shape). */
export async function analyzeSitespeed(url: string, iterations = 3): Promise<SitespeedSection | null> {
  const outputFolder = mkdtempSync(join(tmpdir(), "barrel-sitespeed-"));

  try {
    await runSitespeed(url, outputFolder, iterations);

    const pagesDir = join(outputFolder, "pages");
    const [pageSlug] = readdirSync(pagesDir);
    if (!pageSlug) return null;
    const dataDir = join(pagesDir, pageSlug, "data");

    const coach = JSON.parse(readFileSync(join(dataDir, "coach.pageSummary.json"), "utf-8")) as CoachPageSummary;
    const browsertime = JSON.parse(readFileSync(join(dataDir, "browsertime.pageSummary.json"), "utf-8"));
    const pagexray = JSON.parse(readFileSync(join(dataDir, "pagexray.pageSummary.json"), "utf-8"));

    const gwv: Record<string, Stat> = browsertime?.statistics?.googleWebVitals ?? {};
    const pageTimings: Record<string, Stat> = browsertime?.statistics?.timings?.pageTimings ?? {};

    const metrics: SitespeedSection["metrics"] = [];
    const pushMetric = (label: string, stat: Stat | undefined, unit: string) => {
      if (stat?.median !== undefined) metrics.push({ label, value: Math.round(stat.median), unit });
    };
    pushMetric("Time to First Byte", gwv.ttfb, "ms");
    pushMetric("First Contentful Paint", gwv.firstContentfulPaint, "ms");
    pushMetric("Largest Contentful Paint", gwv.largestContentfulPaint, "ms");
    pushMetric("Total Blocking Time", gwv.totalBlockingTime, "ms");
    pushMetric("Cumulative Layout Shift", gwv.cumulativeLayoutShift, "");
    pushMetric("Page Load Time", pageTimings.pageLoadTime, "ms");
    if (typeof pagexray.requests === "number") metrics.push({ label: "Requests", value: pagexray.requests, unit: "" });
    if (typeof pagexray.transferSize === "number") {
      metrics.push({ label: "Page Weight", value: Math.round(pagexray.transferSize / 1024), unit: "KB" });
    }

    const categoryKeys = Object.keys(CATEGORY_LABELS) as CoachCategoryKey[];

    const advice: SitespeedAdvice[] = [];
    for (const key of categoryKeys) {
      const category = coach.advice[key];
      if (!category) continue;
      for (const item of Object.values(category.adviceList)) {
        if (item.score >= 100) continue;
        advice.push({
          title: item.title,
          category: CATEGORY_LABELS[key],
          severity: SEVERITY_MAP[item.severity] ?? "low",
          detail: item.description,
          recommendation: item.advice || undefined,
        });
      }
    }
    const severityRank: Record<OpportunityImpact, number> = { high: 0, medium: 1, low: 2 };
    advice.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);

    if (metrics.length === 0 && advice.length === 0) return null;

    return {
      score: coach.advice.score,
      categoryScores: categoryKeys.map((key) => ({
        category: CATEGORY_LABELS[key],
        score: coach.advice[key]?.score ?? 0,
      })),
      metrics,
      runs: iterations,
      advice: advice.slice(0, 15),
    };
  } catch {
    return null;
  } finally {
    rmSync(outputFolder, { recursive: true, force: true });
  }
}
