// Mirrors @barrel/site-audit-shared (../../shared/src). Duplicated here (rather than
// imported via the pnpm workspace) so this app deploys to Vercel as a self-contained
// directory — the CLI package still consumes the real shared package directly.

export type Severity = "error" | "warning" | "info";

export interface CodeIssue {
  severity: Severity;
  check: string;
  message: string;
  file: string;
  line?: number;
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
  vitals?: CoreWebVitals;
  pages?: LighthousePageResult[];
  screenshotPath?: string;
  /** Absent on reports run before this field existed. */
  consoleErrors?: ConsoleErrorItem[];
  /** Lighthouse's "Agentic Browsing" category (Lighthouse 13.3+) — pass/total fraction, kept
   * out of overallScore since it's still experimental upstream. Absent on older reports. */
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
  checklist: HealthCheckItem[];
}

export type HealthStatus = "pass" | "warn" | "fail";

export interface HealthCheckItem {
  id: string;
  label: string;
  status: HealthStatus;
  detail: string;
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
  checks: HealthCheckItem[];
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
  checks: HealthCheckItem[];
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
  file?: string;
  codeFix?: string;
}

export interface AiSuggestionsSection {
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
  score: number;
  categoryScores: SitespeedCategoryScore[];
  metrics: SitespeedMetric[];
  runs: number;
  advice: SitespeedAdvice[];
}

export interface AgentReadinessSection {
  score: number;
  checks: HealthCheckItem[];
  skusSampled: number;
  issues: ThemeConcern[];
}

export interface ThemeConcern {
  title: string;
  severity: OpportunityImpact;
  detail: string;
  recommendation?: string;
}

export interface ThemeArchitectureSection {
  summary: string;
  modernPractices: BestPracticeRow[];
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

export interface Report {
  id: string;
  storeSlug: string;
  storeName: string;
  storeUrl: string;
  createdAt: string;
  durationMs: number;
  overallScore: number;
  sections: ReportSections;
  aiUsage?: AiUsage;
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
}

export interface Manifest {
  reports: ManifestEntry[];
}

/* ── Consent QA ─────────────────────────────────────────────────────────────────────────────
 * Behavioral cookie-consent testing: the banner is actually driven (reject / accept / granular)
 * and assertions are made on the *difference between states*, not on a snapshot of one page.
 * Deliberately separate from PixelSection, which answers the much weaker "is a CMP present?".
 */

export type CmpVendor = "cookiebot" | "onetrust" | "osano" | "cookieyes" | "shopify-native" | "heuristic" | "none";

export type TrackerCategory = "essential" | "analytics" | "marketing" | "preferences";

/** The five browser states each site is driven through, each in its own fresh incognito context. */
export type ConsentStateId = "clean" | "reject" | "accept" | "granular" | "returning";

/** `blocked` (site down / bot-walled / banner never appeared) is deliberately NOT `fail`.
 * Conflating "we couldn't test it" with "it failed" is how a compliance report loses its
 * audience. `skipped` means the CMP genuinely has no such capability. */
export type ConsentTestStatus = "pass" | "fail" | "blocked" | "skipped" | "flaky";

export type ConsentSuiteId = "A" | "B" | "C" | "D" | "E" | "F" | "G";

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
  score: number;
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
  score: number;
  totals: ConsentTotals;
  /** Test IDs that failed, e.g. ["B1","C1"] — enough for the fleet table without the full section. */
  failedIds: string[];
  /** The failing and flaky results in full, with their evidence. Carried on the row so the fleet
   * view is actionable on its own: a list of IDs tells you a site is broken but not what to fix,
   * and passing results are the bulk of the payload while being the part nobody reads. */
  failedTests: ConsentTestResult[];
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

export type Grade = "A" | "B" | "C" | "D" | "F";

export function gradeForScore(score: number): Grade {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 50) return "D";
  return "F";
}

export function colorForScore(score: number): string {
  if (score >= 90) return "#10B981"; // A
  if (score >= 80) return "#65A30D"; // B
  if (score >= 70) return "#D97706"; // C
  if (score >= 50) return "#EA580C"; // D
  return "#B91C1C"; // F
}

// Mirrors parseAdaScope() from shared/src/ada-scope.ts, for the Run Audit form's live preview of
// how a pasted scope will be split into items. Only the parser is duplicated here — the
// requirement catalog and the verifiers stay in the CLI, which is what actually runs them.
export interface ParsedAdaScopeItem {
  id: string;
  /** The scope line as pasted, minus its bullet marker and surrounding whitespace. */
  text: string;
  /** The "such as:" style heading this line sat under, when the pasted scope had one. */
  group?: string;
}

// Word/number bullets Word, Google Docs, Notion and plain email all produce.
const BULLET_PREFIX = /^\s*(?:[-*•·▪◦‣–—]|\d{1,2}[.)]|\(\d{1,2}\)|[a-z][.)]|o\s)\s*/i;
const MAX_ITEMS = 60;
const MAX_ITEM_CHARS = 500;

function stripBullet(line: string): string {
  return line.replace(BULLET_PREFIX, "").trim();
}

/** A line like "Test and ensure basic accessibility features are in place, such as:" introduces
 * the items below it — it's a heading, not something to verify on its own. */
function isHeading(line: string, hasFollowing: boolean): boolean {
  return hasFollowing && /:\s*$/.test(line);
}

/** Turns a pasted ADA scope — bullets, numbered lists, a "such as:" preamble, or one long
 * semicolon-separated paragraph — into discrete, verifiable items. Deliberately forgiving about
 * formatting: whatever the client's SOW happened to use should work without reformatting. */
export function parseAdaScope(raw: string): ParsedAdaScopeItem[] {
  const lines = raw
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const items: ParsedAdaScopeItem[] = [];
  let group: string | undefined;

  for (let i = 0; i < lines.length; i++) {
    const line = stripBullet(lines[i]);
    if (!line) continue;

    if (isHeading(line, i < lines.length - 1)) {
      group = line.replace(/:\s*$/, "").trim() || undefined;
      continue;
    }

    // A single line can still carry several requirements when it was pasted as prose.
    for (const part of line.split(/\s*;\s*/)) {
      const text = stripBullet(part).replace(/[;,.]\s*$/, "").trim();
      if (text) items.push({ id: "", text, group });
    }
  }

  // Fallback for a scope pasted as one unbroken paragraph ("...such as: X. Y. Z.") — no bullets
  // and no semicolons to split on, so fall back to sentence boundaries rather than handing the
  // whole paragraph to the verifiers as a single unverifiable item.
  let expanded = items;
  if (items.length === 1 && items[0].text.length > 240) {
    const sentences = items[0].text
      .split(/(?<=[.!?])\s+(?=[A-Z])/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (sentences.length > 1) {
      expanded = sentences.map((text) => ({ id: "", text, group: items[0].group }));
    }
  }

  const seen = new Set<string>();
  const deduped: ParsedAdaScopeItem[] = [];
  for (const item of expanded) {
    const key = item.text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push({ ...item, text: item.text.slice(0, MAX_ITEM_CHARS) });
    if (deduped.length >= MAX_ITEMS) break;
  }

  return deduped.map((item, i) => ({ ...item, id: `scope-${i + 1}` }));
}
