// What a CRO bullet is allowed to rest on, built out of a capture.
//
// This is the closed catalogue the drafting prompts are handed and the validator grades against.
// Building it here — pure, tested, with no model and no browser anywhere near it — is what makes
// the guarantee in cro-slides.ts meaningful: a bullet may cite `pdp-mobile-cta-fold` and restate
// its number, and may not produce a figure from anywhere else.
//
// The wording of each label is the wording a reader sees if they click through to the evidence
// behind a bullet, so these strings are written for a client, not for a log.

import type {
  CroBrief,
  CroDevice,
  CroEvidenceItem,
  CroPageCapture,
  CroPageGroup,
} from "./cro-types.js";
import { CRO_PAGE_GROUP_LABELS } from "./cro-types.js";

/** Below this ratio the primary CTA's text fails WCAG AA at normal size — and a CTA nobody can
 * comfortably read is a conversion problem before it is a compliance one. */
export const MIN_CTA_CONTRAST = 4.5;

/** Apple's and Google's shared floor for a comfortable touch target, in CSS pixels. */
export const MIN_TAP_TARGET_PX = 44;

function id(group: CroPageGroup, device: CroDevice, suffix: string): string {
  return `${group}-${device}-${suffix}`;
}

function round(value: number): number {
  return Math.round(value);
}

/** Every citable fact about one captured page.
 *
 * Signals become evidence one-for-one; measurements become evidence only where they say something
 * — a CTA position is always worth stating, a tap-target count of zero is not, and cluttering the
 * catalogue with non-findings makes the model cite the wrong things. */
export function evidenceForPage(page: CroPageCapture): CroEvidenceItem[] {
  const items: CroEvidenceItem[] = [];
  const { group, device, measurements: m } = page;
  const where = `${CRO_PAGE_GROUP_LABELS[group]} (${device})`;
  const source = `${where} capture`;

  if (page.error) {
    items.push({
      id: id(group, device, "capture-failed"),
      label: `${where} could not be captured: ${page.error}`,
      source,
    });
    return items;
  }

  if (page.note) {
    items.push({ id: id(group, device, "capture-note"), label: `${where}: ${page.note}`, source });
  }

  for (const signal of page.signals) {
    items.push({
      id: id(group, device, signal.id.replace(/^(ux|cro)-/, "")),
      label: `${signal.label} — ${signal.detail}`,
      source,
      screenshot: page.screenshotFold,
    });
  }

  // An overlay capture (a cart drawer over another page) has no page-level layout of its own worth
  // publishing — see CroPageCapture.overlay. Its signals are above and are about the drawer; the
  // measurements below would all be about whatever page it opened over.
  if (page.overlay) return items;

  if (m.viewportHeight > 0) {
    items.push({
      id: id(group, device, "page-height"),
      label: `The ${CRO_PAGE_GROUP_LABELS[group]} page is ${round(m.documentHeight)}px tall on ${device}, which is ${
        Math.round((m.documentHeight / m.viewportHeight) * 10) / 10
      } screens of scrolling.`,
      source,
      value: round(m.documentHeight),
    });
  }

  if (m.primaryCtaY !== undefined) {
    const belowBy = m.primaryCtaY - m.viewportHeight;
    items.push({
      id: id(group, device, "cta-fold"),
      label: m.primaryCtaAboveFold
        ? `The primary call to action sits ${round(m.primaryCtaY)}px down, inside the first screen on ${device}.`
        : `The primary call to action sits ${round(m.primaryCtaY)}px down — ${round(belowBy)}px below the first screen on ${device}, so a visitor has to scroll to reach it.`,
      source,
      value: round(m.primaryCtaY),
      screenshot: page.screenshotFold,
    });
  }

  if (m.stickyAddToCart) {
    items.push({
      id: id(group, device, "sticky-atc"),
      label: "A persistent add-to-cart bar follows the scroll, so the purchase action stays reachable wherever the visitor is on the page.",
      source,
    });
  }

  if (m.interactiveBelowFold > 0 && m.viewportHeight > 0) {
    items.push({
      id: id(group, device, "below-fold-controls"),
      label: `${m.interactiveBelowFold} interactive element(s) on this page start below the first screen on ${device}.`,
      source,
      value: m.interactiveBelowFold,
    });
  }

  if (m.smallTapTargets !== undefined && m.smallTapTargets > 0) {
    items.push({
      id: id(group, device, "tap-targets"),
      label: `${m.smallTapTargets} tap target(s) are smaller than ${MIN_TAP_TARGET_PX}px, which is below the size a thumb hits reliably.`,
      source,
      value: m.smallTapTargets,
    });
  }

  if (m.ctaContrast !== undefined && m.ctaContrast < MIN_CTA_CONTRAST) {
    items.push({
      id: id(group, device, "cta-contrast"),
      label: `The primary call to action's text contrast is ${m.ctaContrast}:1, below the ${MIN_CTA_CONTRAST}:1 needed to read comfortably at normal size.`,
      source,
      value: m.ctaContrast,
    });
  }

  if (m.formFieldCount !== undefined && m.formFieldCount > 0) {
    items.push({
      id: id(group, device, "form-fields"),
      label: `The primary form on this page has ${m.formFieldCount} visible field(s).`,
      source,
      value: m.formFieldCount,
    });
  }

  if (m.sectionOffsets.length > 0) {
    // One item for the whole reading order rather than one per section: a model given twenty
    // section-offset facts cites the one that fits its sentence, which is how a bullet ends up
    // about a section nobody scrolls to.
    const order = m.sectionOffsets
      .slice(0, 10)
      .map((s) => `${s.label} at ${round(s.top)}px`)
      .join("; ");
    items.push({
      id: id(group, device, "section-order"),
      label: `Reading order down the page on ${device}: ${order}.`,
      source,
    });
  }

  return items;
}

