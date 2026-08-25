// Step 1 of the CRO audit: Analytics & Customer Journey.
//
// The site audit's Data Analysis feature (web/lib/data-analysis.ts) asks GA4 one question: where is
// conversion weakest, and what in the audit might explain it. A CRO audit needs more of the picture
// — the funnel, engagement, what sells and what does not, and how the picture differs for a
// first-time visitor — because Step 1's output is the prioritised list every later step is read
// against.
//
// Everything numeric is computed here and handed to the model as a closed catalogue of citable
// facts. The rules, the thresholds and the arithmetic are imported from data-analysis.ts rather
// than restated: two features in the same app printing two different conversion rates for the same
// property would be worse than either of them being absent.
//
// Everything above `generateCroAnalytics` is pure and tested in shared/test/cro-analytics.test.ts.

import type { AiUsage, ConversionSegment, ConversionTotals, CroEvidenceItem, CroSlide, CroStep } from "./shared";
import {
  MIN_BENCHMARK_TRANSACTIONS,
  MIN_SEGMENT_SESSIONS,
  assessSufficiency,
  averageOrderValue,
  conversionRate,
} from "./data-analysis";
import { validateBullets } from "./cro-slides";

/* ── The dataset ────────────────────────────────────────────────────────────────────────────── */

/** One step of the shopping funnel, as GA4 recorded it. */
export interface CroFunnelStep {
  /** The GA4 event name, so the reader can go and check it. */
  event: string;
  label: string;
  /** Sessions in which the event occurred — the number a funnel should be built from. */
  sessions: number;
  /** Total occurrences. Carried because a large gap between the two is itself a finding: it means
   * visitors are repeating the step. */
  count: number;
}

/** One product, across the window. */
export interface CroItemRow {
  name: string;
  viewed: number;
  addedToCart: number;
  purchased: number;
  revenue: number;
  /** purchased ÷ viewed, as a percentage. The number that separates "nobody sees this" from
   * "everybody sees this and nobody buys it" — which need opposite fixes. */
  viewToPurchaseRate: number;
}

export interface CroEngagement {
  /** GA4's engagement rate, 0–100. */
  engagementRate: number;
  /** Mean session duration in seconds. */
  averageSessionDuration: number;
}

export interface CroConversionDataset {
  propertyId: string;
  currencyCode: string;
  startDate: string;
  endDate: string;
  daysWithSessions: number;
  totals: ConversionTotals;
  engagement?: CroEngagement;
  byDevice: ConversionSegment[];
  byChannel: ConversionSegment[];
  byLandingPage: ConversionSegment[];
  byNewReturning: ConversionSegment[];
  funnel: CroFunnelStep[];
  items: CroItemRow[];
}

/* ── Page types ─────────────────────────────────────────────────────────────────────────────── */

/** Shopify's URL conventions, which are fixed enough to classify a landing page by path.
 *
 * Order matters: /collections/x/products/y is a product page, so the product test has to run
 * first. Anything unmatched goes to "Other" rather than being guessed at — a mis-bucketed
 * template produces a confident finding about the wrong page type, which is worse than a bucket
 * labelled Other. */
