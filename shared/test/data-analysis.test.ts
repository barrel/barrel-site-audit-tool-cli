// The Data Analysis feature's pure half: the sufficiency gates, the gap arithmetic, and the
// checks that decide whether a model-written recommendation may be shown at all.
//
// Lives under shared/test/ because that (with cli/test/) is where the harness looks; the code it
// exercises lives in web/lib/data-analysis.ts, which is pure TypeScript with no React, no Next
// runtime and no network — the same reason mirror-drift.test.ts reaches across into web/.
//
// These are the assertions that matter most in the whole feature. Everything else about the
// analysis is prose; this is the arithmetic a client would act on, and the gate that decides
// whether any of it gets said.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MIN_BENCHMARK_TRANSACTIONS,
  MIN_DAYS_WITH_SESSIONS,
  MIN_SEGMENT_SESSIONS,
  MIN_TOTAL_TRANSACTIONS,
  allowedNumbers,
  assessSufficiency,
  averageOrderValue,
  buildEvidence,
  conversionRate,
  deviceGaps,
  findingsForPrompt,
  generateDataAnalysis,
  insufficientAnalysis,
  landingPageGaps,
  safeHeadline,
  unsupportedNumbers,
  validateRecommendations,
} from "../../web/lib/data-analysis.js";
import type { ConversionDataset, ConversionSegment } from "../../web/lib/shared.js";
import type { Finding } from "../../web/lib/findings.js";

function segment(label: string, sessions: number, transactions: number, revenue = transactions * 100): ConversionSegment {
  return { label, sessions, transactions, revenue, conversionRate: conversionRate(transactions, sessions) };
}

/** A healthy 28-day property: mobile is most of the traffic and converts at a third of desktop's
 * rate, which is the exact shape this feature exists to surface. */
function dataset(overrides: Partial<ConversionDataset> = {}): ConversionDataset {
  const byDevice = [segment("mobile", 71_000, 639), segment("desktop", 25_000, 600), segment("tablet", 4_000, 40)];
  const sessions = 100_000;
  const transactions = 1279;
  const revenue = 127_900;
  return {
    propertyId: "123456789",
    currencyCode: "GBP",
    startDate: "2026-07-23",
    endDate: "2026-08-19",
    daysWithSessions: 28,
    totals: {
      sessions,
      totalUsers: 80_000,
      transactions,
      revenue,
      conversionRate: conversionRate(transactions, sessions),
      averageOrderValue: averageOrderValue(revenue, transactions),
    },
    byDevice,
    byChannel: [segment("Organic Search", 50_000, 700), segment("Paid Search", 30_000, 400)],
    byLandingPage: [segment("/", 40_000, 700), segment("/collections/sale", 20_000, 40)],
    ...overrides,
  };
}

describe("conversion arithmetic", () => {
  it("computes a session conversion rate to two decimal places", () => {
    assert.equal(conversionRate(639, 71_000), 0.9);
    assert.equal(conversionRate(600, 25_000), 2.4);
    assert.equal(conversionRate(1, 3), 33.33);
  });

  it("returns zero rather than dividing by zero when a segment had no sessions", () => {
    assert.equal(conversionRate(0, 0), 0);
    assert.equal(conversionRate(5, 0), 0);
  });

  it("computes average order value from revenue and orders, not from users", () => {
    assert.equal(averageOrderValue(127_900, 1279), 100);
    assert.equal(averageOrderValue(1000, 3), 333.33);
  });

  it("treats no transactions as no average order value", () => {
    // The alternative — Infinity or NaN — would be formatted onto a page as a currency figure.
    assert.equal(averageOrderValue(500, 0), 0);
  });
});

