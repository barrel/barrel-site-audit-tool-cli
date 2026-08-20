export type Severity = "error" | "warning" | "info";

export interface CodeIssue {
  severity: Severity;
  check: string;
  message: string;
  file: string;
  line?: number;
  /** Concrete remediation guidance — a link to the Theme Check rule docs and the exact file to fix. */
  recommendation?: string;
}

export interface CodeSection {
  score: number;
  filesScanned: number;
  errorCount: number;
  warningCount: number;
  infoCount: number;
  issues: CodeIssue[];
}

export interface LighthouseAudit {
  id: string;
  title: string;
  description: string;
  score: number | null;
  displayValue?: string;
}

export interface LighthouseCategoryResult {
  score: number;
  audits: LighthouseAudit[];
}

export interface VitalMetric {
  displayValue: string;
  score: number | null;
}

export interface CoreWebVitals {
  lcp?: VitalMetric;
  cls?: VitalMetric;
  tbt?: VitalMetric;
  fcp?: VitalMetric;
  speedIndex?: VitalMetric;
}

export type LighthouseDevice = "mobile" | "desktop";

export interface LighthousePageResult {
  page: string;
  device: LighthouseDevice;
  url: string;
  performance: number;
  accessibility: number;
  bestPractices: number;
  seo: number;
}

export interface ConsoleErrorItem {
  /** Lighthouse's own vocabulary for where the error came from: "network", "security", "exception", etc. */
  source: string;
  description: string;
  url?: string;
  line?: number;
}

export interface PerformanceSection {
  fetchedUrl: string;
  finalUrl: string;
  performance: LighthouseCategoryResult;
  accessibility: LighthouseCategoryResult;
  bestPractices: LighthouseCategoryResult;
  seo: LighthouseCategoryResult;
  vitals: CoreWebVitals;
  /** Real browser console errors captured during the homepage/mobile Lighthouse run (Lighthouse's
   * own `errors-in-console` audit detail rows) — network failures, CSP/security violations,
   * uncaught JS exceptions. */
  consoleErrors: ConsoleErrorItem[];
  /** Performance/A11y/Best-Practices/SEO scores across every discovered page x device combo
   * (Home, Collection, Product, Cart — mobile and desktop). The single-page audits above stay
   * scoped to the homepage on mobile, used for the detailed finding cards. */
  pages: LighthousePageResult[];
  /** Blob pathname (screenshots/...) of a full-page mobile screenshot of the homepage, if captured. */
  screenshotPath?: string;
  /** Lighthouse's "Agentic Browsing" category (ships by default from Lighthouse 13.3+) — how
   * well an AI agent can navigate and act on the homepage. Still experimental upstream, scored
   * as a pass/total fraction rather than 0-100, so it's kept out of overallScore. Absent on
   * reports run before this field existed, or against an older Lighthouse version. */
  agenticBrowsing?: AgenticBrowsingSection;
}

export interface AgenticBrowsingSection {
  passed: number;
  total: number;
  checks: HealthCheckItem[];
}

export type AxeImpact = "critical" | "serious" | "moderate" | "minor";

export interface AxeViolationNode {
  target: string[];
  html: string;
  failureSummary?: string;
}

export interface AxeViolation {
  id: string;
  impact: AxeImpact | null;
  description: string;
  help: string;
  helpUrl: string;
  tags: string[];
  nodeCount: number;
  nodes: AxeViolationNode[];
}

export interface AxePageResult {
  page: string;
  url: string;
  violations: AxeViolation[];
  passCount: number;
  incompleteCount: number;
}

export interface AccessibilitySection {
  score: number;
  pages: AxePageResult[];
  /** WCAG-category readiness checklist (axe-core's own `cat.*` taxonomy), aggregated across
   * every page scanned — one row per category, "pass" only when no violation anywhere tagged
   * that category. */
  checklist: HealthCheckItem[];
}

export type HealthStatus = "pass" | "warn" | "fail";

export interface HealthCheckItem {
  id: string;
  label: string;
  status: HealthStatus;
  detail: string;
  /** Concrete remediation step for a failing/warning check — omitted for "pass". */
  recommendation?: string;
}

export interface HealthSection {
  score: number;
  checks: HealthCheckItem[];
}

export type PixelStatus = "firing" | "configured" | "not-found";

