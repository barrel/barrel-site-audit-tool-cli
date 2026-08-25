// The CRO audit's report shape — a second, separate report type alongside the site audit.
//
// Deliberately not a section inside `Report`. A CRO audit answers a different question for a
// different reader: the site audit says what is wrong with a storefront and is scored, while a CRO
// audit is a strategist's argument about where conversion is being lost, and its deliverable is a
// deck. Folding it into the audit report would put a client-facing narrative inside a record of
// what a run measured, and would make every CRO change a change to the audit's blob schema.
//
// Two structural choices are worth understanding before reading the types:
//
// 1. **Capture is separate from interpretation.** A `CroCapture` is what a browser saw — pages,
//    screenshots, DOM signals, measurements. A `CroReport` is one interpretation of a capture.
//    Keeping them apart is what lets a section be re-drafted (better prompt, corrected brief,
//    a step that failed) without crawling a client's storefront again, and what lets the
//    interpretive half run in the deployed app where there is no browser at all.
//
// 2. **A step says what it could not do.** Every `CroStep` carries `limitations`, and a step that
//    had nothing to work with is `status: "insufficient"` with the reason, never an empty slide.
//    The manual process this replaces has a human who knows they skipped the heatmaps; a generated
//    deck has to say so on the page.

import type { AiUsage, HealthCheckItem, RunnerInfo } from "./types.js";

/** The page *types* a CRO audit reasons about, not individual URLs.
 *
 * This is the unit of the whole deliverable: findings are grouped by page type because that is how
 * a fix gets made — a PDP opportunity is a change to one template that affects every product. Nav
 * is in the list despite not being a page: it is reviewed on every CRO audit, and it is where a
 * surprising share of the friction lives. */
export type CroPageGroup = "nav" | "home" | "plp" | "pdp" | "cart" | "checkout" | "search";

/** Behaviour differs enough between the two that a single verdict for a page type would average
 * away the finding. Mobile carries most sessions on most storefronts and converts worst; the split
 * is where that shows up. */
export type CroDevice = "mobile" | "desktop";

export const CRO_PAGE_GROUPS: readonly CroPageGroup[] = [
  "nav",
  "home",
  "plp",
  "pdp",
  "cart",
  "checkout",
  "search",
];

export const CRO_DEVICES: readonly CroDevice[] = ["mobile", "desktop"];

/** Human labels for page groups, defined once so the CLI's progress lines, the report tabs and the
 * deck all name the same thing the same way. */
export const CRO_PAGE_GROUP_LABELS: Record<CroPageGroup, string> = {
  nav: "Navigation & Menu",
  home: "Home",
  plp: "Collection (PLP)",
  pdp: "Product (PDP)",
  cart: "Cart & Drawer",
  checkout: "Checkout",
  search: "Search Results",
};

/** The seven steps of Barrel's CRO audit process, in the order they are *executed*.
 *
 * `insights` runs last and is presented first — it is a synthesis of everything else, so it cannot
 * be written until the rest exists. The report's own tab order puts it first; this list is the
 * order a run works through. */
export type CroStepKey = "analytics" | "ux" | "behaviour" | "voc" | "journey" | "competitors" | "insights";

export const CRO_STEP_KEYS: readonly CroStepKey[] = [
  "analytics",
  "ux",
  "behaviour",
  "voc",
  "journey",
  "competitors",
  "insights",
];

export const CRO_STEP_LABELS: Record<CroStepKey, string> = {
  analytics: "Analytics & Customer Journey",
  ux: "Website & UX Audit",
  behaviour: "Heatmaps & Session Recordings",
  voc: "Voice of the Customer",
  journey: "CX Journey Mapping",
  competitors: "Competitive Benchmark",
  insights: "Key Insights",
};

/** Where a step's content came from, recorded on the step itself.
 *
 * A reader deciding how much weight to put on a slide needs to know whether it came from measured
 * data, from a model reading a screenshot, or from a strategist typing. Provenance that lives only
 * in someone's memory of how the deck was made is provenance that is lost by the second meeting. */
