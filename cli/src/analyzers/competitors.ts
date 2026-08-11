import * as chromeLauncher from "chrome-launcher";
import type { CompetitorResult, CoreWebVitals, VitalMetric } from "@barrel/site-audit-shared";
import { analyzeHealth } from "./health.js";

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

/** A lightweight single-page (homepage, mobile) Lighthouse pass + health check for a competitor
 * URL — enough for a side-by-side comparison without the cost of the client's full multi-page,
 * multi-device sweep. Returns null (never throws) so one bad competitor URL doesn't fail the report. */
export async function analyzeCompetitor(url: string): Promise<CompetitorResult | null> {
  const chrome = await chromeLauncher.launch({
    chromeFlags: ["--headless=new", "--no-sandbox", "--disable-gpu"],
  });

  try {
    const lighthouse = (await import("lighthouse")).default;
    const [lhResult, health] = await Promise.all([
      lighthouse(url, {
        port: chrome.port,
        output: "json",
        logLevel: "error",
        onlyCategories: ["performance", "accessibility", "best-practices", "seo"],
        formFactor: "mobile",
        screenEmulation: { mobile: true, width: 412, height: 823, deviceScaleFactor: 2.625, disabled: false },
      }),
      analyzeHealth(url).catch(() => null),
    ]);

    const lhr = lhResult?.lhr;
    if (!lhr) return null;

    return {
      name: new URL(url).hostname.replace(/^www\./, ""),
      url,
      performance: categoryScore(lhr, "performance"),
      accessibility: categoryScore(lhr, "accessibility"),
      bestPractices: categoryScore(lhr, "best-practices"),
      seo: categoryScore(lhr, "seo"),
      healthScore: health?.score ?? 0,
      vitals: buildVitals(lhr),
    };
  } catch {
    return null;
  } finally {
    await chrome.kill();
  }
}
