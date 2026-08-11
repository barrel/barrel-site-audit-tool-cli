import * as chromeLauncher from "chrome-launcher";
import type {
  CoreWebVitals,
  LighthouseAudit,
  LighthouseCategoryResult,
  LighthouseDevice,
  LighthousePageResult,
  PerformanceSection,
  VitalMetric,
} from "@barrel/site-audit-shared";
import { discoverJourneyPages } from "./journey.js";

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

async function runLighthouse(port: number, url: string, device: LighthouseDevice) {
  const lighthouse = (await import("lighthouse")).default;
  const result = await lighthouse(url, {
    port,
    output: "json",
    logLevel: "error",
    onlyCategories: ["performance", "accessibility", "best-practices", "seo"],
    formFactor: device,
    screenEmulation:
      device === "mobile"
        ? { mobile: true, width: 412, height: 823, deviceScaleFactor: 2.625, disabled: false }
        : { mobile: false, width: 1350, height: 940, deviceScaleFactor: 1, disabled: false },
  });
  return result?.lhr;
}

export interface PerformanceHooks {
  onStage?: (stage: string) => void;
}

export async function analyzePerformance(url: string, hooks: PerformanceHooks = {}): Promise<PerformanceSection> {
  const chrome = await chromeLauncher.launch({
    chromeFlags: ["--headless=new", "--no-sandbox", "--disable-gpu"],
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
    };
  } finally {
    await chrome.kill();
  }
}
