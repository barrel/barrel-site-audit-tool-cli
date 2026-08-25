// Step 6 of the CRO audit: the competitive benchmark.
//
// Two outputs with very different epistemic standing, deliberately kept apart on the slide deck:
//
//  - A **feature matrix**, derived from the captures with no model involved. Whether a competitor
//    offers subscriptions is a fact about their HTML, and a grid of those facts is the single most
//    useful artefact of a benchmark. It goes in front of a client unedited.
//  - **Per-competitor bullets**, written by a model from screenshots. Useful, and softer. They read
//    as a strategist's read of a rival's site, which is what they are.
//
// The same page groups are captured for a competitor as for the client. A benchmark that compared
// our six-page review against a rival's home page would be an unfair comparison dressed as an
// audit.

import type { AiUsage, CroCompetitorCapture, CroSlide, CroStep, CroTable, CroTableRow } from "@barrel/site-audit-shared";
import { CRO_PAGE_GROUP_LABELS, evidenceForPage, slideIsThin, validateBullets } from "@barrel/site-audit-shared";
import { CRO_FEATURES, detectFeatures, type CroFeatureKey } from "./signals.js";
import { BULLETS_SCHEMA, CRO_HOUSE_RULES, addUsage, callModel, type ModelImage } from "./ai.js";

const SYSTEM = [
  "You are a conversion-rate-optimisation strategist at a digital agency, writing the competitive-benchmark slide of a client-facing audit deck.",
  "You are looking at screenshots of one competitor's storefront. Your reader is the client, not the competitor.",
  "Identify what this competitor does well enough to be worth replicating, and where they leave a gap the client could take.",
  "",
  "Format rules, which are enforced after you answer — a bullet that breaks one is discarded:",
  CRO_HOUSE_RULES,
  "",
  "Additionally: write a two-sentence intro to the competitor, and summarise how they position themselves in the market in two or three words (for example \"Wellness + Eco Luxury\" or \"Bathroom Tech + Comfort\").",
].join("\n");

const COMPETITOR_SCHEMA = {
  type: "object",
  properties: {
    intro: { type: "string" },
    positioning: { type: "string" },
    bullets: BULLETS_SCHEMA.properties.bullets,
  },
  required: ["intro", "positioning", "bullets"],
  additionalProperties: false,
} as const;

/** The deterministic half. One row per compared feature, one column per brand.
 *
 * Presence is a union across every page captured for that brand: "does this brand offer
 * subscriptions" is a question about the brand, and the answer can live on the PDP, in the cart, or
 * only in the footer. */
export function buildFeatureMatrix(
  clientName: string,
  clientHtml: string[],
  competitors: Array<{ name: string; html: string[] }>,
): CroTable {
  const client = detectFeatures(clientHtml);
  const rivals = competitors.map((c) => ({ name: c.name, features: detectFeatures(c.html) }));

  const rows: CroTableRow[] = CRO_FEATURES.map((feature) => ({
    label: feature.label,
    cells: [client[feature.key as CroFeatureKey], ...rivals.map((r) => r.features[feature.key as CroFeatureKey])],
  }));

  return {
    caption:
      "Detected from the markup of every page captured for each brand. A tick means the feature was found somewhere on the site; it says nothing about how well it is implemented.",
    columns: [clientName, ...rivals.map((r) => r.name)],
    rows,
  };
}