/** The catalogue for one page group across every device it was captured on. */
export function evidenceForGroup(pages: CroPageCapture[], group: CroPageGroup): CroEvidenceItem[] {
  return pages.filter((p) => p.group === group).flatMap(evidenceForPage);
}

/** The catalogue rendered for a prompt: one line per fact, id first.
 *
 * The id going first is not cosmetic — it is what the model copies into `evidenceIds`, and burying
 * it at the end of the line measurably increases the rate at which it cites nothing. */
export function evidenceForPrompt(items: CroEvidenceItem[]): string {
  return items.map((item) => `[${item.id}] ${item.label}`).join("\n");
}

/** The client's own words, folded into a prompt.
 *
 * Included because a CRO audit that ignores what the client already believes reads as a tool that
 * did not listen — and because their hypotheses are usually about the right page even when the
 * diagnosis is wrong, which is a useful prior. Never presented as fact to the model. */
export function briefForPrompt(brief: CroBrief | undefined): string {
  if (!brief) return "";
  const parts: string[] = [];
  if (brief.positioning?.trim()) {
    parts.push(`How the client positions the brand (their words, not a finding):\n${brief.positioning.trim()}`);
  }
  if (brief.hypotheses?.trim()) {
    parts.push(
      `What the client already suspects is costing them conversion (their words — engage with these where the evidence speaks to them, and do not repeat one back as a finding unless the evidence supports it):\n${brief.hypotheses.trim()}`,
    );
  }
  if (brief.subscription) parts.push("This store sells subscriptions, so frequency choice and what a subscription includes are part of the decision.");
  if (brief.giftCards) parts.push("This store sells gift cards.");
  return parts.join("\n\n");
}

/** The instruction half of a page-group prompt. Kept next to the evidence builder so the two cannot
 * describe different things. */
export function uxPromptText(group: CroPageGroup, evidence: CroEvidenceItem[], brief: CroBrief | undefined): string[] {
  const label = CRO_PAGE_GROUP_LABELS[group];
  const parts = [
    `You are reviewing the ${label} page type of one Shopify storefront for a conversion-rate audit.`,
    `Deterministic evidence captured from the live page. Cite these ids:\n${evidenceForPrompt(evidence)}`,
  ];
  const briefText = briefForPrompt(brief);
  if (briefText) parts.push(briefText);
  parts.push(
    `Screenshots follow: the first screen and the full page, at each device width that was captured. Ground every bullet in something you can actually see in them or read in the evidence above.`,
  );
  parts.push(
    `Write the ${label} slide of the audit deck: 3 to 5 opportunities to improve conversion on this page type. Where the evidence differs between mobile and desktop, say which device the opportunity is about.`,
  );
  return parts;
}
