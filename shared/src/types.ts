import type { CroBrief } from "./cro-types.js";

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
  /** How many audits in this category failed in total, before `audits` was capped.
   *
   * Without it the report states a floor as though it were a total: `audits` keeps only the worst
   * few, so "12 issues" on a category with sixty failures is true of the list and false of the
   * site. Absent on reports written before the count was kept. */
  failingAudits?: number;
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
  /** Revenue over orders. Deliberately **not** GA4's `averagePurchaseRevenue`, which is revenue
   * per active user and is a different (smaller) number that nobody means by "average order
   * value" — and which this section used to report, while the Data Analysis tab computed it
   * correctly, so one report showed two AOVs for one store. */
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
  /** 2-4 sentence narrative: how the theme appears to be built (custom vs. stock-based, page-builder
   * reliance, Online Store 2.0 vs. legacy template architecture). */
  summary: string;
  /** Verdict table for Shopify platform-feature adoption — OS 2.0 JSON templates, section groups,
   * theme blocks / app-block support, metafields usage, settings schema quality, etc. */
  modernPractices: BestPracticeRow[];
  /** Other architectural concerns beyond raw lint errors — e.g. page-builder reliance fighting the
   * theme's own architecture, inconsistent patterns, sections missing block/app-block support. */
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

/* ── Coverage ───────────────────────────────────────────────────────────────────────────────
 * What the run actually attempted, and what became of each attempt.
 */

/** Why a section is or is not in `ReportSections`.
 *
 * The conflation this exists to end: a section that was skipped, a section that crashed, and a
 * section that ran and found nothing are *byte-identical* in `sections` — all three are an absent
 * key. That is the same misread 1.23 fixed inside Privacy Compliance ("untested no longer looks
 * like clean"), and it is worse one level up, because `overallScore` is an average over whichever
 * sections happened to produce a number, with nothing recording which those were.
 *
 * `skipped` and `not-applicable` are kept apart deliberately: "you passed --skip-axe" and "this
 * store has no GA4 property linked" lead a reader to different actions, and rounding them
 * together throws away the only one they can do something about. */
export type SectionStatus =
  /** The analyzer ran to completion. Its absence from `sections` then means it found nothing to
   * report, which is the only case where absence may be read as good news. */
  | "ran"
  /** The operator asked for it not to run — a `--skip-*` flag, or an opt-in never opted into. */
  | "skipped"
  /** It could not run for want of an input nobody withheld on purpose: no theme code, no GA4
   * property, no ADA scope pasted, no competitors given. */
  | "not-applicable"
  /** It ran and threw, or exceeded its time budget. A coverage gap, not a clean result. */
  | "failed";

/** A cap the analyzer applied to its own output.
 *
 * Several analyzers keep only the worst N of what they found (15 Lighthouse audits per category,
 * 12 signals per AI prompt). Without this the report states a floor as though it were a total,
 * which is the same class of untruth as presenting a coverage gap as a pass. */
export interface SectionTruncation {
  /** How many made it into the section. */
  kept: number;
  /** How many there actually were. */
  found: number;
  /** What is being counted, for a sentence like "showing 15 of 63 failing audits". */
  what: string;
}

export interface SectionCoverage {
  status: SectionStatus;
  /** Bounds this analyzer's own work. `Report.createdAt` is one timestamp stamped after every
   * analyzer finished, so on a twenty-minute run it describes none of them: the Lighthouse pass
   * and the consent pass can be a quarter of an hour apart and both read as the same instant. */
  startedAt?: string;
  finishedAt?: string;
  /** Stated plainly enough to show a reader. Always present for every status but `ran`. */
  reason?: string;
  truncated?: SectionTruncation;
}

/** Keyed off `ReportSections` itself, so a section added there without a coverage entry is a type
 * error rather than a silent gap in the record. */
export type SectionKey = keyof ReportSections;

/** Partial only so reports written before coverage existed still typecheck. A run that records
 * coverage records it for every key — asserted by test rather than by the type, which cannot
 * distinguish "this run predates coverage" from "this run forgot a section". */
