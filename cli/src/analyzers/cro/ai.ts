// The one place a CRO section talks to a model.
//
// Every drafting step wants the same thing: a schema-constrained JSON answer, images alongside the
// prose, and token usage accounted for. Doing that once means a new step cannot accidentally ship
// without usage accounting, and the house-format rules below are stated once rather than
// paraphrased differently in six prompts.

import type { AiUsage } from "@barrel/site-audit-shared";

const MODEL = "claude-opus-5";

// Same pricing note as cli/src/analyzers/summary.ts — informational only, not billed against.
const OPUS_5_PRICING_PER_MILLION = { input: 5, output: 25 };

function estimateCostUsd(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens / 1_000_000) * OPUS_5_PRICING_PER_MILLION.input +
    (outputTokens / 1_000_000) * OPUS_5_PRICING_PER_MILLION.output
  );
}

export function addUsage(a: AiUsage | undefined, b: AiUsage | undefined): AiUsage | undefined {
  if (!a) return b;
  if (!b) return a;
  const inputTokens = a.inputTokens + b.inputTokens;
  const outputTokens = a.outputTokens + b.outputTokens;
  return {
    model: a.model,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    estimatedCostUsd: a.estimatedCostUsd + b.estimatedCostUsd,
  };
}

/** The rules every drafting prompt inherits.
 *
 * Stated in the prompt *as well as* enforced in shared/src/cro-slides.ts. The validator is what
 * guarantees the format; asking for it too is what stops the validator from rejecting half of every
 * response. Neither alone is enough — a prompt-only rule is a suggestion, and a validator-only rule
 * produces thin slides. */
export const CRO_HOUSE_RULES = [
  "Output between 3 and 5 bullets. Each is a short title plus a one-sentence description.",
  "The title is a label, not a sentence: at most 7 words, no ending punctuation, and never a colon.",
  "Frame every bullet as an opportunity, not a fault. Write \"Surface reviews above the fold\", never \"Missing reviews\" or \"Poor social proof\". Never open a title with a word like missing, poor, broken, weak, lacks or unclear.",
  "The description says what to do and why it would plausibly help, in one sentence, under 240 characters.",
  "Cite at least one evidence id on every bullet, from the list you are given. Evidence you were not given does not exist.",
  "Never write a number that does not appear in the evidence you cite. Do not estimate an uplift, annualise anything, or quote an industry benchmark. A bullet containing an invented figure is discarded.",
  "Be specific to this storefront. Reference what is actually visible in the screenshots or stated in the evidence. Generic best-practice advice is worthless here.",
].join("\n");

/** The answer shape every drafting call asks for.
 *
 * No `minItems`/`maxItems` on the array: the API's structured-output schemas reject both ("For
 * 'array' type, property 'maxItems' is not supported"), which is a 400 on every call rather than a
 * silently ignored constraint. The count is stated in the prompt and enforced afterwards by
 * validateBullets, which is where it has to live anyway — a schema cannot express "3 to 5 bullets
 * that each pass the tone and citation checks". */
export const BULLETS_SCHEMA = {
  type: "object",
  properties: {
    bullets: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          description: { type: "string" },
          impact: { type: "string", enum: ["high", "medium", "low"] },
          evidenceIds: { type: "array", items: { type: "string" } },
        },
        required: ["title", "description", "impact", "evidenceIds"],
        additionalProperties: false,
      },
    },
  },
  required: ["bullets"],
  additionalProperties: false,
} as const;

export interface ModelImage {
  caption: string;
  buffer: Buffer;
}

export interface ModelCall {
  system: string;
  /** Text blocks in order. Images are appended after them, each preceded by its caption. */
  text: string[];
  images?: ModelImage[];
  schema: Record<string, unknown>;
  maxTokens?: number;
}

export interface ModelResult<T> {
  data: T;
  usage: AiUsage;
}

/** Either an answer or the reason there is not one.
 *
 * Deliberately not `null` on failure. The first version of this returned null and swallowed the
 * error, and the result was a run that reported "either ANTHROPIC_API_KEY is not set, or the model
 * call failed" for three slides in a row with no way to tell which — for a fault that turned out to
 * be neither. A drafting failure has to name itself: the capture is the expensive half and is
 * already stored, so the only thing at stake is whether the person looking at it can act on the
 * message. */
export type ModelOutcome<T> = { ok: true; result: ModelResult<T> } | { ok: false; reason: string };

export async function callModel<T>(call: ModelCall): Promise<ModelOutcome<T>> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { ok: false, reason: "ANTHROPIC_API_KEY is not set on this machine, so no slide could be written." };
  }

  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic();

    const content: Array<Record<string, unknown>> = call.text.map((text) => ({ type: "text", text }));
    for (const image of call.images ?? []) {
      content.push({ type: "text", text: image.caption });
      content.push({
        type: "image",
        source: { type: "base64", media_type: "image/jpeg", data: image.buffer.toString("base64") },
      });
    }

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: call.maxTokens ?? 2048,
      system: call.system,
      output_config: { format: { type: "json_schema", schema: call.schema } },
      messages: [{ role: "user", content: content as any }],
    });

    const textBlock = response.content.find(
      (b): b is Extract<(typeof response.content)[number], { type: "text" }> => b.type === "text",
    );
    if (!textBlock) {
      return { ok: false, reason: `${MODEL} returned no text block (stop reason: ${response.stop_reason ?? "unknown"}).` };
    }

    const inputTokens = response.usage.input_tokens;
    const outputTokens = response.usage.output_tokens;
    return {
      ok: true,
      result: {
        data: JSON.parse(textBlock.text) as T,
        usage: {
          model: MODEL,
          inputTokens,
          outputTokens,
          totalTokens: inputTokens + outputTokens,
          estimatedCostUsd: estimateCostUsd(inputTokens, outputTokens),
        },
      },
    };
  } catch (err: unknown) {
    const error = err as { status?: number; message?: string };
    const status = error?.status ? ` (HTTP ${error.status})` : "";
    return { ok: false, reason: `The model call failed${status}: ${String(error?.message ?? err).slice(0, 300)}` };
  }
}