export type CroStepSource =
  /** Drafted from a browser capture — screenshots and DOM signals of the live site. */
  | "capture"
  /** Produced in the deployed app from an API (GA4) and/or a model, with no browser involved. */
  | "app"
  /** Built from material a human supplied — pasted reviews, uploaded heatmap images, survey data. */
  | "uploaded"
  /** Written or decided by a strategist. */
  | "manual";

export type CroStepStatus =
  | "generated"
  /** Not yet run. The normal state of `analytics` and `insights` straight after a capture run,
   * since both are produced in the app rather than by the CLI. */
  | "pending"
  /** Deliberately excluded from this run (a --skip flag, or a step this tool does not yet do). */
  | "skipped"
  /** Ran, and concluded there was not enough to say anything. Distinct from "skipped" because it
   * is a finding: an empty Analytics step because GA4 has 6 days of data is information. */
  | "insufficient";

/** One citable fact a bullet is allowed to rest on.
 *
 * The same closed-catalogue device the Data Analysis feature uses: the model is handed a list of
 * facts with ids, may cite them by id, and anything numeric it writes is checked against them
 * before it reaches a page. Without this, a slide reading "mobile converts 40% worse" is
 * indistinguishable from a measured one. */
export interface CroEvidenceItem {
  id: string;
  /** The fact, in the wording that will be shown to a reader if this evidence is surfaced. */
  label: string;
  /** Where it came from — "GA4, last 28 days", "PDP capture, mobile", "competitor sweep". */
  source: string;
  /** Present when the fact is a number, so a bullet's figures can be checked against it. */
  value?: number;
  /** Blob pathname of a screenshot this fact was read off, when there is one. */
  screenshot?: string;
}

export type CroImpact = "high" | "medium" | "low";

/** One deck bullet, in the fixed house format: `Short title: short description`.
 *
 * Title and description are stored apart rather than as one pre-joined string so the deck, the web
 * report and a future export can each present them differently, and so the shape validator in
 * cro-slides.ts has two fields to check rather than one string to parse. */
export interface CroBullet {
  /** Content-derived (see croBulletId) so an edit made against this bullet survives a page reload
   * and is recognisably orphaned by a re-draft that rewords it. */
  id: string;
  title: string;
  description: string;
  impact?: CroImpact;
  /** A short category label shown above the title. Used by the Key Insights cards, whose house
   * format is a tag ("Product Prioritisation", "Decision Clarity") over a bolded headline. */
  tag?: string;
  /** `CroEvidenceItem.id`s this bullet rests on. Empty is allowed but flagged in review: a bullet
   * citing nothing is an opinion, which is sometimes the honest thing but should be visible. */
  evidenceIds: string[];
}

/** A comparison table on a slide.
 *
 * Bullets are the house format, but a competitive benchmark's most useful artefact is a grid: who
 * has subscriptions, who has a size guide, who states a free-shipping threshold. It is derived
 * deterministically from the captures with no model involved, which is exactly why it is worth
 * putting in front of a client unedited. */
export interface CroTable {
  caption?: string;
  /** Header cells. The first names the row-label column. */
  columns: string[];
  rows: CroTableRow[];
}

export interface CroTableRow {
  label: string;
  /** One per column after the first. A boolean renders as a tick or a dash; a string renders as
   * written, for a column that is a measurement rather than a presence check. */
  cells: Array<boolean | string>;
}

/** One slide of the deliverable — a page group, a device, a competitor, or a fixed VoC slide. */
export interface CroSlide {
  id: string;
  label: string;
  group?: CroPageGroup;
  device?: CroDevice;
  /** The 2-line opening the house format calls for on competitor and VoC slides. */
  intro?: string;
  bullets: CroBullet[];
  /** Blob pathnames of the screenshots behind this slide, shown alongside the bullets. */
  screenshots?: string[];
  /** Present instead of (or alongside) bullets when the slide's content is a comparison grid. */
  table?: CroTable;
  /** Competitor slides close on "Brand Positioning: Wellness + Eco Luxury". */
  footnote?: string;
}

