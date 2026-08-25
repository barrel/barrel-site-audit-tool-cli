// Step 7 of the CRO audit: Key Insights.
//
// Executed last and presented first. Four cards, each a tag, a headline and two or three sentences,
// synthesised across every other step.
//
// The rule that makes this step worth having rather than a restatement: every card must cite
// evidence from at least two different steps. A "key insight" that only repeats one slide is that
// slide, moved to the front. What a client is paying for here is the connection between the
// analytics number and the thing on the page — and a connection cannot be drawn inside one step.

import type { AiUsage, CroBullet, CroEvidenceItem, CroReport, CroSlide, CroStep, CroStepKey } from "./shared";
import { CRO_STEP_LABELS } from "./shared";
import { INSIGHT_CARD_LIMITS, validateBullets } from "./cro-slides";

const MODEL = "claude-opus-5";
const OPUS_5_PRICING_PER_MILLION = { input: 5, output: 25 };

function estimateCostUsd(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens / 1_000_000) * OPUS_5_PRICING_PER_MILLION.input +
    (outputTokens / 1_000_000) * OPUS_5_PRICING_PER_MILLION.output
  );
}

/** The house format for this step: four cards. Not three, not six — it is the number that fits an
 * opening slide and the number a client can hold in their head walking out of the room. */
export const KEY_INSIGHT_COUNT = 4;

/** Every step that produced something, as material for the synthesis.
 *
 * Bullets rather than raw evidence: this step reasons over conclusions the audit already reached
 * and defended, and handing it the whole evidence catalogue again would invite it to draw a fifth
 * finding nobody has checked. */
export function materialForSynthesis(report: CroReport): { text: string; evidence: CroEvidenceItem[]; steps: CroStepKey[] } {
  const lines: string[] = [];
  const evidence: CroEvidenceItem[] = [];
  const steps: CroStepKey[] = [];

  for (const key of Object.keys(report.steps) as CroStepKey[]) {
    if (key === "insights") continue;
    const step = report.steps[key];
    if (!step || step.status !== "generated") continue;
    steps.push(key);
    evidence.push(...step.evidence);

    lines.push(`## ${CRO_STEP_LABELS[key]} (step id: ${key})`);
    for (const slide of step.slides) {
      if (slide.bullets.length === 0 && !slide.table) continue;
      lines.push(`### ${slide.label}`);
      if (slide.intro) lines.push(slide.intro);
      for (const bullet of slide.bullets) {
        lines.push(`- ${bullet.title}: ${bullet.description} [cites: ${bullet.evidenceIds.join(", ") || "none"}]`);
      }
    }
  }

  return { text: lines.join("\n"), evidence, steps };
}

const SYSTEM = [
  "You are a conversion-rate-optimisation strategist writing the opening slide of a client-facing audit deck.",
  "You are given the findings of every other section of the audit. Your job is to say which four things matter most.",
  "",
  "Rules, enforced after you answer — a card that breaks one is discarded:",
  "Produce exactly four cards.",
  "Each card has a short category tag (two or three words, e.g. \"Product Prioritisation\" or \"Decision Clarity\"), a headline, and a description of two or three sentences.",
  "The headline is a label, not a sentence: at most 7 words, no ending punctuation, and never a colon.",
  "Frame every card as an opportunity, not a fault. Never open a headline with a word like missing, poor, broken, weak, lacks or unclear.",
  "Every card must draw on findings from at least two different sections. A card that restates one section is not a key insight.",
  "Cite the evidence ids the findings you are drawing on cited. Evidence you were not given does not exist.",
  "Never write a number that does not appear in the evidence you cite. No forecasts, no annualising, no industry benchmarks.",
].join("\n");

const SCHEMA = {
  type: "object",
  properties: {
    cards: {
      type: "array",
      items: {
        type: "object",
        properties: {
          tag: { type: "string" },
          title: { type: "string" },
          description: { type: "string" },
          evidenceIds: { type: "array", items: { type: "string" } },
          stepIds: { type: "array", items: { type: "string" } },
        },
        required: ["tag", "title", "description", "evidenceIds", "stepIds"],
        additionalProperties: false,
      },
    },
  },
  required: ["cards"],
  additionalProperties: false,
} as const;

interface RawCard {
  tag?: unknown;
  title?: unknown;
  description?: unknown;
  evidenceIds?: unknown;
  stepIds?: unknown;
}

/** Which steps a card claims to draw on, filtered to ones that actually exist in this report. */
function claimedSteps(card: RawCard, available: CroStepKey[]): CroStepKey[] {
  const ids = Array.isArray(card.stepIds) ? card.stepIds.filter((s): s is string => typeof s === "string") : [];
  return available.filter((key) => ids.includes(key));
}

export interface GenerateCroInsightsInput {
  report: CroReport;
}

