// Orchestrates one CRO audit: discover the page groups, capture them, draft the slides that need a
// browser, and store the result.
//
// What this deliberately does NOT do is the analytics step or the key-insights synthesis. Both are
// GA4-and-model work with no browser in them, and both already have a home in the deployed web app
// — web/lib/ga4.ts explains why the GA4 conversion pull lives there rather than here, and
// web/lib/data-analysis.ts is the single definition of the arithmetic and the anti-fabrication
// rules a conversion claim has to pass. Implementing them here as well would put a third copy of
// that logic across the shared/web mirror boundary, which is the one place in this repo where
// duplication has actually bitten.
//
// So a CRO audit is two presses: a capture run here, then Generate in the dashboard. The report
// records the app-side steps as `pending` so the gap is visible rather than looking like a step
// that found nothing.

import { nanoid } from "nanoid";
import type {
  AiUsage,
  CroBrief,
  CroCompetitorCapture,
  CroDevice,
  CroPageGroup,
  CroReport,
  CroStep,
  CroStepKey,
  StoreConfig,
} from "@barrel/site-audit-shared";
import {
  CRO_INDEX_BLOB_PATH,
  croCaptureBlobPath,
  croReportBlobPath,
  croScreenshotBlobPath,
  type CroIndex,
  type CroIndexEntry,
} from "@barrel/site-audit-shared";
import { buildCapture, captureCompetitor, captureStorefront } from "../analyzers/cro/capture.js";
import { discoverCroPages } from "../analyzers/cro/discover.js";
import { draftUxStep } from "../analyzers/cro/draft-ux.js";
import { draftCompetitorsStep } from "../analyzers/cro/draft-competitors.js";
import { findTopProductHandle } from "../analyzers/cro/top-product.js";
import { addUsage } from "../analyzers/cro/ai.js";
import { readBlobJson, writeBlobBinary, writeBlobJson } from "../blob.js";
import { normalizeAuditUrl } from "../url.js";
import { runnerInfo } from "./run-record.js";

export interface CroRunOptions {
  groups: readonly CroPageGroup[];
  devices: readonly CroDevice[];
  skipUx?: boolean;
  skipCompetitors?: boolean;
  captureOnly?: boolean;
  upload?: boolean;
  competitorUrls?: string[];
}

export interface CroRunHooks {
  onStage?: (stage: string) => void;
  onNote?: (note: string) => void;
}

/** The steps this tool does not yet produce, each with the reason on the page rather than in a
 * changelog. A reader looking at a CRO deck with no Voice of Customer section needs to know whether
 * the reviews said nothing or whether nobody looked. */
const NOT_YET_BUILT: Record<"behaviour" | "voc" | "journey", string> = {
  behaviour:
    "Heatmaps and session recordings are not yet part of this tool. The fold and scroll measurements in the UX step are a proxy for where attention stops — they say what a visitor would have to scroll past, not what any visitor actually did. Click maps, scroll maps and recordings still come from Hotjar or Clarity by hand.",
  voc:
    "Voice of Customer is not yet part of this tool. Review analysis still runs by hand: pull the reviews, and read them for recurring themes, stated desires, and what those imply for the site.",
  journey:
    "CX journey mapping is not yet part of this tool. The journey steps, their scoring, and which of them is the moment of truth are still a strategist's call.",
};

function pendingStep(key: CroStepKey, reason: string, source: CroStep["source"]): CroStep {
  return { key, status: "skipped", source, slides: [], evidence: [], limitations: [reason] };
}

/** Screenshots live in memory for the length of a run so the drafting step can hand them to the
 * model without a round trip through Blob, and are uploaded in parallel with that so the stored
 * report has something to render. Keyed by the blob pathname, which is what a `CroPageCapture`
 * carries. */
type ScreenshotCache = Map<string, Buffer>;

