/** Parsing and requirement-matching for a client's pasted ADA scope — the wording of that scope
 * changes client to client, so nothing here assumes a fixed list. Lives in shared (rather than
 * the CLI) so the dashboard's Run Audit form can preview exactly the same parse the audit will
 * run, and the report page can label requirements with the same catalog. The verifiers that
 * actually decide pass/fail live in the CLI (cli/src/analyzers/ada-scope.ts), since they need
 * live-browser and axe data. */

export interface ParsedAdaScopeItem {
  id: string;
  /** The scope line as pasted, minus its bullet marker and surrounding whitespace. */
  text: string;
  /** The "such as:" style heading this line sat under, when the pasted scope had one. */
  group?: string;
}

/** One automatable (or explicitly manual) accessibility requirement a scope line can map to. */
export interface AdaRequirementDef {
  id: string;
  label: string;
  /** What the automated check actually verifies — shown in the report so nobody has to guess
   * how a checkbox got ticked. */
  description: string;
  /** Lowercased phrases that, found in a scope line, map it to this requirement. Deliberately
   * specific phrases rather than single generic words ("keyboard", "focus"), so one line doesn't
   * collect every loosely-related requirement. */
  keywords: string[];
  /** false = there is no honest automated check for this; matching lines become explicit manual
   * QA action items rather than being silently marked complete. */
  automated: boolean;
  /** For non-automated requirements: how to actually check it, so a manual item still hands over
   * a concrete task instead of "verify this by hand". */
  manualHint?: string;
}

