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

/* ── Data Analysis: the audit crossed with the store's own GA4 data ─────────────────────────
 *
 * Everything below describes one generated analysis, stored as its own blob beside the report
 * rather than inside it. A report is a record of what a run measured; an analysis is a separate,
 * explicitly-requested, paid act that can be re-run against the same report — folding it into
 * ReportSections would mean rewriting a finished report every time somebody pressed a button.
 *
 * The shapes are deliberately evidence-first. Nothing here lets a recommendation carry a bare
 * number: it cites evidence *by id* into a catalogue this codebase builds from the GA4 response
 * and the report, and the UI renders the catalogue's own wording. That is the structural half of
 * the guarantee that every figure shown came from real data; web/lib/data-analysis.ts holds the
 * validating half. */

/** One slice of GA4 traffic — a device category, a channel group, or a landing page. */
export interface ConversionSegment {
  label: string;
  sessions: number;
  transactions: number;
  revenue: number;
  /** transactions ÷ sessions × 100, to 2dp.
   *
   * Computed here rather than read from GA4's own `sessionConversionRate` so that every rate in
   * the analysis — totals, devices, landing pages, and the gap arithmetic between them — comes
   * out of one piece of arithmetic. Two rates produced by two different definitions, printed
   * side by side, is the sort of discrepancy a client notices and nobody can explain. */
  conversionRate: number;
}

export interface ConversionTotals {
  sessions: number;
  totalUsers: number;
  transactions: number;
  revenue: number;
  conversionRate: number;
  /** revenue ÷ transactions. Deliberately *not* GA4's `averagePurchaseRevenue`, which is revenue
   * per active user and is a different (smaller) number that nobody means by "average order
   * value". */
  averageOrderValue: number;
}

/** The complete set of figures an analysis is allowed to reason about. If a number is not in
 * here or in the audit report, it does not appear in the output. */
export interface ConversionDataset {
  propertyId: string;
  /** The property's reporting currency as GA4 reported it, or "" when GA4 sent none — in which
   * case revenue is rendered as a bare number rather than guessing at dollars. */
  currencyCode: string;
  /** Inclusive window, resolved by GA4 in the property's own timezone and read back off the
   * daily rows, so these are the days actually measured rather than the days we asked for. */
  startDate: string;
  endDate: string;
  /** Days inside the window on which GA4 recorded at least one session. This — not the width of
   * the window — is what says whether the property has enough history to reason from. */
  daysWithSessions: number;
  totals: ConversionTotals;
  byDevice: ConversionSegment[];
  byChannel: ConversionSegment[];
  byLandingPage: ConversionSegment[];
}

/** The size of a conversion gap between one segment and a better-performing benchmark, worked
 * out in code from the figures above.
 *
 * Every field is arithmetic on days that have already happened. None of it is a forecast, and the
 * model is never allowed to produce one: "closing this gap would earn £X/month" is a claim about
 * the future that no amount of historical data supports. What this says is narrower and true —
 * over the days measured, the difference between these two rates was worth this much. */
export interface ConversionGap {
  dimension: "device" | "landingPage";
  segment: string;
  benchmark: string;
  segmentSessions: number;
  segmentConversionRate: number;
  benchmarkConversionRate: number;
  /** The segment's share of all sessions in the window, as a percentage. A bad rate on 2% of
   * traffic and a bad rate on 70% of traffic are not the same problem. */
  shareOfSessions: number;
  /** Transactions the segment did not record but would have at the benchmark's rate, over
   * exactly the days measured. A ceiling on the gap, not a target. */
  transactionsAtBenchmark: number;
  /** transactionsAtBenchmark × the observed site-wide AOV. Same caveat. */
  revenueAtBenchmark: number;
}

/** One citable fact. Written by this codebase, never by the model — the model may only reference
 * it by `id`, and the UI renders `text` verbatim from here. */
export interface AnalysisEvidenceItem {
  id: string;
  text: string;
  /** Where the fact came from: straight off the GA4 response, out of the audit report, or
   * computed by this codebase from the two. The distinction is shown in the UI because
   * "arithmetic" facts are ours, not measurements. */
  source: "ga4" | "audit" | "arithmetic";
}

