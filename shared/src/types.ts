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

export interface ReportSections {
  code?: CodeSection;
  performance?: PerformanceSection;
  accessibility?: AccessibilitySection;
  sitespeed?: SitespeedSection;
  themeArchitecture?: ThemeArchitectureSection;
  agentReadiness?: AgentReadinessSection;
  health?: HealthSection;
  pixels?: PixelSection;
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
  /** Claude token usage for the AI-generated executive summary, if one was produced. */
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
  notes?: string;
}
