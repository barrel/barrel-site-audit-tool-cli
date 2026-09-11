import { nanoid } from "nanoid";
import { average, consentScreenshotBlobPath, reportBlobPath, type AiUsage, type Report, type StoreConfig } from "@barrel/site-audit-shared";
import { analyzeCode, themeDirHasContent } from "../analyzers/code.js";
import { analyzePerformance } from "../analyzers/performance.js";
import { analyzeAccessibility } from "../analyzers/accessibility.js";
import { analyzeAdaScope } from "../analyzers/ada-scope.js";
import { analyzeSitespeed } from "../analyzers/sitespeed.js";
import { generateThemeArchitecture } from "../analyzers/theme-architecture.js";
import { analyzeHealth } from "../analyzers/health.js";
import { analyzePixels } from "../analyzers/pixels.js";
import { analyzeConsent } from "../analyzers/consent/index.js";
import { analyzeSecurity } from "../analyzers/security.js";
import { analyzeThemeStructure } from "../analyzers/theme-structure.js";
import { analyzeThemeProfile } from "../analyzers/theme-profile.js";
import { analyzeAnalytics } from "../analyzers/analytics.js";
import { analyzeCompetitor } from "../analyzers/competitors.js";
import { captureScreenshot } from "../analyzers/screenshot.js";
import { analyzeGeoSeo } from "../analyzers/geo-seo.js";
import { analyzeAgentReadiness } from "../analyzers/agent-readiness.js";
import { analyzeUx } from "../analyzers/ux.js";
import { deriveBestPractices } from "../analyzers/best-practices.js";
import { generateAiSuggestions } from "../analyzers/ai-suggestions.js";
import { generateSummary } from "../analyzers/summary.js";
import { generateRecommendations } from "../analyzers/recommendations.js";
import { resolveThemeDir } from "../store.js";
import { writeBlobJson, writeBlobBinary } from "../blob.js";
import { normalizeAuditUrl } from "../url.js";
import { appendToManifest } from "./manifest.js";
import { finishRunRecord, runnerInfo, startRunRecord, updateRunStage } from "./run-record.js";
import { createCoverageTracker, SLOW_ANALYZER_TIMEOUT_MS } from "./coverage.js";

export interface RunOptions {
  skipCode?: boolean;
  skipPerformance?: boolean;
  skipAxe?: boolean;
  skipThemeArchitecture?: boolean;
  skipHealth?: boolean;
  skipPixels?: boolean;
  /** Skip the behavioural consent QA suite. It drives the banner through five browser states,
   * so it costs about a minute or two on top of the rest of the run. */
  skipConsent?: boolean;
  /** Skip the Security & Compliance section. Cheap to run (HTTP requests and one TLS handshake,
   * no browser), so there is rarely a reason to — the flag exists for parity and for runs against
   * a host that rate-limits the extra probe requests. */
  skipSecurity?: boolean;
  skipAnalytics?: boolean;
  skipSummary?: boolean;
  skipScreenshots?: boolean;
  skipGeoSeo?: boolean;
  skipAgentReadiness?: boolean;
  skipUx?: boolean;
  skipAiSuggestions?: boolean;
  /** Skip the client-ready Recommendations tab. It runs last and synthesizes every other section,
   * so skipping it costs one Claude call and nothing else. */
  skipRecommendations?: boolean;
  competitorUrls?: string[];
  /** The client's ADA scope, pasted verbatim. Present = run the ADA Scope Checker, verifying each
   * scoped line against this run's axe-core, Lighthouse and live keyboard/focus results. */
  adaScope?: string;
  /** Opt-in: also run sitespeed.io (Browsertime + Coach) as a second, independent performance
   * signal. Off by default — it's a separate heavy CLI subprocess with its own browser
   * automation, noticeably slower than the rest of the suite. */
  sitespeed?: boolean;
  /** Where to read theme code from, when the caller has already resolved (and possibly fetched)
   * it. Set by `run` for a store whose GitHub connection is in `"read"` mode: the code lives in a
   * temp directory that only exists for the length of the run, so resolveThemeDir()'s answer —
   * stores/<slug>/theme/, which is deliberately empty for such a store — would be wrong.
   * Omitted everywhere else, and resolveThemeDir() stays the default. */
  themeDir?: string;
  /** Write the finished report to this local path and publish nothing: no report blob, no
   * manifest entry, no run record. For measuring the tool against itself — comparing what two
   * different machines produce for the same storefront — where appending to a client's real
   * report history would corrupt the very baseline the comparison is about. */
  outputPath?: string;
}