export interface CroStep {
  key: CroStepKey;
  status: CroStepStatus;
  source: CroStepSource;
  slides: CroSlide[];
  /** Every fact the step's bullets were allowed to cite, kept so a reader can check one and so a
   * re-draft is graded against the same catalogue. */
  evidence: CroEvidenceItem[];
  /** What this step could not establish, in the wording shown on the page. Populated even on a
   * successful step — a step can be worth presenting and still have holes worth naming. */
  limitations: string[];
  /** Bullets the shape/citation validator rejected, with the reason. Surfaced rather than dropped
   * silently: a step that quietly discarded three of its five bullets looks like a thin step. */
  rejected?: CroRejectedBullet[];
  generatedAt?: string;
  aiUsage?: AiUsage;
}

export interface CroRejectedBullet {
  title: string;
  description: string;
  reason: string;
}

/** Step 0 — the intake. Stored on the store's config rather than per report, because it describes
 * the client and not one audit of them, and because a second CRO audit for the same store should
 * not need it re-typed. */
export interface CroBrief {
  /** Competitor storefronts the client considers relevant. Three is the working number. */
  competitorUrls?: string[];
  /** Where customer reviews can be read — a Yotpo/Judge.me page, an Amazon listing, or the store's
   * own reviews page. Used by the VoC step, and recorded even before that step exists so the
   * intake is complete. */
  reviewsUrl?: string;
  /** Analytics and behaviour tooling this client actually has, so the report can say which of its
   * steps had no source rather than appearing to have found nothing. */
  dataSources?: CroDataSource[];
  /** Business-model facts that change which page groups and journey steps make sense — a
   * subscription store needs a frequency-selection step that a one-off store does not. */
  subscription?: boolean;
  giftCards?: boolean;
  /** Brand positioning / guidelines, pasted. Given to the drafting prompts so a recommendation
   * does not fight the brand it is recommending for. */
  positioning?: string;
  /** What the client already believes is wrong. Handed to the drafting prompts so the audit
   * engages with their hypotheses instead of talking past them. */
  hypotheses?: string;
  /** Page-group URL overrides, for a store whose PLP/PDP conventions the crawler guesses wrong. */
  pageUrls?: Partial<Record<CroPageGroup, string>>;
}

export type CroDataSource =
  | "ga4"
  | "shopify-analytics"
  | "hotjar"
  | "clarity"
  | "quantum-metric"
  | "reviews-platform"
  | "survey";

/* ── Capture: what a browser saw ─────────────────────────────────────────────────────────────── */

/** Measurements taken in the page, which no screenshot can be asked for after the fact.
 *
 * These are the "scroll proxy": they say where things sit relative to the fold, which is the
 * question a scroll map answers, without a heatmap tool. They are a proxy for attention, not
 * evidence of it, and every surface that shows them says so — a section 380px below the fold is a
 * reason to suspect it is unseen, not a measurement that it was. */
export interface CroMeasurements {
  viewportHeight: number;
  documentHeight: number;
  /** Distance from the top of the document to the primary call to action, in CSS pixels. The
   * single most useful number in the set: on mobile it is routinely below the fold. */
  primaryCtaY?: number;
  /** Whether the primary CTA is inside the first viewport. */
  primaryCtaAboveFold?: boolean;
  /** Top offset and height of each major page section, in document order — the shape of the page
   * as a reader scrolls it. */
  sectionOffsets: CroSectionOffset[];
  /** Interactive elements (links, buttons, inputs) that start below the first viewport. */
  interactiveBelowFold: number;
  /** A persistent add-to-cart that follows the scroll, which changes the fold argument entirely. */
  stickyAddToCart?: boolean;
  /** Tap targets smaller than 44x44 CSS px. Mobile only — the number is meaningless on a pointer
   * device, and reporting it there invites a fix nobody needed. */
  smallTapTargets?: number;
  /** Contrast ratio of the primary CTA's text against its background. Below 4.5 is both an
   * accessibility failure and a conversion one. */
  ctaContrast?: number;
  /** Form fields in the primary form on the page — the checkout number people argue about. */
  formFieldCount?: number;
}

export interface CroSectionOffset {
  /** A short, human-readable identity for the section — its heading text where it has one,
   * otherwise its tag and class. Enough to point at it in a bullet. */
  label: string;
  top: number;
  height: number;
}

