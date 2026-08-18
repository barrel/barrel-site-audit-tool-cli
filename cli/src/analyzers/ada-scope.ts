import {
  ADA_REQUIREMENTS,
  adaRequirement,
  matchAdaRequirements,
  parseAdaScope,
  type AccessibilitySection,
  type AdaScopeEvidence,
  type AdaScopeItem,
  type AdaScopeSection,
  type AdaScopeStatus,
  type AiUsage,
  type AxePageResult,
  type AxeViolation,
  type ParsedAdaScopeItem,
  type PerformanceSection,
} from "@barrel/site-audit-shared";
import { probeAdaBehavior, type AdaProbeResult } from "./ada-probe.js";

/** Verifies a client's own pasted ADA scope, item by item, against what the audit actually
 * measured: axe-core rules, Google Lighthouse's accessibility audits, and a live keyboard/focus
 * probe. Every item comes back either verified complete or with a concrete, developer-ready
 * action naming the failing elements — so "did we deliver what was scoped?" has an evidenced
 * answer instead of a verbal one.
 *
 * Deliberately not part of overallScore: this measures scope delivery against one client's
 * contract, not the site's general quality, and it's absent from most reports. */

// Same pricing note as the other AI analyzers — informational only, not billed against.
const OPUS_5_PRICING_PER_MILLION = { input: 5, output: 25 };

function estimateCostUsd(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens / 1_000_000) * OPUS_5_PRICING_PER_MILLION.input +
    (outputTokens / 1_000_000) * OPUS_5_PRICING_PER_MILLION.output
  );
}

const MAX_SELECTORS = 8;
const MAX_SCOPE_CHARS = 20_000;

interface VerifyContext {
  axePages?: AxePageResult[];
  performance?: PerformanceSection;
  probe: AdaProbeResult | null;
}

interface VerifyOutcome {
  status: AdaScopeStatus;
  evidence: AdaScopeEvidence[];
  action?: string;
  affectedCount?: number;
}

const STATUS_RANK: Record<AdaScopeStatus, number> = {
  complete: 0,
  unverified: 1,
  manual: 2,
  partial: 3,
  incomplete: 4,
};

