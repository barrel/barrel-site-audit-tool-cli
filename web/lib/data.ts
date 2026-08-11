import { cache } from "react";
import { get } from "@vercel/blob";
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