describe("assessSufficiency — what the data may not be asked", () => {
  it("accepts a property with a full window, real traffic and real orders", () => {
    const verdict = assessSufficiency(dataset());
    assert.deepEqual(verdict, { sufficient: true, limitations: [] });
  });

  it("refuses a property with no sessions at all, and stops before saying anything else", () => {
    const empty = dataset({
      daysWithSessions: 0,
      totals: { sessions: 0, totalUsers: 0, transactions: 0, revenue: 0, conversionRate: 0, averageOrderValue: 0 },
    });
    const verdict = assessSufficiency(empty);
    assert.equal(verdict.sufficient, false);
    // One reason, not three: with no sessions, "too little history" and "no transactions" are
    // both true and both misleading about what is actually wrong.
    assert.equal(verdict.limitations.length, 1);
    assert.match(verdict.limitations[0], /no sessions/i);
  });

  it("refuses a property with two weeks of history", () => {
    const verdict = assessSufficiency(dataset({ daysWithSessions: 14 }));
    assert.equal(verdict.sufficient, false);
    assert.ok(verdict.limitations.some((l) => /14 days/.test(l)));
  });

  it("accepts exactly the documented minimum and refuses one day less", () => {
    assert.equal(assessSufficiency(dataset({ daysWithSessions: MIN_DAYS_WITH_SESSIONS })).sufficient, true);
    assert.equal(assessSufficiency(dataset({ daysWithSessions: MIN_DAYS_WITH_SESSIONS - 1 })).sufficient, false);
  });

  it("refuses a property with no transactions, and names untracked ecommerce as the likely cause", () => {
    const noOrders = dataset({
      totals: { ...dataset().totals, transactions: 0, revenue: 0, conversionRate: 0, averageOrderValue: 0 },
    });
    const verdict = assessSufficiency(noOrders);
    assert.equal(verdict.sufficient, false);
    assert.ok(verdict.limitations.some((l) => /ecommerce tracking/i.test(l)));
  });

  it("refuses a transaction count too small to tell segments apart", () => {
    const thin = dataset({ totals: { ...dataset().totals, transactions: MIN_TOTAL_TRANSACTIONS - 1 } });
    assert.equal(assessSufficiency(thin).sufficient, false);
    const enough = dataset({ totals: { ...dataset().totals, transactions: MIN_TOTAL_TRANSACTIONS } });
    assert.equal(assessSufficiency(enough).sufficient, true);
  });

  it("refuses transactions recorded without any revenue", () => {
    // Every currency figure downstream would be zero, and a zero gap size reads as "no problem".
    const noValue = dataset({ totals: { ...dataset().totals, revenue: 0, averageOrderValue: 0 } });
    const verdict = assessSufficiency(noValue);
    assert.equal(verdict.sufficient, false);
    assert.ok(verdict.limitations.some((l) => /no purchase revenue/i.test(l)));
  });
});