const PAGE_TYPE_PATTERNS: Array<{ type: string; test: RegExp }> = [
  { type: "Product (PDP)", test: /\/products\// },
  { type: "Collection (PLP)", test: /\/collections\// },
  { type: "Cart", test: /^\/cart(\/|$|\?)/ },
  { type: "Checkout", test: /\/checkouts?(\/|$|\?)/ },
  { type: "Search", test: /^\/search(\/|$|\?)/ },
  { type: "Blog / content", test: /\/(blogs|pages)\// },
  { type: "Account", test: /^\/account/ },
  { type: "Home", test: /^\/?(\?|$)/ },
];

export function classifyPageType(landingPage: string): string {
  // GA4 hands back a path plus query string, and occasionally "(not set)" or "(direct)".
  const path = landingPage.startsWith("/") ? landingPage : `/${landingPage}`;
  for (const { type, test } of PAGE_TYPE_PATTERNS) {
    if (test.test(path)) return type;
  }
  return "Other";
}

/** Landing-page rows rolled up by page type.
 *
 * This is the aggregation a CRO audit actually reasons from: one collection page converting badly
 * is a merchandising question, and every collection page converting badly is a template question.
 * The conversion rate is recomputed from the summed totals rather than averaged across rows —
 * averaging rates weights a 60-session page the same as a 6,000-session one. */
export function aggregateByPageType(landingPages: ConversionSegment[]): ConversionSegment[] {
  const byType = new Map<string, { sessions: number; transactions: number; revenue: number }>();
  for (const row of landingPages) {
    const type = classifyPageType(row.label);
    const acc = byType.get(type) ?? { sessions: 0, transactions: 0, revenue: 0 };
    acc.sessions += row.sessions;
    acc.transactions += row.transactions;
    acc.revenue += row.revenue;
    byType.set(type, acc);
  }

  return Array.from(byType.entries())
    .map(([label, acc]) => ({
      label,
      sessions: acc.sessions,
      transactions: acc.transactions,
      revenue: acc.revenue,
      conversionRate: conversionRate(acc.transactions, acc.sessions),
    }))
    .sort((a, b) => b.sessions - a.sessions);
}

/* ── Funnel arithmetic ──────────────────────────────────────────────────────────────────────── */

export interface CroFunnelDrop {
  from: string;
  to: string;
  /** Sessions that reached `from` but not `to`. */
  lost: number;
  /** Share of `from`'s sessions that did not reach `to`, as a percentage. */
  dropRate: number;
}

/** Step-to-step losses down the funnel.
 *
 * Deliberately computed from sessions rather than event counts: a visitor who adds three items has
 * three add_to_cart events and is one session that progressed. Also deliberately *not* a claim
 * that these sessions are nested — GA4's event-scoped session counts do not guarantee that every
 * session which reached checkout also recorded a view_item — so a step that recorded more sessions
 * than the one before it yields a zero drop rather than a negative one, and the wording everywhere
 * this surfaces says "progression between steps" rather than "of the visitors who added to cart". */
export function funnelDrops(funnel: CroFunnelStep[]): CroFunnelDrop[] {
  const drops: CroFunnelDrop[] = [];
  for (let i = 0; i < funnel.length - 1; i++) {
    const from = funnel[i];
    const to = funnel[i + 1];
    if (from.sessions <= 0) continue;
    const lost = Math.max(0, from.sessions - to.sessions);
    drops.push({
      from: from.label,
      to: to.label,
      lost,
      dropRate: Math.round((lost / from.sessions) * 1000) / 10,
    });
  }
  return drops;
}

/** The biggest single step-to-step loss, which is where a CRO audit starts. */
export function worstFunnelDrop(funnel: CroFunnelStep[]): CroFunnelDrop | null {
  const drops = funnelDrops(funnel).filter((d) => d.lost > 0);
  if (drops.length === 0) return null;
  return [...drops].sort((a, b) => b.dropRate - a.dropRate)[0];
}

/* ── Products ───────────────────────────────────────────────────────────────────────────────── */

/** Products with real traffic that almost nobody buys.
 *
 * The interesting half of "best and worst sellers". A product with 40 views and no sales is the
 * expected outcome of 40 views; a product in the top decile of views with a bottom-decile
 * conversion rate is a page doing something wrong, and it is the most directly actionable finding
 * a CRO audit produces. The view floor is what separates the two. */
export const MIN_ITEM_VIEWS = 300;

export function underperformingItems(items: CroItemRow[], limit = 5): CroItemRow[] {
  const eligible = items.filter((i) => i.viewed >= MIN_ITEM_VIEWS);
  if (eligible.length < 3) return [];
  return [...eligible].sort((a, b) => a.viewToPurchaseRate - b.viewToPurchaseRate).slice(0, limit);
}

export function topItems(items: CroItemRow[], limit = 5): CroItemRow[] {
  return [...items].sort((a, b) => b.revenue - a.revenue).slice(0, limit);
}

/* ── The evidence catalogue ─────────────────────────────────────────────────────────────────── */

function pct(value: number): string {
  return `${value}%`;
}

function money(value: number, currency: string): string {
  return currency ? `${value.toLocaleString()} ${currency}` : value.toLocaleString();
}

/** The strongest segment worth measuring others against — the highest converting segment that has
 * enough purchases behind it to be a real number. Mirrors the benchmark rule in data-analysis.ts. */
export function benchmarkSegment(segments: ConversionSegment[]): ConversionSegment | null {
  const eligible = segments.filter(
    (s) => s.sessions >= MIN_SEGMENT_SESSIONS && s.transactions >= MIN_BENCHMARK_TRANSACTIONS,
  );
  if (eligible.length < 2) return null;
  return [...eligible].sort((a, b) => b.conversionRate - a.conversionRate)[0];
}

/** Every fact the analytics step's bullets may cite.
 *
 * Written in the wording a client reads, because these strings are what the report prints under a
 * bullet when someone asks what it rests on. */
export function buildCroAnalyticsEvidence(dataset: CroConversionDataset): CroEvidenceItem[] {
  const items: CroEvidenceItem[] = [];
  const source = `GA4 property ${dataset.propertyId}, ${dataset.startDate} to ${dataset.endDate}`;
  const { totals } = dataset;

  items.push({
    id: "ga4-totals",
    label: `Over ${dataset.daysWithSessions} days with recorded traffic, the store took ${totals.sessions.toLocaleString()} sessions and ${totals.transactions.toLocaleString()} transactions — a site-wide conversion rate of ${pct(totals.conversionRate)} at an average order value of ${money(totals.averageOrderValue, dataset.currencyCode)}.`,
    source,
    value: totals.conversionRate,
  });

  if (dataset.engagement) {
    items.push({
      id: "ga4-engagement",
      label: `GA4 records an engagement rate of ${pct(dataset.engagement.engagementRate)} and a mean session duration of ${Math.round(dataset.engagement.averageSessionDuration)} seconds.`,
      source,
      value: dataset.engagement.engagementRate,
    });
  }

  const addSegments = (segments: ConversionSegment[], prefix: string, dimension: string) => {
    for (const segment of segments) {
      if (segment.sessions < MIN_SEGMENT_SESSIONS) continue;
      const share = totals.sessions > 0 ? Math.round((segment.sessions / totals.sessions) * 1000) / 10 : 0;
      items.push({
        id: `${prefix}-${segment.label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`.slice(0, 60),
        label: `By ${dimension}: ${segment.label} took ${segment.sessions.toLocaleString()} sessions (${pct(share)} of all traffic) and converted at ${pct(segment.conversionRate)}.`,
        source,
        value: segment.conversionRate,
      });
    }
  };

  addSegments(dataset.byDevice, "ga4-device", "device");
  addSegments(dataset.byNewReturning, "ga4-visitor", "visitor type");
  addSegments(dataset.byChannel.slice(0, 6), "ga4-channel", "channel");
  addSegments(aggregateByPageType(dataset.byLandingPage), "ga4-pagetype", "landing page type");

  // The gap, stated once rather than left for the model to compute — which is the difference
  // between a figure that is checkable and one that is asserted.
  const deviceBenchmark = benchmarkSegment(dataset.byDevice);
  if (deviceBenchmark) {
    for (const segment of dataset.byDevice) {
      if (segment.label === deviceBenchmark.label) continue;
      if (segment.sessions < MIN_SEGMENT_SESSIONS) continue;
      const gap = Math.round((deviceBenchmark.conversionRate - segment.conversionRate) * 100) / 100;
      if (gap <= 0) continue;
      items.push({
        id: `ga4-gap-${segment.label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`,
        label: `${segment.label} converts ${gap} percentage points below ${deviceBenchmark.label} (${pct(segment.conversionRate)} against ${pct(deviceBenchmark.conversionRate)}) over the ${dataset.daysWithSessions} days measured.`,
        source,
        value: gap,
      });
    }
  }

  for (const step of dataset.funnel) {
    items.push({
      id: `ga4-funnel-${step.event.replace(/_/g, "-")}`,
      label: `Funnel: ${step.sessions.toLocaleString()} sessions recorded ${step.label} (${step.event}), across ${step.count.toLocaleString()} occurrences.`,
      source,
      value: step.sessions,
    });
  }

  for (const drop of funnelDrops(dataset.funnel)) {
    if (drop.lost <= 0) continue;
    items.push({
      id: `ga4-drop-${drop.from.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`,
      label: `Progression from ${drop.from} to ${drop.to}: ${drop.lost.toLocaleString()} fewer sessions reached the next step, a ${pct(drop.dropRate)} fall.`,
      source,
      value: drop.dropRate,
    });
  }

  for (const item of topItems(dataset.items, 5)) {
    items.push({
      id: `ga4-top-${item.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`.slice(0, 60),
      label: `Best seller: "${item.name}" earned ${money(item.revenue, dataset.currencyCode)} from ${item.purchased.toLocaleString()} purchases on ${item.viewed.toLocaleString()} product views (${pct(item.viewToPurchaseRate)} of views bought).`,
      source,
      value: item.revenue,
    });
  }

  for (const item of underperformingItems(dataset.items, 5)) {
    items.push({
      id: `ga4-weak-${item.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`.slice(0, 60),
      label: `High traffic, low conversion: "${item.name}" was viewed ${item.viewed.toLocaleString()} times and bought ${item.purchased.toLocaleString()} times (${pct(item.viewToPurchaseRate)} of views).`,
      source,
      value: item.viewToPurchaseRate,
    });
  }

  return items;
}

/* ── Generation ─────────────────────────────────────────────────────────────────────────────── */

const SYSTEM = [
  "You are a conversion-rate-optimisation strategist writing the analytics slide of a client-facing audit deck.",
  "You are given a closed catalogue of figures computed from the client's own GA4 property. It is the only data you have.",
  "",
  "Rules, enforced after you answer — a bullet that breaks one is discarded:",
  "Output between 3 and 5 bullets. Each is a short title plus a one-sentence description.",
  "The title is a label, not a sentence: at most 7 words, no ending punctuation, and never a colon.",
  "Frame every bullet as an opportunity, not a fault. Never open a title with a word like missing, poor, broken, weak, lacks or unclear.",
  "Cite at least one evidence id on every bullet. Evidence you were not given does not exist.",
  "Never write a number that does not appear in the evidence you cite. Do not forecast, annualise, extrapolate, or quote an industry benchmark. Say how big a difference already measured is, never how big a fix would be.",
  "Do not assert a cause. GA4 recorded behaviour; it did not record why. Where a bullet implies a reason, phrase it as something to test.",
  "Rank by size of the opportunity, largest first.",
].join("\n");

const SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string" },
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
  required: ["headline", "bullets"],
  additionalProperties: false,
} as const;

const MODEL = "claude-opus-5";
const OPUS_5_PRICING_PER_MILLION = { input: 5, output: 25 };

function estimateCostUsd(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens / 1_000_000) * OPUS_5_PRICING_PER_MILLION.input +
    (outputTokens / 1_000_000) * OPUS_5_PRICING_PER_MILLION.output
  );
}

