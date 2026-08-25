import { cache } from "react";
import { get, put } from "@vercel/blob";
import type {
  ConsentFleetReport,
  ConsentSection,
  CroCapture,
  CroEdits,
  CroIndex,
  CroIndexEntry,
  CroReport,
  CroStepKey,
  DataAnalysisSection,
  Manifest,
  ManifestEntry,
  Report,
  StoreConfig,
  StoresIndex,
} from "./shared";

const MANIFEST_BLOB_PATH = "reports/manifest.json";

function reportBlobPath(storeSlug: string, reportId: string): string {
  return `reports/${storeSlug}/${reportId}.json`;
}

function dataAnalysisBlobPath(storeSlug: string, reportId: string): string {
  return `reports/${storeSlug}/${reportId}-data-analysis.json`;
}

async function readBlobJson<T>(pathname: string, useCache = true): Promise<T | null> {
  try {
    const result = await get(pathname, { access: "private", useCache });
    if (!result || result.statusCode !== 200 || !result.stream) return null;
    return (await new Response(result.stream).json()) as T;
  } catch {
    return null;
  }
}

// Wrapped in React's request-level cache() — the report layout and its active page (Overview,
// a category page, or All) each call these independently; cache() dedupes them to a single
// Blob read per navigation instead of two, without needing to thread data through props.
export const getManifest = cache(async (): Promise<Manifest> => {
  // The manifest is overwritten on every audit run — always read the origin copy
  // so a new report shows up on the site the moment the CLI finishes, no redeploy.
  return (await readBlobJson<Manifest>(MANIFEST_BLOB_PATH, false)) ?? { reports: [] };
});

export const getReport = cache(async (slug: string, id: string): Promise<Report | null> => {
  return await readBlobJson<Report>(reportBlobPath(slug, id));
});

/** The Data Analysis generated for one report, if one has been. Never cached: the tab is read
 * immediately after the Generate button writes it, and a cached miss would show the empty state
 * to the person who just paid for the analysis. */
export const getDataAnalysis = cache(async (slug: string, id: string): Promise<DataAnalysisSection | null> => {
  return await readBlobJson<DataAnalysisSection>(dataAnalysisBlobPath(slug, id), false);
});

export async function saveDataAnalysis(analysis: DataAnalysisSection): Promise<void> {
  // Same write shape as everything else here — fixed pathname, overwrite allowed — so pressing
  // Generate a second time replaces the previous analysis rather than accumulating orphans.
  await put(dataAnalysisBlobPath(analysis.storeSlug, analysis.reportId), JSON.stringify(analysis, null, 2), {
    access: "private",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
  });
}

