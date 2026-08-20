// Data Analysis: the audit crossed with the store's own GA4 data.
//
// This file is the part of the feature that decides what may be claimed. The model writes prose;
// everything numeric — the rates, the gaps, the sizes — is computed here, handed to the model as a
// closed catalogue of citable facts, and rendered from that catalogue rather than from whatever
// the model wrote back. What the model returns is then checked against the same catalogue before
// any of it reaches a page.
//
// The reason for that architecture, stated plainly because it is the whole point of the feature:
// an AI feature is the easiest place in an audit product to assert more than the evidence
// supports. A fabricated conversion rate is indistinguishable from a real one on the page, and a
// client will act on it. So the guarantee is structural rather than a request in a prompt — the
// prompt asks as well, but the prompt is not what enforces it.
//
// Everything above `generateDataAnalysis` is pure and tested in shared/test/data-analysis.test.ts.

import type { Finding } from "./findings";
import type {
  AiUsage,
  AnalysisEvidenceItem,
  ConversionDataset,
  ConversionGap,
  ConversionSegment,
  DataAnalysisRecommendation,
  DataAnalysisSection,
  RejectedRecommendation,
} from "./shared";

/* ── Arithmetic ─────────────────────────────────────────────────────────────────────────────── */

/** transactions ÷ sessions as a percentage, 2dp. The single definition of "conversion rate" in
 * this feature — totals, segments and gap arithmetic all come through here, so two rates printed
 * side by side can never have been produced by two different definitions. */
export function conversionRate(transactions: number, sessions: number): number {
  if (sessions <= 0) return 0;
  return Math.round((transactions / sessions) * 10000) / 100;
}

/** revenue ÷ transactions, 2dp. With no transactions there is no such thing as an average order
 * value; 0 is the honest answer, and every caller treats it as "unknown" rather than as £0. */
