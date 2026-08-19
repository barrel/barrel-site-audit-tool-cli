export const MANIFEST_BLOB_PATH = "reports/manifest.json";

export function reportBlobPath(storeSlug: string, reportId: string): string {
  return `reports/${storeSlug}/${reportId}.json`;
}

/** The shared copy of a store's config.json. Local `stores/<slug>/config.json` files stay the
 * working copy for CLI runs; this is the version the hosted dashboard (and a cloud runner, which
 * has no local stores/ directory at all) reads and writes. `localThemeDir` is deliberately never
 * mirrored here — it's an absolute path on one person's machine. */
export function storeConfigBlobPath(slug: string): string {
  return `stores/${slug}/config.json`;
}

/** Index of every store that has been mirrored to Blob, so the dashboard can list stores without
 * enumerating blobs. Same read-modify-write shape as the report manifest. */
export const STORES_INDEX_BLOB_PATH = "stores/index.json";

/** One audit run's live status — written by the CLI itself (whichever machine or sandbox it's
 * running on) so progress survives a closed tab, and a cloud run can be followed without holding
 * an HTTP stream open for the whole audit. */
export function runRecordBlobPath(runId: string): string {
  return `runs/${runId}.json`;
}

export const RUNS_INDEX_BLOB_PATH = "runs/index.json";

/** One fleet-wide consent scan. Kept outside reports/ because a fleet scan spans every store
 * rather than belonging to one, so it must never show up in the per-store report manifest. */
export function consentFleetBlobPath(scanId: string): string {
  return `consent/${scanId}.json`;
}

export const CONSENT_INDEX_BLOB_PATH = "consent/index.json";

/** The full section for one site in one fleet scan — every test with its evidence, every state,
 * every cookie, and the tracker matrix.
 *
 * Kept out of the fleet blob on purpose. The fleet view loads its blob on every request to render
 * a table; folding fifty sites' cookie lists and evidence into it would make the page everyone
 * opens pay for the detail almost nobody scrolls to. */
export function consentSiteBlobPath(scanId: string, slug: string): string {
  return `consent/${scanId}/${slug}.json`;
}

/** Evidence captured for one consent state (the banner as it appeared when the choice was made).
 * Without it a failed test is an assertion nobody can verify.
 *
 * Deliberately under screenshots/: the web app's blob proxy is hard-scoped to that one prefix so
 * it can never be used to read arbitrary blobs, and consent evidence is worth far less than that
 * guarantee. Reusing the prefix means reusing the existing login gate too. */
export function consentScreenshotBlobPath(slug: string, scanId: string, state: string): string {
  return `screenshots/consent/${slug}/${scanId}/${state}.jpg`;
}