export interface GenerateCroAnalyticsInput {
  dataset: CroConversionDataset;
  storeName: string;
}

/** Step 1, start to finish. Returns a `CroStep`, including for the case where the data cannot carry
 * a conclusion — an "insufficient" step naming what is missing, with no model call made at all,
 * because a model handed a fortnight of traffic will produce five confident recommendations from it. */
export async function generateCroAnalytics(input: GenerateCroAnalyticsInput): Promise<CroStep> {
  const { dataset } = input;
  const evidence = buildCroAnalyticsEvidence(dataset);
  const sufficiency = assessSufficiency({
    propertyId: dataset.propertyId,
    currencyCode: dataset.currencyCode,
    startDate: dataset.startDate,
    endDate: dataset.endDate,
    daysWithSessions: dataset.daysWithSessions,
    totals: dataset.totals,
    byDevice: dataset.byDevice,
    byChannel: dataset.byChannel,
    byLandingPage: dataset.byLandingPage,
  });

  const limitations = [...sufficiency.limitations];

  // Stated whether or not the data is sufficient: a funnel built from event-scoped session counts
  // is an approximation, and a reader comparing it to a GA4 exploration funnel needs to know why
  // the numbers differ.
  if (dataset.funnel.length > 0) {
    limitations.push(
      "The funnel figures count sessions in which each event was recorded, not a strictly nested path — GA4's session-scoped event counts cannot guarantee that every session which reached checkout also recorded a product view. Read the step-to-step falls as progression rates, not as a cohort followed through.",
    );
  }
  if (dataset.items.length === 0) {
    limitations.push(
      "GA4 returned no item-level data, so nothing here speaks to which products convert well or badly. That usually means the `view_item` and `purchase` events are firing without their `items` array.",
    );
  }

  if (!sufficiency.sufficient) {
    return {
      key: "analytics",
      status: "insufficient",
      source: "app",
      slides: [],
      evidence,
      limitations,
      generatedAt: new Date().toISOString(),
    };
  }

  const slideId = "analytics-overview";
  const evidenceText = evidence.map((e) => `[${e.id}] ${e.label}`).join("\n");
  const prompt = [
    `Store: ${input.storeName}. GA4 property ${dataset.propertyId}, ${dataset.startDate} to ${dataset.endDate}.`,
    `Every figure you may use:\n${evidenceText}`,
    "Write the analytics slide: a one-sentence headline stating what this data shows, then 3 to 5 opportunities ranked by size.",
  ].join("\n\n");

  let usage: AiUsage | undefined;
  let raw: { headline?: string; bullets?: unknown } | null = null;

  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic();
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system: SYSTEM,
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
      messages: [{ role: "user", content: prompt }],
    });
    const textBlock = response.content.find(
      (b): b is Extract<(typeof response.content)[number], { type: "text" }> => b.type === "text",
    );
    if (textBlock) {
      raw = JSON.parse(textBlock.text) as { headline?: string; bullets?: unknown };
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
    // Rethrown as a message the caller shows the person who pressed Generate. The figures are
    // already computed and would render fine, but a slide with a catalogue and no argument is not
    // what was asked for, and half a step in storage is indistinguishable from a whole one later.
    throw new Error(`The analytics step could not be written: ${String((err as Error)?.message ?? err).slice(0, 200)}`);
  }

  const { accepted, rejected } = validateBullets(raw?.bullets, {
    step: "analytics",
    slideId,
    evidence,
  });

  if (accepted.length === 0) {
    limitations.push(
      "No opportunity in this run survived the check that every figure it used came from the data it cited, so none is shown. The figures themselves are below and are unaffected.",
    );
  }

  const slide: CroSlide = {
    id: slideId,
    label: "What the data shows",
    intro: raw?.headline?.trim() || undefined,
    bullets: accepted,
  };

  return {
    key: "analytics",
    status: accepted.length > 0 ? "generated" : "insufficient",
    source: "app",
    slides: [slide, buildSegmentTableSlide(dataset)],
    evidence,
    limitations,
    rejected: rejected.length > 0 ? rejected : undefined,
    generatedAt: new Date().toISOString(),
    aiUsage: usage,
  };
}