describe("device gap arithmetic", () => {
  it("measures each device against the best-converting device that carries enough traffic", () => {
    const gaps = deviceGaps(dataset());
    const mobile = gaps.find((g) => g.segment === "mobile");
    assert.ok(mobile, "expected a mobile gap");
    assert.equal(mobile.benchmark, "desktop");
    assert.equal(mobile.segmentConversionRate, 0.9);
    assert.equal(mobile.benchmarkConversionRate, 2.4);
    assert.equal(mobile.segmentSessions, 71_000);
    assert.equal(mobile.shareOfSessions, 71);
    // 71,000 sessions × (2.4% − 0.9%) = 1,065 orders, at the observed £100 AOV.
    assert.equal(mobile.transactionsAtBenchmark, 1065);
    assert.equal(mobile.revenueAtBenchmark, 106_500);
  });

  it("never reports a gap for the benchmark against itself", () => {
    assert.equal(
      deviceGaps(dataset()).some((g) => g.segment === g.benchmark),
      false,
    );
  });

  it("ignores a device too small to be evidence of anything", () => {
    // Tablet sits under the session floor, so its rate — whatever it is — says nothing, and a
    // gap computed from it would be a confident claim about a rounding error.
    const tabletSessions = MIN_SEGMENT_SESSIONS - 1;
    const gaps = deviceGaps(
      dataset({
        byDevice: [segment("mobile", 71_000, 639), segment("desktop", 25_000, 600), segment("tablet", tabletSessions, 0)],
      }),
    );
    assert.equal(
      gaps.some((g) => g.segment === "tablet"),
      false,
    );
    // …and the same device does produce a gap once it clears the floor.
    const bigger = deviceGaps(
      dataset({
        byDevice: [
          segment("mobile", 71_000, 639),
          segment("desktop", 25_000, 600),
          segment("tablet", MIN_SEGMENT_SESSIONS, 0),
        ],
      }),
    );
    assert.ok(bigger.some((g) => g.segment === "tablet"));
  });

  it("produces no gaps at all when no device has enough purchases to be a benchmark", () => {
    const thin = dataset({
      byDevice: [
        segment("mobile", 71_000, MIN_BENCHMARK_TRANSACTIONS - 1),
        segment("desktop", 25_000, MIN_BENCHMARK_TRANSACTIONS - 1),
      ],
    });
    assert.deepEqual(deviceGaps(thin), []);
  });

  it("produces no gaps when every device converts identically", () => {
    const flat = dataset({ byDevice: [segment("mobile", 50_000, 500), segment("desktop", 50_000, 500)] });
    assert.deepEqual(deviceGaps(flat), []);
  });

  it("orders gaps by the size of the difference that already happened", () => {
    const gaps = deviceGaps(
      dataset({
        byDevice: [segment("mobile", 71_000, 639), segment("tablet", 10_000, 50), segment("desktop", 25_000, 600)],
      }),
    );
    const sizes = gaps.map((g) => g.revenueAtBenchmark);
    assert.deepEqual(sizes, [...sizes].sort((a, b) => b - a));
  });
});

describe("landing-page gap arithmetic", () => {
  it("measures a landing page against the site's own overall rate, not the best page", () => {
    const gaps = landingPageGaps(dataset());
    const sale = gaps.find((g) => g.segment === "/collections/sale");
    assert.ok(sale, "expected a gap on the weak collection page");
    assert.equal(sale.benchmark, "the site overall");
    assert.equal(sale.benchmarkConversionRate, dataset().totals.conversionRate);
    assert.equal(sale.dimension, "landingPage");
  });

  it("does not flag a page that converts above the site average", () => {
    assert.equal(
      landingPageGaps(dataset()).some((g) => g.segment === "/"),
      false,
    );
  });

  it("says nothing about landing pages when the site has too few orders to be a benchmark", () => {
    const thin = dataset({ totals: { ...dataset().totals, transactions: MIN_BENCHMARK_TRANSACTIONS - 1 } });
    assert.deepEqual(landingPageGaps(thin), []);
  });
});

describe("allowedNumbers / unsupportedNumbers — the fabrication guard", () => {
  const allowed = allowedNumbers([
    "mobile converted at 0.9% against 2.4% for desktop, on 71,000 sessions — 71% of all traffic.",
  ]);

  it("accepts figures that appear in the cited evidence, with or without thousands separators", () => {
    assert.deepEqual(unsupportedNumbers("Mobile is 71% of sessions and converts at 0.9%.", allowed), []);
    assert.deepEqual(unsupportedNumbers("71000 sessions entered on mobile.", allowed), []);
  });

  it("accepts a figure restated at lower precision, because rounding is not invention", () => {
    const precise = allowedNumbers(["the rate was 2.43%"]);
    assert.deepEqual(unsupportedNumbers("roughly 2.4%", precise), []);
    assert.deepEqual(unsupportedNumbers("about 2%", precise), []);
  });

  it("catches an invented forecast — the failure this whole design exists to prevent", () => {
    assert.deepEqual(unsupportedNumbers("Expect a 15-20% lift in mobile conversion.", allowed), ["15", "20"]);
    assert.deepEqual(unsupportedNumbers("Worth roughly £48,000 a month.", allowed), ["48,000"]);
  });

  it("catches a metric that was never measured, even when it is plausible", () => {
    assert.deepEqual(unsupportedNumbers("Mobile bounce rate is 62%.", allowed), ["62"]);
  });

  it("lets a small bare integer through as English, but never as a quantity", () => {
    assert.deepEqual(unsupportedNumbers("Fix the top 3 templates first.", allowed), []);
    assert.deepEqual(unsupportedNumbers("A 3% improvement is realistic.", allowed), ["3"]);
    assert.deepEqual(unsupportedNumbers("Worth £3 per session.", allowed), ["3"]);
    assert.deepEqual(unsupportedNumbers("Worth £ 3 per session.", allowed), ["3"]);
    assert.deepEqual(unsupportedNumbers("Worth 3 GBP per session.", allowed), ["3"]);
    assert.deepEqual(unsupportedNumbers("Around 3.5 seconds.", allowed), ["3.5"]);
  });
});

