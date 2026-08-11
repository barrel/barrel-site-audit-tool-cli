import type { AiUsage, Report, ReportSections, SummarySection } from "@barrel/site-audit-shared";

// Anthropic first-party pricing for claude-opus-5 as of 2026-08 — used only to show an
// approximate cost on the report; not billed against, so drift from the live rate card is fine.
const OPUS_5_PRICING_PER_MILLION = { input: 5, output: 25 };

function estimateCostUsd(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens / 1_000_000) * OPUS_5_PRICING_PER_MILLION.input +
    (outputTokens / 1_000_000) * OPUS_5_PRICING_PER_MILLION.output
  );
}

function buildDataSummary(storeName: string, storeUrl: string, sections: ReportSections): string {
  const parts: string[] = [`Store: ${storeName} (${storeUrl})`];

  if (sections.performance) {
    const p = sections.performance;
    parts.push(
      `Lighthouse — Performance ${p.performance.score}, Accessibility ${p.accessibility.score}, Best Practices ${p.bestPractices.score}, SEO ${p.seo.score}.`,
      `Top performance issues: ${p.performance.audits.slice(0, 5).map((a) => a.title).join("; ") || "none"}.`,
    );
  }

  if (sections.health) {
    const failing = sections.health.checks.filter((c) => c.status !== "pass");
    parts.push(
      `Site health score ${sections.health.score}. Issues: ${failing.map((c) => `${c.label} (${c.status})`).join("; ") || "none"}.`,
    );
  }

  if (sections.code) {
    parts.push(
      `Theme code: ${sections.code.filesScanned} files scanned, ${sections.code.errorCount} errors, ${sections.code.warningCount} warnings.`,
      `Sample issues: ${sections.code.issues.slice(0, 8).map((i) => `${i.check} (${i.file})`).join("; ") || "none"}.`,
    );
  }

  if (sections.themeStructure) {
    const ts = sections.themeStructure;
    parts.push(
      `Theme structure: ${ts.templates.total} templates, ${ts.sectionsCount} sections, ${ts.snippetsCount} snippets.`,
      `Page builder apps detected: ${ts.pageBuilderApps.join(", ") || "none"}.`,
      `Red flags: ${ts.redFlags.map((f) => f.label).join("; ") || "none"}.`,
    );
  }

  if (sections.pixels) {
    const px = sections.pixels;
    parts.push(
      `Marketing pixels: ${px.platforms.map((p) => `${p.name}: ${p.status}`).join(", ")}.`,
      `Consent mechanism detected: ${px.consentMechanismDetected ? "yes" : "no"}.`,
      `Pixel findings: ${px.findings.map((f) => f.title).join("; ") || "none"}.`,
    );
  }

  if (sections.geoSeo) {
    const gs = sections.geoSeo;
    parts.push(
      `SEO & GEO health rating: ${gs.healthRating} (SEO ${gs.seo.score}, GEO/AI-discoverability ${gs.geo.score}).`,
      `SEO opportunities: ${gs.seo.opportunities.map((o) => `${o.title} (${o.impact} impact)`).join("; ") || "none found"}.`,
      `Agentic-commerce & AI-discoverability verdicts: ${gs.geo.agenticCommerce.map((r) => `${r.dimension}: ${r.verdict}`).join("; ")}.`,
    );
  }

  if (sections.ux) {
    const ux = sections.ux;
    parts.push(
      `UX/conversion audit (score ${ux.score}, collection page + product page): ${ux.checks.map((c) => `${c.label}: ${c.status}`).join("; ")}.`,
      `AI-flagged UX opportunities: ${ux.opportunities.map((o) => `${o.title} (${o.page}, ${o.impact} impact)`).join("; ") || "none"}.`,
    );
  }

  if (sections.analytics) {
    const a = sections.analytics;
    parts.push(
      `Real traffic & revenue (Google Analytics, ${a.dateRangeLabel}): ${a.sessions.toLocaleString()} sessions, ` +
        `${a.totalUsers.toLocaleString()} users, ${a.conversionRate}% conversion rate, ${a.transactions.toLocaleString()} transactions, ` +
        `$${a.revenue.toLocaleString()} revenue, $${a.averageOrderValue.toFixed(2)} average order value.`,
      `Top channels by sessions: ${a.channels.slice(0, 4).map((c) => `${c.label} (${c.sessions.toLocaleString()})`).join(", ") || "none"}.`,
      `Device split: ${a.devices.map((d) => `${d.label} (${d.sessions.toLocaleString()})`).join(", ") || "none"}.`,
      `When real traffic/revenue data is present, use it to make the business impact of technical findings concrete ` +
        `(e.g. tie a performance or conversion-blocking issue to the actual session volume and AOV) instead of speaking generically.`,
    );
  }

  return parts.join("\n");
}

const SUMMARY_SCHEMA = {
  type: "object",
  properties: {
    overview: { type: "string" },
    keyFindings: { type: "array", items: { type: "string" } },
  },
  required: ["overview", "keyFindings"],
  additionalProperties: false,
} as const;

export interface SummaryResult {
  summary: SummarySection;
  usage: AiUsage;
}

export async function generateSummary(report: Report): Promise<SummaryResult | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;

  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic();

  const dataSummary = buildDataSummary(report.storeName, report.storeUrl, report.sections);

  const response = await client.messages.create({
    model: "claude-opus-5",
    max_tokens: 4096,
    system:
      "You are a senior technical auditor writing the executive summary for a client-facing Shopify site audit. " +
      "Write plainly and specifically: name the real risks and their business impact, don't hedge or pad. " +
      "overview is a 3-5 sentence narrative paragraph covering the overall state of the site. " +
      "keyFindings is 3-6 short, specific, concrete findings (one sentence each) — the ones a reader needs to act on.",
    output_config: {
      format: { type: "json_schema", schema: SUMMARY_SCHEMA },
    },
    messages: [{ role: "user", content: `Audit data:\n${dataSummary}` }],
  });

  const textBlock = response.content.find(
    (b): b is Extract<(typeof response.content)[number], { type: "text" }> => b.type === "text",
  );
  if (!textBlock) return null;

  const parsed = JSON.parse(textBlock.text) as { overview: string; keyFindings: string[] };
  const inputTokens = response.usage.input_tokens;
  const outputTokens = response.usage.output_tokens;

  return {
    summary: { overview: parsed.overview, keyFindings: parsed.keyFindings.map(String) },
    usage: {
      model: "claude-opus-5",
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      estimatedCostUsd: estimateCostUsd(inputTokens, outputTokens),
    },
  };
}