/** Step 7, start to finish. Never partially written: either four cards' worth of synthesis exists
 * or the step says what was missing. */
export async function generateCroInsights(input: GenerateCroInsightsInput): Promise<CroStep> {
  const { text, evidence, steps } = materialForSynthesis(input.report);
  const limitations: string[] = [];

  if (steps.length === 0) {
    return {
      key: "insights",
      status: "insufficient",
      source: "app",
      slides: [],
      evidence: [],
      limitations: [
        "No other step of this audit has produced findings yet, so there is nothing to synthesise. Run a capture and generate the analytics step first.",
      ],
      generatedAt: new Date().toISOString(),
    };
  }

  if (steps.length === 1) {
    // Not fatal — one section's findings can still be ranked — but the step's whole premise is
    // cross-section, so say plainly that it could not do the thing it claims to do.
    limitations.push(
      `Only one section of this audit (${CRO_STEP_LABELS[steps[0]]}) has findings, so these insights are a ranking of that section rather than a synthesis across the audit. The requirement that each insight draw on two sections is relaxed here, and each card names what it drew on.`,
    );
  }

  const prompt = [
    `Store: ${input.report.storeName} (${input.report.storeUrl}).`,
    `Sections available, by step id: ${steps.join(", ")}.`,
    `Findings from every completed section:\n\n${text}`,
    `Every figure you may use:\n${evidence.map((e) => `[${e.id}] ${e.label}`).join("\n")}`,
    `Write the ${KEY_INSIGHT_COUNT} key insights that open this deck.`,
  ].join("\n\n");

  let usage: AiUsage | undefined;
  let cards: RawCard[] = [];

  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic();
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 3072,
      system: SYSTEM,
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
      messages: [{ role: "user", content: prompt }],
    });
    const textBlock = response.content.find(
      (b): b is Extract<(typeof response.content)[number], { type: "text" }> => b.type === "text",
    );
    if (textBlock) {
      cards = (JSON.parse(textBlock.text) as { cards?: RawCard[] }).cards ?? [];
      const inputTokens = response.usage.input_tokens;
      const outputTokens = response.usage.output_tokens;
      usage = {
        model: MODEL,
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        estimatedCostUsd: estimateCostUsd(inputTokens, outputTokens),
      };
    }
  } catch (err: unknown) {
    throw new Error(`The key insights could not be written: ${String((err as Error)?.message ?? err).slice(0, 200)}`);
  }

  const slideId = "insights-cards";
  const rejected: NonNullable<CroStep["rejected"]> = [];

  // The two-section rule, applied before the shape checks so its rejection reason is the one a
  // reviewer sees — "this is a restatement of one section" is more useful than a note about
  // formatting on a card that was never eligible.
  const crossSection: RawCard[] = [];
  for (const card of cards) {
    const drawnFrom = claimedSteps(card, steps);
    if (steps.length > 1 && drawnFrom.length < 2) {
      rejected.push({
        title: typeof card.title === "string" ? card.title : "(untitled)",
        description: typeof card.description === "string" ? card.description : "",
        reason:
          drawnFrom.length === 0
            ? "It named no section of the audit it drew on."
            : `It draws only on ${CRO_STEP_LABELS[drawnFrom[0]]}, so it restates one section rather than connecting two.`,
      });
      continue;
    }
    crossSection.push(card);
  }

  // Key-insight descriptions run to two or three sentences, past the one-sentence limit a slide
  // bullet has — so the shape check runs with the description limit the card format uses. Passed
  // through validateBullets all the same, because the tone rule, the citation rule and the number
  // check are the same rules and must not be re-implemented here.
  const validated = validateBullets(
    crossSection.map((card) => ({
      title: card.title,
      description: card.description,
      tag: card.tag,
      evidenceIds: card.evidenceIds,
    })),
    { step: "insights", slideId, evidence, limits: INSIGHT_CARD_LIMITS },
  );
  rejected.push(...validated.rejected);

  const bullets: CroBullet[] = validated.accepted.slice(0, KEY_INSIGHT_COUNT);

  if (bullets.length < KEY_INSIGHT_COUNT) {
    limitations.push(
      `${bullets.length} of the ${KEY_INSIGHT_COUNT} key insights survived the checks that each one connects two sections of the audit and uses only figures from the evidence it cited. The discarded ones are listed with their reasons.`,
    );
  }

  const slide: CroSlide = { id: slideId, label: "Key insights", bullets };

  return {
    key: "insights",
    status: bullets.length > 0 ? "generated" : "insufficient",
    source: "app",
    slides: [slide],
    evidence,
    limitations,
    rejected: rejected.length > 0 ? rejected : undefined,
    generatedAt: new Date().toISOString(),
    aiUsage: usage,
  };
}