/** The segment table, built with no model involved.
 *
 * A CRO deck's analytics section needs the numbers on the page, not only the argument about them —
 * a client will want to check the conversion rate they are being shown, and a table they can read
 * is what makes the bullets above it trustworthy. */
export function buildSegmentTableSlide(dataset: CroConversionDataset): CroSlide {
  const rows = [
    ...dataset.byDevice.map((s) => ({ group: "Device", segment: s })),
    ...dataset.byNewReturning.map((s) => ({ group: "Visitor", segment: s })),
    ...aggregateByPageType(dataset.byLandingPage).map((s) => ({ group: "Landing page type", segment: s })),
  ].filter((r) => r.segment.sessions >= MIN_SEGMENT_SESSIONS);

  return {
    id: "analytics-segments",
    label: "Conversion by segment",
    bullets: [],
    table: {
      caption: `GA4 property ${dataset.propertyId}, ${dataset.startDate} to ${dataset.endDate}. Segments below ${MIN_SEGMENT_SESSIONS} sessions are omitted — at that size the rate is noise rather than a measurement.`,
      columns: ["Segment", "Sessions", "Transactions", "Conversion rate", "Revenue"],
      rows: rows.map(({ group, segment }) => ({
        label: `${group}: ${segment.label}`,
        cells: [
          segment.sessions.toLocaleString(),
          segment.transactions.toLocaleString(),
          `${segment.conversionRate}%`,
          money(segment.revenue, dataset.currencyCode),
        ],
      })),
    },
  };
}

/** Re-exported so the API route can build a dataset's derived views without importing the
 * arithmetic from two places. */
export { averageOrderValue, conversionRate };
