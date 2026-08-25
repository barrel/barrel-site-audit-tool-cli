import type { AiUsage, RecommendationsSection, Report, ReportSections } from "@barrel/site-audit-shared";
import { buildDataSummary } from "./summary.js";

// Same pricing note as cli/src/analyzers/summary.ts — informational only, not billed against.
const OPUS_5_PRICING_PER_MILLION = { input: 5, output: 25 };

function estimateCostUsd(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens / 1_000_000) * OPUS_5_PRICING_PER_MILLION.input +
    (outputTokens / 1_000_000) * OPUS_5_PRICING_PER_MILLION.output
  );
}

/** The sections buildDataSummary() (written for the executive summary) doesn't cover. Kept separate
 * rather than folded into that function so the executive summary's input — and therefore its
 * output — doesn't change as a side effect of adding this tab. */
function buildExtraDigest(sections: ReportSections): string {
  const parts: string[] = [];

  if (sections.accessibility) {
    const a = sections.accessibility;
    const violations = a.pages.flatMap((p) => p.violations);
    const bySeverity = new Map<string, number>();
    for (const v of violations) {
      const impact = v.impact ?? "unrated";
      bySeverity.set(impact, (bySeverity.get(impact) ?? 0) + 1);
    }
    parts.push(
      `Automated accessibility (axe-core) score ${a.score} across ${a.pages.length} page(s): ` +
        `${[...bySeverity.entries()].map(([impact, n]) => `${n} ${impact}`).join(", ") || "no violations"}. ` +
        `Most common: ${violations.slice(0, 5).map((v) => v.help).join("; ") || "none"}.`,
    );
  }

  if (sections.security) {
    const s = sections.security;
    const failing = s.checks.filter((c) => c.status !== "pass");
    parts.push(
      `Security & compliance score ${s.score ?? "not scored"}. Failing/warning checks: ` +
        `${failing.map((c) => `${c.title} (${c.status})`).join("; ") || "none"}.`,
    );
  }

  if (sections.consent) {
    const c = sections.consent;
    const failing = c.tests.filter((t) => t.status === "fail");
    parts.push(
      `Privacy/consent behaviour score ${c.score ?? "not scored"} (CMP: ${c.cmp}): ${failing.length} of ` +
        `${c.tests.length} behavioural tests failing` +
        `${failing.length > 0 ? ` (${failing.map((t) => t.title).join("; ")})` : ""}.`,
    );
  }

  if (sections.agentReadiness) {
    const ar = sections.agentReadiness;
    parts.push(
      `Agent/AI-shopping readiness score ${ar.score} (${ar.skusSampled} SKUs sampled). ` +
        `Issues: ${ar.issues.map((i) => `${i.title} (${i.severity})`).join("; ") || "none"}.`,
    );
  }

  if (sections.themeProfile) {
    const tp = sections.themeProfile;
    parts.push(
      `Theme in use: ${tp.identity.name ?? "unnamed"}${tp.identity.version ? ` v${tp.identity.version}` : ""} by ` +
        `${tp.identity.author ?? "unknown author"} (${tp.identity.origin}). ` +
        `Codebase: ${tp.facts.map((f) => `${f.label} — ${f.value}`).join("; ")}.`,
      `Codebase opportunities found by file scan: ${
        tp.opportunities.map((o) => `${o.title} (${o.impact} impact, ${o.effort ?? "unknown"} effort)`).join("; ") || "none"
      }.`,
    );
  }

  if (sections.themeArchitecture) {
    const ta = sections.themeArchitecture;
    parts.push(
      `Theme architecture assessment: ${ta.summary}`,
      `Platform-fit verdicts: ${ta.modernPractices.map((r) => `${r.dimension}: ${r.verdict}`).join("; ") || "none"}.`,
      `Architectural concerns: ${ta.concerns.map((c) => `${c.title} (${c.severity})`).join("; ") || "none"}.`,
      `AI-found codebase opportunities: ${(ta.opportunities ?? []).map((o) => o.title).join("; ") || "none"}.`,
    );
  }

  if (sections.aiSuggestions) {
    parts.push(
      `Prioritized performance/accessibility fixes already written for the dev team: ${
        sections.aiSuggestions.suggestions.map((s) => `${s.title} (${s.category}, ${s.severity})`).join("; ") || "none"
      }.`,
    );
  }

  if (sections.competitors) {
    parts.push(
      `Competitor benchmark: ${sections.competitors.competitors
        .map((c) => `${c.name} — performance ${c.performance}, accessibility ${c.accessibility}, SEO ${c.seo}`)
        .join("; ")}.`,
    );
  }

  if (sections.summary) {
    parts.push(
      `The audit's own executive summary (already shown to this client — build on it, don't restate it): ` +
        `${sections.summary.overview} Key findings: ${sections.summary.keyFindings.join(" | ")}`,
    );
  }

  return parts.join("\n");
}

const RECOMMENDATIONS_SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string" },
    strengths: { type: "array", items: { type: "string" } },
    recommendations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          area: { type: "string" },
          why: { type: "string" },
          what: { type: "string" },
          expectedImpact: { type: "string" },
          evidence: { type: "array", items: { type: "string" } },
          effort: { type: "string", enum: ["quick win", "moderate", "larger project"] },
        },
        required: ["title", "area", "why", "what", "expectedImpact", "evidence", "effort"],
        additionalProperties: false,
      },
    },
  },
  required: ["headline", "strengths", "recommendations"],
  additionalProperties: false,
} as const;