export function averageOrderValue(revenue: number, transactions: number): number {
  if (transactions <= 0) return 0;
  return Math.round((revenue / transactions) * 100) / 100;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/* ── Sufficiency: what this data cannot be asked ────────────────────────────────────────────── */

/** A property needs more than a fortnight before a conversation about conversion rates means
 * anything. Two weeks spans two weekends and one payday; a single promotion, outage or press hit
 * inside it moves every rate far more than any site change would. 21 days out of the 28-day
 * window is the line: it tolerates a couple of genuinely zero-traffic days without accepting a
 * property that was connected last Tuesday. */
export const MIN_DAYS_WITH_SESSIONS = 21;

/** Below this many purchases in the window, the site-wide conversion rate is dominated by
 * randomness — a single order moves it by a visible amount — and comparing segments against each
 * other is comparing noise. */
export const MIN_TOTAL_TRANSACTIONS = 25;

/** A segment smaller than this is not evidence of anything. A landing page with 40 sessions and
 * no orders is the expected result of 40 sessions, not a broken template. */
export const MIN_SEGMENT_SESSIONS = 250;

/** The benchmark side of a gap has to be a rate worth aiming at. Fifteen purchases is few, but a
 * benchmark built on three is a number that would move by a third on one refund. */
export const MIN_BENCHMARK_TRANSACTIONS = 15;

export interface SufficiencyVerdict {
  sufficient: boolean;
  /** Every reason the data cannot carry a recommendation, in the wording shown to the user.
   * Populated even when `sufficient` is true — a dataset can be good enough to reason from and
   * still have holes worth naming. */
  limitations: string[];
}

/** Decides whether this dataset can support conversion recommendations at all.
 *
 * This gate exists because the worst possible output of this feature is a confident
 * recommendation built on absent data. Every branch below is a case where the honest answer is
 * "not enough data", and where a model handed the same numbers would cheerfully produce five
 * prioritised recommendations anyway. */
export function assessSufficiency(dataset: ConversionDataset): SufficiencyVerdict {
  const limitations: string[] = [];
  const { totals } = dataset;

  if (totals.sessions <= 0) {
    limitations.push(
      `GA4 recorded no sessions for property ${dataset.propertyId} in the last 28 days. Either the property is not the one this storefront reports to, or tracking is not firing.`,
    );
    return { sufficient: false, limitations };
  }

  if (dataset.daysWithSessions < MIN_DAYS_WITH_SESSIONS) {
    limitations.push(
      `GA4 has only ${dataset.daysWithSessions} day${dataset.daysWithSessions === 1 ? "" : "s"} with recorded sessions inside the 28-day window. That is too little history to separate a conversion problem from a quiet fortnight, so no recommendations are made from it.`,
    );
  }

  if (totals.transactions <= 0) {
    limitations.push(
      "GA4 recorded no transactions in this window, so there is no conversion rate to analyse. Either the store made no sales in these 28 days, or GA4 ecommerce tracking (the `purchase` event) is not configured — which is itself worth checking before reading anything else here.",
    );
  } else if (totals.transactions < MIN_TOTAL_TRANSACTIONS) {
    limitations.push(
      `Only ${totals.transactions} transactions were recorded in the window. Below roughly ${MIN_TOTAL_TRANSACTIONS}, a single order moves the conversion rate enough to swamp any difference between segments, so no recommendations are made from it.`,
    );
  }

  if (totals.transactions > 0 && totals.revenue <= 0) {
    // Not fatal on its own — the transactions are still countable — but every revenue figure and
    // every gap size below becomes meaningless, so it has to be said out loud.
    limitations.push(
      "GA4 recorded transactions but no purchase revenue, so no order value or revenue figure in this analysis can be trusted. This usually means the purchase event is firing without a value parameter.",
    );
  }

  return { sufficient: limitations.length === 0, limitations };
}

/* ── Gap arithmetic ─────────────────────────────────────────────────────────────────────────── */

/** The gap between a weak segment and a benchmark, over the days already measured.
 *
 * Not a forecast, and deliberately impossible to turn into one from here: it multiplies the rate
 * difference by sessions that have already happened, and by an order value that was already
 * observed. Nothing in it says anything about next month. The wording everywhere it surfaces says
 * "over the 28 days measured" for that reason. */
function gapBetween(
  dimension: ConversionGap["dimension"],
  segment: ConversionSegment,
  benchmark: ConversionSegment,
  totalSessions: number,
  observedAov: number,
): ConversionGap | null {
  if (segment.label === benchmark.label) return null;
  if (segment.sessions < MIN_SEGMENT_SESSIONS) return null;
  if (benchmark.sessions < MIN_SEGMENT_SESSIONS) return null;
  if (benchmark.transactions < MIN_BENCHMARK_TRANSACTIONS) return null;
  if (benchmark.conversionRate <= segment.conversionRate) return null;

  const rateDelta = (benchmark.conversionRate - segment.conversionRate) / 100;
  const transactionsAtBenchmark = Math.round(segment.sessions * rateDelta);
  if (transactionsAtBenchmark <= 0) return null;

  return {
    dimension,
    segment: segment.label,
    benchmark: benchmark.label,
    segmentSessions: segment.sessions,
    segmentConversionRate: segment.conversionRate,
    benchmarkConversionRate: benchmark.conversionRate,
    shareOfSessions: totalSessions > 0 ? round2((segment.sessions / totalSessions) * 100) : 0,
    transactionsAtBenchmark,
    revenueAtBenchmark: Math.round(transactionsAtBenchmark * observedAov),
  };
}

/** Device gaps, measured against the best-converting device that carries enough traffic to be a
 * credible benchmark.
 *
 * Devices are compared to each other rather than to the site average because the site average
 * already contains the weak device — a mobile-heavy store drags its own benchmark down, and the
 * gap comes out smaller the worse the problem is. */
export function deviceGaps(dataset: ConversionDataset): ConversionGap[] {
  const eligible = dataset.byDevice.filter(
    (d) => d.sessions >= MIN_SEGMENT_SESSIONS && d.transactions >= MIN_BENCHMARK_TRANSACTIONS,
  );
  if (eligible.length === 0) return [];
  const benchmark = eligible.reduce((best, d) => (d.conversionRate > best.conversionRate ? d : best));
  const aov = dataset.totals.averageOrderValue;

  return dataset.byDevice
    .map((d) => gapBetween("device", d, benchmark, dataset.totals.sessions, aov))
    .filter((g): g is ConversionGap => g !== null)
    .sort((a, b) => b.revenueAtBenchmark - a.revenueAtBenchmark);
}

/** Landing-page gaps, measured against the site's own overall conversion rate.
 *
 * A synthetic "site overall" segment is the benchmark here rather than the best page, because the
 * best-converting landing page in any store is almost always a checkout-adjacent or branded-search
 * entry point that no collection page could ever match. Comparing a collection page to that
 * produces a huge, meaningless gap. */
export function landingPageGaps(dataset: ConversionDataset): ConversionGap[] {
  const siteWide: ConversionSegment = {
    label: "the site overall",
    sessions: dataset.totals.sessions,
    transactions: dataset.totals.transactions,
    revenue: dataset.totals.revenue,
    conversionRate: dataset.totals.conversionRate,
  };
  if (siteWide.transactions < MIN_BENCHMARK_TRANSACTIONS) return [];
  const aov = dataset.totals.averageOrderValue;

  return dataset.byLandingPage
    .map((page) => gapBetween("landingPage", page, siteWide, dataset.totals.sessions, aov))
    .filter((g): g is ConversionGap => g !== null)
    .sort((a, b) => b.revenueAtBenchmark - a.revenueAtBenchmark)
    .slice(0, 5);
}

/* ── The evidence catalogue ─────────────────────────────────────────────────────────────────── */

function money(amount: number, currency: string): string {
  const rounded = Math.round(amount).toLocaleString("en-US");
  return currency ? `${rounded} ${currency}` : rounded;
}

/** Turns a landing-page path into a stable, id-safe token. Paths contain slashes, query strings
 * and occasionally unicode; the position in the traffic-ordered list is stable enough for an id
 * that only has to survive one request. */
function pageId(index: number): string {
  return `landing-${index + 1}`;
}

/** Builds every fact the model is allowed to cite.
 *
 * The catalogue is closed on purpose. A recommendation references entries by id, and the UI prints
 * `text` from here — so a number can only appear on the page if this function wrote it, and this
 * function only writes numbers that came out of the GA4 response or out of the arithmetic above. */
export function buildEvidence(dataset: ConversionDataset, gaps: ConversionGap[]): AnalysisEvidenceItem[] {
  const { totals, currencyCode } = dataset;
  const items: AnalysisEvidenceItem[] = [];

  items.push({
    id: "totals",
    source: "ga4",
    text: `Across ${dataset.startDate} to ${dataset.endDate} (${dataset.daysWithSessions} days with recorded sessions), GA4 recorded ${totals.sessions.toLocaleString("en-US")} sessions from ${totals.totalUsers.toLocaleString("en-US")} users, ${totals.transactions.toLocaleString("en-US")} transactions, a session conversion rate of ${totals.conversionRate}%, ${money(totals.revenue, currencyCode)} of purchase revenue and an average order value of ${money(totals.averageOrderValue, currencyCode)}.`,
  });

  for (const device of dataset.byDevice) {
    const share = totals.sessions > 0 ? round2((device.sessions / totals.sessions) * 100) : 0;
    items.push({
      id: `device-${device.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      source: "ga4",
      text: `${device.label}: ${device.sessions.toLocaleString("en-US")} sessions (${share}% of all sessions), ${device.transactions.toLocaleString("en-US")} transactions, ${device.conversionRate}% conversion rate, ${money(device.revenue, currencyCode)} revenue.`,
    });
  }

  for (const channel of dataset.byChannel) {
    const share = totals.sessions > 0 ? round2((channel.sessions / totals.sessions) * 100) : 0;
    items.push({
      id: `channel-${channel.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      source: "ga4",
      text: `${channel.label} traffic: ${channel.sessions.toLocaleString("en-US")} sessions (${share}% of all sessions), ${channel.transactions.toLocaleString("en-US")} transactions, ${channel.conversionRate}% conversion rate.`,
    });
  }

  dataset.byLandingPage.forEach((page, index) => {
    items.push({
      id: pageId(index),
      source: "ga4",
      text: `Landing page ${page.label}: ${page.sessions.toLocaleString("en-US")} entry sessions, ${page.transactions.toLocaleString("en-US")} transactions, ${page.conversionRate}% conversion rate.`,
    });
  });

  gaps.forEach((gap, index) => {
    items.push({
      id: `gap-${gap.dimension}-${index + 1}`,
      source: "arithmetic",
      text: `${gap.segment} converted at ${gap.segmentConversionRate}% against ${gap.benchmarkConversionRate}% for ${gap.benchmark}, on ${gap.segmentSessions.toLocaleString("en-US")} sessions — ${gap.shareOfSessions}% of all traffic. At the benchmark's rate those sessions would have produced ${gap.transactionsAtBenchmark.toLocaleString("en-US")} more transactions over the days measured, worth about ${money(gap.revenueAtBenchmark, currencyCode)} at the site's observed average order value. That is the size of the gap that already happened, not a projection of what fixing it would earn.`,
    });
  });

  return items;
}

/* ── Guards against fabrication ─────────────────────────────────────────────────────────────── */

const NUMBER_TOKEN = /\d[\d,]*(?:\.\d+)?/g;

/** Every way a number in the source text may legitimately be restated: as written, and rounded to
 * one or zero decimal places. Rounding "2.43%" to "2.4%" in prose is a restatement, not an
 * invention; producing "3.1%" from it is an invention. */
function numberForms(raw: string): string[] {
  const value = Number(raw.replace(/,/g, ""));
  if (!Number.isFinite(value)) return [];
  return [String(value), String(Math.round(value * 10) / 10), String(Math.round(value))];
}

/** The set of numeric values a piece of prose is permitted to contain, derived from the text it
 * is allowed to draw on. */
export function allowedNumbers(sources: string[]): Set<string> {
  const allowed = new Set<string>();
  for (const source of sources) {
    for (const match of source.match(NUMBER_TOKEN) ?? []) {
      for (const form of numberForms(match)) allowed.add(form);
    }
  }
  return allowed;
}

/** Small bare integers a sentence can use as English rather than as data — "the top 3 landing
 * pages", "both of the two templates". Never applied to a figure carrying a percent sign or a
 * currency symbol, which is where a fabricated metric would actually appear. */
const SMALL_INTEGER_LIMIT = 12;

/** Returns every number in `text` that the allowed set does not account for.
 *
 * This is the check that catches the failure this feature is most exposed to: the model given a
 * conversion rate of 0.9% and an audit finding about LCP, writing "fixing this typically lifts
 * mobile conversion by 15-20%". Nothing in the input contains 15 or 20, so it is caught and the
 * recommendation carrying it is discarded rather than quietly published. */
export function unsupportedNumbers(text: string, allowed: Set<string>): string[] {
  const offenders: string[] = [];
  for (const match of text.matchAll(NUMBER_TOKEN)) {
    const raw = match[0];
    const value = Number(raw.replace(/,/g, ""));
    if (!Number.isFinite(value)) continue;
    if (allowed.has(String(value))) continue;

    // "Quantified" means the number is presented as a measurement — a percentage or an amount of
    // money — which is precisely where a fabricated metric would appear. The small-integer
    // allowance below is for numbers used as English ("the top 3 templates"), and must never
    // extend to one of these.
    const before = text.slice(0, match.index);
    const after = text.slice(match.index + raw.length);
    const isQuantified =
      /^\s*(%|percent|pp\b|GBP|USD|EUR|AUD|CAD)/i.test(after) || /[$£€¥]\s*$/.test(before) || /\b(GBP|USD|EUR|AUD|CAD)\s*$/i.test(before);
    const isBareSmallInteger = Number.isInteger(value) && value <= SMALL_INTEGER_LIMIT && !raw.includes(".");
    if (!isQuantified && isBareSmallInteger) continue;

    offenders.push(raw);
  }
  return offenders;
}

/** What the model is asked to return, before any of it is trusted. */
export interface RawRecommendation {
  title?: unknown;
  action?: unknown;
  evidenceIds?: unknown;
  findingIds?: unknown;
  sectionIds?: unknown;
  expectation?: unknown;
  confidence?: unknown;
  causalNote?: unknown;
}

export interface ValidationResult {
  accepted: DataAnalysisRecommendation[];
  rejected: RejectedRecommendation[];
}

/** How many recommendations survive to the page. A ranked list nobody reads to the bottom of is
 * a way of avoiding the ranking. */
const MAX_RECOMMENDATIONS = 8;

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/** Checks each recommendation the model produced against the data it was actually given, and
 * throws away the ones that do not hold up.
 *
 * Each rule below refuses something specific:
 *  - a recommendation citing no evidence is an opinion wearing a data feature's clothes;
 *  - an evidence id that does not exist means the model referred to a fact it was not given;
 *  - a finding id that does not exist means it invented a connection to the audit, which is worse
 *    than drawing none, because a reader will go looking for the finding;
 *  - a number that appears nowhere in the cited evidence or findings is a fabricated metric, and
 *    is the single failure this whole design exists to prevent. */
export function validateRecommendations(
  raw: RawRecommendation[],
  evidence: AnalysisEvidenceItem[],
  findings: Finding[],
  availableSections: string[],
): ValidationResult {
  const evidenceById = new Map(evidence.map((e) => [e.id, e]));
  const findingById = new Map(findings.map((f) => [f.id, f]));
  const sections = new Set(availableSections);

  const accepted: DataAnalysisRecommendation[] = [];
  const rejected: RejectedRecommendation[] = [];

  for (const item of raw) {
    const title = typeof item.title === "string" ? item.title.trim() : "";
    const action = typeof item.action === "string" ? item.action.trim() : "";
    const expectation = typeof item.expectation === "string" ? item.expectation.trim() : "";
    const causalNote = typeof item.causalNote === "string" ? item.causalNote.trim() : "";
    const label = title || "(untitled recommendation)";

    if (!title || !action) {
      rejected.push({ title: label, reason: "It arrived without a title or without an action to take." });
      continue;
    }

    const claimedEvidence = asStringArray(item.evidenceIds);
    const evidenceIds = claimedEvidence.filter((id) => evidenceById.has(id));
    if (evidenceIds.length === 0) {
      rejected.push({
        title: label,
        reason:
          claimedEvidence.length === 0
            ? "It cited none of the GA4 figures it was given, so nothing in the data supports it."
            : `It cited evidence that does not exist in this dataset (${claimedEvidence.join(", ")}).`,
      });
      continue;
    }

    const claimedFindings = asStringArray(item.findingIds);
    const findingIds = claimedFindings.filter((id) => findingById.has(id));
    if (claimedFindings.length > 0 && findingIds.length === 0) {
      rejected.push({
        title: label,
        reason: `It claimed to connect to audit finding${claimedFindings.length === 1 ? "" : "s"} that this report does not contain (${claimedFindings.join(", ")}).`,
      });
      continue;
    }

    const sectionIds = asStringArray(item.sectionIds).filter((id) => sections.has(id));

    const citedText = [
      ...evidenceIds.map((id) => evidenceById.get(id)!.text),
      ...findingIds.flatMap((id) => {
        const f = findingById.get(id)!;
        return [f.title, f.description, f.displayValue ?? "", f.recommendation ?? "", f.scope ?? ""];
      }),
    ];
    const allowed = allowedNumbers(citedText);
    const offenders = [title, action, expectation, causalNote].flatMap((t) => unsupportedNumbers(t, allowed));
    if (offenders.length > 0) {
      rejected.push({
        title: label,
        reason: `It contained figures that appear nowhere in the data it cited (${[...new Set(offenders)].join(", ")}).`,
      });
      continue;
    }

    accepted.push({
      rank: accepted.length + 1,
      title,
      action,
      evidenceIds,
      findingIds,
      sectionIds,
      expectation,
      // An unrecognised confidence value defaults to the more cautious of the two. A model that
      // returns something off-schema should never land on the stronger claim by accident.
      confidence: item.confidence === "measured" ? "measured" : "hypothesis",
      causalNote,
    });
    if (accepted.length >= MAX_RECOMMENDATIONS) break;
  }

  return { accepted, rejected };
}

/** The headline gets the same scrub as the recommendations, against the whole catalogue rather
 * than one recommendation's citations. A failed headline is replaced rather than dropped, because
 * the page needs an opening sentence — and the replacement is built from the dataset, so it is
 * true by construction. */
export function safeHeadline(candidate: string, evidence: AnalysisEvidenceItem[], dataset: ConversionDataset): string {
  const fallback = `Over ${dataset.daysWithSessions} days of GA4 data, ${dataset.totals.sessions.toLocaleString("en-US")} sessions produced ${dataset.totals.transactions.toLocaleString("en-US")} transactions — a ${dataset.totals.conversionRate}% session conversion rate.`;
  const text = candidate.trim();
  if (!text) return fallback;
  const allowed = allowedNumbers(evidence.map((e) => e.text));
  return unsupportedNumbers(text, allowed).length === 0 ? text : fallback;
}

/* ── The model call ─────────────────────────────────────────────────────────────────────────── */

// Same pricing note as cli/src/analyzers/ai-suggestions.ts — informational only, not billed
// against.
const OPUS_5_PRICING_PER_MILLION = { input: 5, output: 25 };
const MODEL = "claude-opus-5";

function estimateCostUsd(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens / 1_000_000) * OPUS_5_PRICING_PER_MILLION.input +
    (outputTokens / 1_000_000) * OPUS_5_PRICING_PER_MILLION.output
  );
}