export interface PixelPlatformResult {
  id: string;
  name: string;
  status: PixelStatus;
  detail: string;
}

export interface PixelFinding {
  severity: Severity;
  title: string;
  detail: string;
  /** Concrete remediation step — what to change and where. */
  recommendation?: string;
}

export interface PixelSection {
  score: number;
  platforms: PixelPlatformResult[];
  consentMechanismDetected: boolean;
  findings: PixelFinding[];
}

export interface StructureFlag {
  label: string;
  detail: string;
  /** Concrete remediation step — omitted for green flags, which don't need one. */
  recommendation?: string;
}

export interface ThemeStructureSection {
  score: number;
  templates: { total: number; json: number; liquid: number };
  sectionsCount: number;
  snippetsCount: number;
  pageBuilderApps: string[];
  redFlags: StructureFlag[];
  greenFlags: StructureFlag[];
}

export type BestPracticeVerdict = "good" | "needs-improvement" | "poor";

export interface BestPracticeRow {
  dimension: string;
  verdict: BestPracticeVerdict;
  evidence: string;
}

export interface BestPracticesSection {
  rows: BestPracticeRow[];
}

export interface SummarySection {
  overview: string;
  keyFindings: string[];
}

export interface AnalyticsBreakdownRow {
  label: string;
  sessions: number;
}

export interface AnalyticsSection {
  propertyId: string;
  dateRangeLabel: string;
  sessions: number;
  totalUsers: number;
  transactions: number;
  conversionRate: number;
  revenue: number;
  averageOrderValue: number;
  channels: AnalyticsBreakdownRow[];
  devices: AnalyticsBreakdownRow[];
}

export type OpportunityImpact = "high" | "medium" | "low";

export interface SeoOpportunity {
  title: string;
  impact: OpportunityImpact;
  detail: string;
  recommendation: string;
}

export interface SeoSection {
  score: number;
  opportunities: SeoOpportunity[];
}

export interface GeoSection {
  score: number;
  /** AI-crawler access, llms.txt presence, structured-data / product-feed checks. */
  checks: HealthCheckItem[];
  /** Verdict table for agentic-commerce readiness and general AI-discoverability best practices. */
  agenticCommerce: BestPracticeRow[];
}

export interface GeoSeoSection {
  healthRating: number;
  seo: SeoSection;
  geo: GeoSection;
}

export interface UxOpportunity {
  title: string;
  page: "Collection" | "Product";
  impact: OpportunityImpact;
  detail: string;
  recommendation: string;
}

export interface UxPageCapture {
  url: string;
  screenshotPath?: string;
}

export interface UxSection {
  score: number;
  /** Deterministic conversion-related DOM checks (add-to-cart visibility, reviews, trust badges, filters, etc.). */
  checks: HealthCheckItem[];
  /** AI-generated, screenshot-grounded conversion opportunities — advisory, not scored. */
  opportunities: UxOpportunity[];
  collectionPage?: UxPageCapture;
  productPage?: UxPageCapture;
}

export interface CompetitorResult {
  name: string;
  url: string;
  performance: number;
  accessibility: number;
  bestPractices: number;
  seo: number;
  healthScore: number;
  vitals?: CoreWebVitals;
  /** Blob pathname (screenshots/...) of a full-page mobile screenshot of the competitor's homepage, if captured. */
  screenshotPath?: string;
}

export interface CompetitorSection {
  competitors: CompetitorResult[];
}

export type AiSuggestionCategory = "performance" | "accessibility";

export interface AiSuggestion {
  category: AiSuggestionCategory;
  severity: OpportunityImpact;
  title: string;
  detail: string;
  recommendation: string;
  /** Theme file the suggestion is grounded in, e.g. "sections/hero.liquid" — omitted when no theme code was available. */
  file?: string;
  /** A concrete corrected code snippet (Liquid/HTML) implementing the recommendation, grounded in
   * the actual sampled theme code — only present when `file` is set and the model had enough real
   * code context to write it. Never a placeholder/invented snippet. */
  codeFix?: string;
}

export interface AiSuggestionsSection {
  /** AI-generated, code/Lighthouse-grounded performance & accessibility (ADA/WCAG) fixes — advisory, not scored. */
  suggestions: AiSuggestion[];
}

