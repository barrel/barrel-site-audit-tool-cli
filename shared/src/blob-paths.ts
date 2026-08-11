export const MANIFEST_BLOB_PATH = "reports/manifest.json";

export function reportBlobPath(storeSlug: string, reportId: string): string {
  return `reports/${storeSlug}/${reportId}.json`;
}
