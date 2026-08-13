import * as chromeLauncher from "chrome-launcher";
import type {
  AgenticBrowsingSection,
  ConsoleErrorItem,
  CoreWebVitals,
  HealthCheckItem,
  LighthouseAudit,
  LighthouseCategoryResult,
  LighthouseDevice,
  LighthousePageResult,
  PerformanceSection,
  VitalMetric,
} from "@barrel/site-audit-shared";
import { discoverJourneyPages } from "./journey.js";

const MAX_CONSOLE_ERRORS = 20;

function extractConsoleErrors(lhr: any): ConsoleErrorItem[] {
  const items = lhr.audits?.["errors-in-console"]?.details?.items ?? [];
  return items.slice(0, MAX_CONSOLE_ERRORS).map((item: any) => ({
    source: item.source ?? "other",
    description: item.description,
    url: item.sourceLocation?.url,
    line: item.sourceLocation?.line,
  }));
}

function buildCategory(lhr: any, categoryId: string): LighthouseCategoryResult {
  const category = lhr.categories[categoryId];
  const audits: LighthouseAudit[] = (category?.auditRefs ?? [])
    .map((ref: any) => lhr.audits[ref.id])
    .filter((audit: any) => audit && audit.score !== null && audit.score < 1)
    .map((audit: any) => ({
      id: audit.id,
      title: audit.title,
      description: audit.description,
      score: audit.score,
      displayValue: audit.displayValue,
    }))
    .sort((a: LighthouseAudit, b: LighthouseAudit) => (a.score ?? 1) - (b.score ?? 1))
    .slice(0, 15);

  return {
    score: Math.round((category?.score ?? 0) * 100),
    audits,
  };
}

function categoryScore(lhr: any, categoryId: string): number {
  return Math.round((lhr.categories?.[categoryId]?.score ?? 0) * 100);
}

function vitalMetric(lhr: any, auditId: string): VitalMetric | undefined {
  const audit = lhr.audits?.[auditId];
  if (!audit || !audit.displayValue) return undefined;
  return { displayValue: audit.displayValue, score: audit.score ?? null };
}

function buildVitals(lhr: any): CoreWebVitals {
  return {
    lcp: vitalMetric(lhr, "largest-contentful-paint"),
    cls: vitalMetric(lhr, "cumulative-layout-shift"),
    tbt: vitalMetric(lhr, "total-blocking-time"),
    fcp: vitalMetric(lhr, "first-contentful-paint"),
    speedIndex: vitalMetric(lhr, "speed-index"),
  };
}

/** Lighthouse's "Agentic Browsing" category (ships by default from v13.3+) scores as a
 * pass/total fraction, not 0-100 — it counts applicable audits itself (WebMCP's 3 sub-checks
 * collapse out entirely via scoreDisplayMode "notApplicable" on sites with no WebMCP
 * integration), so we mirror that rather than assume a fixed audit count. */
function buildAgenticBrowsing(lhr: any): AgenticBrowsingSection | undefined {
  const category = lhr.categories?.["agentic-browsing"];
  if (!category) return undefined;

  const checks: HealthCheckItem[] = (category.auditRefs ?? [])
    .map((ref: any) => lhr.audits[ref.id])
    .filter((audit: any) => audit && audit.scoreDisplayMode !== "notApplicable")
    .map((audit: any) => ({
      id: audit.id,
      label: audit.title,
      status: audit.score === 1 ? "pass" : "fail",
      detail: audit.description,
    }));

  return { passed: checks.filter((c) => c.status === "pass").length, total: checks.length, checks };
}

async function runLighthouse(port: number, url: string, device: LighthouseDevice) {
  const lighthouse = (await import("lighthouse")).default;
  const result = await lighthouse(url, {
    port,
    output: "json",
    logLevel: "error",
    onlyCategories: ["performance", "accessibility", "best-practices", "seo", "agentic-browsing"],
    formFactor: device,
    screenEmulation:
      device === "mobile"
        ? { mobile: true, width: 412, height: 823, deviceScaleFactor: 2.625, disabled: false }
        : { mobile: false, width: 1350, height: 940, deviceScaleFactor: 1, disabled: false },
    // Explicit, not just relying on Lighthouse's own default: every run gets its cache/cookies/
    // storage wiped immediately beforehand, so results reflect a first-time visitor rather than
    // whatever the previous page in this loop (or a prior run) left behind.
    disableStorageReset: false,
  });
  return result?.lhr;
}

export interface PerformanceHooks {
  onStage?: (stage: string) => void;
}

export async function analyzePerformance(url: string, hooks: PerformanceHooks = {}): Promise<PerformanceSection> {
  // --incognito on top of chrome-launcher's own fresh temp user-data-dir (created per launch,
  // deleted on kill — see chrome-launcher's makeTmpDir): belt-and-suspenders isolation so no
  // signed-in session, extension, or cached asset from outside this run can leak into the data.
  const chrome = await chromeLauncher.launch({
    chromeFlags: ["--headless=new", "--incognito", "--no-sandbox", "--disable-gpu"],
  });

  try {
    const journeyPages = await discoverJourneyPages(url);
    const pages: LighthousePageResult[] = [];
    let homeMobileLhr: any = null;

    for (const { page, url: pageUrl } of journeyPages) {
      for (const device of ["mobile", "desktop"] as const) {
        hooks.onStage?.(`Lighthouse: ${page} (${device})`);
        try {
          const lhr = await runLighthouse(chrome.port, pageUrl, device);
          if (!lhr) continue;
          if (page === "Home" && device === "mobile") homeMobileLhr = lhr;
          pages.push({
            page,
            device,
            url: pageUrl,
            performance: categoryScore(lhr, "performance"),
            accessibility: categoryScore(lhr, "accessibility"),
            bestPractices: categoryScore(lhr, "best-practices"),
            seo: categoryScore(lhr, "seo"),
          });
        } catch {
          // this page/device combo failed (timeout, redirect loop, etc.) — skip and continue
        }
      }
    }

    if (!homeMobileLhr) {
      throw new Error("Lighthouse did not return a result for the homepage (mobile)");
    }

    return {
      fetchedUrl: url,
      finalUrl: homeMobileLhr.finalDisplayedUrl ?? homeMobileLhr.finalUrl ?? url,
      performance: buildCategory(homeMobileLhr, "performance"),
      accessibility: buildCategory(homeMobileLhr, "accessibility"),
      bestPractices: buildCategory(homeMobileLhr, "best-practices"),
      seo: buildCategory(homeMobileLhr, "seo"),
      vitals: buildVitals(homeMobileLhr),
      pages,
      consoleErrors: extractConsoleErrors(homeMobileLhr),
      agenticBrowsing: buildAgenticBrowsing(homeMobileLhr),
    };
  } finally {
    await chrome.kill();
  }
}
