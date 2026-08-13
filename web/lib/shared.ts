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