export interface SitespeedMetric {
  label: string;
  value: number;
  unit: string;
}

export interface SitespeedCategoryScore {
  category: string;
  score: number;
}

export interface SitespeedAdvice {
  title: string;
  category: string;
  severity: OpportunityImpact;
  detail: string;
  recommendation?: string;
}

export interface SitespeedSection {
  /** Coach's overall 0-100 score for the page. */
  score: number;
  /** Per-category Coach scores — Performance, Best Practice, Privacy. */
  categoryScores: SitespeedCategoryScore[];
  /** Key Browsertime timing/weight metrics, median across `runs` real-browser iterations. */
  metrics: SitespeedMetric[];
  runs: number;
  /** Coach's rule-level advice for anything scoring below 100, worst-first. */
  advice: SitespeedAdvice[];
}

export interface AgentReadinessSection {
  score: number;
  /** Dimension-level checks: AI crawler access, server-rendered price/stock, per-SKU Offer
   * schema completeness, machine-readable return/shipping policy data, size-attribute
   * consistency, feed-vs-PDP price accuracy. */
  checks: HealthCheckItem[];
  skusSampled: number;
  /** Concrete, SKU-level or catalog-level findings — missing Offer fields on a specific
   * product, inconsistent size labels across the catalog, feed/PDP price drift, etc. */
  issues: ThemeConcern[];
}

export interface ThemeConcern {
  title: string;
  severity: OpportunityImpact;
  detail: string;
  recommendation?: string;
}

export interface ThemeArchitectureSection {
  /** 2-4 sentence narrative: how the theme appears to be built (custom vs. stock-based, page-builder
   * reliance, Online Store 2.0 vs. legacy template architecture). */
  summary: string;
  /** Verdict table for Shopify platform-feature adoption — OS 2.0 JSON templates, section groups,
   * theme blocks / app-block support, metafields usage, settings schema quality, etc. */
  modernPractices: BestPracticeRow[];
  /** Other architectural concerns beyond raw lint errors — e.g. page-builder reliance fighting the
   * theme's own architecture, inconsistent patterns, sections missing block/app-block support. */
  concerns: ThemeConcern[];
}

export type AdaScopeStatus = "complete" | "partial" | "incomplete" | "manual" | "unverified";

export interface AdaScopeEvidence {
  /** What produced this evidence — "axe-core", "Lighthouse", or "Keyboard probe". */
  source: string;
  detail: string;
  /** CSS selectors of the actual offending elements (capped), so a dev can go straight to them. */
  selectors?: string[];
  /** Journey page the evidence came from, when it's page-specific. */
  page?: string;
}

export interface AdaScopeItem {
  id: string;
  /** The scope line exactly as the client wrote it, minus its bullet marker. */
  text: string;
  /** The "such as:" heading this line sat under in the pasted scope, if any. */
  group?: string;
  status: AdaScopeStatus;
  /** Requirement IDs from the shared catalog (see shared/src/ada-scope.ts) this line was
   * verified against — empty for a purely manual item. */
  requirementIds: string[];
  /** How the line was mapped to those requirements: keyword catalog, Claude, or not at all. */
  matchedBy: "catalog" | "ai" | "none";
  /** Why the status is what it is — the specific rules, counts and elements behind it. */
  evidence: AdaScopeEvidence[];
  /** A developer-ready instruction to close the gap: what to change, where, and how to verify.
   * Omitted only when the item is complete. */
  action?: string;
  /** Number of elements/pages failing, when the underlying check is countable. */
  affectedCount?: number;
}

export interface AdaScopeSection {
  /** The scope exactly as pasted, kept verbatim so the report shows what was actually asked for. */
  rawScope: string;
  items: AdaScopeItem[];
  completeCount: number;
  partialCount: number;
  incompleteCount: number;
  manualCount: number;
  unverifiedCount: number;
  /** Percent of the automatically-verifiable scope items that came back complete (0-100).
   * Manual and unverified items are excluded from both sides of the fraction — this measures
   * scope delivery, not site quality, so it's deliberately kept out of overallScore. */
  coverage: number;
  /** Journey pages the scope was verified against. */
  pagesScanned: string[];
  /** Lighthouse's own accessibility score for the homepage (mobile) at the time of this run,
   * carried here so the ADA scope sign-off reads standalone. Absent when Lighthouse was skipped. */
  lighthouseAccessibilityScore?: number;
  /** axe-core's automated accessibility score, same reason. Absent when the axe scan was skipped. */
  axeScore?: number;
}

