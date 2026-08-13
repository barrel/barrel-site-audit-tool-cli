import { cache } from "react";
import { get, put } from "@vercel/blob";
import type { Manifest, ManifestEntry, Report } from "./shared";

const MANIFEST_BLOB_PATH = "reports/manifest.json";

function reportBlobPath(storeSlug: string, reportId: string): string {
  return `reports/${storeSlug}/${reportId}.json`;
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
): ReportListResult {
  const q = (query ?? "").trim().toLowerCase();
  const filtered = q
    ? manifest.reports.filter((r) =>
        [r.storeName, r.storeSlug, r.storeUrl].some((field) => field.toLowerCase().includes(q)),
      )
    : manifest.reports;

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

/** Groups every report by store for the Progress views, oldest-to-newest within each group,
 * so trend/delta math reads left-to-right in the same order the data was produced. */
export function groupReportsByStore(manifest: Manifest): StoreProgressGroup[] {
  const bySlug = new Map<string, ManifestEntry[]>();
  for (const r of manifest.reports) {
    const list = bySlug.get(r.storeSlug) ?? [];
    list.push(r);
    bySlug.set(r.storeSlug, list);
  }

  return Array.from(bySlug.values())
    .map((reports) => {
      const sorted = [...reports].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      const latest = sorted[sorted.length - 1];
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