describe("insufficientAnalysis", () => {
  const dataSet = dataset({ daysWithSessions: 10 });
  const section = insufficientAnalysis(
    {
      storeSlug: "acme",
      storeName: "Acme",
      reportId: "r1",
      dataset: dataSet,
      findings: [],
      availableSections: ["performance"],
    },
    assessSufficiency(dataSet).limitations,
  );

  it("makes no recommendations and computes no gaps", () => {
    assert.equal(section.status, "insufficient-data");
    assert.deepEqual(section.recommendations, []);
    assert.deepEqual(section.gaps, []);
    assert.deepEqual(section.rejected, []);
  });

  it("still carries the figures, so the refusal can be checked rather than trusted", () => {
    assert.ok(section.evidence.length > 0);
    assert.equal(section.dataset.totals.sessions, dataSet.totals.sessions);
    assert.ok(section.limitations.length > 0);
  });

  it("never states a gap it computed nothing for", () => {
    assert.equal(
      section.evidence.some((e) => e.source === "arithmetic"),
      false,
    );
  });

  it("is reached without the model being called at all", async () => {
    // The point of the gate is that it fires *before* the spend, not that it filters the answer
    // afterwards. Proved rather than asserted: the Anthropic client is pointed at a closed local
    // port, so any attempt to reach the model would fail loudly instead of returning a section.
    const previousBase = process.env.ANTHROPIC_BASE_URL;
    const previousKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_BASE_URL = "http://127.0.0.1:1";
    process.env.ANTHROPIC_API_KEY = "not-a-real-key";
    try {
      const generated = await generateDataAnalysis({
        storeSlug: "acme",
        storeName: "Acme",
        reportId: "r1",
        dataset: dataSet,
        findings: [],
        availableSections: ["performance"],
      });
      assert.equal(generated.status, "insufficient-data");
      assert.deepEqual(generated.recommendations, []);
      assert.equal(generated.usage, undefined);
    } finally {
      if (previousBase === undefined) delete process.env.ANTHROPIC_BASE_URL;
      else process.env.ANTHROPIC_BASE_URL = previousBase;
      if (previousKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = previousKey;
    }
  });
});

describe("validateRecommendations", () => {
  const dataSet = dataset();
  const gaps = deviceGaps(dataSet);
  const evidence = buildEvidence(dataSet, gaps);
  const findings: Finding[] = [
    {
      id: "perf-lcp",
      title: "Largest Contentful Paint is slow on mobile",
      severity: "high",
      description: "The hero image finishes painting at 5.8 s on the mobile Lighthouse run.",
      displayValue: "5.8 s",
      scope: "Homepage",
      recommendation: "Preload the hero image and stop lazy-loading it.",
    },
  ];
  const sections = ["performance", "ux"];
  const evidenceId = evidence[0].id;

  function run(items: Parameters<typeof validateRecommendations>[0]) {
    return validateRecommendations(items, evidence, findings, sections);
  }

  it("accepts a grounded recommendation and ranks it", () => {
    const { accepted, rejected } = run([
      {
        title: "Test the mobile hero against the mobile conversion gap",
        action: "Preload the hero image on the homepage and re-measure.",
        evidenceIds: [evidenceId],
        findingIds: ["perf-lcp"],
        sectionIds: ["performance", "not-a-section"],
        expectation: "Closes the largest of the measured gaps first.",
        confidence: "hypothesis",
        causalNote: "Slow paint and weak mobile conversion may share a cause, or may not.",
      },
    ]);
    assert.deepEqual(rejected, []);
    assert.equal(accepted.length, 1);
    assert.equal(accepted[0].rank, 1);
    assert.deepEqual(accepted[0].findingIds, ["perf-lcp"]);
    // A section this report does not contain is dropped rather than rendered as a dead link.
    assert.deepEqual(accepted[0].sectionIds, ["performance"]);
  });

  it("discards a recommendation that cites no evidence", () => {
    const { accepted, rejected } = run([
      {
        title: "Improve the checkout",
        action: "Simplify it.",
        evidenceIds: [],
        findingIds: [],
        sectionIds: [],
        expectation: "Better.",
        confidence: "measured",
        causalNote: "",
      },
    ]);
    assert.deepEqual(accepted, []);
    assert.equal(rejected.length, 1);
    assert.match(rejected[0].reason, /cited none of the GA4 figures/i);
  });

  it("discards a recommendation citing evidence it was never given", () => {
    const { accepted, rejected } = run([
      {
        title: "Act on the bounce rate",
        action: "Do something.",
        evidenceIds: ["bounce-rate"],
        findingIds: [],
        sectionIds: [],
        expectation: "",
        confidence: "measured",
        causalNote: "",
      },
    ]);
    assert.deepEqual(accepted, []);
    assert.match(rejected[0].reason, /does not exist in this dataset/i);
  });

  it("discards a recommendation that invents a connection to an audit finding", () => {
    // Worse than drawing no connection: a reader goes looking for the finding and cannot find it.
    const { accepted, rejected } = run([
      {
        title: "Fix the thing the audit found",
        action: "Do it.",
        evidenceIds: [evidenceId],
        findingIds: ["perf-imaginary"],
        sectionIds: [],
        expectation: "",
        confidence: "hypothesis",
        causalNote: "",
      },
    ]);
    assert.deepEqual(accepted, []);
    assert.match(rejected[0].reason, /does not contain/i);
  });

  it("discards a recommendation carrying a fabricated forecast", () => {
    const { accepted, rejected } = run([
      {
        title: "Fix mobile",
        action: "Preload the hero.",
        evidenceIds: [evidenceId],
        findingIds: [],
        sectionIds: [],
        expectation: "Recovering half the gap is worth roughly 42,000 GBP a month.",
        confidence: "hypothesis",
        causalNote: "",
      },
    ]);
    assert.deepEqual(accepted, []);
    assert.match(rejected[0].reason, /appear nowhere in the data it cited/i);
    assert.match(rejected[0].reason, /42,000/);
  });

  it("allows a figure that came from the audit finding it cited", () => {
    const { accepted, rejected } = run([
      {
        title: "Preload the hero image",
        action: "LCP is 5.8 s on mobile; preload the hero so it is not discovered late.",
        evidenceIds: [evidenceId],
        findingIds: ["perf-lcp"],
        sectionIds: [],
        expectation: "",
        confidence: "hypothesis",
        causalNote: "",
      },
    ]);
    assert.deepEqual(rejected, []);
    assert.equal(accepted.length, 1);
  });

  it("defaults an unrecognised confidence to the weaker claim", () => {
    const { accepted } = run([
      {
        title: "A recommendation",
        action: "Do it.",
        evidenceIds: [evidenceId],
        findingIds: [],
        sectionIds: [],
        expectation: "",
        confidence: "certain",
        causalNote: "",
      },
    ]);
    assert.equal(accepted[0].confidence, "hypothesis");
  });

  it("discards anything arriving without a title or an action", () => {
    const { accepted, rejected } = run([
      { title: "", action: "Do it.", evidenceIds: [evidenceId] },
      { title: "A title", action: "", evidenceIds: [evidenceId] },
    ]);
    assert.deepEqual(accepted, []);
    assert.equal(rejected.length, 2);
  });

  it("caps the list and renumbers the survivors consecutively", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      title: `Recommendation ${i + 1}`,
      action: "Do it.",
      evidenceIds: [evidenceId],
      findingIds: [],
      sectionIds: [],
      expectation: "",
      confidence: "hypothesis",
      causalNote: "",
    }));
    const { accepted } = run(many);
    assert.equal(accepted.length, 8);
    assert.deepEqual(
      accepted.map((r) => r.rank),
      [1, 2, 3, 4, 5, 6, 7, 8],
    );
  });
});