export interface ReportListResult {
  items: ManifestEntry[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export function searchAndPaginate(
  manifest: Manifest,
  query: string | undefined,
  page: number,
  pageSize = 20,
  view: "active" | "archived" = "active",
): ReportListResult {
  const q = (query ?? "").trim().toLowerCase();
  const byView = manifest.reports.filter((r) => (view === "archived" ? r.archived : !r.archived));
  const filtered = q
    ? byView.filter((r) => [r.storeName, r.storeSlug, r.storeUrl].some((field) => field.toLowerCase().includes(q)))
    : byView;

  const sorted = [...filtered].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const total = sorted.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const clampedPage = Math.min(Math.max(1, page || 1), totalPages);
  const start = (clampedPage - 1) * pageSize;

  return {
    items: sorted.slice(start, start + pageSize),
    total,
    page: clampedPage,
    pageSize,
    totalPages,
  };
}

export function reportsForStore(manifest: Manifest, storeSlug: string, excludeId?: string): ManifestEntry[] {
  return manifest.reports
    .filter((r) => r.storeSlug === storeSlug && r.id !== excludeId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export interface StoreProgressGroup {
  storeSlug: string;
  storeName: string;
  storeUrl: string;
  reports: ManifestEntry[]; // sorted oldest -> newest
  baseline: ManifestEntry; // explicit isBaseline entry, else the earliest report
}

/** Groups reports by store for the Progress views, oldest-to-newest within each group, so
 * trend/delta math reads left-to-right in the same order the data was produced.
 *
 * Archived reports are excluded. Archiving is how a run that should not count gets retired — a
 * test run, a scan of the wrong URL, a report taken mid-deploy — and leaving those in the trend
 * meant a discarded run could still set the baseline, bend the sparkline, and drive the delta a
 * client is shown. The blob and its direct link keep working; it simply stops being evidence. */
export function groupReportsByStore(manifest: Manifest): StoreProgressGroup[] {
  const bySlug = new Map<string, ManifestEntry[]>();
  for (const r of manifest.reports) {
    if (r.archived) continue;
    const list = bySlug.get(r.storeSlug) ?? [];
    list.push(r);
    bySlug.set(r.storeSlug, list);
  }

  return Array.from(bySlug.values())
    // A store whose every report has been archived has nothing left to chart, and the entry that
    // follows would read undefined off an empty array.
    .filter((reports) => reports.length > 0)
    .map((reports) => {
      const sorted = [...reports].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      const latest = sorted[sorted.length - 1];
      // An archived report can no longer be the baseline even if it is still flagged as one:
      // the flag is set independently of archiving, and the two can disagree.
      const baseline = sorted.find((r) => r.isBaseline) ?? sorted[0];
      return {
        storeSlug: latest.storeSlug,
        storeName: latest.storeName,
        storeUrl: latest.storeUrl,
        reports: sorted,
        baseline,
      };
    })
    .sort((a, b) => b.reports[b.reports.length - 1].createdAt.localeCompare(a.reports[a.reports.length - 1].createdAt));
}

/** Writes the manifest back to Blob — mirrors the CLI's writeBlobJson (cli/src/blob.ts) exactly,
 * since the web app and CLI both need read-modify-write access to the same manifest blob. */
export async function writeManifest(manifest: Manifest): Promise<void> {
  await put(MANIFEST_BLOB_PATH, JSON.stringify(manifest, null, 2), {
    access: "private",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
  });
}

/* ── Store configuration ─────────────────────────────────────────────────────────────────── */

const STORES_INDEX_BLOB_PATH = "stores/index.json";

function storeConfigBlobPath(slug: string): string {
  return `stores/${slug}/config.json`;
}

/** Every store the CLI has synced. Never cached: the whole point of the GA4 link form is that a
 * change made here is visible on the next page load. */
export const getStores = cache(async (): Promise<StoresIndex["stores"]> => {
  const index = await readBlobJson<StoresIndex>(STORES_INDEX_BLOB_PATH, false);
  return index?.stores ?? [];
});

export const getStoreConfig = cache(async (slug: string): Promise<StoreConfig | null> => {
  return await readBlobJson<StoreConfig>(storeConfigBlobPath(slug), false);
});

export async function saveStoreConfig(config: StoreConfig): Promise<void> {
  // Same write shape as the manifest above, and as the CLI's own writer: no random suffix, and
  // overwrite allowed, because the CLI reads this exact pathname back on its next run.
  await put(storeConfigBlobPath(config.slug), JSON.stringify(config, null, 2), {
    access: "private",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
  });
}

/* ── Privacy Compliance fleet scans ──────────────────────────────────────────────────────────────── */

const CONSENT_INDEX_BLOB_PATH = "consent/index.json";

function consentFleetBlobPath(scanId: string): string {
  return `consent/${scanId}.json`;
}

function consentSiteBlobPath(scanId: string, slug: string): string {
  return `consent/${scanId}/${slug}.json`;
}

export interface ConsentIndexEntry {
  id: string;
  createdAt: string;
  region: string;
  totals: ConsentFleetReport["totals"];
}

export const getConsentIndex = cache(async (): Promise<ConsentIndexEntry[]> => {
  // Same reasoning as the report manifest: rewritten on every scan, so never serve a cached copy
  // or a fresh scan appears to have vanished.
  const index = await readBlobJson<{ scans: ConsentIndexEntry[] }>(CONSENT_INDEX_BLOB_PATH, false);
  return index?.scans ?? [];
});

export const getConsentScan = cache(async (scanId: string): Promise<ConsentFleetReport | null> => {
  return await readBlobJson<ConsentFleetReport>(consentFleetBlobPath(scanId));
});

/** One site's full section from one scan — every test with its evidence, every state, every
 * cookie, and the tracker matrix. Read only by the per-site report, which is why it is a separate
 * blob rather than part of the fleet payload. */
export const getConsentSiteDetail = cache(async (scanId: string, slug: string): Promise<ConsentSection | null> => {
  return await readBlobJson<ConsentSection>(consentSiteBlobPath(scanId, slug));
});

/** The most recent scan, which is what /consent shows by default. */
export const getLatestConsentScan = cache(async (): Promise<ConsentFleetReport | null> => {
  const index = await getConsentIndex();
  if (index.length === 0) return null;
  const newest = [...index].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  return await getConsentScan(newest.id);
});

/* ── CRO audits ──────────────────────────────────────────────────────────────────────────────
 *
 * A separate namespace from reports/, for the same reason consent/ is one: a CRO audit is not a
 * site-audit report and must never appear in the report manifest. Mirrors
 * shared/src/blob-paths.ts — see shared/test/mirror-drift.test.ts, which compares the two.
 */

const CRO_INDEX_BLOB_PATH = "cro/index.json";

function croReportBlobPath(storeSlug: string, croId: string): string {
  return `cro/${storeSlug}/${croId}.json`;
}

function croCaptureBlobPath(storeSlug: string, croId: string): string {
  return `cro/${storeSlug}/${croId}-capture.json`;
}

function croEditsBlobPath(storeSlug: string, croId: string): string {
  return `cro/${storeSlug}/${croId}-edits.json`;
}

/** Never cached, for the same reason the report manifest is not: it is rewritten by every capture
 * run and by every Generate, and a cached copy makes a finished run look like it never happened. */
export const getCroIndex = cache(async (): Promise<CroIndexEntry[]> => {
  const index = await readBlobJson<CroIndex>(CRO_INDEX_BLOB_PATH, false);
  return index?.reports ?? [];
});

/** Never cached: the report page is opened immediately after Generate rewrites it, and a cached
 * miss would show the pre-Generate state to the person who just paid for the generation. */
export const getCroReport = cache(async (slug: string, id: string): Promise<CroReport | null> => {
  return await readBlobJson<CroReport>(croReportBlobPath(slug, id), false);
});

/** The evidence a report was drafted from. Read only when a step is being re-generated, or when
 * someone opens the evidence behind a bullet — the report itself carries everything the slides
 * need, so the normal page load never pays for this. Cacheable because a capture is written once
 * and never rewritten. */
export const getCroCapture = cache(async (slug: string, id: string): Promise<CroCapture | null> => {
  return await readBlobJson<CroCapture>(croCaptureBlobPath(slug, id));
});

export const getCroEdits = cache(async (slug: string, id: string): Promise<CroEdits | null> => {
  return await readBlobJson<CroEdits>(croEditsBlobPath(slug, id), false);
});

export async function saveCroReport(report: CroReport): Promise<void> {
  await put(croReportBlobPath(report.storeSlug, report.id), JSON.stringify(report, null, 2), {
    access: "private",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
  });
}

export async function saveCroEdits(edits: CroEdits): Promise<void> {
  await put(croEditsBlobPath(edits.storeSlug, edits.croId), JSON.stringify(edits, null, 2), {
    access: "private",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
  });
}

/** Read-modify-write, newest first, replacing any entry with the same id — which is what makes
 * re-publishing a report after a Generate safe. Mirrors appendToCroIndex in
 * cli/src/report/cro-generate.ts. */
export async function saveCroIndexEntry(entry: CroIndexEntry): Promise<void> {
  const reports = (await readBlobJson<CroIndex>(CRO_INDEX_BLOB_PATH, false))?.reports ?? [];
  const next = [entry, ...reports.filter((r) => r.id !== entry.id)];
  await put(CRO_INDEX_BLOB_PATH, JSON.stringify({ reports: next }, null, 2), {
    access: "private",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
  });
}

/** The index entry for a report as it now stands. Recomputed on every write rather than patched,
 * so "which steps are done" on the list page cannot drift from the report itself. */
export function croIndexEntry(report: CroReport, archived?: boolean): CroIndexEntry {
  return {
    id: report.id,
    storeSlug: report.storeSlug,
    storeName: report.storeName,
    storeUrl: report.storeUrl,
    createdAt: report.createdAt,
    stepsGenerated: (Object.keys(report.steps) as CroStepKey[]).filter((k) => report.steps[k]?.status === "generated"),
    ...(archived ? { archived: true } : {}),
  };
}

export interface CroStoreGroup {
  storeSlug: string;
  storeName: string;
  storeUrl: string;
  /** Newest first. */
  reports: CroIndexEntry[];
}

/** Grouped by store, because a CRO audit repeats quarterly and the useful question on the list
 * page is "what have we told this client, and when", not "what ran most recently". */
export function groupCroByStore(entries: CroIndexEntry[]): CroStoreGroup[] {
  const bySlug = new Map<string, CroIndexEntry[]>();
  for (const entry of entries) {
    if (entry.archived) continue;
    const list = bySlug.get(entry.storeSlug) ?? [];
    list.push(entry);
    bySlug.set(entry.storeSlug, list);
  }

  return Array.from(bySlug.values())
    .filter((reports) => reports.length > 0)
    .map((reports) => {
      const sorted = [...reports].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return {
        storeSlug: sorted[0].storeSlug,
        storeName: sorted[0].storeName,
        storeUrl: sorted[0].storeUrl,
        reports: sorted,
      };
    })
    .sort((a, b) => b.reports[0].createdAt.localeCompare(a.reports[0].createdAt));
}
