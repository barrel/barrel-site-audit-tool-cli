// The rules a CRO deck bullet has to satisfy before it reaches a slide.
//
// Barrel's CRO deliverable has a fixed house format — 3 to 5 bullets per slide, each one
// `Short title: short description`, framed as an opportunity rather than a fault — and the whole
// point of generating it is that a strategist can present the output without rewriting it. A
// prompt asking for that format produces it most of the time, which is the worst possible hit
// rate: the failures are individually plausible and only visible when someone reads all forty
// bullets in a deck the night before the meeting.
//
// So the format is enforced here, in code, over the model's output. Anything that fails is
// reported as rejected with a reason rather than dropped, because a slide that quietly lost two of
// its five bullets looks like a thin finding rather than a caught mistake.
//
// The numeric guards in the second half are a faithful copy of the ones in
// web/lib/data-analysis.ts. They are duplicated rather than shared because web/ deploys to Vercel
// as a self-contained directory and cannot import this package — the same boundary web/lib/shared.ts
// exists for. shared/test/cro-slides.test.ts asserts the two implementations agree on the same
// corpus of cases, which is a stronger guard than comparing their source.

import type {
  CroBullet,
  CroBulletEdit,
  CroEvidenceItem,
  CroRejectedBullet,
  CroSlide,
  CroStepKey,
} from "./cro-types.js";

/* ── Bullet identity ────────────────────────────────────────────────────────────────────────── */

/** FNV-1a, 32-bit. A hash rather than an index because a bullet's id has to survive its slide
 * being re-ordered, and rather than node:crypto because this module is mirrored into the web app
 * where it also runs in a request handler — one implementation, identical output on both sides.
 *
 * Not a security boundary: the only thing a collision costs is one strategist edit landing on the
 * wrong bullet of the same slide, and 32 bits is far more than enough for the five bullets a slide
 * can hold. */