export interface CroPageCapture {
  group: CroPageGroup;
  device: CroDevice;
  url: string;
  /** Blob pathname of the full-page screenshot. */
  screenshotFull?: string;
  /** Blob pathname of the first-viewport screenshot. Both are kept: the fold crop is what a
   * visitor saw, the full page is what the strategist needs to argue about order. */
  screenshotFold?: string;
  /** Deterministic pass/warn/fail signals read out of the DOM — the same `HealthCheckItem` shape
   * the site audit uses everywhere, so the existing checklist components render these unchanged. */
  signals: HealthCheckItem[];
  measurements: CroMeasurements;
  /** Something worth knowing about how this page was captured, when it is not an error — a cart
   * that turned out to be a drawer, a group reached by a redirect. Shown alongside the slide, since
   * it changes how the findings should be read. */
  note?: string;
  /** True when the page rendered as an overlay over a different page — the drawer-only cart most
   * Shopify themes ship. The DOM signals still describe the overlay, so they are kept; every
   * scroll-shaped measurement describes the page underneath it, so those are not published. */
  overlay?: boolean;
  /** Why this page could not be captured, when it could not. A capture that quietly omits the cart
   * reads as a store with no cart problems. */
  error?: string;
}

/** One browser pass over a storefront. The evidence half of a CRO audit, stored on its own so it
 * can be interpreted more than once. */
export interface CroCapture {
  id: string;
  storeSlug: string;
  storeUrl: string;
  createdAt: string;
  durationMs: number;
  pages: CroPageCapture[];
  /** Competitor captures, keyed by hostname. Same shape as the client's own pages. */
  competitors?: CroCompetitorCapture[];
  limitations: string[];
  runner?: RunnerInfo;
}

export interface CroCompetitorCapture {
  name: string;
  url: string;
  pages: CroPageCapture[];
  /** Lighthouse/vitals column from the existing competitor analyzer, when it ran. */
  performance?: number;
  error?: string;
}

/* ── The report ──────────────────────────────────────────────────────────────────────────────── */

export interface CroReport {
  id: string;
  storeSlug: string;
  storeName: string;
  storeUrl: string;
  createdAt: string;
  durationMs: number;
  /** The intake this audit was run against, copied in rather than referenced. The store's brief
   * will be edited before the next audit, and a report has to keep meaning what it meant. */
  brief: CroBrief;
  steps: Partial<Record<CroStepKey, CroStep>>;
  /** The capture these steps were drafted from — the same id as the report on a normal run, but
   * held separately because a re-draft in the app produces a new report from an old capture. */
  captureId?: string;
  aiUsage?: AiUsage;
  /** Barrel email of whoever last pressed Generate. Recorded because the app-side steps are a paid
   * act taken by a person, and "who ran this, and when" is the first question about a figure a
   * client is querying. */
  generatedBy?: string;
  runner?: RunnerInfo;
}

/** A strategist's corrections, kept apart from the generated report.
 *
 * The generated report is a record of what the tool concluded at a moment, and it may already have
 * been sent to a client. Editing it in place would destroy that, and would make "did we change
 * this after we presented it?" unanswerable. Same reasoning as the Data Analysis blob being a
 * sibling of its report rather than a section inside it. */
export interface CroEdits {
  croId: string;
  storeSlug: string;
  updatedAt: string;
  /** Barrel email of whoever last saved. Not for policing — for asking them what they meant. */
  editedBy?: string;
  bullets: Record<string, CroBulletEdit>;
}

export interface CroBulletEdit {
  title?: string;
  description?: string;
  /** Hidden rather than deleted, so an edit is always reversible and a re-draft can tell the
   * difference between "never generated" and "generated and rejected by a human". */
  hidden?: boolean;
  updatedAt: string;
}

export interface CroIndexEntry {
  id: string;
  storeSlug: string;
  storeName: string;
  storeUrl: string;
  createdAt: string;
  /** Which steps actually have content, so the list can show completeness without reading every
   * report blob — the same reason the report manifest carries scores. */
  stepsGenerated: CroStepKey[];
  /** Hides a report from the default list without deleting it. Set only from the web app. */
  archived?: boolean;
}

export interface CroIndex {
  reports: CroIndexEntry[];
}
