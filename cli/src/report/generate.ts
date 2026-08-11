import { nanoid } from "nanoid";
import { average, reportBlobPath, type AiUsage, type Report, type StoreConfig } from "@barrel/site-audit-shared";
import { analyzeCode, themeDirHasContent } from "../analyzers/code.js";
import { analyzePerformance } from "../analyzers/performance.js";
import { analyzeAccessibility } from "../analyzers/accessibility.js";
import { analyzeHealth } from "../analyzers/health.js";
import { analyzePixels } from "../analyzers/pixels.js";
import { analyzeThemeStructure } from "../analyzers/theme-structure.js";
import { analyzeAnalytics } from "../analyzers/analytics.js";
import { analyzeCompetitor } from "../analyzers/competitors.js";
import { captureScreenshot } from "../analyzers/screenshot.js";
import { analyzeGeoSeo } from "../analyzers/geo-seo.js";
import { analyzeUx } from "../analyzers/ux.js";
import { deriveBestPractices } from "../analyzers/best-practices.js";
import { generateAiSuggestions } from "../analyzers/ai-suggestions.js";
import { generateSummary } from "../analyzers/summary.js";
import { storeThemeDir } from "../paths.js";
import { writeBlobJson, writeBlobBinary } from "../blob.js";
import { appendToManifest } from "./manifest.js";

export interface RunOptions {
  skipCode?: boolean;
  skipPerformance?: boolean;
  skipAxe?: boolean;
  skipHealth?: boolean;
  skipPixels?: boolean;
  skipAnalytics?: boolean;
  skipSummary?: boolean;
  skipScreenshots?: boolean;
  skipGeoSeo?: boolean;
  skipUx?: boolean;
  skipAiSuggestions?: boolean;
  competitorUrls?: string[];
}

function addUsage(a: AiUsage | undefined, b: AiUsage | undefined): AiUsage | undefined {
  if (!a) return b;
  if (!b) return a;
  const inputTokens = a.inputTokens + b.inputTokens;
  const outputTokens = a.outputTokens + b.outputTokens;
  return {
    model: a.model,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    estimatedCostUsd: a.estimatedCostUsd + b.estimatedCostUsd,
  };
}