// Ordered roughly by how often it shows up in a real Barrel ADA scope.
export const ADA_REQUIREMENTS: AdaRequirementDef[] = [
  {
    id: "keyboard-tab-order",
    label: "Keyboard / TAB navigation",
    description:
      "Tabs through every scanned page from the top and compares what the TAB key actually reaches against every visible interactive element in the DOM.",
    keywords: [
      "tab key",
      "tab-key",
      "tab through",
      "tabbed through",
      "tab to each",
      "tab order",
      "tabbing",
      "navigated using the tab",
      "navigate using the tab",
      "keyboard navigat",
      "keyboard accessib",
      "keyboard only",
      "keyboard-only",
      "without a mouse",
      "operable by keyboard",
    ],
    automated: true,
  },
  {
    id: "focus-visible",
    label: "Visible focus indicators",
    description:
      "Captures each interactive element's computed styles before and during real keyboard focus, and flags any element whose appearance doesn't change (suppressed outline with no replacement).",
    keywords: [
      "focus outline",
      "focus outlines",
      "focus indicator",
      "focus ring",
      "focus state",
      "focus styles",
      "focus-visible",
      "visible focus",
      "focus is visible",
      "receives focus",
      "receive focus",
      "focused element",
    ],
    automated: true,
  },
  {
    id: "skip-link",
    label: "Skip-navigation link",
    description:
      "Looks for a skip link among the first focusable elements, verifies its target exists, and confirms it becomes visible once focused.",
    keywords: [
      "skip navigation",
      "skip nav",
      "skip to content",
      "skip to main",
      "skip link",
      "skip-link",
      "bypass block",
      "link to skip",
    ],
    automated: true,
  },
  {
    id: "image-alt",
    label: "Image alt text",
    description:
      "axe-core's image-alt / role-img-alt / input-image-alt rules across every scanned page, plus a direct count of <img> elements with no alt attribute at all.",
    keywords: [
      "alt text",
      "alt-text",
      "alt attribute",
      "alt tag",
      "alternative text",
      "image alt",
      "images have alt",
      "text alternative",
    ],
    automated: true,
  },
  {
    id: "color-contrast",
    label: "Color contrast",
    description:
      "axe-core's color-contrast rule (WCAG AA, 4.5:1 body / 3:1 large text) against the rendered pages, with the failing elements listed.",
    keywords: [
      "color contrast",
      "colour contrast",
      "contrast ratio",
      "contrast ratios",
      "foreground and background",
      "4.5:1",
      "3:1",
      "contrast requirement",
    ],
    automated: true,
  },
  {
    id: "form-labels",
    label: "Form field labels",
    description:
      "axe-core's label / select-name / form-field-multiple-labels rules — every input, select and textarea has a programmatic label.",
    keywords: [
      "form label",
      "form labels",
      "field label",
      "input label",
      "labels for form",
      "form field",
      "form accessib",
      "labelled input",
      "labeled input",
    ],
    automated: true,
  },
  {
    id: "heading-structure",
    label: "Heading structure",
    description:
      "axe-core's page-has-heading-one / heading-order / empty-heading rules — one H1 per page and no skipped levels.",
    keywords: [
      "heading structure",
      "heading hierarchy",
      "heading order",
      "heading level",
      "semantic heading",
      "h1",
      "headings are",
    ],
    automated: true,
  },
  {
    id: "landmarks",
    label: "Landmarks & semantic regions",
    description:
      "axe-core's region / landmark-* rules — page content sits inside header/nav/main/footer landmarks rather than bare divs.",
    keywords: [
      "landmark",
      "semantic region",
      "semantic markup",
      "semantic html",
      "main region",
      "aria landmark",
      "document structure",
    ],
    automated: true,
  },
  {
    id: "link-name",
    label: "Link names",
    description:
      "axe-core's link-name rule — every link exposes discernible text to a screen reader (no bare icon links).",
    keywords: ["link text", "link name", "descriptive link", "link is descriptive", "meaningful link"],
    automated: true,
  },
  {
    id: "button-name",
    label: "Button & control names",
    description:
      "axe-core's button-name / input-button-name / aria-command-name rules — every button and custom control has an accessible name.",
    keywords: ["button name", "button text", "button label", "control has a name", "accessible name", "icon button"],
    automated: true,
  },
  {
    id: "aria-valid",
    label: "ARIA usage",
    description:
      "every axe-core rule tagged cat.aria — valid roles, allowed attributes, required parent/child relationships, no broken references.",
    keywords: ["aria", "role attribute", "aria-label", "screen reader markup", "assistive markup"],
    automated: true,
  },
  {
    id: "page-language",
    label: "Page language",
    description: "axe-core's html-has-lang / html-lang-valid rules — the document declares a valid language.",
    keywords: ["page language", "lang attribute", "declared language", "html lang"],
    automated: true,
  },
  {
    id: "page-title",
    label: "Page titles",
    description: "axe-core's document-title rule — every scanned page has a non-empty, descriptive <title>.",
    keywords: ["page title", "document title", "descriptive title", "unique title"],
    automated: true,
  },
  {
    id: "tables",
    label: "Data tables",
    description: "every axe-core rule tagged cat.tables — header cells, scope, and caption on tabular data.",
    keywords: ["data table", "table header", "table accessib", "tabular data"],
    automated: true,
  },
  {
    id: "wcag-aa",
    label: "WCAG 2.1 AA conformance (automatable subset)",
    description:
      "no axe-core violation tagged wcag2a / wcag2aa / wcag21a / wcag21aa on any scanned page. Automated rules cover roughly a third of the AA success criteria — passing is necessary, not sufficient.",
    keywords: [
      "wcag 2.0",
      "wcag 2.1",
      "wcag 2.2",
      "wcag2",
      "level aa",
      "wcag aa",
      "aa conformance",
      "aa compliance",
      "section 508",
      "ada compliance",
      "ada compliant",
      "wcag compliance",
      "wcag conformance",
    ],
    automated: true,
  },
  {
    id: "media-captions",
    label: "Captions & media alternatives",
    description:
      "no automated check — captions, transcripts and audio description have to be reviewed by a person against the actual media.",
    keywords: [
      "caption",
      "transcript",
      "subtitle",
      "audio description",
      "video accessib",
      "time-based media",
      "autoplay",
    ],
    manualHint:
      "Open every video and audio embed on the site: anything with speech needs captions or a transcript, and nothing should autoplay with sound. Caption files usually have to come from the client, so confirm who owns them and by when.",
    automated: false,
  },
  {
    id: "screen-reader-qa",
    label: "Screen-reader pass",
    description:
      "no automated check — a real screen-reader pass (VoiceOver / NVDA / JAWS) is a manual QA task by definition.",
    keywords: ["screen reader", "screenreader", "voiceover", "nvda", "jaws", "talkback", "assistive technolog"],
    manualHint:
      "Run one pass per key template (home, collection, product, cart, checkout) with VoiceOver on macOS/iOS or NVDA on Windows: navigate by heading and by landmark, add to cart, and complete a checkout. Log anything announced wrongly or not at all.",
    automated: false,
  },
  {
    id: "zoom-reflow",
    label: "Zoom & reflow",
    description:
      "no automated check — reflow at 200%/400% zoom and text-spacing overrides need a human looking at the result.",
    keywords: ["zoom", "reflow", "200%", "400%", "text spacing", "text resize", "resize text", "magnif"],
    manualHint:
      "Zoom each key template to 200% and 400% at a 1280px width and check nothing is cut off, overlapping, or needs horizontal scrolling; then apply the WCAG text-spacing overrides (line height 1.5x, paragraph spacing 2x, letter spacing 0.12em) and confirm no text is clipped.",
    automated: false,
  },
  {
    id: "reduced-motion",
    label: "Motion & animation control",
    description:
      "no automated check — whether motion is essential, pausable, and honors prefers-reduced-motion is a judgment call.",
    keywords: ["reduced motion", "prefers-reduced-motion", "animation", "parallax", "motion sensitiv", "flashing"],
    manualHint:
      "Turn on the OS 'reduce motion' preference and reload: carousels, parallax and scroll animations should stop or shorten. Anything that animates for more than five seconds also needs a visible pause control.",
    automated: false,
  },
  {
    id: "document-accessibility",
    label: "Document (PDF/Office) accessibility",
    description: "no automated check — linked PDFs and Office documents are outside anything this audit renders.",
    keywords: ["pdf", "document accessib", "downloadable document", "word document"],
    manualHint:
      "List the PDFs and Office documents linked from the site and check each one in Acrobat's accessibility checker (tagged structure, reading order, alt text, real text rather than a scan). Anything failing needs remediation or an accessible HTML equivalent.",
    automated: false,
  },
  {
    id: "third-party-widgets",
    label: "Third-party / app-embedded widgets",
    description:
      "no reliable automated check — third-party embeds render in iframes or after interaction, so their accessibility has to be confirmed with the vendor or by hand.",
    keywords: ["third party", "third-party", "app embed", "widget", "chat widget", "vendor", "iframe"],
    manualHint:
      "Identify each third-party embed (reviews, chat, subscription, consent) and test it on its own with the keyboard and a screen reader. For any that fail, ask the vendor for their VPAT or roadmap and decide whether to replace or wrap it — the accessibility of an embed is still the site’s responsibility.",
    automated: false,
  },
  {
    id: "accessibility-statement",
    label: "Accessibility statement / policy page",
    description:
      "no automated check — whether a published statement is accurate and current is a content review, not a scan.",
    keywords: ["accessibility statement", "accessibility policy", "accessibility page", "vpat", "conformance report"],
    manualHint:
      "Check the published accessibility statement names the conformance target (e.g. WCAG 2.1 AA), states what is and is not yet conformant, gives a working contact route for access problems, and carries a current date.",
    automated: false,
  },
  {
    id: "training-handoff",
    label: "Training, documentation & handoff",
    description: "no automated check — a deliverable about people and process, verified by the person who owns it.",
    keywords: ["training", "documentation", "handoff", "guidelines for the client", "educate", "style guide"],
    manualHint:
      "Confirm the client has the written guidance they need to keep the site accessible — how to write alt text, when a heading level is wrong, which content types need captions — and that whoever publishes content has been walked through it.",
    automated: false,
  },
];