export type ReportCoverage = Partial<Record<SectionKey, SectionCoverage>>;

/* ── Scoring ────────────────────────────────────────────────────────────────────────────────
 * What the headline number was actually an average of.
 */

/** One scored area — the unit `overallScore` averages.
 *
 * `id` rather than a section key because the two are not one-to-one: the Lighthouse pass alone
 * contributes four of them, so keying on `performance` would silently collapse four numbers into
 * one and change the average. */
export interface ScoreContributor {
  id: string;
  label: string;
  section: SectionKey;
  score: number;
}

/** Why `overallScore` alone is not enough.
 *
 * It is an average over whatever happened to produce a number: a run with four `--skip-*` flags
 * averaged six values, a full run averaged thirteen, and both were stored as a bare integer with
 * nothing recording the denominator. Baseline & Reporting then differenced one against the other
 * as though they were the same measurement.
 *
 * Two reports are comparable when their contributor `id` sets match. That is a fact about the run,
 * so it is recorded by the run rather than guessed at afterwards. */
export interface ScoreBreakdown {
  score: number;
  contributors: ScoreContributor[];
  /** Areas that would have counted had their section produced a number. Named rather than merely
   * absent, so a reader can see what the score does not cover without knowing the full list. */
  missing: Omit<ScoreContributor, "score">[];
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
  /** The headline number. Kept as a bare integer because every archived report, the manifest and
   * the history dropdown are keyed off it; `scoreBreakdown` is what says whether two of them mean
   * the same thing. */
  overallScore: number;
  /** What `overallScore` was averaged from. Absent on reports written before it was recorded —
   * and those cannot be safely compared to anything, which is the point. */
  scoreBreakdown?: ScoreBreakdown;
  sections: ReportSections;
  /** What every analyzer did, including the ones that produced nothing. Absent on reports written
   * before coverage existed — and absent is not the same as empty: for those, nothing is known
   * about what ran, which is exactly the state this field exists to end. */
  coverage?: ReportCoverage;
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
  /** The contributor ids `overallScore` was averaged from, so progress views can tell a
   * like-for-like comparison from a misleading one without fetching every report blob. Absent on
   * entries written before score breakdowns existed. */
  scoredAreas?: string[];
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
  /** "owner/repo" of the GitHub repo connected to this store via `link-repo` (or the dashboard's
   * repo picker). Whether a copy of it exists on disk depends on `githubMode`. */
  githubRepo?: string;
  /** Branch the connection reads — omitted when the repo's default branch is used. */
  githubBranch?: string;
  /** How a run gets this store's theme code out of `githubRepo`:
   *  - `"pull"` (the default, and what every connection made before this field existed did) —
   *    the repo was cloned once into `stores/<slug>/theme/`. A snapshot: it is whatever the repo
   *    looked like the day it was pulled, until someone pulls it again.
   *  - `"read"` — nothing is kept on disk. Each run downloads the ref's tarball to a temp
   *    directory, reads it, and deletes it, so every audit sees the branch as it is right now.
   *
   * Both are read-only: the connector never writes to the repo in either mode. The one sanctioned
   * write path in this tool is still the separately-gated "Suggest fix" PR flow in `git-pr.ts`. */
  githubMode?: "pull" | "read";
  /** Who connected the repo and when, in ISO form — recorded because a `"read"` connection leaves
   * no artefact on disk to date, so without this there is nothing to say where the theme code in a
   * report came from. */
  githubConnectedAt?: string;
  githubConnectedBy?: string;
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
  /** Step 0 of a CRO audit — the intake: competitors, reviews source, business model, the client's
   * own hypotheses. On the store rather than on a CRO report because it describes the client and
   * not one audit of them, and because a second CRO audit should not need it re-typed. Each report
   * copies the brief it was run against, so editing this never rewrites history. */
  croBrief?: CroBrief;
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

/* ── Vendor inventory ───────────────────────────────────────────────────────────────────────
 * The "take inventory of the cookies & scripts that fire" deliverable: one row per vendor,
 * answering what it is, how it got on the page, what the CMP says it is, and whether it fires
 * in a way that respects that.
 *
 * Deliberately open-ended where the test suites are closed. The suites assert against a
 * catalogue of known trackers, which is right for a pass/fail claim; an inventory that only
 * listed catalogued vendors would silently omit the uncatalogued ones, and on a real storefront
 * those are the majority. A vendor nobody has catalogued is exactly the vendor a client has not
 * accounted for, so it has to appear — as an identified unknown rather than not at all.
 */

/** How a vendor's code got onto the page.
 *
 * The distinction the fix depends on: a tag hardcoded in the theme `<head>` is removed by editing
 * the theme, one injected by a tag manager is removed in the tag manager, and a Shopify web pixel
 * is governed by its own `privacyPurposes` and cannot be gated by a CMP at all. Reporting all
 * three as "the pixel fired" hands the client a finding no one owns. */
export type VendorLoadMechanism =
  | "theme-head"
  | "theme-body"
  | "shopify-web-pixel"
  | "tag-manager"
  | "vendor-chain"
  | "shopify-platform"
  | "unknown";

/** A Shopify web pixel as the platform's own registry describes it.
 *
 * Read from the storefront's `webPixelsConfigList` rather than inferred from traffic, because the
 * fields that decide whether consent is honoured — `privacyPurposes` and `runtimeContext` — are
 * not observable in the network log at all. An empty `privacyPurposes` is the finding: Shopify
 * runs that pixel whatever the visitor chose, and no CMP configuration can change it. */
export interface ShopifyWebPixel {
  id: string;
  /** "APP" or "CUSTOM". A custom pixel is the merchant's own code and is edited in the admin. */
  type: string;
  /** "STRICT" (sandboxed), "LAX", or "OPEN". OPEN means it runs in the page with full DOM access. */
  runtimeContext: string;
  /** The consent purposes this pixel is gated on. **Empty means gated on nothing.** */
  privacyPurposes: string[];
  apiClientId?: number;
  dataSharingState?: string;
  /** The pixel's own settings blob, which is usually what identifies the vendor behind it. */
  configuration?: string;
  /** Vendor key this pixel was attributed to, when it could be identified. */
  vendorKey?: string;
}

export interface VendorLoadEvidence {
  mechanism: VendorLoadMechanism;
  /** The sentence the report prints, e.g. "Hardcoded in theme <head>" or
   * "Injected by GTM-NLL9MG2". Built from the observed facts, never guessed. */
  description: string;
  /** Script URLs observed causing this vendor's requests, from the CDP initiator chain. */
  injectedBy?: string[];
  shopifyPixel?: ShopifyWebPixel;
}

/** What the CMP itself declares this vendor to be — the thing "is it classified correctly?"
 * is a question *about*.
 *
 * Without this the column would be us asserting a classification rather than auditing theirs,
 * which is a different and much weaker claim. Every field is optional because most CMPs expose
 * some of this and none expose all of it, and a missing field must read as "not readable" rather
 * than as "not classified". */
export interface DeclaredClassification {
  /** The CMP's own category label, verbatim and uppercased as the vendor writes it —
   * "MARKETING", "ESSENTIAL", "HIDDEN". Not mapped onto our own categories: the mapping is the
   * judgement the reader is being asked to check. */
  category?: string;
  /** The rule that matched, so the reader can find it in the CMP dashboard and change it. */
  rule?: string;
  /** Why there is no classification — "no rule covers this host". Distinct from an unreadable
   * ruleset, which leaves the whole `declared` field undefined. */
  absent?: string;
  /** A second rule that contradicts or supersedes the matched one, or a rule pinned to a script
   * version that is no longer live. Either makes the declared category misleading rather than
   * merely wrong, which is a different fix. */
  conflict?: string;
}

/** `unclassified` (the CMP has no rule for this vendor) and `unknown` (we could not read the
 * CMP's ruleset) are deliberately separate. Both leave the client without an answer, but only
 * the first is a finding about their configuration. */
export type ClassificationVerdict = "correct" | "incorrect" | "partly" | "unclassified" | "unknown";

/** Inventory severity, which is coarser and more client-facing than ConsentSeverity.
 *
 * Separate from the test suites' blocker/error/warning because it grades a *vendor*, not an
 * assertion: "Snap Pixel transmits under full opt-out" is critical whether or not the test that
 * caught it was a blocker. */
export type InventorySeverity = "critical" | "high" | "medium" | "low" | "none";

export interface InventoryVendor {
  /** Registrable-domain group, e.g. "klaviyo.com" — the unit a client thinks in and a CMP rule
   * is written against, rather than one row per host. */
  key: string;
  name: string;
  purpose: string;
  /** Whether `purpose` came from the catalogue or was written by the model. Inferred purposes are
   * labelled as such in the report: a client must never read a guess about what a vendor does as
   * an established fact about their own stack. */
  purposeSource: "catalogue" | "inferred";
  /** Our category for it, from the catalogue or inferred alongside the purpose. */
  observedCategory: TrackerCategory;
  hosts: string[];
  load: VendorLoadEvidence;
  cookies: string[];
  /** localStorage and sessionStorage keys, which a cookie banner does not govern and a
   * cookie-only inventory misses entirely. */
  storageKeys: string[];
  declared?: DeclaredClassification;
  classifiedCorrectly: ClassificationVerdict;
  classificationNote?: string;
  /** States in which this vendor sent data about the visitor. */
  transmittedIn: ConsentStateId[];
  /** States in which only its library was fetched. */
  scriptLoadedIn: ConsentStateId[];
  firesBeforeConsent: boolean;
  firesDespiteRejection: boolean;
  /** The sentence printed in the "fires before / despite consent?" column, naming the state it
   * was observed in so the claim carries its own evidence. */
  consentBehaviour: string;
  severity: InventorySeverity;
  /** Caveats and open questions — including anything the scan could not settle. Never a
   * substitute for a verdict field; a note saying "probably fine" alongside a `correct` verdict
   * is the shape that misleads. */
  notes?: string[];
  recommendedFix?: string;
}

/** One step of the remediation plan. Ordered because the client asked for a *plan*, and because
 * the order matters: reclassifying a tag that is about to be removed is wasted work. */
export interface InventoryFixStep {
  order: number;
  title: string;
  detail: string;
  /** Who does it — "Theme developer", "Whoever owns the GTM container", "Shopify admin". */
  owner?: string;
  effort?: "quick" | "moderate" | "involved";
  /** Vendor keys this step resolves, so the table and the plan cross-reference. */
  vendors: string[];
}

/** A way to collect more data *without* weakening the consent posture — the client's secondary
 * ask. Kept structurally separate from the fix plan so closing a tracking gap can never be
 * presented as a compliance remedy. */
export interface InventoryOpportunity {
  title: string;
  detail: string;
  /** What has to be true first — usually a fix step that must land before this is legitimate. */
  requires?: string;
}

export interface ConsentInventory {
  vendors: InventoryVendor[];
  /** Every pixel in the registry, including any whose vendor could not be identified — an
   * unattributed pixel is still a pixel the client is running. */
  shopifyPixels: ShopifyWebPixel[];
  /** Which CMP's ruleset the `declared` fields were read from, and which variant, e.g.
   * "Osano (live us-fl ruleset)". Names the source so the column header can be honest about
   * whose classification is being audited. */
  classificationSource?: string;
  /** Why no declared classification is present — an inert CMP, or an adapter that cannot read
   * one. Set instead of `classificationSource`, never alongside it. */
  classificationUnavailable?: string;
  fixPlan: InventoryFixStep[];
  opportunities: InventoryOpportunity[];
  /** Whether the model was reached for purposes, severities and wording. False means the table
   * is present with catalogue purposes only — the deterministic columns stand on their own, so a
   * missing API key degrades the inventory rather than removing it. */
  aiGenerated: boolean;
  /** Set when the AI pass was attempted and failed, so a thinner table is explained rather than
   * silently thinner. */
  aiError?: string;
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
  /** The vendor inventory. Optional because scans archived before it existed still have to
   * render, and because it can be skipped with --no-inventory. */
  inventory?: ConsentInventory;
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