function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // Multiply by the 32-bit FNV prime (16777619) using shifts, so this stays in 32-bit integer
    // arithmetic in every JS engine rather than drifting into float territory.
    hash = (hash + (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** A bullet's stable identity, derived from its content and where it sits.
 *
 * Content-derived on purpose. An index-based id (`ux-pdp-mobile-2`) is stable across a re-draft
 * that rewrites every bullet, which is exactly when a strategist's edit must NOT be silently
 * re-applied to different words. Deriving it from the title means a re-draft that rewords a bullet
 * orphans the edit — visibly, so it can be re-made against the new wording — while a re-draft that
 * happens to produce the same bullet keeps it. */
export function croBulletId(step: CroStepKey, slideId: string, title: string): string {
  return `${step}-${fnv1a(`${slideId}|${normalizeForId(title)}`)}`;
}

/** Case, whitespace and trailing punctuation are not part of a bullet's identity — a re-draft that
 * changes "Surface reviews above the fold" to "Surface Reviews Above the Fold" is the same bullet,
 * and an edit made against it should survive. */
function normalizeForId(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, " ").replace(/[.:;,!?]+$/, "");
}

/* ── Shape ──────────────────────────────────────────────────────────────────────────────────── */

/** A slide holds 3 to 5 bullets. Fewer reads as nothing found; more stops being a slide and starts
 * being a list nobody will read out loud. Both ends are the house format, not a technical limit. */
export const MIN_BULLETS_PER_SLIDE = 3;
export const MAX_BULLETS_PER_SLIDE = 5;

/** A title is a label, not a sentence.
 *
 * The character limit is the one that decides whether a title fits on one line of a projected
 * slide; the word count is a secondary guard against a title that is really a sentence. Seven
 * rather than six because six threw away "Pull Add to Cart onto screen one" on the first live run —
 * 31 characters, unmistakably a label, and a better bullet than two that survived. */
export const MAX_TITLE_WORDS = 7;
export const MAX_TITLE_CHARS = 52;

/** Two sentences at most, and short ones. The description exists to make the title actionable, not
 * to hold the analysis — that is what the evidence behind it is for. */
export const MAX_DESCRIPTION_CHARS = 240;
export const MAX_DESCRIPTION_SENTENCES = 2;

/** The Key Insights step's cards are the one place the house format is not a one-liner: each card
 * carries two or three sentences explaining why the insight matters. Its own limits rather than a
 * relaxation of the ones above, so a page-group slide can never quietly grow a paragraph. */
export const MAX_CARD_DESCRIPTION_CHARS = 460;
export const MAX_CARD_DESCRIPTION_SENTENCES = 3;

/** How long a description may run. Per-step because the deliverable's own format differs by step,
 * not because some steps are held to a lower standard — every other rule applies unchanged. */
export interface DescriptionLimits {
  maxChars: number;
  maxSentences: number;
}

export const SLIDE_BULLET_LIMITS: DescriptionLimits = {
  maxChars: MAX_DESCRIPTION_CHARS,
  maxSentences: MAX_DESCRIPTION_SENTENCES,
};

export const INSIGHT_CARD_LIMITS: DescriptionLimits = {
  maxChars: MAX_CARD_DESCRIPTION_CHARS,
  maxSentences: MAX_CARD_DESCRIPTION_SENTENCES,
};

/** Words that, as the first word of a title, make the bullet a complaint rather than an
 * opportunity.
 *
 * Deliberately a short list applied only to the leading word. The house style is a tone, and a
 * tone cannot be enforced by banning vocabulary — "no breadcrumbs are present" is a perfectly good
 * description, and a validator that rejected the word "no" would reject half of every good deck.
 * What it can catch is the specific failure of a bullet that opens by naming a fault: "Broken
 * filter UI", "Poor mobile hierarchy", "Missing trust signals". Those are the ones a client reads
 * as an accusation, and they are mechanically detectable. */
const PROBLEM_FRAMING_OPENERS = new Set([
  "bad",
  "broken",
  "confusing",
  "failing",
  "fails",
  "faulty",
  "flawed",
  "inadequate",
  "insufficient",
  "issue",
  "issues",
  "lack",
  "lacking",
  "lacks",
  "missing",
  "poor",
  "problem",
  "problematic",
  "problems",
  "unclear",
  "weak",
  "wrong",
]);

export interface RawBullet {
  title?: unknown;
  description?: unknown;
  impact?: unknown;
  tag?: unknown;
  evidenceIds?: unknown;
}

/** Why a bullet cannot be shown, in the wording a reviewer reads next to it — or null when it can.
 *
 * One function returning a reason string rather than a boolean plus a lookup, so a new rule and its
 * explanation can never be added in two places and get out of step. */
export function bulletShapeProblem(
  title: string,
  description: string,
  limits: DescriptionLimits = SLIDE_BULLET_LIMITS,
): string | null {
  const t = title.trim();
  const d = description.trim();

  if (!t) return "It arrived with no title.";
  if (!d) return "It arrived with no description.";

  if (t.length > MAX_TITLE_CHARS) {
    return `Its title is ${t.length} characters, past the ${MAX_TITLE_CHARS} that fit on a slide.`;
  }
  const words = t.split(/\s+/);
  if (words.length > MAX_TITLE_WORDS) {
    return `Its title is ${words.length} words, past the ${MAX_TITLE_WORDS}-word limit for a slide label.`;
  }
  // The rendered bullet is `title: description`, so a colon inside the title produces a line with
  // two of them and no way for a reader to tell which half is which.
  if (t.includes(":")) return "Its title contains a colon, which collides with the `title: description` format.";
  if (/[.!?]$/.test(t)) return "Its title ends in sentence punctuation, so it reads as a sentence rather than a label.";

  const opener = words[0].toLowerCase().replace(/[^a-z]/g, "");
  if (PROBLEM_FRAMING_OPENERS.has(opener)) {
    return `Its title opens with "${words[0]}", which frames the finding as a fault rather than an opportunity.`;
  }

  if (d.length > limits.maxChars) {
    return `Its description is ${d.length} characters, past the ${limits.maxChars}-character limit.`;
  }
  if (countSentences(d) > limits.maxSentences) {
    return `Its description runs to more than ${limits.maxSentences} sentences.`;
  }

  return null;
}

/** Sentence count, by terminal punctuation followed by a capital or end of string.
 *
 * Decimals and abbreviations are the reason this is not a `split(".")`: "converts at 1.4% on
 * mobile." is one sentence, and counting it as two would reject good copy. */
function countSentences(text: string): number {
  const matches = text.match(/[.!?]+(?=\s+[A-Z(“"']|\s*$)/g);
  return matches ? matches.length : 1;
}

/* ── Guards against fabrication ─────────────────────────────────────────────────────────────── */
// Copy of web/lib/data-analysis.ts's guards — see this file's header for why, and
// shared/test/cro-slides.test.ts for the test that keeps the two honest.

const NUMBER_TOKEN = /\d[\d,]*(?:\.\d+)?/g;

/** Every way a number in the source text may legitimately be restated: as written, and rounded to
 * one or zero decimal places. Rounding "2.43%" to "2.4%" in prose is a restatement, not an
 * invention; producing "3.1%" from it is an invention. */
function numberForms(raw: string): string[] {
  const value = Number(raw.replace(/,/g, ""));
  if (!Number.isFinite(value)) return [];
  return [String(value), String(Math.round(value * 10) / 10), String(Math.round(value))];
}

/** The set of numeric values a piece of prose is permitted to contain, derived from the text it is
 * allowed to draw on. */
export function allowedNumbers(sources: string[]): Set<string> {
  const allowed = new Set<string>();
  for (const source of sources) {
    for (const match of source.match(NUMBER_TOKEN) ?? []) {
      for (const form of numberForms(match)) allowed.add(form);
    }
  }
  return allowed;
}

/** Small bare integers a sentence can use as English rather than as data — "the top 3 products",
 * "both of the two templates". Never applied to a figure carrying a percent sign or a currency
 * symbol, which is where a fabricated metric would actually appear. */
const SMALL_INTEGER_LIMIT = 12;

/** Returns every number in `text` that the allowed set does not account for.
 *
 * The check that catches the failure this whole feature is most exposed to: a model looking at a
 * screenshot of a PDP and writing "moving the CTA above the fold typically lifts add-to-cart by
 * 12-18%". Nothing it was given contains 12 or 18, and on a slide that sentence is
 * indistinguishable from a measurement. */
export function unsupportedNumbers(text: string, allowed: Set<string>): string[] {
  const offenders: string[] = [];
  for (const match of text.matchAll(NUMBER_TOKEN)) {
    const raw = match[0];
    const value = Number(raw.replace(/,/g, ""));
    if (!Number.isFinite(value)) continue;
    if (allowed.has(String(value))) continue;

    const before = text.slice(0, match.index);
    const after = text.slice(match.index + raw.length);
    const isQuantified =
      /^\s*(%|percent|pp\b|GBP|USD|EUR|AUD|CAD)/i.test(after) ||
      /[$£€¥]\s*$/.test(before) ||
      /\b(GBP|USD|EUR|AUD|CAD)\s*$/i.test(before);
    const isBareSmallInteger = Number.isInteger(value) && value <= SMALL_INTEGER_LIMIT && !raw.includes(".");
    if (!isQuantified && isBareSmallInteger) continue;

    offenders.push(raw);
  }
  return offenders;
}

/* ── Validation ─────────────────────────────────────────────────────────────────────────────── */

export interface ValidatedBullets {
  accepted: CroBullet[];
  rejected: CroRejectedBullet[];
}

export interface ValidateOptions {
  step: CroStepKey;
  slideId: string;
  evidence: CroEvidenceItem[];
  /** Prose the bullets may draw numbers from beyond the evidence catalogue — the signals summary
   * and measurements handed to the model for this slide. Passing the same text the prompt
   * contained is what makes the number check fair rather than punitive. */
  extraSources?: string[];
  /** Off for steps whose evidence is a human's uploaded material rather than a measured catalogue
   * (Voice of Customer quotes, a strategist's journey notes) — there, the material itself is the
   * source and is checked differently. */
  requireEvidence?: boolean;
  /** Defaults to the one-sentence slide-bullet limits. The Key Insights step passes
   * INSIGHT_CARD_LIMITS, because a card's format is two or three sentences. */
  limits?: DescriptionLimits;
}

/** Turns whatever the model returned into the bullets that may be shown, plus the ones that may
 * not and why. Never throws: a malformed item is a rejection, not a failed run. */
export function validateBullets(raw: unknown, options: ValidateOptions): ValidatedBullets {
  const accepted: CroBullet[] = [];
  const rejected: CroRejectedBullet[] = [];
  const items = Array.isArray(raw) ? raw : [];
  const evidenceIds = new Set(options.evidence.map((e) => e.id));
  const allowed = allowedNumbers([
    ...options.evidence.map((e) => `${e.label} ${e.value ?? ""}`),
    ...(options.extraSources ?? []),
  ]);
  const seen = new Set<string>();

  for (const item of items) {
    const bullet = (item ?? {}) as RawBullet;
    const title = typeof bullet.title === "string" ? bullet.title.trim() : "";
    const description = typeof bullet.description === "string" ? bullet.description.trim() : "";

    const shape = bulletShapeProblem(title, description, options.limits ?? SLIDE_BULLET_LIMITS);
    if (shape) {
      rejected.push({ title: title || "(untitled)", description, reason: shape });
      continue;
    }

    const cited = Array.isArray(bullet.evidenceIds)
      ? bullet.evidenceIds.filter((id): id is string => typeof id === "string")
      : [];
    const known = cited.filter((id) => evidenceIds.has(id));
    const unknown = cited.filter((id) => !evidenceIds.has(id));

    if (unknown.length > 0) {
      rejected.push({
        title,
        description,
        reason: `It cited evidence that does not exist in this audit (${unknown.join(", ")}).`,
      });
      continue;
    }
    if (options.requireEvidence !== false && known.length === 0) {
      rejected.push({
        title,
        description,
        reason: "It cited none of the evidence it was given, so nothing observed on the site supports it.",
      });
      continue;
    }

    // Only the evidence this bullet actually cited — plus the shared prose sources — may supply its
    // figures. Allowing the whole catalogue would let a bullet about the cart borrow a number
    // measured on the PDP, which is a real and easy mistake to make.
    const citedText = [
      ...options.evidence.filter((e) => known.includes(e.id)).map((e) => `${e.label} ${e.value ?? ""}`),
      ...(options.extraSources ?? []),
    ];
    const offenders = unsupportedNumbers(
      `${title} ${description}`,
      known.length > 0 ? allowedNumbers(citedText) : allowed,
    );
    if (offenders.length > 0) {
      rejected.push({
        title,
        description,
        reason: `It contained figures that appear nowhere in the evidence it cited (${[...new Set(offenders)].join(", ")}).`,
      });
      continue;
    }

    const id = croBulletId(options.step, options.slideId, title);
    // A model asked for five distinct opportunities occasionally returns the same one twice in
    // different words; identical titles collapse to the same id and would silently overwrite each
    // other's edits.
    if (seen.has(id)) {
      rejected.push({ title, description, reason: "It repeats a bullet already on this slide." });
      continue;
    }
    seen.add(id);

    accepted.push({
      id,
      title,
      description,
      impact: bullet.impact === "high" || bullet.impact === "medium" || bullet.impact === "low" ? bullet.impact : undefined,
      tag: typeof bullet.tag === "string" && bullet.tag.trim() ? bullet.tag.trim() : undefined,
      evidenceIds: known,
    });

    if (accepted.length === MAX_BULLETS_PER_SLIDE) break;
  }

  return { accepted, rejected };
}

/** The rendered form, defined once so the report, the deck and any later export agree. */
export function formatBullet(bullet: Pick<CroBullet, "title" | "description">): string {
  return `${bullet.title}: ${bullet.description}`;
}

/** True when a slide has too few bullets to present. Not an error — a page group with two real
 * opportunities has two, and padding it would be worse — but the report says so, so a thin slide
 * reads as a thin finding rather than a broken generation.
 *
 * A slide whose content is a table is never thin: the grid is the finding, and the bullet count is
 * not the measure of it. */
export function slideIsThin(slide: CroSlide): boolean {
  if (slide.table) return false;
  return slide.bullets.length < MIN_BULLETS_PER_SLIDE;
}

/* ── Composing a strategist's edits over a generated report ─────────────────────────────────── */

export interface ComposedSlides {
  slides: CroSlide[];
  /** Ids the overlay holds edits for that no bullet in this report carries any more — the result of
   * re-drafting a step whose bullets were already corrected by hand. Surfaced so the corrections
   * can be re-made against the new wording instead of vanishing. */
  orphanedEditIds: string[];
  /** How many visible bullets carry a hand edit, for the "edited" marking in the internal view. */
  editedCount: number;
}

/** Applies an edit overlay to a step's slides.
 *
 * Never mutates its input, and never writes: the generated report is a record of what the tool
 * concluded, and it may already have been sent to a client. The composition happens at render
 * time, every time.
 *
 * Hidden bullets are removed from the returned slides rather than flagged, because every surface
 * that renders them (report, deck, client share link) wants them gone; the overlay keeps the
 * hidden entry, so the decision is reversible. */
export function composeSlides(slides: CroSlide[], edits: Record<string, CroBulletEdit> | undefined): ComposedSlides {
  if (!edits || Object.keys(edits).length === 0) {
    return { slides, orphanedEditIds: [], editedCount: 0 };
  }

  const present = new Set<string>();
  let editedCount = 0;

  const composed = slides.map((slide) => ({
    ...slide,
    bullets: slide.bullets.flatMap((bullet) => {
      const edit = edits[bullet.id];
      if (!edit) return [bullet];
      present.add(bullet.id);
      if (edit.hidden) return [];
      editedCount++;
      return [
        {
          ...bullet,
          title: edit.title?.trim() || bullet.title,
          description: edit.description?.trim() || bullet.description,
        },
      ];
    }),
  }));

  return {
    slides: composed,
    orphanedEditIds: Object.keys(edits).filter((id) => !present.has(id)),
    editedCount,
  };
}