describe("buildEvidence", () => {
  it("gives every fact a unique id, since a recommendation cites them by id", () => {
    const dataSet = dataset();
    const evidence = buildEvidence(dataSet, deviceGaps(dataSet));
    assert.equal(new Set(evidence.map((e) => e.id)).size, evidence.length);
  });

  it("labels its own arithmetic as computed rather than as a measurement", () => {
    const dataSet = dataset();
    const evidence = buildEvidence(dataSet, deviceGaps(dataSet));
    const gapLines = evidence.filter((e) => e.id.startsWith("gap-"));
    assert.ok(gapLines.length > 0);
    assert.ok(gapLines.every((e) => e.source === "arithmetic"));
  });

  it("says in the gap wording that the figure is not a projection", () => {
    const dataSet = dataset();
    const evidence = buildEvidence(dataSet, deviceGaps(dataSet));
    const gapLine = evidence.find((e) => e.id.startsWith("gap-"));
    assert.ok(gapLine);
    assert.match(gapLine.text, /not a projection/i);
  });
});

describe("safeHeadline", () => {
  const dataSet = dataset();
  const evidence = buildEvidence(dataSet, deviceGaps(dataSet));

  it("keeps a headline whose figures all came from the evidence", () => {
    const text = "Mobile is 71% of sessions and converts at 0.9%.";
    assert.equal(safeHeadline(text, evidence, dataSet), text);
  });

  it("replaces a headline with an invented figure, rather than dropping the headline", () => {
    const replaced = safeHeadline("Conversion is 88% below industry benchmark.", evidence, dataSet);
    assert.doesNotMatch(replaced, /88/);
    // The fallback is built from the dataset, so it is true by construction.
    assert.match(replaced, /100,000 sessions/);
  });

  it("falls back when the model returned nothing at all", () => {
    assert.match(safeHeadline("   ", evidence, dataSet), /1,279 transactions/);
  });
});

describe("findingsForPrompt", () => {
  const findings: Finding[] = [
    { id: "a", title: "A", severity: "low", description: "" },
    { id: "b", title: "B", severity: "critical", description: "" },
    { id: "c", title: "C", severity: "good", description: "" },
    { id: "d", title: "D", severity: "medium", description: "" },
  ];

  it("orders worst-first so a truncated list keeps what matters", () => {
    assert.deepEqual(
      findingsForPrompt(findings).map((f) => f.id),
      ["b", "d", "a"],
    );
  });

  it("never offers a no-issue finding as something to act on", () => {
    assert.equal(
      findingsForPrompt(findings).some((f) => f.severity === "good"),
      false,
    );
  });

  it("does not mutate the caller's list", () => {
    const original = findings.map((f) => f.id);
    findingsForPrompt(findings);
    assert.deepEqual(
      findings.map((f) => f.id),
      original,
    );
  });
});
