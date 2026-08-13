import type { AiUsage, BestPracticeRow, CodeSection, ThemeArchitectureSection, ThemeStructureSection } from "@barrel/site-audit-shared";
import { sampleThemeCode } from "./ai-suggestions.js";

// Same pricing note as cli/src/analyzers/summary.ts — informational only, not billed against.
const OPUS_5_PRICING_PER_MILLION = { input: 5, output: 25 };

function estimateCostUsd(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens / 1_000_000) * OPUS_5_PRICING_PER_MILLION.input +
    (outputTokens / 1_000_000) * OPUS_5_PRICING_PER_MILLION.output
  );
}

function buildStructuralSummary(code?: CodeSection, themeStructure?: ThemeStructureSection): string {
  const lines: string[] = [];

  if (themeStructure) {
    lines.push(
      `Templates: ${themeStructure.templates.total} total — ${themeStructure.templates.json} JSON (Online Store 2.0-style), ${themeStructure.templates.liquid} Liquid-only (legacy template architecture).`,
      `${themeStructure.sectionsCount} section(s), ${themeStructure.snippetsCount} snippet(s).`,
      themeStructure.pageBuilderApps.length > 0
        ? `Page-builder app(s) detected: ${themeStructure.pageBuilderApps.join(", ")}.`
        : "No page-builder app signatures detected.",
    );
    for (const flag of themeStructure.redFlags.slice(0, 8)) {
      lines.push(`Structure red flag: ${flag.label} — ${flag.detail}`);
    }
  }

  if (code) {
    const byCheck = new Map<string, number>();
    for (const issue of code.issues) byCheck.set(issue.check, (byCheck.get(issue.check) ?? 0) + 1);
    const topChecks = [...byCheck.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
    lines.push(`Theme Check: ${code.filesScanned} files scanned, ${code.errorCount} errors, ${code.warningCount} warnings.`);
    if (topChecks.length > 0) {
      lines.push(`Most common checks triggered: ${topChecks.map(([check, count]) => `${check} (${count})`).join(", ")}.`);
    }
  }

  return lines.length > 0 ? lines.join("\n") : "No theme-structure or theme-check signals available.";
}

const THEME_ARCHITECTURE_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    modernPractices: {
      type: "array",
      items: {
        type: "object",
        properties: {
          dimension: { type: "string" },
          verdict: { type: "string", enum: ["good", "needs-improvement", "poor"] },
          evidence: { type: "string" },
        },
        required: ["dimension", "verdict", "evidence"],
        additionalProperties: false,
      },
    },
    concerns: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          severity: { type: "string", enum: ["high", "medium", "low"] },
          detail: { type: "string" },
          recommendation: { type: "string" },
        },
        required: ["title", "severity", "detail"],
        additionalProperties: false,
      },
    },
  },
  required: ["summary", "modernPractices", "concerns"],
  additionalProperties: false,
} as const;

export interface ThemeArchitectureResult {
  section: ThemeArchitectureSection;
  usage: AiUsage;
}

/** AI assessment of how the theme is architected and how well it adopts Shopify's current
 * platform features/best practices (Online Store 2.0 JSON templates, section groups, theme
 * blocks, app-block support, metafields) — plus any other structural concerns beyond raw lint
 * errors. Grounded in theme-structure signals, Theme Check output, and an actual sample of the
 * theme's source (same sampleThemeCode() used by the AI suggestions analyzer). Returns null
 * (never throws) if there's no API key. */
export async function generateThemeArchitecture(
  themeDir: string,
  code?: CodeSection,
  themeStructure?: ThemeStructureSection,
): Promise<ThemeArchitectureResult | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;

  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic();

    const structuralSummary = buildStructuralSummary(code, themeStructure);
    const codeSample = sampleThemeCode(themeDir, 30_000);

    const response = await client.messages.create({
      model: "claude-opus-5",
      max_tokens: 8192,
      system:
        "You are a senior Shopify theme architect reviewing a storefront's theme codebase for a client-facing " +
        "audit. Assess three things: (1) how the theme appears to be built — a short, specific narrative " +
        "(`summary`, 2-4 sentences) covering whether it looks custom-built vs. based on a stock/reference theme, " +
        "how heavily it relies on page-builder apps vs. native sections, and whether its template architecture is " +
        "Online Store 2.0-style (JSON templates, section groups like header-group.json/footer-group.json, theme " +
        "blocks) or legacy Liquid-template architecture; (2) a verdict table (`modernPractices`) scoring specific " +
        "dimensions of Shopify platform-feature adoption — e.g. 'Online Store 2.0 JSON templates', 'Section " +
        "groups (header/footer)', 'Theme blocks / app-block support in key sections', 'Metafields & metaobjects " +
        "usage', 'Settings schema quality' — each with a good/needs-improvement/poor verdict and a one-sentence " +
        "evidence citation grounded in the signals or code shown to you; (3) any other architectural concerns " +
        "beyond raw lint errors (`concerns`) — e.g. page-builder reliance fighting the theme's own architecture, " +
        "inconsistent patterns across sections, monolithic snippets, sections that don't declare block/app-block " +
        "support limiting merchant flexibility, missing section groups. Every claim must be grounded in the " +
        "structural signals or code sample provided — never invent a file, a metric, or a generic platitude. If " +
        "the code sample doesn't show enough to judge a dimension, say so in its evidence rather than guessing.",
      output_config: { format: { type: "json_schema", schema: THEME_ARCHITECTURE_SCHEMA } },
      messages: [
        {
          role: "user",
          content:
            `Structural signals:\n${structuralSummary}\n\n` +
            `Sample of the storefront's actual theme source code (Liquid/JSON, file paths shown above each chunk):\n${codeSample}`,
        },
      ],
    });

    const textBlock = response.content.find(
      (b): b is Extract<(typeof response.content)[number], { type: "text" }> => b.type === "text",
    );
    if (!textBlock) return null;

    const parsed = JSON.parse(textBlock.text) as {
      summary: string;
      modernPractices: BestPracticeRow[];
      concerns: ThemeArchitectureSection["concerns"];
    };
    const inputTokens = response.usage.input_tokens;
    const outputTokens = response.usage.output_tokens;

    return {
      section: parsed,
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