export interface ReportSections {
  code?: CodeSection;
  performance?: PerformanceSection;
  accessibility?: AccessibilitySection;
  adaScope?: AdaScopeSection;
  sitespeed?: SitespeedSection;
  themeArchitecture?: ThemeArchitectureSection;
  agentReadiness?: AgentReadinessSection;
  health?: HealthSection;
  pixels?: PixelSection;
  consent?: ConsentSection;
  themeStructure?: ThemeStructureSection;
  bestPractices?: BestPracticesSection;
  analytics?: AnalyticsSection;
  competitors?: CompetitorSection;
  geoSeo?: GeoSeoSection;
  ux?: UxSection;
  aiSuggestions?: AiSuggestionsSection;
  summary?: SummarySection;
}

export interface AiUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
}

/** Where an audit physically ran. Recorded because Lighthouse numbers are a property of the
 * machine as much as the site: a 4-vCPU sandbox in iad1 and an M-series laptop on office wifi do
 * not produce comparable scores, and Baseline & Reporting exists to compare a store to itself. */
export interface RunnerInfo {
  mode: RunMode;
  /** Version of @barrel/site-audit-cli that produced the report. */
  cliVersion?: string;
  /** Cloud runs only — the sandbox region and size the numbers came off. */
  region?: string;
  vcpus?: number;
}

export interface Report {
  id: string;
  storeSlug: string;
  storeName: string;
  storeUrl: string;
  createdAt: string;
  durationMs: number;
  overallScore: number;
  sections: ReportSections;
  /** Claude token usage for the AI-generated executive summary, if one was produced. */
  aiUsage?: AiUsage;
  /** Absent on reports produced before cloud runs existed — treat those as local. */
  runner?: RunnerInfo;
}

export interface ManifestEntry {
  id: string;
  storeSlug: string;
  storeName: string;
  storeUrl: string;
  createdAt: string;
  overallScore: number;
  /** Marks this report as the reference point for progress tracking — at most one
   * per storeSlug, set/cleared from the web app, never touched by the CLI. */
  isBaseline?: boolean;
  /** Hides this report from the default landing-page list without deleting it — the report
   * blob, Baseline & Reporting history, and direct link all keep working. Set/cleared only
   * from the web app, never touched by the CLI. */
  archived?: boolean;
  /** Copied from the report so progress/delta views can flag a cross-runner comparison without
   * fetching every report blob. Absent on entries written before cloud runs existed. */
  runner?: RunnerInfo;
}

export interface Manifest {
  reports: ManifestEntry[];
}

export interface StoreConfig {
  slug: string;
  name: string;
  url: string;
  /** The store's *.myshopify.com domain, needed to authenticate `shopify theme pull`. */
  shopifyDomain?: string;
  /** GA4 numeric property ID (Admin -> Property Settings), for the Traffic & Revenue section.
   * Requires the service account in GOOGLE_SERVICE_ACCOUNT_KEY to be a Viewer on the property —
   * see docs/ga4-setup.md. */
  ga4PropertyId?: string;
  /** "owner/repo" of the GitHub repo last cloned into theme/ via `link-repo`, for reference. */
  githubRepo?: string;
  /** Branch last cloned via `link-repo` — omitted when the repo's default branch was used. */
  githubBranch?: string;
  /** Path *within* the repo to the Shopify theme root, for repos that keep the theme one level
   * down (theme/, src/, dist/). Omitted when the theme sits at the repo root. Only a cloud run
   * needs this recorded: a local run finds the theme root by walking up from where you are. */
  themeSubdir?: string;
  /** Absolute path to a local git checkout to read theme code from directly, set via
   * `run --local-repo <path>` — an alternative to the managed stores/<slug>/theme/ copy for a
   * dev auditing (and fixing) a repo they already have cloned. When set, "Suggest fix" writes
   * straight into this checkout (unstaged) instead of opening a GitHub PR. */
  localThemeDir?: string;
  /** The client's ADA/accessibility scope, pasted verbatim (bullets and all). Set from the
   * dashboard's Run Audit form or `run --ada-scope`, and reused by later runs for this store so
   * the same scope doesn't have to be re-pasted every time. */
  adaScope?: string;
  notes?: string;
}