// Real-browser iterations sitespeed.io runs per audit when --sitespeed is passed — enough for
// a stable median without turning an opt-in extra into a multi-minute detour on its own.
const SITESPEED_RUNS = 3;

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

export async function runAudit(store: StoreConfig, options: RunOptions, callerHooks: RunHooks = {}): Promise<Report> {
  const start = Date.now();
  const id = `${new Date().toISOString().replace(/[:.]/g, "-")}-${nanoid(6)}`;

  // Every stage line goes to the run record as well as to whoever asked for it (the spinner, or
  // the "→ stage" lines a piped caller reads). No-op unless BARREL_RUN_ID is set.
  await startRunRecord(store, store.url);
  const hooks: RunHooks = {
    onStage: (stage) => {
      updateRunStage(stage);
      callerHooks.onStage?.(stage);
    },
  };

  const sections: Report["sections"] = {};
  // Written for every section, including the ones that never run — see SectionStatus. Nothing in
  // here changes what an analyzer does; it records what became of it, which is the difference
  // between a report that found nothing and a report that did not look.
  const track = createCoverageTracker();
  const themeDir = options.themeDir ?? resolveThemeDir(store);
  const hasTheme = themeDirHasContent(themeDir);
  let aiUsage: AiUsage | undefined;
  // Every analyzer below fetches/renders this instead of store.url directly — store.url (used
  // for storeUrl below and in the manifest) stays exactly what was configured.
  const auditUrl = normalizeAuditUrl(store.url);

  const THEME_SECTIONS = ["code", "themeStructure", "themeProfile", "themeArchitecture"] as const;
  if (options.skipCode) {
    for (const key of THEME_SECTIONS) track.skipped(key, "--skip-code was passed.");
  } else if (!hasTheme) {
    hooks.onStage?.(`No theme code found at stores/${store.slug}/theme — skipping code analysis`);
    for (const key of THEME_SECTIONS) {
      track.notApplicable(key, "No theme code was available to this run, so nothing could be read.");
    }
  } else {
    hooks.onStage?.("Linting theme code (theme-check)");
    sections.code = await track.run("code", () => analyzeCode(themeDir));
    hooks.onStage?.("Analyzing theme structure (orphaned files, page-builder apps)");
    sections.themeStructure = await track.run("themeStructure", () => analyzeThemeStructure(themeDir));
    hooks.onStage?.("Profiling the theme (identity, stack, codebase opportunities)");
    sections.themeProfile = await track.run("themeProfile", () => analyzeThemeProfile(themeDir));

    if (options.skipThemeArchitecture) {
      track.skipped("themeArchitecture", "--skip-theme-architecture was passed.");
    } else if (!process.env.ANTHROPIC_API_KEY) {
      track.notApplicable("themeArchitecture", "ANTHROPIC_API_KEY is not set, so the AI assessment could not run.");
    } else {
      hooks.onStage?.("Assessing theme architecture & Shopify platform fit (Claude)");
      const themeArchitectureResult = await track.run("themeArchitecture", () =>
        generateThemeArchitecture(themeDir, sections.code, sections.themeStructure, sections.themeProfile),
      );
      if (themeArchitectureResult) {
        sections.themeArchitecture = themeArchitectureResult.section;
        aiUsage = addUsage(aiUsage, themeArchitectureResult.usage);
      }
    }
  }

  if (options.skipPerformance) {
    track.skipped("performance", "--skip-performance was passed.");
  } else {
    hooks.onStage?.("Discovering journey pages (Home/Collection/Product/Cart)");
    // Was the one unguarded analyzer in the run: analyzePerformance throws when the homepage
    // Lighthouse pass returns nothing, which destroyed a twenty-minute audit that had already
    // completed ten other sections. It now costs this section and nothing else.
    sections.performance = await track.run("performance", () => analyzePerformance(auditUrl, { onStage: hooks.onStage }));

    // Each Lighthouse category keeps only its worst failures. Summed across the four so the
    // section carries one honest "showing N of M" rather than four separate silent caps.
    if (sections.performance) {
      const categories = [
        sections.performance.performance,
        sections.performance.accessibility,
        sections.performance.bestPractices,
        sections.performance.seo,
      ];
      const kept = categories.reduce((sum, c) => sum + c.audits.length, 0);
      const found = categories.reduce((sum, c) => sum + (c.failingAudits ?? c.audits.length), 0);
      if (found > kept) track.truncated("performance", { kept, found, what: "failing Lighthouse audits" });
    }
  }

  if (options.skipAxe) {
    track.skipped("accessibility", "--skip-axe was passed.");
  } else {
    hooks.onStage?.("Scanning for accessibility violations (axe-core)");
    sections.accessibility = await track.run("accessibility", () => analyzeAccessibility(auditUrl));
  }

  // After both Lighthouse and axe, since it verifies the client's scope against whatever those
  // two actually measured (plus its own live keyboard/focus probe). Deliberately absent from the
  // `scores` list below: it measures delivery against one client's contract, not site quality.
  if (!options.adaScope?.trim()) {
    track.notApplicable("adaScope", "No ADA scope was given for this store, so there was nothing to verify against.");
  } else {
    hooks.onStage?.("Checking the client's ADA scope against axe-core, Lighthouse & a live keyboard probe");
    const adaScopeResult = await track.run("adaScope", () =>
      analyzeAdaScope(
        options.adaScope!,
        { auditUrl, accessibility: sections.accessibility, performance: sections.performance },
        { onStage: hooks.onStage },
      ),
    );
    if (adaScopeResult) {
      sections.adaScope = adaScopeResult.section;
      aiUsage = addUsage(aiUsage, adaScopeResult.usage);
    }
  }

  if (!options.sitespeed) {
    track.skipped("sitespeed", "sitespeed.io is opt-in and --sitespeed was not passed.");
  } else {
    hooks.onStage?.(`Running sitespeed.io (${SITESPEED_RUNS} real-browser iterations, this is slow)`);
    sections.sitespeed = await track.run("sitespeed", () => analyzeSitespeed(auditUrl, SITESPEED_RUNS), {
      timeoutMs: SLOW_ANALYZER_TIMEOUT_MS,
    });
  }

  if (!options.skipScreenshots && sections.performance) {
    hooks.onStage?.("Capturing homepage screenshot");
    const screenshot = await captureScreenshot(auditUrl).catch(() => null);
    if (screenshot) {
      const path = await writeBlobBinary(`screenshots/${store.slug}/${id}/home.jpg`, screenshot, "image/jpeg");
      if (path) sections.performance.screenshotPath = path;
    }
  }

  if (options.skipHealth) {
    track.skipped("health", "--skip-health was passed.");
  } else {
    hooks.onStage?.("Running storefront health checks");
    sections.health = await track.run("health", () => analyzeHealth(auditUrl));
  }

  if (options.skipPixels) {
    track.skipped("pixels", "--skip-pixels was passed.");
  } else {
    hooks.onStage?.("Detecting marketing pixels (live browser)");
    sections.pixels = await track.run("pixels", () => analyzePixels(auditUrl));
  }

  if (options.skipConsent) {
    track.skipped("consent", "--skip-consent was passed.");
  } else {
    hooks.onStage?.("Privacy Compliance: driving the banner (5 browser states)");
    // Never fatal to the run: a site that bot-walls headless Chrome should still produce a
    // report for every other section rather than losing the lot.
    sections.consent = await track.run("consent", () =>
      analyzeConsent(auditUrl, {
        onStage: hooks.onStage,
        onAiUsage: (usage) => {
          aiUsage = addUsage(aiUsage, usage);
        },
        uploadScreenshot: (state, image) =>
          writeBlobBinary(consentScreenshotBlobPath(store.slug, id, state), image, "image/jpeg"),
      }),
    );
  }

  if (options.skipSecurity) {
    track.skipped("security", "--skip-security was passed.");
  } else {
    hooks.onStage?.("Security & Compliance: headers, transport, cookies, exposed paths, script supply chain");
    // Never fatal to the run, for the same reason as consent: a host that rate-limits or blocks
    // the probe requests should cost this one section, not the whole report.
    sections.security = await track.run("security", () => analyzeSecurity(auditUrl, { onStage: hooks.onStage }));
  }

  if (options.skipGeoSeo) {
    track.skipped("geoSeo", "--skip-geo-seo was passed.");
  } else {
    hooks.onStage?.("Auditing SEO opportunities & AI/agentic-commerce readiness (GEO)");
    sections.geoSeo = await track.run("geoSeo", () => analyzeGeoSeo(auditUrl));
  }

  if (options.skipAgentReadiness) {
    track.skipped("agentReadiness", "--skip-agent-readiness was passed.");
  } else {
    hooks.onStage?.("Auditing agent readiness (per-SKU schema, hydration, policy data, feed drift)");
    sections.agentReadiness = await track.run("agentReadiness", () => analyzeAgentReadiness(auditUrl));
  }

  if (options.skipUx) {
    track.skipped("ux", "--skip-ux was passed.");
  } else {
    hooks.onStage?.("Auditing UX & conversion (one collection page + one product page, throttled)");
    const uxResult = await track.run("ux", () => analyzeUx(auditUrl));
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

  if (options.skipAnalytics) {
    track.skipped("analytics", "--skip-analytics was passed.");
  } else if (!store.ga4PropertyId) {
    track.notApplicable("analytics", "This store has no GA4 property linked, so there was no traffic data to read.");
  } else {
    hooks.onStage?.("Pulling traffic & revenue from Google Analytics");
    sections.analytics = await track.run("analytics", () => analyzeAnalytics(store.ga4PropertyId!));
  }

  if (!options.competitorUrls?.length) {
    track.notApplicable("competitors", "No competitor URLs were given for this run.");
  } else {
    const competitorUrls = options.competitorUrls.slice(0, MAX_COMPETITORS);
    if (options.competitorUrls.length > MAX_COMPETITORS) {
      hooks.onStage?.(
        `Only benchmarking the first ${MAX_COMPETITORS} competitors (${options.competitorUrls.length - MAX_COMPETITORS} dropped) — each one runs a full Lighthouse + screenshot pass`,
      );
    }

    const competitors = [];
    let failedCompetitors = 0;
    for (const competitorUrl of competitorUrls) {
      hooks.onStage?.(`Benchmarking competitor: ${competitorUrl}`);
      const result = await analyzeCompetitor(competitorUrl).catch(() => null);
      if (!result) {
        failedCompetitors++;
        continue;
      }

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
    if (competitors.length > 0) {
      sections.competitors = { competitors };
      track.coverage.competitors = { status: "ran" };
      // Benchmarking three competitors and reporting on one is a different claim from benchmarking
      // one, and the section itself cannot tell them apart — it only holds what succeeded.
      if (failedCompetitors > 0) {
        track.truncated("competitors", {
          kept: competitors.length,
          found: competitorUrls.length,
          what: "competitors benchmarked",
        });
      }
    } else {
      track.coverage.competitors = {
        status: "failed",
        reason: `None of the ${competitorUrls.length} competitor URL(s) could be benchmarked.`,
      };
    }
  }

  // A derivation, not a measurement: it restates what code, performance and themeStructure already
  // found, so it is "not applicable" exactly when all three are missing rather than a failure of
  // its own.
  sections.bestPractices =
    deriveBestPractices({
      code: sections.code,
      performance: sections.performance,
      themeStructure: sections.themeStructure,
      themeDir: hasTheme ? themeDir : undefined,
    }) ?? undefined;
  track.coverage.bestPractices = sections.bestPractices
    ? { status: "ran" }
    : {
        status: "not-applicable",
        reason: "It is derived from the theme code, performance and theme structure sections, none of which ran.",
      };

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
  if (sections.sitespeed) scores.push(sections.sitespeed.score);
  if (sections.health) scores.push(sections.health.score);
  if (sections.pixels) scores.push(sections.pixels.score);
  // Skipped rather than counted as zero: a section we could not test should not drag the overall
  // score down as if it had failed.
  if (sections.consent && sections.consent.score !== null) scores.push(sections.consent.score);
  if (sections.security && sections.security.score !== null) scores.push(sections.security.score);
  if (sections.geoSeo) scores.push(sections.geoSeo.healthRating);
  if (sections.agentReadiness) scores.push(sections.agentReadiness.score);
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
    coverage: track.coverage,
    runner: runnerInfo(),
  };

  if (options.skipAiSuggestions) {
    track.skipped("aiSuggestions", "--skip-ai-suggestions was passed.");
  } else if (!process.env.ANTHROPIC_API_KEY) {
    hooks.onStage?.("ANTHROPIC_API_KEY not set — skipping AI suggestions");
    track.notApplicable("aiSuggestions", "ANTHROPIC_API_KEY is not set, so no AI suggestions could be written.");
  } else {
    hooks.onStage?.("Generating AI performance & accessibility suggestions (Claude)");
    const aiSuggestionsResult = await track.run("aiSuggestions", () =>
      generateAiSuggestions(sections.performance, hasTheme ? themeDir : undefined),
    );
    if (aiSuggestionsResult) {
      report.sections.aiSuggestions = aiSuggestionsResult.section;
      aiUsage = addUsage(aiUsage, aiSuggestionsResult.usage);
    }
  }

  if (options.skipSummary) {
    track.skipped("summary", "--skip-summary was passed.");
  } else if (!process.env.ANTHROPIC_API_KEY) {
    // Checked before the call rather than inferred from its failure: "no key" and "the call
    // failed" were previously the same `null`, so a genuine API error printed nothing at all.
    hooks.onStage?.("ANTHROPIC_API_KEY not set — skipping executive summary");
    track.notApplicable("summary", "ANTHROPIC_API_KEY is not set, so no executive summary could be written.");
  } else {
    hooks.onStage?.("Writing executive summary (Claude)");
    const result = await track.run("summary", () => generateSummary(report));
    if (result) {
      report.sections.summary = result.summary;
      aiUsage = addUsage(aiUsage, result.usage);
    }
  }

  // Last, deliberately: it reads every other section including the executive summary above, so it
  // has to run once they are all final.
  if (options.skipRecommendations) {
    track.skipped("recommendations", "--skip-recommendations was passed.");
  } else if (!process.env.ANTHROPIC_API_KEY) {
    hooks.onStage?.("ANTHROPIC_API_KEY not set — skipping client-ready recommendations");
    track.notApplicable("recommendations", "ANTHROPIC_API_KEY is not set, so no recommendations could be written.");
  } else {
    hooks.onStage?.("Writing client-ready recommendations (Claude)");
    const recommendationsResult = await track.run("recommendations", () => generateRecommendations(report));
    if (recommendationsResult) {
      report.sections.recommendations = recommendationsResult.section;
      aiUsage = addUsage(aiUsage, recommendationsResult.usage);
    }
  }

  report.aiUsage = aiUsage;

  // --output: keep the report entirely local. Deliberately before the upload rather than a flag
  // inside it, so there is no ordering in which a probe run can half-publish.
  if (options.outputPath) {
    hooks.onStage?.(`Writing report to ${options.outputPath}`);
    const { mkdirSync, writeFileSync } = await import("node:fs");
    const { dirname } = await import("node:path");
    mkdirSync(dirname(options.outputPath), { recursive: true });
    writeFileSync(options.outputPath, JSON.stringify(report, null, 2));
    await finishRunRecord({ status: "succeeded", overallScore });
    return report;
  }

  hooks.onStage?.("Uploading report to Vercel Blob");
  await writeBlobJson(reportBlobPath(store.slug, id), report);

  await appendToManifest({
    id,
    storeSlug: store.slug,
    storeName: store.name,
    storeUrl: store.url,
    createdAt: report.createdAt,
    overallScore,
    runner: report.runner,
  });

  await finishRunRecord({ status: "succeeded", reportId: id, overallScore });

  return report;
}