/** How firmly the data supports the connection a recommendation draws.
 *
 * "measured" means the analysis is only restating what GA4 recorded. "hypothesis" means it is
 * joining an audit finding to a GA4 number — which is a correlation worth testing, never a
 * demonstrated cause. Almost everything interesting is a hypothesis, and saying so is the point. */
export type AnalysisConfidence = "measured" | "hypothesis";

export interface DataAnalysisRecommendation {
  rank: number;
  title: string;
  /** What to actually do. */
  action: string;
  /** Ids into DataAnalysisSection.evidence. A recommendation with none of these is discarded. */
  evidenceIds: string[];
  /** Ids of audit findings (as produced by the report's own finding collection) this connects
   * to. Empty when the GA4 data raised something the audit has no finding for. */
  findingIds: string[];
  /** Report section ids ("vitals", "ux", …) for when the connection is to a section as a whole
   * rather than to one finding. */
  sectionIds: string[];
  /** What to expect from doing it — a direction and a rough magnitude, never a percentage the
   * model made up. */
  expectation: string;
  confidence: AnalysisConfidence;
  /** Why the link between audit finding and GA4 number is or is not causal, in the open. */
  causalNote: string;
}

/** A recommendation the validator threw out, and why.
 *
 * Kept and rendered rather than silently dropped: a filtered-out recommendation otherwise looks
 * identical to the model simply having had less to say, which hides the fact that the guardrails
 * fired at all. */
export interface RejectedRecommendation {
  title: string;
  reason: string;
}

/** "insufficient-data" is a first-class outcome, not an error. A property with a fortnight of
 * history, or with no ecommerce tracking configured, genuinely cannot support conversion
 * recommendations — and the analysis says so and stops rather than filling the space. */
export type DataAnalysisStatus = "ok" | "insufficient-data";