export type RunMode = "local" | "cloud";

export type RunStatus = "queued" | "running" | "succeeded" | "failed" | "stopped";

/** The live status of one audit run, written to Blob by the CLI process actually doing the work —
 * see runRecordBlobPath(). This, not an open HTTP stream, is what the dashboard follows: a run
 * survives a closed tab, a reload, and (in cloud mode) the machine that started it going to sleep.
 * Every field is set by the runner except `sandboxName`/`cmdId`, which only the web app that
 * created the sandbox knows. */
export interface RunRecord {
  runId: string;
  mode: RunMode;
  status: RunStatus;
  storeSlug: string;
  storeName: string;
  /** Exactly what was submitted — a slug or a full URL. */
  target: string;
  startedAt: string;
  finishedAt?: string;
  /** The most recent `onStage` line, i.e. what the run is doing right now. */
  stage?: string;
  /** Set once the report has been written to Blob. */
  reportId?: string;
  overallScore?: number;
  /** Failure message, shown as the headline of the failure screen. */
  error?: string;
  cliVersion?: string;
  /** Cloud runs only — how to reach the sandbox again for logs or a stop request. */
  sandboxName?: string;
  cmdId?: string;
}

/** Newest first, capped — the dashboard's "recent runs" list. */
export interface RunsIndex {
  runs: RunRecord[];
}

/** Newest-first list of the stores mirrored to Blob, so the dashboard can offer a store picker
 * without a local stores/ directory. */
export interface StoresIndex {
  stores: Array<{ slug: string; name: string; url: string; updatedAt: string }>;
}

/* ── Consent QA ─────────────────────────────────────────────────────────────────────────────
 * Behavioral cookie-consent testing: the banner is actually driven (reject / accept / granular)
 * and assertions are made on the *difference between states*, not on a snapshot of one page.
 * Deliberately separate from PixelSection, which answers the much weaker "is a CMP present?".
 */

export type CmpVendor = "cookiebot" | "onetrust" | "osano" | "cookieyes" | "shopify-native" | "heuristic" | "none";

export type TrackerCategory = "essential" | "analytics" | "marketing" | "preferences";

/** The five browser states each site is driven through, each in its own fresh incognito context. */
export type ConsentStateId = "clean" | "dismiss" | "reject" | "accept" | "granular" | "returning";

/** `blocked` (site down / bot-walled / banner never appeared) is deliberately NOT `fail`.
 * Conflating "we couldn't test it" with "it failed" is how a compliance report loses its
 * audience. `skipped` means the CMP genuinely has no such capability. */
export type ConsentTestStatus = "pass" | "fail" | "blocked" | "skipped" | "flaky";

export type ConsentSuiteId = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H";

/** Separate from the shared `Severity` because consent needs a level above `error`: a blocker
 * fails the whole run's exit code, which nothing else in the audit does. */
export type ConsentSeverity = "blocker" | "error" | "warning" | "info";

export interface ConsentCookie {
  name: string;
  domain: string;
  category: TrackerCategory;
  /** ISO timestamp, or "session" for a session cookie. */
  expires: string;
}

/** What a test result is grounded in. A compliance finding without evidence is an accusation,
 * not a bug report — nobody can act on "consent is broken". */
export interface ConsentEvidence {
  cookies?: ConsentCookie[];
  /** Full URLs of the tracker requests that triggered this result. */
  requests?: string[];
  notes?: string[];
  /** Blob pathname of the banner screenshot for the state this test read from. */
  screenshotPath?: string;
}

export interface ConsentTestResult {
  /** Stable test ID, e.g. "B1" — the contract between the report, the docs and the runbook. */
  id: string;
  suite: ConsentSuiteId;
  title: string;
  severity: ConsentSeverity;
  status: ConsentTestStatus;
  detail: string;
  recommendation?: string;
  evidence?: ConsentEvidence;
}

/** The `gtag('consent', …)` calls recorded by an init script injected *before* navigation —
 * the only way to see the default, which by definition fires before any tag loads. */
export interface ConsentModeSignals {
  default?: Record<string, string>;
  update?: Record<string, string>;
}

