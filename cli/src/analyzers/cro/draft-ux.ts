// Step 2 of the CRO audit: the page-group UX slides.
//
// One model call per page group, given that group's evidence catalogue and its screenshots at every
// captured device width. Per group rather than one call for the whole site because the deliverable
// is one slide per page type, and a single call asked for six slides reliably produces its best
// three and pads the rest.

import type {
  AiUsage,
  CroBrief,
  CroDevice,
  CroPageCapture,
  CroPageGroup,
  CroSlide,
  CroStep,
} from "@barrel/site-audit-shared";
import {
  CRO_PAGE_GROUP_LABELS,
  evidenceForGroup,
  slideIsThin,
  uxPromptText,
  validateBullets,
} from "@barrel/site-audit-shared";
import { BULLETS_SCHEMA, CRO_HOUSE_RULES, addUsage, callModel, type ModelImage } from "./ai.js";

const SYSTEM = [
  "You are a conversion-rate-optimisation strategist at a digital agency, writing one slide of a client-facing audit deck.",
  "You are looking at screenshots of a real storefront and a catalogue of measurements taken from it.",
  "Be specific and visual: reference layout, hierarchy, copy and imagery you can actually see, and the measured fold positions you were given.",
  "",
  "Format rules, which are enforced after you answer — a bullet that breaks one is discarded:",
  CRO_HOUSE_RULES,
].join("\n");

interface DraftedSlide {
  slide: CroSlide;
  usage?: AiUsage;
  limitations: string[];
  rejected: CroStep["rejected"];
}

/** Screenshots for a group, ordered so the model reads mobile before desktop.
 *
 * Mobile first because it is where most sessions and almost all of the friction are, and because
 * the first images in a message carry the most weight in the answer. */
async function imagesForGroup(
  pages: CroPageCapture[],
  group: CroPageGroup,
  devices: readonly CroDevice[],
  loadScreenshot: (pathname: string) => Promise<Buffer | null>,
): Promise<ModelImage[]> {
  const images: ModelImage[] = [];
  for (const device of devices) {
    const page = pages.find((p) => p.group === group && p.device === device && !p.error);
    if (!page) continue;
    for (const [crop, pathname] of [
      ["first screen", page.screenshotFold],
      ["full page", page.screenshotFull],
    ] as const) {
      if (!pathname) continue;
      const buffer = await loadScreenshot(pathname);
      if (buffer) {
        images.push({
          caption: `${CRO_PAGE_GROUP_LABELS[group]} — ${device}, ${crop}:`,
          buffer,
        });
      }
    }
  }
  return images;
}

async function draftGroup(
  group: CroPageGroup,
  pages: CroPageCapture[],
  devices: readonly CroDevice[],
  brief: CroBrief | undefined,
  loadScreenshot: (pathname: string) => Promise<Buffer | null>,
): Promise<DraftedSlide | null> {
  const groupPages = pages.filter((p) => p.group === group);
  if (groupPages.length === 0) return null;

  const slideId = `ux-${group}`;
  const label = CRO_PAGE_GROUP_LABELS[group];
  const evidence = evidenceForGroup(pages, group);
  const limitations: string[] = [];

  const failed = groupPages.filter((p) => p.error);
  for (const page of failed) {
    limitations.push(`${label} on ${page.device} was not captured: ${page.error}`);
  }
  if (failed.length === groupPages.length) {
    // Nothing was seen, so there is nothing to interpret. A slide of bullets written from a
    // catalogue that contains only "could not be captured" would be pure invention.
    return {
      slide: { id: slideId, label, group, bullets: [], screenshots: [] },
      limitations,
      rejected: [],
    };
  }

  const images = await imagesForGroup(pages, group, devices, loadScreenshot);
  const promptText = uxPromptText(group, evidence, brief);

  const result = await callModel<{ bullets: unknown }>({
    system: SYSTEM,
    text: promptText,
    images,
    schema: BULLETS_SCHEMA as unknown as Record<string, unknown>,
    maxTokens: 2048,
  });

  if (!result.ok) {
    limitations.push(
      `The ${label} slide could not be drafted: ${result.reason} The evidence captured for it is stored, so it can be drafted later without re-crawling the site.`,
    );
    return { slide: { id: slideId, label, group, bullets: [] }, limitations, rejected: [] };
  }

  const { accepted, rejected } = validateBullets(result.result.data.bullets, {
    step: "ux",
    slideId,
    evidence,
    // The reading-order and measurement lines are already in the catalogue; passing the prompt's
    // own text as an extra number source lets a bullet restate a figure the prompt stated without
    // having to cite the exact line it came from.
    extraSources: promptText,
  });

  const slide: CroSlide = {
    id: slideId,
    label,
    group,
    bullets: accepted,
    screenshots: groupPages.flatMap((p) => [p.screenshotFold, p.screenshotFull].filter((s): s is string => Boolean(s))),
  };

  if (slideIsThin(slide)) {
    limitations.push(
      `The ${label} slide carries ${accepted.length} opportunit${accepted.length === 1 ? "y" : "ies"} rather than the usual three to five${
        rejected.length > 0 ? `, after ${rejected.length} were discarded by the format and evidence checks` : ""
      }.`,
    );
  }

  return { slide, usage: result.result.usage, limitations, rejected };
}

export interface DraftUxOptions {
  pages: CroPageCapture[];
  groups: readonly CroPageGroup[];
  devices: readonly CroDevice[];
  brief?: CroBrief;
  /** Reads a screenshot back by blob pathname. Injected so this module works the same whether the
   * bytes are still in memory from the capture or have to come out of Blob storage. */
  loadScreenshot: (pathname: string) => Promise<Buffer | null>;
  onStage?: (stage: string) => void;
}

/** The whole of Step 2. Sequential rather than parallel: these are large image-bearing requests,
 * and a CRO run is not latency-sensitive enough to justify six of them in flight at once. */
export async function draftUxStep(options: DraftUxOptions): Promise<CroStep> {
  const slides: CroSlide[] = [];
  const limitations: string[] = [];
  const rejected: NonNullable<CroStep["rejected"]> = [];
  let usage: AiUsage | undefined;

  for (const group of options.groups) {
    options.onStage?.(`Drafting the ${CRO_PAGE_GROUP_LABELS[group]} slide (Claude)`);
    const drafted = await draftGroup(group, options.pages, options.devices, options.brief, options.loadScreenshot);
    if (!drafted) continue;
    slides.push(drafted.slide);
    limitations.push(...drafted.limitations);
    rejected.push(...(drafted.rejected ?? []));
    usage = addUsage(usage, drafted.usage);
  }

  const anyBullets = slides.some((s) => s.bullets.length > 0);

  return {
    key: "ux",
    // "insufficient" rather than "generated" when nothing at all was drafted: an empty step that
    // claims to have run reads as "no opportunities on this site", which is never the finding.
    status: anyBullets ? "generated" : "insufficient",
    source: "capture",
    slides,
    evidence: options.groups.flatMap((group) => evidenceForGroup(options.pages, group)),
    limitations,
    rejected: rejected.length > 0 ? rejected : undefined,
    generatedAt: new Date().toISOString(),
    aiUsage: usage,
  };
}