export interface DataAnalysisSection {
  storeSlug: string;
  reportId: string;
  generatedAt: string;
  status: DataAnalysisStatus;
  /** Present whatever the status: the figures the verdict was reached on are shown either way,
   * so "not enough data" is checkable rather than asserted. */
  dataset: ConversionDataset;
  gaps: ConversionGap[];
  evidence: AnalysisEvidenceItem[];
  /** Plain statements of what this data could not support. Always rendered, never empty on an
   * insufficient-data verdict. */
  limitations: string[];
  headline: string;
  recommendations: DataAnalysisRecommendation[];
  rejected: RejectedRecommendation[];
  usage?: AiUsage;
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

/** Where a theme's codebase came from, read off `config/settings_schema.json`'s `theme_info`
 * block — the only place a Shopify theme records its own name/version/author. */
export type ThemeOrigin =
  /** A stock Shopify theme, unrenamed: theme_author is Shopify and the name is a known stock theme. */
  | "shopify-stock"
  /** A stock Shopify theme that has been forked and renamed — the name still matches a stock theme
   * but the author doesn't, so upstream updates no longer apply cleanly. */
  | "shopify-fork"
  /** A named third-party/agency theme (Barrel's own base framework, a Theme Store theme, etc.). */
  | "third-party"
  /** theme_info exists but names nothing recognizable, or is missing entirely — built from scratch. */
  | "custom"
  /** No config/settings_schema.json at all, so nothing can be claimed either way. */
  | "unknown";

export interface ThemeIdentity {
  /** `theme_name` — the theme's own name for itself. Absent if theme_info is missing. */
  name?: string;
  version?: string;
  author?: string;
  documentationUrl?: string;
  origin: ThemeOrigin;
  /** The stock Shopify theme this appears to be based on, when one was recognized. */
  basedOn?: string;
  /** One sentence stating what was found and where, so the claim is auditable. */
  detail: string;
}

/** One measured fact about the codebase — deliberately a value plus its provenance, never a
 * verdict. The verdicts live in `opportunities` and in the AI architecture assessment. */
export interface CodebaseFact {
  label: string;
  value: string;
  /** How the value was derived, or what it implies — one short sentence. */
  detail?: string;
}

/** A concrete, evidence-backed improvement available in the theme codebase. */
export interface ThemeOpportunity {
  title: string;
  impact: OpportunityImpact;
  /** Rough implementation size, so a list of these can be triaged. */
  effort?: "low" | "medium" | "high";
  /** What was found, with the numbers/filenames it was found in. */
  detail: string;
  recommendation?: string;
  /** "scan" = derived deterministically from the files on disk; "ai" = Claude's read of the code. */
  source: "scan" | "ai";
}

/** What theme this store runs, what its codebase is made of, and what could be improved in it.
 * Entirely deterministic — no API key needed — and computed from the synced theme directory. */
export interface ThemeProfileSection {
  identity: ThemeIdentity;
  /** Measured facts: template architecture, Liquid footprint, asset weight, build tooling,
   * front-end approach, localization, custom-data usage, repo hygiene. */
  facts: CodebaseFact[];
  /** Modernization and cleanup opportunities found by scanning the files, impact-first. */
  opportunities: ThemeOpportunity[];
}

export interface ThemeArchitectureSection {
  summary: string;
  modernPractices: BestPracticeRow[];
  concerns: ThemeConcern[];
  /** Forward-looking upgrades Claude sees in the code that the deterministic scan can't spot —
   * always `source: "ai"`, and prompted to avoid restating what the scan already found. */
  opportunities?: ThemeOpportunity[];
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

/** How much work a recommendation is, phrased for a client-facing deck rather than a dev ticket. */
export type RecommendationEffort = "quick win" | "moderate" | "larger project";

/** One action to put in front of a client — the deliverable of the Recommendations tab. Written in
 * the voice of an account manager or business analyst, not a linter: what to do, why it matters
 * commercially, and which numbers in this report say so. */
export interface ClientRecommendation {
  /** The action, phrased as something to do ("Cut the product page's load time in half"). */
  title: string;
  /** Which part of the experience it moves — "Product page", "Site speed", "Navigation", "Checkout". */
  area: string;
  /** Why it matters commercially, in plain language a stakeholder can repeat in a meeting. */
  why: string;
  /** The work itself, described so a client can approve it without reading a dev ticket. */
  what: string;
  /** The conversion outcome to expect — directional and honest, never an invented percentage. */
  expectedImpact: string;
  /** The specific figures or findings elsewhere in this report that support it. */
  evidence: string[];
  effort: RecommendationEffort;
}

/** The client-ready read of the whole report: 5-10 things to do next, ordered by how much they
 * should move conversion, plus the credit due for what already works. Synthesized by Claude from
 * every other section, so it is only present when the run had an API key. */
export interface RecommendationsSection {
  /** Positive, plain-language framing of where the storefront stands today (2-4 sentences). */
  headline: string;
  /** What is already working, named specifically — so the deck opens on credit, not criticism. */
  strengths: string[];
  /** The actions, highest conversion impact first. */
  recommendations: ClientRecommendation[];
}

export interface ReportSections {
  code?: CodeSection;
  performance?: PerformanceSection;
  accessibility?: AccessibilitySection;
  adaScope?: AdaScopeSection;
  sitespeed?: SitespeedSection;
  themeProfile?: ThemeProfileSection;
  themeArchitecture?: ThemeArchitectureSection;
  agentReadiness?: AgentReadinessSection;
  health?: HealthSection;
  pixels?: PixelSection;
  consent?: ConsentSection;
  security?: SecuritySection;
  themeStructure?: ThemeStructureSection;
  bestPractices?: BestPracticesSection;
  analytics?: AnalyticsSection;
  competitors?: CompetitorSection;
  geoSeo?: GeoSeoSection;
  ux?: UxSection;
  aiSuggestions?: AiSuggestionsSection;
  summary?: SummarySection;
  recommendations?: RecommendationsSection;
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

/* ── Security & Compliance ──────────────────────────────────────────────────────────────────
 * Everything here is read from an HTTP response, the served HTML, or a TLS handshake — no
 * browser, no multi-state flows. That ceiling is deliberate: it keeps the section cheap enough
 * to run on every audit, and keeps every verdict reproducible with curl by whoever is reading
 * the report. Anything that would need a real browser to observe belongs in the consent or
 * pixel sections, which already pay for one.
 */

export type SecuritySeverity = "critical" | "high" | "medium" | "low";

/** `not-tested` is a first-class outcome, never rounded into `pass` or `fail`. A request that
 * timed out, a port that refused a connection and a header we chose not to judge are all
 * coverage gaps, and a report that presents a coverage gap as a clean bill of health is worse
 * than one that admits it looked and could not tell. `warn` is different: it IS an observation
 * — the control exists but is weaker than it should be. */
export type SecurityCheckStatus = "pass" | "warn" | "fail" | "not-tested";

export type SecurityCheckCategory = "headers" | "transport" | "cookies" | "exposure" | "supply-chain";

/** The raw material behind a verdict. Without it a security finding is an accusation the reader
 * has to take on trust — with the header value or the URL in front of them they can re-check it
 * in one command, which is the only reason a client-facing security claim is worth making. */
export interface SecurityEvidence {
  /** Verbatim header lines, cookie attributes or matched strings the verdict was read from. */
  observed?: string[];
  /** Exact URLs that were requested to reach this verdict. */
  urls?: string[];
  notes?: string[];
}

export interface SecurityCheck {
  /** Stable id, e.g. "hsts" — the contract between the report and any follow-up ticket. */
  id: string;
  category: SecurityCheckCategory;
  title: string;
  /** How much this control matters if it is wrong — a fixed property of the check, not of this
   * site's result. It doubles as the check's scoring weight, so a passing `critical` check earns
   * as much as a failing one costs. */
  severity: SecuritySeverity;
  status: SecurityCheckStatus;
  /** What was actually observed, stated plainly enough to quote to a client. */
  detail: string;
  /** Concrete remediation — omitted on `pass`, and on `not-tested`, where the next step is to
   * re-test rather than to change anything. */
  recommendation?: string;
  evidence?: SecurityEvidence;
}

export interface SecurityTotals {
  pass: number;
  warn: number;
  fail: number;
  notTested: number;
  /** Failures at `critical` severity — the ones that clamp the section score into the bottom half. */
  critical: number;
}

export interface SecuritySection {
  /** Null when too little was confirmed to score honestly — see SecurityCheckStatus. */
  score: number | null;
  /** The URL the checks were actually made against, after redirects — not necessarily the URL
   * that was requested, and the difference matters when reading a header verdict. */
  scannedUrl: string;
  checks: SecurityCheck[];
  totals: SecurityTotals;
  /** Distinct cross-origin hosts serving <script src> in the delivered HTML. Reported as a
   * supply-chain surface count: each one can change its own code without anyone here noticing. */
  thirdPartyScriptOrigins: string[];
  /** Set when the page itself could not be fetched, so nothing was testable. `checks` is empty
   * and `score` is null — never zero, which would read as "this site failed everything". */
  fatalError?: string;
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

export interface StoreConfig {
  slug: string;
  name: string;
  url: string;
  shopifyDomain?: string;
  /** GA4 numeric property ID (Admin → Property Settings), for the Traffic & Revenue section.
   * The service account in GOOGLE_SERVICE_ACCOUNT_KEY must be a Viewer on the property. */
  ga4PropertyId?: string;
  githubRepo?: string;
  githubBranch?: string;
  themeSubdir?: string;
  /** Step 0 of a CRO audit — the intake. On the store rather than on a CRO report because it
   * describes the client and not one audit of them. Each report copies the brief it was run
   * against, so editing this never rewrites what a past audit was based on. */
  croBrief?: CroBrief;
}

export interface StoresIndex {
  stores: Array<{ slug: string; name: string; url: string; updatedAt: string }>;
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

export type ComplianceBand = "at-risk" | "improving" | "healthy";

/** Bands for the compliance scores, which do not use the A-F scale the Lighthouse-derived
 * numbers do.
 *
 * Two reasons they need their own scale. The compliance scores are a weighted proportion of what
 * was confirmed rather than a percentage of a fixed total, so a 40 there is not the same claim as
 * a Lighthouse 40. And any confirmed top-severity failure scales the result into the bottom half
 * by design, which means a site with one unresolved blocker mathematically cannot reach green —
 * that is the intended reading, not a quirk: nothing that leaks data after an opt-out should
 * present as healthy.
 *
 * The cutoffs are deliberately reachable. Full marks is not a realistic target for a live
 * storefront with a working marketing stack, and a scale where everything is red teaches people
 * to ignore it. */
export function complianceBand(score: number): ComplianceBand {
  if (score >= 60) return "healthy";
  if (score >= 30) return "improving";
  return "at-risk";
}

export function colorForComplianceScore(score: number): string {
  const band = complianceBand(score);
  return band === "healthy" ? "#10B981" : band === "improving" ? "#D97706" : "#B91C1C";
}

export const COMPLIANCE_BAND_LABEL: Record<ComplianceBand, string> = {
  healthy: "Healthy",
  improving: "Improving",
  "at-risk": "At risk",
};

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

export type RunMode = "local" | "cloud";

/** Where a run physically happened. Mirrored because a CroCapture and a CroReport carry it, and
 * the CRO report page shows whether a capture came off a laptop or a cloud sandbox — the fold
 * measurements a CRO audit argues about are a property of the viewport, not the machine, but a
 * capture from an unexpected place is still the first thing worth checking when a slide looks wrong. */
export interface RunnerInfo {
  mode: RunMode;
  cliVersion?: string;
  region?: string;
  vcpus?: number;
}

/* ── CRO audit ─────────────────────────────────────────────────────────────────────────────────
 *
 * Mirrors shared/src/cro-types.ts. Duplicated here (rather than imported via the pnpm workspace)
 * for the same reason as everything above: this app deploys to Vercel as a self-contained
 * directory. shared/test/mirror-drift.test.ts is what keeps the two in step.
 */


/** The page *types* a CRO audit reasons about, not individual URLs.
 *
 * This is the unit of the whole deliverable: findings are grouped by page type because that is how
 * a fix gets made — a PDP opportunity is a change to one template that affects every product. Nav
 * is in the list despite not being a page: it is reviewed on every CRO audit, and it is where a
 * surprising share of the friction lives. */
export type CroPageGroup = "nav" | "home" | "plp" | "pdp" | "cart" | "checkout" | "search";

/** Behaviour differs enough between the two that a single verdict for a page type would average
 * away the finding. Mobile carries most sessions on most storefronts and converts worst; the split
 * is where that shows up. */
export type CroDevice = "mobile" | "desktop";

export const CRO_PAGE_GROUPS: readonly CroPageGroup[] = [
  "nav",
  "home",
  "plp",
  "pdp",
  "cart",
  "checkout",
  "search",
];

export const CRO_DEVICES: readonly CroDevice[] = ["mobile", "desktop"];

/** Human labels for page groups, defined once so the CLI's progress lines, the report tabs and the
 * deck all name the same thing the same way. */
export const CRO_PAGE_GROUP_LABELS: Record<CroPageGroup, string> = {
  nav: "Navigation & Menu",
  home: "Home",
  plp: "Collection (PLP)",
  pdp: "Product (PDP)",
  cart: "Cart & Drawer",
  checkout: "Checkout",
  search: "Search Results",
};

/** The seven steps of Barrel's CRO audit process, in the order they are *executed*.
 *
 * `insights` runs last and is presented first — it is a synthesis of everything else, so it cannot
 * be written until the rest exists. The report's own tab order puts it first; this list is the
 * order a run works through. */
export type CroStepKey = "analytics" | "ux" | "behaviour" | "voc" | "journey" | "competitors" | "insights";

export const CRO_STEP_KEYS: readonly CroStepKey[] = [
  "analytics",
  "ux",
  "behaviour",
  "voc",
  "journey",
  "competitors",
  "insights",
];

export const CRO_STEP_LABELS: Record<CroStepKey, string> = {
  analytics: "Analytics & Customer Journey",
  ux: "Website & UX Audit",
  behaviour: "Heatmaps & Session Recordings",
  voc: "Voice of the Customer",
  journey: "CX Journey Mapping",
  competitors: "Competitive Benchmark",
  insights: "Key Insights",
};

/** Where a step's content came from, recorded on the step itself.
 *
 * A reader deciding how much weight to put on a slide needs to know whether it came from measured
 * data, from a model reading a screenshot, or from a strategist typing. Provenance that lives only
 * in someone's memory of how the deck was made is provenance that is lost by the second meeting. */
export type CroStepSource =
  /** Drafted from a browser capture — screenshots and DOM signals of the live site. */
  | "capture"
  /** Produced in the deployed app from an API (GA4) and/or a model, with no browser involved. */
  | "app"
  /** Built from material a human supplied — pasted reviews, uploaded heatmap images, survey data. */
  | "uploaded"
  /** Written or decided by a strategist. */
  | "manual";

export type CroStepStatus =
  | "generated"
  /** Not yet run. The normal state of `analytics` and `insights` straight after a capture run,
   * since both are produced in the app rather than by the CLI. */
  | "pending"
  /** Deliberately excluded from this run (a --skip flag, or a step this tool does not yet do). */
  | "skipped"
  /** Ran, and concluded there was not enough to say anything. Distinct from "skipped" because it
   * is a finding: an empty Analytics step because GA4 has 6 days of data is information. */
  | "insufficient";

/** One citable fact a bullet is allowed to rest on.
 *
 * The same closed-catalogue device the Data Analysis feature uses: the model is handed a list of
 * facts with ids, may cite them by id, and anything numeric it writes is checked against them
 * before it reaches a page. Without this, a slide reading "mobile converts 40% worse" is
 * indistinguishable from a measured one. */
export interface CroEvidenceItem {
  id: string;
  /** The fact, in the wording that will be shown to a reader if this evidence is surfaced. */
  label: string;
  /** Where it came from — "GA4, last 28 days", "PDP capture, mobile", "competitor sweep". */
  source: string;
  /** Present when the fact is a number, so a bullet's figures can be checked against it. */
  value?: number;
  /** Blob pathname of a screenshot this fact was read off, when there is one. */
  screenshot?: string;
}

export type CroImpact = "high" | "medium" | "low";

/** One deck bullet, in the fixed house format: `Short title: short description`.
 *
 * Title and description are stored apart rather than as one pre-joined string so the deck, the web
 * report and a future export can each present them differently, and so the shape validator in
 * cro-slides.ts has two fields to check rather than one string to parse. */
export interface CroBullet {
  /** Content-derived (see croBulletId) so an edit made against this bullet survives a page reload
   * and is recognisably orphaned by a re-draft that rewords it. */
  id: string;
  title: string;
  description: string;
  impact?: CroImpact;
  /** A short category label shown above the title. Used by the Key Insights cards, whose house
   * format is a tag ("Product Prioritisation", "Decision Clarity") over a bolded headline. */
  tag?: string;
  /** `CroEvidenceItem.id`s this bullet rests on. Empty is allowed but flagged in review: a bullet
   * citing nothing is an opinion, which is sometimes the honest thing but should be visible. */
  evidenceIds: string[];
}

/** A comparison table on a slide.
 *
 * Bullets are the house format, but a competitive benchmark's most useful artefact is a grid: who
 * has subscriptions, who has a size guide, who states a free-shipping threshold. It is derived
 * deterministically from the captures with no model involved, which is exactly why it is worth
 * putting in front of a client unedited. */
export interface CroTable {
  caption?: string;
  /** Header cells. The first names the row-label column. */
  columns: string[];
  rows: CroTableRow[];
}

export interface CroTableRow {
  label: string;
  /** One per column after the first. A boolean renders as a tick or a dash; a string renders as
   * written, for a column that is a measurement rather than a presence check. */
  cells: Array<boolean | string>;
}

/** One slide of the deliverable — a page group, a device, a competitor, or a fixed VoC slide. */
export interface CroSlide {
  id: string;
  label: string;
  group?: CroPageGroup;
  device?: CroDevice;
  /** The 2-line opening the house format calls for on competitor and VoC slides. */
  intro?: string;
  bullets: CroBullet[];
  /** Blob pathnames of the screenshots behind this slide, shown alongside the bullets. */
  screenshots?: string[];
  /** Present instead of (or alongside) bullets when the slide's content is a comparison grid. */
  table?: CroTable;
  /** Competitor slides close on "Brand Positioning: Wellness + Eco Luxury". */
  footnote?: string;
}

export interface CroStep {
  key: CroStepKey;
  status: CroStepStatus;
  source: CroStepSource;
  slides: CroSlide[];
  /** Every fact the step's bullets were allowed to cite, kept so a reader can check one and so a
   * re-draft is graded against the same catalogue. */
  evidence: CroEvidenceItem[];
  /** What this step could not establish, in the wording shown on the page. Populated even on a
   * successful step — a step can be worth presenting and still have holes worth naming. */
  limitations: string[];
  /** Bullets the shape/citation validator rejected, with the reason. Surfaced rather than dropped
   * silently: a step that quietly discarded three of its five bullets looks like a thin step. */
  rejected?: CroRejectedBullet[];
  generatedAt?: string;
  aiUsage?: AiUsage;
}

export interface CroRejectedBullet {
  title: string;
  description: string;
  reason: string;
}

/** Step 0 — the intake. Stored on the store's config rather than per report, because it describes
 * the client and not one audit of them, and because a second CRO audit for the same store should
 * not need it re-typed. */
export interface CroBrief {
  /** Competitor storefronts the client considers relevant. Three is the working number. */
  competitorUrls?: string[];
  /** Where customer reviews can be read — a Yotpo/Judge.me page, an Amazon listing, or the store's
   * own reviews page. Used by the VoC step, and recorded even before that step exists so the
   * intake is complete. */
  reviewsUrl?: string;
  /** Analytics and behaviour tooling this client actually has, so the report can say which of its
   * steps had no source rather than appearing to have found nothing. */
  dataSources?: CroDataSource[];
  /** Business-model facts that change which page groups and journey steps make sense — a
   * subscription store needs a frequency-selection step that a one-off store does not. */
  subscription?: boolean;
  giftCards?: boolean;
  /** Brand positioning / guidelines, pasted. Given to the drafting prompts so a recommendation
   * does not fight the brand it is recommending for. */
  positioning?: string;
  /** What the client already believes is wrong. Handed to the drafting prompts so the audit
   * engages with their hypotheses instead of talking past them. */
  hypotheses?: string;
  /** Page-group URL overrides, for a store whose PLP/PDP conventions the crawler guesses wrong. */
  pageUrls?: Partial<Record<CroPageGroup, string>>;
}

export type CroDataSource =
  | "ga4"
  | "shopify-analytics"
  | "hotjar"
  | "clarity"
  | "quantum-metric"
  | "reviews-platform"
  | "survey";

/* ── Capture: what a browser saw ─────────────────────────────────────────────────────────────── */

/** Measurements taken in the page, which no screenshot can be asked for after the fact.
 *
 * These are the "scroll proxy": they say where things sit relative to the fold, which is the
 * question a scroll map answers, without a heatmap tool. They are a proxy for attention, not
 * evidence of it, and every surface that shows them says so — a section 380px below the fold is a
 * reason to suspect it is unseen, not a measurement that it was. */
export interface CroMeasurements {
  viewportHeight: number;
  documentHeight: number;
  /** Distance from the top of the document to the primary call to action, in CSS pixels. The
   * single most useful number in the set: on mobile it is routinely below the fold. */
  primaryCtaY?: number;
  /** Whether the primary CTA is inside the first viewport. */
  primaryCtaAboveFold?: boolean;
  /** Top offset and height of each major page section, in document order — the shape of the page
   * as a reader scrolls it. */
  sectionOffsets: CroSectionOffset[];
  /** Interactive elements (links, buttons, inputs) that start below the first viewport. */
  interactiveBelowFold: number;
  /** A persistent add-to-cart that follows the scroll, which changes the fold argument entirely. */
  stickyAddToCart?: boolean;
  /** Tap targets smaller than 44x44 CSS px. Mobile only — the number is meaningless on a pointer
   * device, and reporting it there invites a fix nobody needed. */
  smallTapTargets?: number;
  /** Contrast ratio of the primary CTA's text against its background. Below 4.5 is both an
   * accessibility failure and a conversion one. */
  ctaContrast?: number;
  /** Form fields in the primary form on the page — the checkout number people argue about. */
  formFieldCount?: number;
}

export interface CroSectionOffset {
  /** A short, human-readable identity for the section — its heading text where it has one,
   * otherwise its tag and class. Enough to point at it in a bullet. */
  label: string;
  top: number;
  height: number;
}

export interface CroPageCapture {
  group: CroPageGroup;
  device: CroDevice;
  url: string;
  /** Blob pathname of the full-page screenshot. */
  screenshotFull?: string;
  /** Blob pathname of the first-viewport screenshot. Both are kept: the fold crop is what a
   * visitor saw, the full page is what the strategist needs to argue about order. */
  screenshotFold?: string;
  /** Deterministic pass/warn/fail signals read out of the DOM — the same `HealthCheckItem` shape
   * the site audit uses everywhere, so the existing checklist components render these unchanged. */
  signals: HealthCheckItem[];
  measurements: CroMeasurements;
  /** Something worth knowing about how this page was captured, when it is not an error — a cart
   * that turned out to be a drawer, a group reached by a redirect. Shown alongside the slide, since
   * it changes how the findings should be read. */
  note?: string;
  /** True when the page rendered as an overlay over a different page — the drawer-only cart most
   * Shopify themes ship. The DOM signals still describe the overlay, so they are kept; every
   * scroll-shaped measurement describes the page underneath it, so those are not published. */
  overlay?: boolean;
  /** Why this page could not be captured, when it could not. A capture that quietly omits the cart
   * reads as a store with no cart problems. */
  error?: string;
}

/** One browser pass over a storefront. The evidence half of a CRO audit, stored on its own so it
 * can be interpreted more than once. */
export interface CroCapture {
  id: string;
  storeSlug: string;
  storeUrl: string;
  createdAt: string;
  durationMs: number;
  pages: CroPageCapture[];
  /** Competitor captures, keyed by hostname. Same shape as the client's own pages. */
  competitors?: CroCompetitorCapture[];
  limitations: string[];
  runner?: RunnerInfo;
}

export interface CroCompetitorCapture {
  name: string;
  url: string;
  pages: CroPageCapture[];
  /** Lighthouse/vitals column from the existing competitor analyzer, when it ran. */
  performance?: number;
  error?: string;
}

/* ── The report ──────────────────────────────────────────────────────────────────────────────── */

export interface CroReport {
  id: string;
  storeSlug: string;
  storeName: string;
  storeUrl: string;
  createdAt: string;
  durationMs: number;
  /** The intake this audit was run against, copied in rather than referenced. The store's brief
   * will be edited before the next audit, and a report has to keep meaning what it meant. */
  brief: CroBrief;
  steps: Partial<Record<CroStepKey, CroStep>>;
  /** The capture these steps were drafted from — the same id as the report on a normal run, but
   * held separately because a re-draft in the app produces a new report from an old capture. */
  captureId?: string;
  aiUsage?: AiUsage;
  /** Barrel email of whoever last pressed Generate. Recorded because the app-side steps are a paid
   * act taken by a person, and "who ran this, and when" is the first question about a figure a
   * client is querying. */
  generatedBy?: string;
  runner?: RunnerInfo;
}

/** A strategist's corrections, kept apart from the generated report.
 *
 * The generated report is a record of what the tool concluded at a moment, and it may already have
 * been sent to a client. Editing it in place would destroy that, and would make "did we change
 * this after we presented it?" unanswerable. Same reasoning as the Data Analysis blob being a
 * sibling of its report rather than a section inside it. */
export interface CroEdits {
  croId: string;
  storeSlug: string;
  updatedAt: string;
  /** Barrel email of whoever last saved. Not for policing — for asking them what they meant. */
  editedBy?: string;
  bullets: Record<string, CroBulletEdit>;
}

export interface CroBulletEdit {
  title?: string;
  description?: string;
  /** Hidden rather than deleted, so an edit is always reversible and a re-draft can tell the
   * difference between "never generated" and "generated and rejected by a human". */
  hidden?: boolean;
  updatedAt: string;
}

export interface CroIndexEntry {
  id: string;
  storeSlug: string;
  storeName: string;
  storeUrl: string;
  createdAt: string;
  /** Which steps actually have content, so the list can show completeness without reading every
   * report blob — the same reason the report manifest carries scores. */
  stepsGenerated: CroStepKey[];
  /** Hides a report from the default list without deleting it. Set only from the web app. */
  archived?: boolean;
}

export interface CroIndex {
  reports: CroIndexEntry[];
}