function unverified(reason: string, rerunHint: string): VerifyOutcome {
  return {
    status: "unverified",
    evidence: [{ source: "Audit coverage", detail: reason }],
    action: rerunHint,
  };
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

function formatSelectors(selectors: string[]): string {
  const shown = dedupe(selectors).slice(0, MAX_SELECTORS);
  if (shown.length === 0) return "";
  return shown.map((s) => `\`${s}\``).join(", ");
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

// ---------------------------------------------------------------------------
// axe-core / Lighthouse backed verifiers
// ---------------------------------------------------------------------------

interface AxeMatch {
  page: string;
  violation: AxeViolation;
}

function findAxeViolations(
  axePages: AxePageResult[],
  predicate: (v: AxeViolation) => boolean,
): AxeMatch[] {
  return axePages.flatMap((p) => p.violations.filter(predicate).map((violation) => ({ page: p.page, violation })));
}

/** Lighthouse only ever stores its *failing* accessibility audits (see performance.ts), and only
 * for the homepage on mobile — so its absence proves nothing and is never read as a pass. It's
 * used here purely as corroborating evidence when it agrees that something is broken, which is
 * also the number a client recognizes. */
function lighthouseEvidence(performance: PerformanceSection | undefined, auditIds: string[]): AdaScopeEvidence[] {
  if (!performance || auditIds.length === 0) return [];
  const failing = performance.accessibility.audits.filter((a) => auditIds.includes(a.id));
  if (failing.length === 0) return [];
  return [
    {
      source: "Lighthouse",
      page: "Home",
      detail: `Google Lighthouse also flags this on the homepage (accessibility score ${performance.accessibility.score}/100): ${failing
        .map((a) => a.title)
        .join("; ")}.`,
    },
  ];
}

interface AxeCheckConfig {
  label: string;
  /** axe rule IDs this requirement owns. */
  ruleIds?: string[];
  /** axe category/WCAG tags, for requirements that span a whole rule family. */
  tags?: string[];
  /** Lighthouse audit IDs measuring the same thing, used as corroboration. */
  lighthouseAudits?: string[];
  /** Imperative lead-in for the action item — what a developer should actually change. */
  fixHint: string;
}

function axeOutcome(ctx: VerifyContext, config: AxeCheckConfig): VerifyOutcome {
  const { axePages } = ctx;
  if (!axePages || axePages.length === 0) {
    return unverified(
      `The axe-core scan didn't run for this report, so ${config.label.toLowerCase()} couldn't be verified automatically.`,
      `Re-run the audit with the axe-core accessibility scan enabled (don't pass --skip-axe) to verify "${config.label}" automatically.`,
    );
  }

  const matches = findAxeViolations(axePages, (v) => {
    if (config.ruleIds?.includes(v.id)) return true;
    if (config.tags && config.tags.some((t) => v.tags.includes(t))) return true;
    return false;
  });

  const pageNames = axePages.map((p) => p.page).join(", ");
  const lhEvidence = lighthouseEvidence(ctx.performance, config.lighthouseAudits ?? []);

  if (matches.length === 0) {
    return {
      status: "complete",
      evidence: [
        {
          source: "axe-core",
          detail: `No ${config.label.toLowerCase()} violations on any scanned page (${pageNames}).`,
        },
        ...lhEvidence,
      ],
      affectedCount: 0,
    };
  }

  const affectedCount = matches.reduce((sum, m) => sum + m.violation.nodeCount, 0);
  const worstImpact = matches.some((m) => m.violation.impact === "critical" || m.violation.impact === "serious")
    ? "serious"
    : "moderate";

  const evidence: AdaScopeEvidence[] = matches.slice(0, 6).map((m) => ({
    source: "axe-core",
    page: m.page,
    detail: `${m.violation.help} — ${pluralize(m.violation.nodeCount, "element")} affected (rule \`${m.violation.id}\`, impact: ${m.violation.impact ?? "unspecified"}).`,
    selectors: dedupe(m.violation.nodes.map((n) => n.target.join(" "))).slice(0, MAX_SELECTORS),
  }));

  const allSelectors = matches.flatMap((m) => m.violation.nodes.map((n) => n.target.join(" ")));
  const helpUrls = dedupe(matches.map((m) => m.violation.helpUrl)).slice(0, 3);

  return {
    status: worstImpact === "serious" ? "incomplete" : "partial",
    evidence: [...evidence, ...lhEvidence],
    affectedCount,
    action:
      `${config.fixHint} ${pluralize(affectedCount, "element")} across ${pluralize(matches.length, "axe rule")} ` +
      `still fail on ${dedupe(matches.map((m) => m.page)).join(", ")}.` +
      (allSelectors.length > 0 ? ` Start with: ${formatSelectors(allSelectors)}.` : "") +
      ` Re-run the audit afterwards to confirm the rule passes. Rule docs: ${helpUrls.join(" ")}`,
  };
}

// ---------------------------------------------------------------------------
// Live-probe backed verifiers (the things a rule engine can't answer)
// ---------------------------------------------------------------------------

function probeMissing(label: string): VerifyOutcome {
  return unverified(
    `The live keyboard/focus probe didn't complete, so ${label} couldn't be verified automatically.`,
    `Verify "${label}" by hand: tab through the page from the top with no mouse, and confirm the expected behavior. Re-run the audit to try the automated probe again.`,
  );
}

function verifyKeyboardTabOrder(ctx: VerifyContext): VerifyOutcome {
  const probe = ctx.probe;
  if (!probe) return probeMissing("keyboard / TAB navigation");

  const evidence: AdaScopeEvidence[] = [];
  const unreachable: string[] = [];
  const positive: string[] = [];
  const negative: string[] = [];
  const traps: string[] = [];
  const truncatedPages: string[] = [];

  for (const p of probe.pages) {
    unreachable.push(...p.unreachable);
    positive.push(...p.positiveTabindex);
    negative.push(...p.negativeTabindexInteractive);
    if (p.focusTrap) traps.push(`${p.page}: \`${p.focusTrap}\``);
    if (!p.traversalComplete) truncatedPages.push(p.page);

    evidence.push({
      source: "Keyboard probe",
      page: p.page,
      detail: p.traversalComplete
        ? `TAB reached ${p.reachableCount} of ${p.interactiveCount} visible interactive elements` +
          (p.focusTrap ? ` before focus was trapped inside \`${p.focusTrap}\`` : "") +
          `.`
        : // Focus never wrapped back to the start within the key-press budget — usually because a
          // third-party iframe swallowed a long run of stops. What the pass didn't reach is
          // unproven, so it's reported as unfinished rather than as that many failures.
          `The TAB pass reached ${p.reachableCount} of ${p.interactiveCount} interactive elements but didn't ` +
          `finish walking the page's tab order within its key-press budget` +
          (p.nonCandidateStops > 0
            ? ` (${p.nonCandidateStops} stops landed inside embedded content or markup added after load)`
            : "") +
          `. The elements it didn't reach are unconfirmed either way — finish this page by hand.`,
      selectors: p.unreachable.slice(0, MAX_SELECTORS),
    });
  }

  if (traps.length > 0) {
    // No affectedCount: with focus held inside the trap, everything past it is blocked rather
    // than individually broken, and reporting ~60 failing elements would misstate the fix.
    return {
      status: "incomplete",
      evidence,
      action:
        `Keyboard focus is trapped — it cycles inside one container and never reaches the rest of the page (${traps.join("; ")}). ` +
        `Give that dialog/banner a proper focus loop: move focus into it when it opens, close it on Escape, return focus to the trigger, ` +
        `and don't hold focus once it's dismissed. Then tab from the top of the page to the footer and confirm you can reach every control.`,
    };
  }

  if (unreachable.length === 0 && positive.length === 0) {
    if (truncatedPages.length === 0) {
      return { status: "complete", evidence, affectedCount: 0 };
    }
    return {
      status: "partial",
      evidence,
      action:
        `Nothing unreachable was found on the pages the automated pass finished, but it ran out of key presses on ` +
        `${truncatedPages.join(", ")}. Tab from the top of ${truncatedPages.length === 1 ? "that page" : "those pages"} ` +
        `to the footer by hand and confirm every control is reachable — paying attention to third-party embeds, which ` +
        `is usually where the pass stalls.`,
    };
  }

  const actionParts: string[] = [];
  if (unreachable.length > 0) {
    actionParts.push(
      `Make these controls reachable with the TAB key: ${formatSelectors(unreachable)}. ` +
        `Usually this means replacing a click-handling \`div\`/\`span\` with a real \`<button>\`/\`<a href>\`, or removing a \`tabindex="-1"\` from something a user has to operate.`,
    );
  }
  if (positive.length > 0) {
    actionParts.push(
      `Remove the positive \`tabindex\` values on ${formatSelectors(positive)} — they override DOM order and make focus jump around; let source order drive the tab sequence.`,
    );
  }
  if (negative.length > 0) {
    actionParts.push(
      `Double-check the \`tabindex="-1"\` on ${formatSelectors(negative)} is intentional (a scripted focus target), not a control a keyboard user needs.`,
    );
  }
  if (truncatedPages.length > 0) {
    actionParts.push(
      `Also finish ${truncatedPages.join(", ")} by hand — the automated pass ran out of key presses there, so the rest of ${truncatedPages.length === 1 ? "that page" : "those pages"} is unconfirmed.`,
    );
  }
  actionParts.push(`Verify by tabbing from the top of each template to the footer with no mouse.`);

  return {
    status: unreachable.length > 0 ? "incomplete" : "partial",
    evidence,
    affectedCount: unreachable.length,
    action: actionParts.join(" "),
  };
}

function verifyFocusVisible(ctx: VerifyContext): VerifyOutcome {
  const probe = ctx.probe;
  if (!probe) return probeMissing("visible focus indicators");

  const evidence: AdaScopeEvidence[] = [];
  const invisible: string[] = [];
  let checked = 0;

  for (const p of probe.pages) {
    checked += p.focusChecked;
    invisible.push(...p.focusInvisible);
    evidence.push({
      source: "Keyboard probe",
      page: p.page,
      detail:
        p.focusInvisible.length === 0
          ? `All ${p.focusChecked} elements that received keyboard focus changed appearance visibly when focused.`
          : `${p.focusInvisible.length} of ${p.focusChecked} focused elements showed no visual change at all when focused (no outline, box-shadow, border, background or ::before/::after change).`,
      selectors: p.focusInvisible.slice(0, MAX_SELECTORS),
    });
  }

  if (checked === 0) return probeMissing("visible focus indicators");

  if (invisible.length === 0) {
    return { status: "complete", evidence, affectedCount: 0 };
  }

  return {
    status: "incomplete",
    evidence,
    affectedCount: invisible.length,
    action:
      `Give these elements a visible focus indicator: ${formatSelectors(invisible)}. ` +
      `Find the rule suppressing it (\`outline: none\` / \`outline: 0\`, often a global reset) and replace it with a deliberate indicator, e.g. ` +
      `\`:focus-visible { outline: 2px solid <brand color>; outline-offset: 2px; }\` — at least 3:1 contrast against the adjacent background, and don't rely on color change alone. ` +
      `Verify by tabbing through the page and confirming you can always see where focus is.`,
  };
}

function verifySkipLink(ctx: VerifyContext): VerifyOutcome {
  const probe = ctx.probe;
  if (!probe) return probeMissing("skip-navigation link");

  const evidence: AdaScopeEvidence[] = [];
  const problems: string[] = [];

  for (const p of probe.pages) {
    const s = p.skipLink;
    if (!s.present) {
      evidence.push({ source: "Keyboard probe", page: p.page, detail: "No skip-navigation link found in the document." });
      problems.push(`${p.page}: none present`);
      continue;
    }

    const notes: string[] = [];
    if (!s.targetExists) notes.push(`its target \`${s.href}\` doesn't exist on the page`);
    // The reveal is only judged when the TAB key actually landed on the link and kept focus.
    // Otherwise it's inconclusive — a scripted focus doesn't satisfy the `:focus-visible` styling
    // these links normally use, and a consent dialog's focus trap can pull focus away mid-measure.
    // In both cases the real finding (a trap) belongs to the keyboard-navigation item, not here.
    if (s.focusAssessed && !s.focusStolen && !s.visibleOnFocus) {
      notes.push("it stays visually hidden when the TAB key lands on it");
    }
    if (!s.firstFocusable) notes.push("it isn't one of the first focusable elements");

    const inconclusive = !s.focusAssessed || s.focusStolen;
    evidence.push({
      source: "Keyboard probe",
      page: p.page,
      detail:
        `Skip link found${s.text ? ` ("${s.text}")` : ""} pointing at \`${s.href}\`` +
        (notes.length > 0
          ? ` — but ${notes.join(", and ")}.`
          : inconclusive
            ? `, and its target exists — but the TAB pass never held focus on it long enough to confirm it becomes ` +
              `visible (focus was held elsewhere on this page — see the keyboard-navigation item).`
            : ", target exists, and it becomes visible when the TAB key lands on it."),
    });
    if (notes.length > 0) problems.push(`${p.page}: ${notes.join(", ")}`);
  }

  const anyConfirmed = probe.pages.some(
    (p) => p.skipLink.present && p.skipLink.focusAssessed && !p.skipLink.focusStolen && p.skipLink.visibleOnFocus,
  );
  if (problems.length === 0) {
    if (anyConfirmed) return { status: "complete", evidence, affectedCount: 0 };
    // Present and correctly wired everywhere, but no page ever held focus on it long enough to
    // prove it actually appears — worth one manual TAB press rather than a silent pass.
    return {
      status: "partial",
      evidence,
      action:
        `The skip link is present and points at a real target, but the automated pass never confirmed it becomes ` +
        `visible when focused. Load the page, press TAB once, and check the link appears on screen — if it doesn't, ` +
        `it's useless to a sighted keyboard user even though it exists.`,
    };
  }

  const anyPresent = probe.pages.some((p) => p.skipLink.present);
  return {
    status: anyPresent ? "partial" : "incomplete",
    evidence,
    affectedCount: problems.length,
    action:
      (anyPresent
        ? `Fix the existing skip link (${problems.join("; ")}).`
        : `Add a skip-navigation link as the first focusable element in \`layout/theme.liquid\`, before the header markup.`) +
      ` It should be the first thing TAB reaches, point at the \`id\` of the main content wrapper (e.g. \`<a class="skip-to-content" href="#MainContent">Skip to content</a>\` with \`<main id="MainContent" tabindex="-1">\`), ` +
      `be visually hidden until focused, and become clearly visible once focused. Verify by loading the page and pressing TAB once.`,
  };
}

function verifyImageAlt(ctx: VerifyContext): VerifyOutcome {
  const axe = axeOutcome(ctx, {
    label: "Image alt text",
    ruleIds: ["image-alt", "role-img-alt", "input-image-alt", "area-alt", "object-alt", "svg-img-alt", "image-redundant-alt"],
    lighthouseAudits: ["image-alt", "input-image-alt", "object-alt"],
    fixHint: `Add meaningful \`alt\` text to every content image (and \`alt=""\` to purely decorative ones).`,
  });

  // The probe adds the one thing axe can't give a client: how many images there are in total, and
  // exactly which ones carry no alt attribute at all.
  const probe = ctx.probe;
  if (!probe) return axe;

  const totalImages = probe.pages.reduce((sum, p) => sum + p.images.total, 0);
  const missing = probe.pages.flatMap((p) => p.images.missingAlt);
  const emptyAlt = probe.pages.reduce((sum, p) => sum + p.images.emptyAlt, 0);

  const probeEvidence: AdaScopeEvidence = {
    // Same live browser pass as the keyboard checks, but labelled for what it measured here —
    // "Keyboard probe: 583 <img> elements" reads like a mistake.
    source: "Live page scan",
    detail:
      `${totalImages} \`<img>\` elements across ${pluralize(probe.pages.length, "page")}: ` +
      `${missing.length} with no \`alt\` attribute at all, ${emptyAlt} with \`alt=""\` (correct only if the image is decorative).`,
    selectors: missing.slice(0, MAX_SELECTORS),
  };

  if (missing.length > 0 && axe.status === "complete") {
    return {
      status: "partial",
      evidence: [...axe.evidence, probeEvidence],
      affectedCount: missing.length,
      action:
        `axe reports no alt-text rule failures, but ${pluralize(missing.length, "image")} carry no \`alt\` attribute at all: ${formatSelectors(missing)}. ` +
        `Add descriptive \`alt\` text for content images and \`alt=""\` for decorative ones. Note that images populated by the client through the theme editor or metafields ` +
        `also need alt text entered in Shopify admin — confirm the theme actually outputs \`{{ image.alt }}\` (or the metafield) rather than hardcoding or dropping it.`,
    };
  }

  return { ...axe, evidence: [...axe.evidence, probeEvidence] };
}

const AXE_BACKED: Record<string, AxeCheckConfig> = {
  "color-contrast": {
    label: "Color contrast",
    ruleIds: ["color-contrast", "color-contrast-enhanced", "link-in-text-block"],
    lighthouseAudits: ["color-contrast"],
    fixHint: `Raise the failing foreground/background pairs to at least 4.5:1 (3:1 for text 18.66px+ bold or 24px+, and for UI component boundaries) — change the token/variable, not the one-off rule, so the fix holds across templates.`,
  },
  "form-labels": {
    label: "Form field labels",
    ruleIds: [
      "label",
      "select-name",
      "form-field-multiple-labels",
      "label-title-only",
      "aria-input-field-name",
      "aria-toggle-field-name",
    ],
    lighthouseAudits: ["label", "select-name", "form-field-multiple-labels"],
    fixHint: `Give every input, select and textarea a programmatic label (\`<label for>\`, or \`aria-label\`/\`aria-labelledby\` where a visible label isn't wanted) — placeholder text is not a label.`,
  },
  "heading-structure": {
    label: "Heading structure",
    ruleIds: ["page-has-heading-one", "heading-order", "empty-heading"],
    lighthouseAudits: ["heading-order", "empty-heading"],
    fixHint: `Give each template exactly one \`<h1>\` and step heading levels without skipping — style with CSS rather than choosing tags for size.`,
  },
  landmarks: {
    label: "Landmarks & semantic regions",
    ruleIds: [
      "region",
      "landmark-one-main",
      "landmark-unique",
      "landmark-no-duplicate-banner",
      "landmark-no-duplicate-contentinfo",
      "bypass",
    ],
    lighthouseAudits: ["bypass"],
    fixHint: `Wrap page content in real landmarks — \`<header>\`, \`<nav>\`, \`<main id="MainContent">\`, \`<footer>\` — so screen-reader users can jump between regions instead of reading through the header every time.`,
  },
  "link-name": {
    label: "Link names",
    ruleIds: ["link-name", "identical-links-same-purpose"],
    lighthouseAudits: ["link-name"],
    fixHint: `Give every link discernible text — visible text, or an \`aria-label\`/visually-hidden span on icon-only links (social icons, cart, search).`,
  },
  "button-name": {
    label: "Button & control names",
    ruleIds: ["button-name", "input-button-name", "aria-command-name", "aria-tooltip-name"],
    lighthouseAudits: ["button-name", "input-button-name"],
    fixHint: `Give every button and custom control an accessible name (visible text, \`aria-label\`, or a visually-hidden span) — an icon glyph alone announces nothing.`,
  },
  "aria-valid": {
    label: "ARIA usage",
    tags: ["cat.aria"],
    lighthouseAudits: [
      "aria-allowed-attr",
      "aria-required-attr",
      "aria-required-children",
      "aria-required-parent",
      "aria-roles",
      "aria-valid-attr",
      "aria-valid-attr-value",
      "aria-hidden-focus",
      "aria-hidden-body",
    ],
    fixHint: `Correct the invalid ARIA — valid roles only, only attributes that role allows, required parent/child structures intact, and no \`aria-*\` pointing at an id that doesn't exist.`,
  },
  "page-language": {
    label: "Page language",
    ruleIds: ["html-has-lang", "html-lang-valid", "valid-lang", "html-xml-lang-mismatch"],
    lighthouseAudits: ["html-has-lang", "html-lang-valid", "valid-lang"],
    fixHint: `Set a valid \`lang\` on \`<html>\` in \`layout/theme.liquid\` (Shopify themes should output \`{{ request.locale.iso_code }}\`), and mark any passage in another language with its own \`lang\`.`,
  },
  "page-title": {
    label: "Page titles",
    ruleIds: ["document-title"],
    lighthouseAudits: ["document-title"],
    fixHint: `Give every template a non-empty, page-specific \`<title>\`.`,
  },
  tables: {
    label: "Data tables",
    tags: ["cat.tables"],
    fixHint: `Give data tables real \`<th>\` header cells with \`scope\`, and a \`<caption>\` describing the table — and don't use tables for layout.`,
  },
  "wcag-aa": {
    label: "WCAG 2.1 AA (automatable subset)",
    tags: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
    fixHint: `Clear the remaining WCAG A/AA rule failures below.`,
  },
};

type Verifier = (ctx: VerifyContext) => VerifyOutcome;

const VERIFIERS: Record<string, Verifier> = {
  "keyboard-tab-order": verifyKeyboardTabOrder,
  "focus-visible": verifyFocusVisible,
  "skip-link": verifySkipLink,
  "image-alt": verifyImageAlt,
  ...Object.fromEntries(
    Object.entries(AXE_BACKED).map(([id, config]) => [id, (ctx: VerifyContext) => axeOutcome(ctx, config)] as const),
  ),
};

/** Requirements whose verification needs the live keyboard/focus probe — used to skip that
 * browser pass entirely when nothing in the scope asks for it. */
const PROBE_REQUIREMENTS = new Set(["keyboard-tab-order", "focus-visible", "skip-link", "image-alt"]);

// ---------------------------------------------------------------------------
// AI mapping for scope wording the keyword catalog doesn't recognize
// ---------------------------------------------------------------------------

const MAPPING_SCHEMA = {
  type: "object",
  properties: {
    mappings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          index: { type: "number" },
          requirementIds: { type: "array", items: { type: "string" } },
          manualAction: { type: "string" },
        },
        required: ["index", "requirementIds"],
        additionalProperties: false,
      },
    },
  },
  required: ["mappings"],
  additionalProperties: false,
} as const;