const ANALYSIS_SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string" },
    recommendations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          action: { type: "string" },
          evidenceIds: { type: "array", items: { type: "string" } },
          findingIds: { type: "array", items: { type: "string" } },
          sectionIds: { type: "array", items: { type: "string" } },
          expectation: { type: "string" },
          confidence: { type: "string", enum: ["measured", "hypothesis"] },
          causalNote: { type: "string" },
        },
        required: ["title", "action", "evidenceIds", "findingIds", "sectionIds", "expectation", "confidence", "causalNote"],
        additionalProperties: false,
      },
    },
  },
  required: ["headline", "recommendations"],
  additionalProperties: false,
} as const;

/** How many audit findings to put in front of the model. Ordered worst-first, so a truncated list
 * loses the ones least likely to explain a conversion problem. */
const MAX_FINDINGS_IN_PROMPT = 40;
const SEVERITY_ORDER: Record<Finding["severity"], number> = { critical: 0, high: 1, medium: 2, low: 3, good: 4 };

export function findingsForPrompt(findings: Finding[]): Finding[] {
  return [...findings]
    .filter((f) => f.severity !== "good")
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
    .slice(0, MAX_FINDINGS_IN_PROMPT);
}

export function buildPrompt(
  storeName: string,
  dataset: ConversionDataset,
  evidence: AnalysisEvidenceItem[],
  findings: Finding[],
  availableSections: string[],
): string {
  const evidenceBlock = evidence.map((e) => `[${e.id}] (${e.source}) ${e.text}`).join("\n");
  const findingsBlock =
    findings.length > 0
      ? findings
          .map(
            (f) =>
              `[${f.id}] (${f.severity}) ${f.title} — ${f.description}${f.displayValue ? ` (${f.displayValue})` : ""}${f.scope ? ` [scope: ${f.scope}]` : ""}`,
          )
          .join("\n")
      : "The audit produced no findings at this severity — say so if a GA4 number has no audit explanation.";

  return (
    `Store: ${storeName}\n` +
    `GA4 property ${dataset.propertyId}, ${dataset.startDate} to ${dataset.endDate}.\n\n` +
    `THE ONLY FIGURES THAT EXIST. Cite these by id in evidenceIds. Do not restate a number that is not in one of these lines:\n${evidenceBlock}\n\n` +
    `AUDIT FINDINGS from the site audit of this same store. Cite these by id in findingIds:\n${findingsBlock}\n\n` +
    `Report sections available for sectionIds: ${availableSections.join(", ") || "(none)"}\n`
  );
}