export interface RecommendationsResult {
  section: RecommendationsSection;
  usage: AiUsage;
}

/** Hard cap on what reaches the deck. The prompt asks for 5-10; this is the guard against a model
 * that decides everything is a priority, since the whole value of this tab is that it is short. */
const MAX_RECOMMENDATIONS = 10;

/**
 * The client-ready read of the whole report: the 5-10 things to do next that should move
 * conversion the most, written for a deck rather than a backlog.
 *
 * Deliberately the last thing the run does — it synthesizes every other section, including the
 * executive summary, so it has to see them finished. Returns null (never throws) with no API key.
 */
export async function generateRecommendations(report: Report): Promise<RecommendationsResult | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;

  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic();

    const digest = [
      buildDataSummary(report.storeName, report.storeUrl, report.sections),
      buildExtraDigest(report.sections),
      `Overall audit score: ${report.overallScore}/100.`,
    ]
      .filter(Boolean)
      .join("\n");

    const response = await client.messages.create({
      model: "claude-opus-5",
      max_tokens: 8192,
      system:
        "You are a senior account manager at a Shopify agency, writing the recommendations slide-set that closes a " +
        "site audit presentation for a client. Your reader is the client's marketing or ecommerce lead — a smart " +
        "business person who does not read Lighthouse reports. Everything below is written to be said out loud in " +
        "that meeting.\n\n" +
        "TONE. Warm, confident, collaborative, and specific. This is a partnership, not a verdict: say 'we', frame " +
        "every item as an opportunity to build on what's there rather than a failure to fix. Our own agency very " +
        "often built this site, so never write anything that reads as blaming whoever built it — a finding is what " +
        "the storefront has outgrown, what the platform now makes possible, or what the data is now telling us, not " +
        "a mistake someone made. No shaming, no alarm, no hedging either — a client should finish reading feeling " +
        "that there is a clear, worthwhile plan and that we know exactly how to run it.\n\n" +
        "OUTPUT.\n" +
        "`headline`: 2-4 sentences on where the storefront stands today. Lead with what is genuinely strong, then " +
        "name the theme running through the recommendations. Concrete, not corporate — reference real figures from " +
        "the audit.\n" +
        "`strengths`: 2-4 specific things that are already working, each citing a real number or finding from the " +
        "audit. Never generic praise. This is the credit that makes the rest of the deck land.\n" +
        "`recommendations`: 5-10 actions, ordered by how much they should move CONVERSION — revenue per visitor, " +
        "not audit score. Rank on commercial impact, not on technical severity: a critical lint error that no " +
        "shopper can perceive ranks below a slow product page or a confusing add-to-cart. Merge related technical " +
        "findings into one business-level action (several image and script findings become 'speed up the product " +
        "page'), and leave out anything that only matters to a developer — the dev backlog is a separate tab.\n" +
        "For each: `title` is the action, phrased as something to do, in plain language (no jargon, no rule names). " +
        "`area` is the part of the experience it moves — Product page, Collection & search, Site speed, Navigation, " +
        "Cart & checkout, Mobile experience, Trust & privacy, Findability. `why` is 1-3 sentences on why it matters " +
        "commercially, in words the client can repeat to their own boss. `what` is 2-4 sentences on the work itself, " +
        "specific enough to approve and scope, naming the pages/templates/features involved but never Liquid " +
        "internals or file paths. `expectedImpact` is the outcome to expect, and it must be honest and directional " +
        "('shoppers reach the add-to-cart a full second sooner on mobile, which is where most of the traffic is') — " +
        "you may cite an industry-standard relationship, but NEVER invent a percentage lift for this store, and " +
        "never present a projection as a measurement. `evidence` is 1-4 short strings quoting the actual figures or " +
        "findings from the audit that justify it (e.g. 'Lighthouse mobile performance: 41/100', '3 of 5 consent " +
        "tests failing') — every one must come from the data below, never invented. `effort` is 'quick win', " +
        "'moderate' or 'larger project'.\n\n" +
        "RULES. Ground every claim in the audit data provided — if the data doesn't support an item, leave it out " +
        "rather than padding to ten. When real GA4 traffic and revenue figures are present, use them to make impact " +
        "concrete (tie an issue to the actual session volume, conversion rate or AOV). Never invent a metric, a " +
        "page, a percentage or a competitor. Return fewer, stronger recommendations over more, weaker ones.",
      output_config: { format: { type: "json_schema", schema: RECOMMENDATIONS_SCHEMA } },
      messages: [
        {
          role: "user",
          content: `Audit data for ${report.storeName} (${report.storeUrl}):\n${digest}`,
        },
      ],
    });

    const textBlock = response.content.find(
      (b): b is Extract<(typeof response.content)[number], { type: "text" }> => b.type === "text",
    );
    if (!textBlock) return null;

    const parsed = JSON.parse(textBlock.text) as RecommendationsSection;
    if (!parsed.recommendations?.length) return null;

    const inputTokens = response.usage.input_tokens;
    const outputTokens = response.usage.output_tokens;

    return {
      section: { ...parsed, recommendations: parsed.recommendations.slice(0, MAX_RECOMMENDATIONS) },
      usage: {
        model: "claude-opus-5",
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        estimatedCostUsd: estimateCostUsd(inputTokens, outputTokens),
      },
    };
  } catch {
    return null;
  }
}
