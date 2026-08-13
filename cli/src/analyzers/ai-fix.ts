import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import type { AiUsage } from "@barrel/site-audit-shared";
import { sampleThemeCode } from "./ai-suggestions.js";

// Same pricing note as cli/src/analyzers/summary.ts — informational only, not billed against.
const OPUS_5_PRICING_PER_MILLION = { input: 5, output: 25 };

function estimateCostUsd(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens / 1_000_000) * OPUS_5_PRICING_PER_MILLION.input +
    (outputTokens / 1_000_000) * OPUS_5_PRICING_PER_MILLION.output
  );
}

const SEVERITY_MAP: Record<number, "error" | "warning" | "info"> = { 0: "error", 1: "warning", 2: "info" };

export interface SuggestFixParams {
  file: string;
  line?: number;
  title: string;
  description?: string;
  recommendation?: string;
}

export interface ThemeCheckOffenseLite {
  check: string;
  message: string;
  line?: number;
  severity: "error" | "warning" | "info";
}

export interface SuggestFixResult {
  file: string;
  /** Hash of the ORIGINAL file content this fix was generated against — echoed back verbatim by
   * the client when applying, so the apply step can detect if the file changed on GitHub in the
   * meantime rather than silently overwriting someone else's newer commit. */
  baseContentSha256: string;
  before: string;
  after: string;
  diff: string;
  explanation: string;
  /** What the proposed fix changes about the file's Theme Check standing — never blocks showing
   * the diff, since the human reviewing it is the real gate, not the linter. */
  themeCheck: { newErrorCount: number; newWarningCount: number; offenses: ThemeCheckOffenseLite[] };
  usage: AiUsage;
}

async function runThemeCheck(dir: string): Promise<any[]> {
  const { check } = await import("@shopify/theme-check-node");
  return (await check(dir)) as any[];
}

function offensesForFile(offenses: any[], dir: string, file: string): ThemeCheckOffenseLite[] {
  return offenses
    .filter((o) => o.uri && String(o.uri).replace(`file://${dir}/`, "") === file)
    .map((o) => ({
      check: o.check ?? "unknown",
      message: o.message ?? "",
      line: o.start?.line,
      severity: SEVERITY_MAP[o.severity] ?? "info",
    }));
}

/** Shells out to `git diff --no-index` between two temp files — no new diff dependency, since
 * git is already a hard dependency everywhere in this repo. Exit code 1 (files differ) is the
 * expected/success case; anything else with no stdout is a genuine failure and rethrown. */
function unifiedDiff(before: string, after: string): string {
  const dir = mkdtempSync(join(tmpdir(), "barrel-diff-"));
  try {
    writeFileSync(join(dir, "before"), before, "utf-8");
    writeFileSync(join(dir, "after"), after, "utf-8");
    try {
      return execFileSync("git", ["diff", "--no-index", "--", "before", "after"], { cwd: dir, encoding: "utf-8" });
    } catch (err: any) {
      if (typeof err.stdout === "string" && err.stdout.length > 0) return err.stdout;
      throw err;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Reads the real current file, asks Claude for a complete corrected version grounded in
 * Shopify's current best practices (with web_search available for doc lookups), and validates
 * the result against Shopify's real Theme Check engine on a scratch copy. Never writes to
 * `themeDir` — this is read-only start to finish. Throws rather than returning a half-formed
 * fix (malformed model output, empty file, etc.). */
export async function suggestFix(themeDir: string, params: SuggestFixParams): Promise<SuggestFixResult> {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set.");

  const targetPath = join(themeDir, params.file);
  const before = readFileSync(targetPath, "utf-8");
  const context = sampleThemeCode(themeDir, 8_000);

  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic();

  const userContent =
    `Finding: ${params.title}\n` +
    (params.description ? `Detail: ${params.description}\n` : "") +
    (params.recommendation ? `Recommendation: ${params.recommendation}\n` : "") +
    (params.line ? `Reported at line ${params.line}.\n` : "") +
    `\nFile to fix — ${params.file}:\n\`\`\`\n${before}\n\`\`\`\n\n` +
    `Other theme files, for convention reference only — do not modify these:\n${context}`;

  const response = await client.messages.create({
    model: "claude-opus-5",
    max_tokens: 8192,
    tools: [{ type: "web_search_20260318", name: "web_search", max_uses: 3 }],
    system:
      "You are a senior Shopify theme developer fixing exactly one issue in exactly one theme file. " +
      "Ground the fix in Shopify's current Liquid/theme best practices — use web_search against " +
      "shopify.dev if you need to confirm exact tag/filter/schema syntax. Make the smallest change " +
      "that fixes the stated issue; do not refactor unrelated code, and do not change unrelated " +
      "formatting/whitespace. Respond in exactly this format and nothing else:\n\n" +
      "EXPLANATION:\n<1-3 sentences>\nFILE:\n```\n<the COMPLETE corrected file, start to finish>\n```",
    messages: [{ role: "user", content: userContent }],
  });

  // With web_search enabled the response can interleave tool-use/tool-result blocks with
  // multiple text segments — concatenate every text block rather than taking just the first.
  const text = response.content
    .filter((b): b is Extract<(typeof response.content)[number], { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  const match = text.match(/EXPLANATION:\s*([\s\S]*?)\nFILE:\s*```(?:\w*)\n([\s\S]*?)\n?```\s*$/);
  if (!match) throw new Error("Claude's response did not match the expected EXPLANATION/FILE format.");
  const explanation = match[1].trim();
  const after = match[2];
  if (!after.trim()) throw new Error("Claude returned an empty file.");

  const inputTokens = response.usage.input_tokens;
  const outputTokens = response.usage.output_tokens;
  const usage: AiUsage = {
    model: "claude-opus-5",
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    estimatedCostUsd: estimateCostUsd(inputTokens, outputTokens),
  };

  // Validate against Shopify's real Theme Check engine on a scratch copy — never touches themeDir.
  const scratchDir = mkdtempSync(join(tmpdir(), "barrel-suggest-fix-"));
  let themeCheck: SuggestFixResult["themeCheck"];
  try {
    const baseline = offensesForFile(await runThemeCheck(themeDir), themeDir, params.file);
    cpSync(themeDir, scratchDir, { recursive: true });
    writeFileSync(join(scratchDir, params.file), after, "utf-8");
    const proposed = offensesForFile(await runThemeCheck(scratchDir), scratchDir, params.file);

    const baselineKeys = new Set(baseline.map((o) => `${o.check}:${o.line}`));
    const introduced = proposed.filter((o) => !baselineKeys.has(`${o.check}:${o.line}`));
    themeCheck = {
      newErrorCount: introduced.filter((o) => o.severity === "error").length,
      newWarningCount: introduced.filter((o) => o.severity === "warning").length,
      offenses: introduced,
    };
  } finally {
    rmSync(scratchDir, { recursive: true, force: true });
  }

  return {
    file: params.file,
    baseContentSha256: createHash("sha256").update(before).digest("hex"),
    before,
    after,
    diff: unifiedDiff(before, after),
    explanation,
    themeCheck,
    usage,
  };
}
