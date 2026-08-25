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

/** One generated Data Analysis for one report — the audit crossed with that store's GA4 data.
 *
 * A sibling of the report blob rather than a section inside it. Generating an analysis is an
 * explicit, paid act that can be repeated against a report that is already finished and may
 * already have been shared; rewriting the report blob each time would mutate a record of what a
 * run measured. Keyed by report id so a re-run of the audit gets its own analysis, and a client
 * comparing two reports is never shown one report's numbers with the other's conclusions. */
export function dataAnalysisBlobPath(storeSlug: string, reportId: string): string {
  return `reports/${storeSlug}/${reportId}-data-analysis.json`;
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

/* ── CRO audits ───────────────────────────────────────────────────────────────────────────────
 *
 * A separate namespace from reports/, for the same reason consent/ is one: a CRO audit is not a
 * site-audit report and must never appear in the report manifest. It has its own index, its own
 * pages and its own share links.
 */

/** Index of every CRO audit, so the list page can render without enumerating blobs. Same
 * read-modify-write shape as the report manifest. */
export const CRO_INDEX_BLOB_PATH = "cro/index.json";

/** One CRO audit — the interpreted deck. */
export function croReportBlobPath(storeSlug: string, croId: string): string {
  return `cro/${storeSlug}/${croId}.json`;
}

/** What the browser saw: pages, DOM signals, measurements, screenshot pathnames.
 *
 * Stored apart from the report because it is evidence rather than conclusion. Every AI section is
 * drafted from this, which is what lets a section be re-drafted — from the deployed app, where
 * there is no browser — without crawling the client's storefront a second time. */
export function croCaptureBlobPath(storeSlug: string, croId: string): string {
  return `cro/${storeSlug}/${croId}-capture.json`;
}

/** A strategist's corrections to a generated deck, kept as an overlay.
 *
 * Never folded into the report blob: that blob is the record of what the tool concluded at a
 * moment, and by the time anyone edits it, it may already have been shared with a client. Same
 * reasoning as dataAnalysisBlobPath above. */
export function croEditsBlobPath(storeSlug: string, croId: string): string {
  return `cro/${storeSlug}/${croId}-edits.json`;
}

/** One captured page screenshot.
 *
 * Under screenshots/ deliberately, to reuse the web app's blob proxy — which is hard-scoped to that
 * one prefix so it can never read arbitrary blobs — and the login gate that comes with it. The same
 * tradeoff consentScreenshotBlobPath documents.
 *
 * The store segment is `cro-<slug>`, not `cro/<slug>`, and this is load-bearing: the app's
 * middleware authorises a shared report's images by splitting the proxy path into
 * `<store>/<report>/…` and checking that pair against the share token's scope. With `cro/<slug>`
 * the pair would be `cro/<slug>`, and one CRO share link would authorise every CRO audit that
 * store has ever had. */
export function croScreenshotBlobPath(
  storeSlug: string,
  croId: string,
  group: string,
  device: string,
  crop: "full" | "fold",
): string {
  return `screenshots/cro-${storeSlug}/${croId}/${group}-${device}-${crop}.jpg`;
}