async function draftCompetitor(
  competitor: CroCompetitorCapture,
  loadScreenshot: (pathname: string) => Promise<Buffer | null>,
): Promise<{ slide: CroSlide; usage?: AiUsage; limitations: string[]; rejected: NonNullable<CroStep["rejected"]> } | null> {
  const slideId = `competitors-${competitor.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
  const limitations: string[] = [];

  if (competitor.error) {
    return {
      slide: { id: slideId, label: competitor.name, bullets: [], intro: undefined },
      limitations: [`${competitor.name}: ${competitor.error}`],
      rejected: [],
    };
  }

  const usable = competitor.pages.filter((p) => !p.error);
  const evidence = usable.flatMap(evidenceForPage);

  // The first screen of each page group, mobile first — the whole set at both devices would be
  // twenty images for a slide that carries five bullets.
  const images: ModelImage[] = [];
  for (const page of usable.filter((p) => p.device === "mobile")) {
    if (!page.screenshotFold) continue;
    const buffer = await loadScreenshot(page.screenshotFold);
    if (buffer) {
      images.push({ caption: `${competitor.name} — ${CRO_PAGE_GROUP_LABELS[page.group]}, mobile first screen:`, buffer });
    }
  }

  const promptText = [
    `Competitor: ${competitor.name} (${competitor.url}).`,
    `Deterministic evidence captured from their live storefront. Cite these ids:\n${evidence
      .map((e) => `[${e.id}] ${e.label}`)
      .join("\n")}`,
    "Screenshots of their page types follow.",
    "Write this competitor's slide: a two-sentence intro, 4 to 5 opportunities the client could take from what this competitor does (or fails to do), and their brand positioning in two or three words.",
  ];

  const result = await callModel<{ intro?: string; positioning?: string; bullets: unknown }>({
    system: SYSTEM,
    text: promptText,
    images,
    schema: COMPETITOR_SCHEMA as unknown as Record<string, unknown>,
    maxTokens: 2048,
  });

  if (!result.ok) {
    limitations.push(`${competitor.name}'s slide could not be drafted: ${result.reason} Their capture is stored, so it can be drafted later.`);
    return { slide: { id: slideId, label: competitor.name, bullets: [] }, limitations, rejected: [] };
  }

  const { accepted, rejected } = validateBullets(result.result.data.bullets, {
    step: "competitors",
    slideId,
    evidence,
    extraSources: promptText,
  });

  const positioning = result.result.data.positioning?.trim();
  const slide: CroSlide = {
    id: slideId,
    label: competitor.name,
    intro: result.result.data.intro?.trim() || undefined,
    bullets: accepted,
    screenshots: usable.map((p) => p.screenshotFold).filter((s): s is string => Boolean(s)),
    footnote: positioning ? `Brand Positioning: ${positioning}` : undefined,
  };

  if (slideIsThin(slide)) {
    limitations.push(
      `${competitor.name}'s slide carries ${accepted.length} takeaway(s)${
        rejected.length > 0 ? `, after ${rejected.length} were discarded by the format and evidence checks` : ""
      }.`,
    );
  }

  return { slide, usage: result.result.usage, limitations, rejected };
}

export interface DraftCompetitorsOptions {
  clientName: string;
  clientHtml: string[];
  competitors: CroCompetitorCapture[];
  competitorHtml: Record<string, string[]>;
  loadScreenshot: (pathname: string) => Promise<Buffer | null>;
  onStage?: (stage: string) => void;
}

export async function draftCompetitorsStep(options: DraftCompetitorsOptions): Promise<CroStep> {
  const slides: CroSlide[] = [];
  const limitations: string[] = [];
  const rejected: NonNullable<CroStep["rejected"]> = [];
  const evidence = options.competitors.flatMap((c) => c.pages.flatMap(evidenceForPage));
  let usage: AiUsage | undefined;

  // The matrix leads the step: it is the part that is measured rather than argued, and it gives the
  // per-competitor slides that follow something concrete to sit against.
  if (options.competitors.length > 0) {
    slides.push({
      id: "competitors-matrix",
      label: "Feature comparison",
      bullets: [],
      table: buildFeatureMatrix(
        options.clientName,
        options.clientHtml,
        options.competitors
          .filter((c) => !c.error)
          .map((c) => ({ name: c.name, html: options.competitorHtml[c.name] ?? [] })),
      ),
    });
  }

  for (const competitor of options.competitors) {
    options.onStage?.(`Drafting the ${competitor.name} benchmark slide (Claude)`);
    const drafted = await draftCompetitor(competitor, options.loadScreenshot);
    if (!drafted) continue;
    slides.push(drafted.slide);
    limitations.push(...drafted.limitations);
    rejected.push(...drafted.rejected);
    usage = addUsage(usage, drafted.usage);
  }

  return {
    key: "competitors",
    status: slides.length > 0 ? "generated" : "skipped",
    source: "capture",
    slides,
    evidence,
    limitations,
    rejected: rejected.length > 0 ? rejected : undefined,
    generatedAt: new Date().toISOString(),
    aiUsage: usage,
  };
}