function slugifyForPath(value: string): string {
  return value
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Each competitor runs a full headless-Chrome Lighthouse pass + a Puppeteer screenshot —
// real local CPU/memory cost, not a third-party quota. Capped so a long --competitor list
// can't turn one `run` into an unbounded resource hog; excess URLs are dropped, not silently
// truncated (logged via onStage so it shows up in the CLI's live status line).
const MAX_COMPETITORS = 5;

export interface RunHooks {
  onStage?: (stage: string) => void;
}

export async function runAudit(store: StoreConfig, options: RunOptions, hooks: RunHooks = {}): Promise<Report> {
  const start = Date.now();
  const id = `${new Date().toISOString().replace(/[:.]/g, "-")}-${nanoid(6)}`;

  const sections: Report["sections"] = {};
  const themeDir = storeThemeDir(store.slug);
  const hasTheme = themeDirHasContent(themeDir);

  if (!options.skipCode) {
    if (hasTheme) {
      hooks.onStage?.("Linting theme code (theme-check)");
      sections.code = (await analyzeCode(themeDir)) ?? undefined;
      hooks.onStage?.("Analyzing theme structure (orphaned files, page-builder apps)");
      sections.themeStructure = (await analyzeThemeStructure(themeDir)) ?? undefined;
    } else {
      hooks.onStage?.(`No theme code found at stores/${store.slug}/theme — skipping code analysis`);
    }
  }

  if (!options.skipPerformance) {
    hooks.onStage?.("Discovering journey pages (Home/Collection/Product/Cart)");
    sections.performance = await analyzePerformance(store.url, { onStage: hooks.onStage });
  }

  if (!options.skipAxe) {
    hooks.onStage?.("Scanning for accessibility violations (axe-core)");
    sections.accessibility = (await analyzeAccessibility(store.url)) ?? undefined;
  }

  if (!options.skipScreenshots && sections.performance) {
    hooks.onStage?.("Capturing homepage screenshot");
    const screenshot = await captureScreenshot(store.url).catch(() => null);
    if (screenshot) {
      const path = await writeBlobBinary(`screenshots/${store.slug}/${id}/home.jpg`, screenshot, "image/jpeg");
      if (path) sections.performance.screenshotPath = path;
    }
  }

  if (!options.skipHealth) {
    hooks.onStage?.("Running storefront health checks");
    sections.health = await analyzeHealth(store.url);
  }

  if (!options.skipPixels) {
    hooks.onStage?.("Auditing marketing pixels & consent (live browser)");
    sections.pixels = await analyzePixels(store.url);
  }

  if (!options.skipGeoSeo) {
    hooks.onStage?.("Auditing SEO opportunities & AI/agentic-commerce readiness (GEO)");
    sections.geoSeo = (await analyzeGeoSeo(store.url)) ?? undefined;
  }

  let aiUsage: AiUsage | undefined;

  if (!options.skipUx) {
    hooks.onStage?.("Auditing UX & conversion (one collection page + one product page, throttled)");
    const uxResult = await analyzeUx(store.url).catch(() => null);
    if (uxResult) {
      if (!options.skipScreenshots) {
        if (uxResult.screenshots.collection) {
          const path = await writeBlobBinary(
            `screenshots/${store.slug}/${id}/ux-collection.jpg`,
            uxResult.screenshots.collection,
            "image/jpeg",
          );
          if (path && uxResult.section.collectionPage) uxResult.section.collectionPage.screenshotPath = path;
        }
        if (uxResult.screenshots.product) {
          const path = await writeBlobBinary(
            `screenshots/${store.slug}/${id}/ux-product.jpg`,
            uxResult.screenshots.product,
            "image/jpeg",
          );
          if (path && uxResult.section.productPage) uxResult.section.productPage.screenshotPath = path;
        }
      }
      sections.ux = uxResult.section;
      aiUsage = addUsage(aiUsage, uxResult.usage);
    }
  }

  if (!options.skipAnalytics && store.ga4PropertyId) {
    hooks.onStage?.("Pulling traffic & revenue from Google Analytics");
    sections.analytics = (await analyzeAnalytics(store.ga4PropertyId)) ?? undefined;
  }

  if (options.competitorUrls?.length) {
    const competitorUrls = options.competitorUrls.slice(0, MAX_COMPETITORS);
    if (options.competitorUrls.length > MAX_COMPETITORS) {
      hooks.onStage?.(
        `Only benchmarking the first ${MAX_COMPETITORS} competitors (${options.competitorUrls.length - MAX_COMPETITORS} dropped) — each one runs a full Lighthouse + screenshot pass`,
      );
    }

    const competitors = [];
    for (const competitorUrl of competitorUrls) {
      hooks.onStage?.(`Benchmarking competitor: ${competitorUrl}`);
      const result = await analyzeCompetitor(competitorUrl).catch(() => null);
      if (!result) continue;

      if (!options.skipScreenshots) {
        hooks.onStage?.(`Capturing competitor screenshot: ${competitorUrl}`);
        const screenshot = await captureScreenshot(competitorUrl).catch(() => null);
        if (screenshot) {
          const path = await writeBlobBinary(
            `screenshots/${store.slug}/${id}/competitor-${slugifyForPath(result.name)}.jpg`,
            screenshot,
            "image/jpeg",
          );
          if (path) result.screenshotPath = path;
        }
      }

      competitors.push(result);
    }
    if (competitors.length > 0) sections.competitors = { competitors };
  }

  sections.bestPractices =
    deriveBestPractices({
      code: sections.code,
      performance: sections.performance,
      themeStructure: sections.themeStructure,
      themeDir: hasTheme ? themeDir : undefined,
    }) ?? undefined;

  const scores: number[] = [];
  if (sections.code) scores.push(sections.code.score);
  if (sections.themeStructure) scores.push(sections.themeStructure.score);
  if (sections.performance) {
    scores.push(
      sections.performance.performance.score,
      sections.performance.accessibility.score,
      sections.performance.bestPractices.score,
      sections.performance.seo.score,
    );
  }
  if (sections.accessibility) scores.push(sections.accessibility.score);
  if (sections.health) scores.push(sections.health.score);
  if (sections.pixels) scores.push(sections.pixels.score);
  if (sections.geoSeo) scores.push(sections.geoSeo.healthRating);
  if (sections.ux) scores.push(sections.ux.score);

  const overallScore = average(scores);

  const report: Report = {
    id,
    storeSlug: store.slug,
    storeName: store.name,
    storeUrl: store.url,
    createdAt: new Date().toISOString(),
    durationMs: Date.now() - start,
    overallScore,
    sections,
  };

  if (!options.skipAiSuggestions) {
    hooks.onStage?.("Generating AI performance & accessibility suggestions (Claude)");
    const aiSuggestionsResult = await generateAiSuggestions(sections.performance, hasTheme ? themeDir : undefined).catch(
      () => null,
    );
    if (aiSuggestionsResult) {
      report.sections.aiSuggestions = aiSuggestionsResult.section;
      aiUsage = addUsage(aiUsage, aiSuggestionsResult.usage);
    }
  }

  if (!options.skipSummary) {
    hooks.onStage?.("Writing executive summary (Claude)");
    const result = await generateSummary(report).catch(() => null);
    if (result) {
      report.sections.summary = result.summary;
      aiUsage = addUsage(aiUsage, result.usage);
    } else if (!process.env.ANTHROPIC_API_KEY) {
      hooks.onStage?.("ANTHROPIC_API_KEY not set — skipping executive summary");
    }
  }

  report.aiUsage = aiUsage;

  hooks.onStage?.("Uploading report to Vercel Blob");
  await writeBlobJson(reportBlobPath(store.slug, id), report);

  await appendToManifest({
    id,
    storeSlug: store.slug,
    storeName: store.name,
    storeUrl: store.url,
    createdAt: report.createdAt,
    overallScore,
  });

  return report;
}