const SYSTEM_PROMPT =
  "You are a conversion analyst writing for a Shopify merchant. You are given two things: a closed " +
  "catalogue of figures pulled from the store's own GA4 property, and the findings of a technical " +
  "audit of the same storefront. Produce a ranked list of what to do, ordered by how much the data " +
  "suggests is at stake.\n\n" +
  "Rules, all of which are enforced after you answer — a recommendation that breaks one is discarded " +
  "rather than corrected:\n" +
  "1. Every recommendation must cite at least one evidence id. Evidence you were not given does not exist.\n" +
  "2. Never write a number that does not appear in the evidence or findings you cite. Do not extrapolate, " +
  "annualise, or convert. If you want to say how big something is, cite the evidence line that says it.\n" +
  "3. Never forecast. Do not say a fix will lift conversion by any percentage, or be worth any amount. " +
  "The `expectation` field takes a direction and a rough magnitude grounded in the cited gap — for example " +
  "'the gap this would close is the largest of the three, so treat it as the first thing to test' — never a " +
  "number you produced yourself.\n" +
  "4. The audit says the site has a defect; GA4 says a segment converts badly. That is a hypothesis worth " +
  "testing, not a demonstrated cause. Use confidence 'hypothesis' whenever you join an audit finding to a " +
  "GA4 number, and 'measured' only when you are restating what GA4 recorded. Say in `causalNote` what else " +
  "could explain the same numbers.\n" +
  "5. Cite findingIds only for findings you were actually shown. Never invent an id.\n" +
  "6. Fewer, better-grounded recommendations beat more. If the data supports two, return two.\n" +
  "7. The headline is one sentence describing what the data shows, using only figures from the evidence.";