const REQUIREMENTS_BY_ID = new Map(ADA_REQUIREMENTS.map((r) => [r.id, r]));

export function adaRequirement(id: string): AdaRequirementDef | undefined {
  return REQUIREMENTS_BY_ID.get(id);
}

// Word/number bullets Word, Google Docs, Notion and plain email all produce.
const BULLET_PREFIX = /^\s*(?:[-*•·▪◦‣–—]|\d{1,2}[.)]|\(\d{1,2}\)|[a-z][.)]|o\s)\s*/i;
const MAX_ITEMS = 60;
const MAX_ITEM_CHARS = 500;

function stripBullet(line: string): string {
  return line.replace(BULLET_PREFIX, "").trim();
}

/** A line like "Test and ensure basic accessibility features are in place, such as:" introduces
 * the items below it — it's a heading, not something to verify on its own. */
function isHeading(line: string, hasFollowing: boolean): boolean {
  return hasFollowing && /:\s*$/.test(line);
}

/** Turns a pasted ADA scope — bullets, numbered lists, a "such as:" preamble, or one long
 * semicolon-separated paragraph — into discrete, verifiable items. Deliberately forgiving about
 * formatting: whatever the client's SOW happened to use should work without reformatting. */
export function parseAdaScope(raw: string): ParsedAdaScopeItem[] {
  const lines = raw
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const items: ParsedAdaScopeItem[] = [];
  let group: string | undefined;

  for (let i = 0; i < lines.length; i++) {
    const line = stripBullet(lines[i]);
    if (!line) continue;

    if (isHeading(line, i < lines.length - 1)) {
      group = line.replace(/:\s*$/, "").trim() || undefined;
      continue;
    }

    // A single line can still carry several requirements when it was pasted as prose.
    for (const part of line.split(/\s*;\s*/)) {
      const text = stripBullet(part).replace(/[;,.]\s*$/, "").trim();
      if (text) items.push({ id: "", text, group });
    }
  }

  // Fallback for a scope pasted as one unbroken paragraph ("...such as: X. Y. Z.") — no bullets
  // and no semicolons to split on, so fall back to sentence boundaries rather than handing the
  // whole paragraph to the verifiers as a single unverifiable item.
  let expanded = items;
  if (items.length === 1 && items[0].text.length > 240) {
    const sentences = items[0].text
      .split(/(?<=[.!?])\s+(?=[A-Z])/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (sentences.length > 1) {
      expanded = sentences.map((text) => ({ id: "", text, group: items[0].group }));
    }
  }

  const seen = new Set<string>();
  const deduped: ParsedAdaScopeItem[] = [];
  for (const item of expanded) {
    const key = item.text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push({ ...item, text: item.text.slice(0, MAX_ITEM_CHARS) });
    if (deduped.length >= MAX_ITEMS) break;
  }

  return deduped.map((item, i) => ({ ...item, id: `scope-${i + 1}` }));
}

/** Keyword-matches one scope line against the requirement catalog. Returns every requirement the
 * line plausibly covers (a line can name two), or an empty array when nothing matches — those
 * lines go to the AI mapper, and failing that become manual items. */
export function matchAdaRequirements(text: string): string[] {
  const haystack = text.toLowerCase();
  return ADA_REQUIREMENTS.filter((req) => req.keywords.some((k) => haystack.includes(k))).map((r) => r.id);
}