interface AiMapping {
  index: number;
  requirementIds: string[];
  manualAction?: string;
}

/** Maps scope lines the keyword catalog didn't recognize onto catalog requirements, and writes a
 * concrete manual-QA instruction for anything genuinely unautomatable. Returns null (never
 * throws) with no API key or on any failure — those items just fall through to manual. */
async function mapWithAi(
  items: Array<{ index: number; text: string }>,
): Promise<{ mappings: AiMapping[]; usage: AiUsage } | null> {
  if (!process.env.ANTHROPIC_API_KEY || items.length === 0) return null;

  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic();

    const catalog = ADA_REQUIREMENTS.map(
      (r) => `- ${r.id}${r.automated ? "" : " (NOT automatable)"}: ${r.label} — ${r.description}`,
    ).join("\n");

    const response = await client.messages.create({
      model: "claude-opus-5",
      max_tokens: 2048,
      system:
        "You map lines from a client's ADA/accessibility scope of work onto a fixed catalog of checks that an " +
        "automated audit already performs. For each line, return every catalog requirement ID that the audit could " +
        "legitimately use to verify that line — only IDs from the catalog, never invented ones, and only where the " +
        "check genuinely verifies what the line asks for. Do not stretch a loose association into a match: a wrong " +
        "match would mark a scope item complete on evidence that doesn't apply to it, which is worse than leaving it " +
        "to manual review. Return an empty requirementIds array when nothing in the catalog verifies the line, and " +
        "whenever you do (or when the only matches are marked NOT automatable), also return `manualAction`: one or " +
        "two sentences telling a developer or QA engineer exactly how to verify or implement that specific line — " +
        "imperative, concrete, naming the thing to check. No restating the scope line back, no generic advice.",
      output_config: { format: { type: "json_schema", schema: MAPPING_SCHEMA } },
      messages: [
        {
          role: "user",
          content:
            `Catalog of available automated checks:\n${catalog}\n\n` +
            `Scope lines to map (by index):\n${items.map((i) => `${i.index}. ${i.text}`).join("\n")}`,
        },
      ],
    });

    const textBlock = response.content.find(
      (b): b is Extract<(typeof response.content)[number], { type: "text" }> => b.type === "text",
    );
    if (!textBlock) return null;

    const parsed = JSON.parse(textBlock.text) as { mappings: AiMapping[] };
    // Drop anything that isn't a real catalog ID, whatever the model returned.
    const mappings = parsed.mappings.map((m) => ({
      ...m,
      requirementIds: (m.requirementIds ?? []).filter((id) => adaRequirement(id) !== undefined),
    }));

    const inputTokens = response.usage.input_tokens;
    const outputTokens = response.usage.output_tokens;
    return {
      mappings,
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

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

function manualOutcome(requirementIds: string[], aiAction: string | undefined, text: string): VerifyOutcome {
  const manualReqs = requirementIds.map(adaRequirement).filter((r): r is NonNullable<typeof r> => Boolean(r));
  const detail =
    manualReqs.length > 0
      ? `${manualReqs.map((r) => r.label).join(", ")}: ${manualReqs[0].description}`
      : "No automated check in this audit covers this scope item — it needs a person to verify it.";

  // Preference order: Claude's line about this specific scope wording, then the catalog's own
  // how-to-check hint for the matched requirement, then a bare instruction to verify by hand.
  const hints = manualReqs.map((r) => r.manualHint).filter((h): h is string => Boolean(h));
  const action =
    aiAction?.trim() ||
    (hints.length > 0
      ? hints.join(" ")
      : `Verify by hand and record who signed it off: "${text}". Nothing in the automated audit can confirm this one.`);

  return { status: "manual", evidence: [{ source: "Manual review", detail }], action };
}

function combine(outcomes: VerifyOutcome[]): VerifyOutcome {
  if (outcomes.length === 1) return outcomes[0];
  const status = outcomes.reduce<AdaScopeStatus>(
    (worst, o) => (STATUS_RANK[o.status] > STATUS_RANK[worst] ? o.status : worst),
    "complete",
  );
  const actions = outcomes.filter((o) => o.status !== "complete" && o.action).map((o) => o.action as string);
  const affected = outcomes.reduce((sum, o) => sum + (o.affectedCount ?? 0), 0);
  return {
    status,
    evidence: outcomes.flatMap((o) => o.evidence),
    action: actions.length > 0 ? dedupe(actions).join("\n\n") : undefined,
    affectedCount: affected > 0 ? affected : undefined,
  };
}

export interface AdaScopeResult {
  section: AdaScopeSection;
  usage?: AiUsage;
}

export interface AdaScopeInput {
  auditUrl: string;
  accessibility?: AccessibilitySection;
  performance?: PerformanceSection;
}

/** Verifies a pasted ADA scope against this run's axe-core, Lighthouse and live-probe results.
 * Returns null (never throws) when the scope is empty or parses to nothing verifiable. */
export async function analyzeAdaScope(
  rawScope: string,
  input: AdaScopeInput,
  hooks: { onStage?: (stage: string) => void } = {},
): Promise<AdaScopeResult | null> {
  const scope = rawScope.slice(0, MAX_SCOPE_CHARS).trim();
  if (!scope) return null;

  const parsed: ParsedAdaScopeItem[] = parseAdaScope(scope);
  if (parsed.length === 0) return null;

  // 1. Keyword catalog first — deterministic, free, and correct for the wording that actually
  //    recurs across client scopes.
  const matched = parsed.map((item) => ({ item, requirementIds: matchAdaRequirements(item.text) }));

  // 2. Claude maps only what the catalog didn't recognize.
  const unmatched = matched
    .map((m, index) => ({ index, text: m.item.text, empty: m.requirementIds.length === 0 }))
    .filter((m) => m.empty)
    .map(({ index, text }) => ({ index, text }));

  let usage: AiUsage | undefined;
  const aiActions = new Map<number, string>();
  const aiMatchedIndexes = new Set<number>();
  if (unmatched.length > 0) {
    hooks.onStage?.(`Mapping ${pluralize(unmatched.length, "unrecognized ADA scope item")} to checks (Claude)`);
    const aiResult = await mapWithAi(unmatched);
    if (aiResult) {
      usage = aiResult.usage;
      for (const mapping of aiResult.mappings) {
        const target = matched[mapping.index];
        if (!target) continue;
        if (mapping.requirementIds.length > 0) {
          target.requirementIds = mapping.requirementIds;
          aiMatchedIndexes.add(mapping.index);
        }
        if (mapping.manualAction) aiActions.set(mapping.index, mapping.manualAction);
      }
    }
  }

  // 3. Only pay for the live browser pass if something in the scope actually needs it.
  const allRequirements = new Set(matched.flatMap((m) => m.requirementIds));
  const needsProbe = [...allRequirements].some((id) => PROBE_REQUIREMENTS.has(id));
  let probe: AdaProbeResult | null = null;
  if (needsProbe) {
    hooks.onStage?.("Probing keyboard navigation, focus visibility & skip links (live browser)");
    probe = await probeAdaBehavior(input.auditUrl).catch(() => null);
  }

  const ctx: VerifyContext = {
    axePages: input.accessibility?.pages,
    performance: input.performance,
    probe,
  };

  const items: AdaScopeItem[] = matched.map((m, index) => {
    const automatedIds = m.requirementIds.filter((id) => adaRequirement(id)?.automated && VERIFIERS[id]);
    const manualIds = m.requirementIds.filter((id) => !adaRequirement(id)?.automated || !VERIFIERS[id]);

    const outcomes: VerifyOutcome[] = automatedIds.map((id) => VERIFIERS[id](ctx));
    if (manualIds.length > 0 || outcomes.length === 0) {
      outcomes.push(manualOutcome(manualIds, aiActions.get(index), m.item.text));
    }

    const combined = combine(outcomes);
    return {
      id: m.item.id,
      text: m.item.text,
      group: m.item.group,
      status: combined.status,
      requirementIds: m.requirementIds,
      matchedBy: m.requirementIds.length === 0 ? "none" : aiMatchedIndexes.has(index) ? "ai" : "catalog",
      evidence: combined.evidence,
      action: combined.status === "complete" ? undefined : combined.action,
      affectedCount: combined.affectedCount,
    };
  });

  const count = (status: AdaScopeStatus) => items.filter((i) => i.status === status).length;
  const completeCount = count("complete");
  const partialCount = count("partial");
  const incompleteCount = count("incomplete");
  const automated = completeCount + partialCount + incompleteCount;

  return {
    section: {
      rawScope: scope,
      items,
      completeCount,
      partialCount,
      incompleteCount,
      manualCount: count("manual"),
      unverifiedCount: count("unverified"),
      coverage: automated > 0 ? Math.round((completeCount / automated) * 100) : 0,
      pagesScanned: dedupe([
        ...(probe?.pages.map((p) => p.page) ?? []),
        ...(input.accessibility?.pages.map((p) => p.page) ?? []),
      ]),
      lighthouseAccessibilityScore: input.performance?.accessibility.score,
      axeScore: input.accessibility?.score,
    },
    usage,
  };
}
