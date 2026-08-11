import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import type { AiSuggestion, AiSuggestionsSection, AiUsage, PerformanceSection } from "@barrel/site-audit-shared";

// Same pricing note as cli/src/analyzers/summary.ts — informational only, not billed against.
const OPUS_5_PRICING_PER_MILLION = { input: 5, output: 25 };

function estimateCostUsd(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens / 1_000_000) * OPUS_5_PRICING_PER_MILLION.input +
    (outputTokens / 1_000_000) * OPUS_5_PRICING_PER_MILLION.output
  );
}

const RELEVANT_EXTENSIONS = [".liquid", ".json"];
const SKIP_DIRS = new Set(["node_modules", ".git", ".shopify"]);

// Files most likely to drive Lighthouse performance/accessibility scores — checked first so a
// byte-capped sample still covers the highest-leverage code instead of e.g. locale JSON.
const PRIORITY_PATTERNS = [
  /layout\/theme\.liquid$/,
  /sections\//,
  /snippets\/(header|footer|product|image|hero|nav)/i,
  /templates\//,
];

function priorityRank(path: string): number {
  const idx = PRIORITY_PATTERNS.findIndex((p) => p.test(path));
  return idx === -1 ? PRIORITY_PATTERNS.length : idx;
}

function walk(dir: string, out: string[]): void {
  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true, encoding: "utf-8" });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (RELEVANT_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) out.push(full);
  }
}

/** Concatenates a byte-capped, priority-ordered sample of the theme's Liquid/JSON source,
 * each chunk labeled with its path relative to themeDir so the model can cite real files. */
export function sampleThemeCode(themeDir: string, maxTotalBytes = 20_000): string {
  const files: string[] = [];
  walk(themeDir, files);
  files.sort((a, b) => priorityRank(a) - priorityRank(b));

  const chunks: string[] = [];
  let used = 0;
  for (const file of files) {
    if (used >= maxTotalBytes) break;
    let content: string;
    try {
      content = readFileSync(file, "utf-8");
    } catch {
      continue;
    }
    const remaining = maxTotalBytes - used;
    const slice = content.length > remaining ? content.slice(0, remaining) : content;
    chunks.push(`--- ${relative(themeDir, file)} ---\n${slice}`);
    used += slice.length;
  }
  return chunks.join("\n\n");
}

function buildSignalsSummary(performance?: PerformanceSection): string {
  if (!performance) return "No Lighthouse performance/accessibility data available for this run.";

  const perfAudits = performance.performance.audits
    .filter((a) => a.score !== null && a.score < 0.9)
    .slice(0, 12)
    .map((a) => `- [Performance] ${a.title}: ${a.description}${a.displayValue ? ` (${a.displayValue})` : ""}`);

  const a11yAudits = performance.accessibility.audits
    .filter((a) => a.score !== null && a.score < 0.9)
    .slice(0, 12)
    .map((a) => `- [Accessibility] ${a.title}: ${a.description}`);

  const combined = [...perfAudits, ...a11yAudits];
  return combined.length > 0 ? combined.join("\n") : "All measured performance/accessibility audits passed.";
}

const AI_SUGGESTIONS_SCHEMA = {
  type: "object",
  properties: {
    suggestions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          category: { type: "string", enum: ["performance", "accessibility"] },
          severity: { type: "string", enum: ["high", "medium", "low"] },
          title: { type: "string" },
          detail: { type: "string" },
          recommendation: { type: "string" },
          file: { type: "string" },
          codeFix: { type: "string" },
        },
        required: ["category", "severity", "title", "detail", "recommendation"],
        additionalProperties: false,
      },
    },
  },
  required: ["suggestions"],
  additionalProperties: false,
} as const;

export interface AiSuggestionsResult {
  section: AiSuggestionsSection;
  usage: AiUsage;
}

/** AI-generated, code/Lighthouse-grounded performance & accessibility (ADA/WCAG) suggestions —
 * advisory only, not part of any score. Returns null (never throws) if there's no API key or
 * no signal to work from (no Lighthouse data and no theme code). */
export async function generateAiSuggestions(
  performance: PerformanceSection | undefined,
  themeDir: string | undefined,
): Promise<AiSuggestionsResult | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!performance && !themeDir) return null;

  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic();

    const signalsSummary = buildSignalsSummary(performance);
    const codeSample = themeDir ? sampleThemeCode(themeDir) : "";

    const userContent =
      `Lighthouse performance & accessibility signals:\n${signalsSummary}\n\n` +
      (codeSample
        ? `Sample of the storefront's actual theme source code (Liquid/JSON, file paths shown above each chunk):\n${codeSample}`
        : "No theme source code was available for this audit — base suggestions only on the Lighthouse signals above, and don't invent a file path.");

    const response = await client.messages.create({
      model: "claude-opus-5",
      max_tokens: 4096,
      system:
        "You are a senior Shopify theme developer producing a prioritized, actionable list of performance and " +
        "accessibility (ADA/WCAG) fixes for a client-facing audit. Ground every suggestion in the Lighthouse " +
        "signals and/or the actual theme code provided — cite the specific file in `file` when the code sample " +
        "makes that possible, and never invent a file path that wasn't shown to you. No generic advice " +
        "('optimize images', 'improve contrast') — be specific about what to change and why. Return 4-10 " +
        "suggestions, covering both performance and accessibility where the input supports it. " +
        (themeDir
          ? "A theme codebase was provided: whenever you cite a `file`, also include `codeFix` — the exact " +
            "corrected Liquid/HTML snippet (just the relevant lines, not the whole file) that implements the " +
            "recommendation, written against the REAL surrounding code shown to you. Omit `codeFix` entirely if " +
            "the sampled code didn't actually show you enough of that file to write a real fix — never invent one."
          : "No theme codebase was provided for this audit, so never include a `codeFix` — there's no real code to " +
            "ground it in."),
      output_config: { format: { type: "json_schema", schema: AI_SUGGESTIONS_SCHEMA } },
      messages: [{ role: "user", content: userContent }],
    });

    const textBlock = response.content.find(
      (b): b is Extract<(typeof response.content)[number], { type: "text" }> => b.type === "text",
    );
    if (!textBlock) return null;

    const parsed = JSON.parse(textBlock.text) as { suggestions: AiSuggestion[] };
    // Defense in depth: strip any codeFix the model included despite the system prompt, if there
    // was no theme code to ground it in or no specific file it claims to fix.
    const suggestions = parsed.suggestions.map((s) => (!themeDir || !s.file ? { ...s, codeFix: undefined } : s));
    const inputTokens = response.usage.input_tokens;
    const outputTokens = response.usage.output_tokens;

    return {
      section: { suggestions },
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