export async function runCroAudit(
  store: StoreConfig,
  options: CroRunOptions,
  hooks: CroRunHooks = {},
): Promise<CroReport> {
  const start = Date.now();
  const id = `${new Date().toISOString().replace(/[:.]/g, "-")}-${nanoid(6)}`;
  const auditUrl = normalizeAuditUrl(store.url);
  const upload = options.upload !== false;

  const brief: CroBrief = {
    ...(store.croBrief ?? {}),
    ...(options.competitorUrls && options.competitorUrls.length > 0 ? { competitorUrls: options.competitorUrls } : {}),
  };

  const screenshots: ScreenshotCache = new Map();
  const limitations: string[] = [];
  const steps: Partial<Record<CroStepKey, CroStep>> = {};
  let aiUsage: AiUsage | undefined;

  /* ── Discovery ─────────────────────────────────────────────────────────────────────────────── */

  hooks.onStage?.("Choosing which page stands for each page group");
  // Before the browser starts, because it decides which PDP gets reviewed.
  const topProductHandle = await findTopProductHandle(store.ga4PropertyId);
  if (!topProductHandle && store.ga4PropertyId) {
    limitations.push(
      "GA4 is linked but returned no product pageviews, so the product page reviewed here was chosen from catalogue order rather than by traffic.",
    );
  } else if (!store.ga4PropertyId) {
    limitations.push(
      "No GA4 property is linked to this store, so the product page reviewed here was chosen from catalogue order rather than by traffic. Linking one makes the PDP slide about the page the client's visitors actually land on.",
    );
  }

  const discovered = await discoverCroPages(auditUrl, {
    groups: options.groups,
    brief,
    topProductHandle: topProductHandle ?? undefined,
    onNote: hooks.onNote,
  });
  limitations.push(...discovered.limitations);

  /* ── Capture ───────────────────────────────────────────────────────────────────────────────── */

  const sink = async (
    group: CroPageGroup,
    device: CroDevice,
    crop: "full" | "fold",
    image: Buffer,
  ): Promise<string | undefined> => {
    const pathname = croScreenshotBlobPath(store.slug, id, group, device, crop);
    screenshots.set(pathname, image);
    if (!upload) return pathname;
    const stored = await writeBlobBinary(pathname, image, "image/jpeg");
    // Kept in the record either way: the drafting step reads it from memory, and a failed upload
    // costs the report its image rather than its slide.
    return stored ?? pathname;
  };

  const captured = await captureStorefront({
    targets: discovered.targets,
    devices: options.devices,
    uploadScreenshot: sink,
    onStage: hooks.onStage,
  });
  limitations.push(...captured.limitations);

  /* ── Competitors ───────────────────────────────────────────────────────────────────────────── */

  const competitorCaptures: CroCompetitorCapture[] = [];
  const competitorHtml: Record<string, string[]> = {};
  const competitorUrls = options.skipCompetitors ? [] : (brief.competitorUrls ?? []);

  if (!options.skipCompetitors && competitorUrls.length === 0) {
    limitations.push(
      "No competitors are recorded for this store, so there is no benchmark. Add up to three in the store's CRO brief and re-run.",
    );
  }

  for (const url of competitorUrls) {
    hooks.onStage?.(`Capturing competitor ${new URL(url).hostname}`);
    // A competitor's own page groups, discovered independently: their collection and product URLs
    // are theirs, and pointing our discovered paths at their domain would 404 on most of them.
    const theirs = await discoverCroPages(normalizeAuditUrl(url), { groups: options.groups, onNote: hooks.onNote }).catch(
      () => null,
    );
    if (!theirs || theirs.targets.length === 0) {
      competitorCaptures.push({
        name: new URL(url).hostname.replace(/^www\./, ""),
        url,
        pages: [],
        error: "No page of this storefront could be discovered.",
      });
      continue;
    }
    // Mobile only for competitors: it is where the behaviour that matters happens, and doubling a
    // three-competitor sweep to both devices roughly doubles the run for a second opinion on
    // somebody else's site.
    const result = await captureCompetitor(url, theirs.targets, ["mobile"], hooks.onStage);
    competitorCaptures.push(result.capture);
    competitorHtml[result.capture.name] = result.html;
  }

  /* ── Store the evidence ────────────────────────────────────────────────────────────────────── */

  const capture = buildCapture({
    id,
    storeSlug: store.slug,
    storeUrl: store.url,
    durationMs: Date.now() - start,
    pages: captured.pages,
    competitors: competitorCaptures.length > 0 ? competitorCaptures : undefined,
    limitations,
  });
  capture.runner = runnerInfo();

  if (upload) {
    hooks.onStage?.("Storing the capture");
    await writeBlobJson(croCaptureBlobPath(store.slug, id), capture);
  }

  /* ── Draft what a browser saw ──────────────────────────────────────────────────────────────── */

  const loadScreenshot = async (pathname: string): Promise<Buffer | null> => screenshots.get(pathname) ?? null;

  if (options.captureOnly) {
    steps.ux = pendingStep(
      "ux",
      "This was a capture-only run: the pages were captured and stored, and no slides were drafted from them. Generate them from the dashboard, or re-run without --capture-only.",
      "capture",
    );
    steps.ux.status = "pending";
  } else if (!options.skipUx) {
    const step = await draftUxStep({
      pages: captured.pages,
      groups: options.groups,
      devices: options.devices,
      brief,
      loadScreenshot,
      onStage: hooks.onStage,
    });
    steps.ux = step;
    aiUsage = addUsage(aiUsage, step.aiUsage);
  }

  if (!options.captureOnly && !options.skipCompetitors && competitorCaptures.length > 0) {
    const step = await draftCompetitorsStep({
      clientName: store.name,
      clientHtml: captured.html,
      competitors: competitorCaptures,
      competitorHtml,
      loadScreenshot,
      onStage: hooks.onStage,
    });
    steps.competitors = step;
    aiUsage = addUsage(aiUsage, step.aiUsage);
  }

  /* ── Declare what is not here ──────────────────────────────────────────────────────────────── */

  // Produced in the app, not here — see this file's header.
  steps.analytics = pendingStep(
    "analytics",
    store.ga4PropertyId
      ? "Not generated yet. The analytics step reads GA4 and needs no browser, so it runs from the dashboard: open this report and press Generate."
      : "No GA4 property is linked to this store, so there is no traffic data to analyse. Link one from the Run Audit page, then press Generate on this report.",
    "app",
  );
  steps.analytics.status = "pending";

  steps.insights = pendingStep(
    "insights",
    "Not generated yet. Key Insights is a synthesis of every other step, so it is written last — press Generate on this report once the analytics step has run.",
    "app",
  );
  steps.insights.status = "pending";

  steps.behaviour = pendingStep("behaviour", NOT_YET_BUILT.behaviour, "uploaded");
  steps.voc = pendingStep("voc", NOT_YET_BUILT.voc, "uploaded");
  steps.journey = pendingStep("journey", NOT_YET_BUILT.journey, "manual");

  /* ── Store the report ──────────────────────────────────────────────────────────────────────── */

  const report: CroReport = {
    id,
    storeSlug: store.slug,
    storeName: store.name,
    storeUrl: store.url,
    createdAt: new Date().toISOString(),
    durationMs: Date.now() - start,
    brief,
    steps,
    captureId: id,
    aiUsage,
    runner: runnerInfo(),
  };

  if (upload) {
    hooks.onStage?.("Publishing the report");
    await writeBlobJson(croReportBlobPath(store.slug, id), report);
    await appendToCroIndex(toIndexEntry(report));
  }

  return report;
}

export function toIndexEntry(report: CroReport): CroIndexEntry {
  return {
    id: report.id,
    storeSlug: report.storeSlug,
    storeName: report.storeName,
    storeUrl: report.storeUrl,
    createdAt: report.createdAt,
    stepsGenerated: (Object.keys(report.steps) as CroStepKey[]).filter((k) => report.steps[k]?.status === "generated"),
  };
}

/** Read-modify-write, same shape as the report manifest. Newest first, and an existing entry for
 * the same id is replaced rather than duplicated — which is what makes re-publishing a report from
 * the dashboard after a Generate safe. */
export async function appendToCroIndex(entry: CroIndexEntry): Promise<void> {
  const index = (await readBlobJson<CroIndex>(CRO_INDEX_BLOB_PATH)) ?? { reports: [] };
  index.reports = index.reports.filter((r) => r.id !== entry.id);
  index.reports.unshift(entry);
  await writeBlobJson(CRO_INDEX_BLOB_PATH, index);
}