export interface GenerationInput {
  storeSlug: string;
  storeName: string;
  reportId: string;
  dataset: ConversionDataset;
  findings: Finding[];
  availableSections: string[];
}

/** Builds the insufficient-data verdict without calling the model at all.
 *
 * Not calling it is the point: there is nothing for it to do here except produce something that
 * reads like analysis, and it would. The dataset is still saved and rendered so the reader can
 * check the refusal for themselves. */
export function insufficientAnalysis(input: GenerationInput, limitations: string[]): DataAnalysisSection {
  const gaps: ConversionGap[] = [];
  return {
    storeSlug: input.storeSlug,
    reportId: input.reportId,
    generatedAt: new Date().toISOString(),
    status: "insufficient-data",
    dataset: input.dataset,
    gaps,
    evidence: buildEvidence(input.dataset, gaps),
    limitations,
    headline: "There is not enough GA4 data behind this property to support conversion recommendations.",
    recommendations: [],
    rejected: [],
  };
}

/** Runs the whole analysis: gate, arithmetic, model call, validation.
 *
 * Throws only when the model call itself cannot be made or fails — the caller turns that into an
 * error state rather than a stored analysis, because a half-generated analysis saved to Blob would
 * look identical to a complete one. */
export async function generateDataAnalysis(input: GenerationInput): Promise<DataAnalysisSection> {
  const verdict = assessSufficiency(input.dataset);
  if (!verdict.sufficient) return insufficientAnalysis(input, verdict.limitations);

  const gaps = [...deviceGaps(input.dataset), ...landingPageGaps(input.dataset)];
  const evidence = buildEvidence(input.dataset, gaps);
  const findings = findingsForPrompt(input.findings);

  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    system: SYSTEM_PROMPT,
    output_config: { format: { type: "json_schema", schema: ANALYSIS_SCHEMA } },
    messages: [
      {
        role: "user",
        content: buildPrompt(input.storeName, input.dataset, evidence, findings, input.availableSections),
      },
    ],
  });

  const textBlock = response.content.find(
    (b): b is Extract<(typeof response.content)[number], { type: "text" }> => b.type === "text",
  );
  if (!textBlock) throw new Error("Claude returned no text block for the analysis.");
  const parsed = JSON.parse(textBlock.text) as { headline?: string; recommendations?: RawRecommendation[] };

  const { accepted, rejected } = validateRecommendations(
    parsed.recommendations ?? [],
    evidence,
    findings,
    input.availableSections,
  );

  // A limitation worth stating even on a good dataset: the analysis only ever saw 28 days, and
  // only the segments GA4 returned above the caps in ga4.ts.
  const limitations = [
    `This analysis saw ${input.dataset.daysWithSessions} days of GA4 data (${input.dataset.startDate} to ${input.dataset.endDate}) and nothing before it. Seasonality, promotions and outages inside that window are not separated out.`,
    "Where a recommendation links an audit finding to a GA4 number, that link is a hypothesis to test — the audit measured the site, GA4 measured behaviour, and neither one demonstrates that the first caused the second.",
  ];
  if (accepted.length === 0) {
    limitations.push(
      "No recommendation in this run survived the check that every figure it used came from the data it cited. Nothing is shown rather than showing something unsupported.",
    );
  }

  const inputTokens = response.usage.input_tokens;
  const outputTokens = response.usage.output_tokens;
  const usage: AiUsage = {
    model: MODEL,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    estimatedCostUsd: estimateCostUsd(inputTokens, outputTokens),
  };

  return {
    storeSlug: input.storeSlug,
    reportId: input.reportId,
    generatedAt: new Date().toISOString(),
    status: "ok",
    dataset: input.dataset,
    gaps,
    evidence,
    limitations,
    headline: safeHeadline(parsed.headline ?? "", evidence, input.dataset),
    recommendations: accepted,
    rejected,
    usage,
  };
}