export interface ShopifyConsentState {
  analyticsAllowed?: boolean;
  marketingAllowed?: boolean;
  preferencesAllowed?: boolean;
  saleOfDataAllowed?: boolean;
}

export interface ConsentStateCapture {
  state: ConsentStateId;
  reached: boolean;
  /** Why the state couldn't be reached — set only when `reached` is false. */
  blockedReason?: string;
  cookies: ConsentCookie[];
  /** IDs of trackers that fired in this state. */
  trackers: string[];
  requestCount: number;
  /** A marketing interstitial covering the page in this state (email capture, spin-to-win).
   * Reported because it can sit over the consent banner and fires its own vendor's tags. */
  marketingInterstitial?: string;
  consentMode?: ConsentModeSignals;
  shopifyConsent?: ShopifyConsentState;
  screenshotPath?: string;
}

export interface ConsentTrackerHit {
  id: string;
  name: string;
  category: TrackerCategory;
  /** Which states this tracker fired in — the raw material for the state × tracker matrix. */
  firedIn: ConsentStateId[];
}

export interface ConsentTotals {
  pass: number;
  fail: number;
  blocked: number;
  skipped: number;
  flaky: number;
  /** Failures at `blocker` severity — the ones that drive a non-zero exit code. */
  blockers: number;
}

export interface ConsentSection {
  /** Null when too little was confirmed to score honestly — a number would read as a verdict on
   * the site rather than on how little could be tested. */
  score: number | null;
  cmp: CmpVendor;
  cmpDetail: string;
  /** Which region the scan ran from. v1 is always "us"; the field exists so a later EU run is
   * distinguishable in an archived report rather than silently comparable to a US one. */
  region: string;
  states: ConsentStateCapture[];
  trackers: ConsentTrackerHit[];
  tests: ConsentTestResult[];
  totals: ConsentTotals;
  /** Set when the CMP reports an implied-consent model — no prompt, consent assumed. Carries the
   * vendor's own wording so the report can say why the choice-driven suites are not applicable
   * rather than leaving a wall of untested results with no explanation. */
  impliedConsent?: string;
}

/* ── Fleet scan ─────────────────────────────────────────────────────────────────────────── */

export type ConsentFleetStatus = "ok" | "issues" | "blocked" | "error";

export interface ConsentFleetRow {
  slug: string;
  client: string;
  url: string;
  cmp: CmpVendor;
  status: ConsentFleetStatus;
  /** Null when too little was confirmed to score — see ConsentSection.score. */
  score: number | null;
  totals: ConsentTotals;
  /** Test IDs that failed, e.g. ["B1","C1"] — enough for the fleet table without the full section. */
  failedIds: string[];
  /** The failing and flaky results in full, with their evidence. Carried on the row so the fleet
   * view is actionable on its own: a list of IDs tells you a site is broken but not what to fix,
   * and passing results are the bulk of the payload while being the part nobody reads. */
  failedTests: ConsentTestResult[];
  /** Every result, including the passes — what the fleet view's per-site detail reads.
   *
   * Evidence is stripped from anything that isn't a failure: it is the bulk of the payload, and
   * a screenshot proving a test passed is not something anyone opens. Optional because scans
   * archived before this field existed still have to render. */
  tests?: ConsentTestResult[];
  /** Set when status is "error": the site could not be scanned at all. */
  error?: string;
  durationMs: number;
}

export interface ConsentFleetReport {
  id: string;
  createdAt: string;
  durationMs: number;
  region: string;
  rows: ConsentFleetRow[];
  totals: { sites: number; ok: number; issues: number; blocked: number; errored: number };
}

/* ── Registry (sites.yml) ───────────────────────────────────────────────────────────────── */

export interface ConsentSiteExpectations {
  banner?: boolean;
  /** Whether marketing tags are permitted to fire before any consent choice. Effectively always
   * false; present so a site with a documented, signed-off exception can record it here. */
  preConsentMarketing?: boolean;
  consentModeV2?: boolean;
}

export interface ConsentSiteEntry {
  slug: string;
  client?: string;
  url: string;
  repo?: string;
  cmp?: CmpVendor | "unknown";
  regions?: string[];
  expect?: ConsentSiteExpectations;
  owner?: string;
  status?: "active" | "paused" | "offboarded";
}

export interface ConsentRegistry {
  sites: ConsentSiteEntry[];
}
