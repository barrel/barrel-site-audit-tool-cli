// The CRO audit's analytics step: the arithmetic a client would act on.
//
// Lives under shared/test/ (with cli/test/) because that is where the harness looks; the code it
// exercises is web/lib/cro-analytics.ts, which is pure TypeScript with no React, no Next runtime
// and no network — the same reason data-analysis.test.ts reaches across into web/.
//
// The bulk of it is page-type bucketing and funnel arithmetic, both of which are places where a
// plausible-looking mistake produces a confident slide about the wrong thing: a PDP mis-bucketed as
// a collection page turns a merchandising finding into a template finding, and a funnel drop
// computed from event counts rather than sessions makes a store where people add two items each
// look like it is haemorrhaging shoppers.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MIN_ITEM_VIEWS,
  aggregateByPageType,
  benchmarkSegment,
  buildCroAnalyticsEvidence,
  buildSegmentTableSlide,
  classifyPageType,
  funnelDrops,
  topItems,
  underperformingItems,
  worstFunnelDrop,
} from "../../web/lib/cro-analytics.js";
import type { CroConversionDataset, CroFunnelStep, CroItemRow } from "../../web/lib/cro-analytics.js";
import type { ConversionSegment } from "../../web/lib/shared.js";

function segment(label: string, sessions: number, transactions: number, revenue = transactions * 50): ConversionSegment {
  return {
    label,
    sessions,
    transactions,
    revenue,
    conversionRate: sessions > 0 ? Math.round((transactions / sessions) * 10000) / 100 : 0,
  };
}

describe("page-type classification", () => {
  it("reads a product page as a product page even under a collection prefix", () => {
    // /collections/x/products/y is a real Shopify URL and a real PDP. Ordering the collection test
    // first would file every one of them as a collection page.
    assert.equal(classifyPageType("/collections/all/products/blue-mug"), "Product (PDP)");
    assert.equal(classifyPageType("/products/blue-mug?variant=123"), "Product (PDP)");
  });

  it("classifies the rest of the storefront", () => {
    assert.equal(classifyPageType("/collections/mugs"), "Collection (PLP)");
    assert.equal(classifyPageType("/cart"), "Cart");
    assert.equal(classifyPageType("/search?q=mug"), "Search");
    assert.equal(classifyPageType("/blogs/news/how-to"), "Blog / content");
    assert.equal(classifyPageType("/pages/about"), "Blog / content");
    assert.equal(classifyPageType("/account/login"), "Account");
    assert.equal(classifyPageType("/"), "Home");
  });

  it("puts anything it does not recognise in Other rather than guessing", () => {
    // A wrong bucket is worse than an honest one: it produces a confident finding about a page type
    // the traffic was never on.
    assert.equal(classifyPageType("/apps/store-locator"), "Other");
    assert.equal(classifyPageType("(not set)"), "Other");
  });
});

describe("aggregating landing pages into page types", () => {
  const pages = [
    segment("/products/a", 5000, 100),
    segment("/products/b", 1000, 5),
    segment("/collections/mugs", 2000, 40),
    segment("/", 3000, 90),
  ];

  it("recomputes the rate from summed totals rather than averaging rates", () => {
    // Averaging the two PDP rates (2% and 0.5%) gives 1.25%. The truthful number is
    // 105/6000 = 1.75%, because the 5,000-session page is not the equal of the 1,000-session one.
    const byType = aggregateByPageType(pages);
    const pdp = byType.find((r) => r.label === "Product (PDP)");
    assert.equal(pdp?.sessions, 6000);
    assert.equal(pdp?.transactions, 105);
    assert.equal(pdp?.conversionRate, 1.75);
  });

  it("orders by traffic, so the page type that matters most reads first", () => {
    assert.deepEqual(
      aggregateByPageType(pages).map((r) => r.label),
      ["Product (PDP)", "Home", "Collection (PLP)"],
    );
  });

  it("returns nothing for no rows rather than a zero row", () => {
    assert.deepEqual(aggregateByPageType([]), []);
  });
});

describe("funnel arithmetic", () => {
  const funnel: CroFunnelStep[] = [
    { event: "view_item", label: "viewed a product", sessions: 10000, count: 42000 },
    { event: "add_to_cart", label: "added to cart", sessions: 2000, count: 5200 },
    { event: "begin_checkout", label: "began checkout", sessions: 1200, count: 1400 },
    { event: "purchase", label: "purchased", sessions: 900, count: 910 },
  ];

  it("computes each step-to-step loss from sessions", () => {
    const drops = funnelDrops(funnel);
    assert.equal(drops.length, 3);
    assert.deepEqual(drops[0], { from: "viewed a product", to: "added to cart", lost: 8000, dropRate: 80 });
    assert.deepEqual(drops[2], { from: "began checkout", to: "purchased", lost: 300, dropRate: 25 });
  });

  it("finds the largest proportional loss, not the largest absolute one", () => {
    // 8,000 sessions is the bigger number; the audit's question is which step loses the largest
    // share of those who reached it, and here that happens to be the same step.
    assert.equal(worstFunnelDrop(funnel)?.from, "viewed a product");
  });

  it("never reports a negative drop when a later step recorded more sessions", () => {
    // GA4's event-scoped session counts are not guaranteed nested — a session can record
    // add_to_cart with no view_item. A negative "loss" on a slide is indefensible.
    const odd: CroFunnelStep[] = [
      { event: "view_item", label: "viewed a product", sessions: 100, count: 100 },
      { event: "add_to_cart", label: "added to cart", sessions: 140, count: 140 },
    ];
    assert.deepEqual(funnelDrops(odd), [{ from: "viewed a product", to: "added to cart", lost: 0, dropRate: 0 }]);
  });

  it("has nothing to say about an untracked funnel", () => {
    assert.deepEqual(funnelDrops([]), []);
    assert.equal(worstFunnelDrop([]), null);
  });
});

describe("product performance", () => {
  const items: CroItemRow[] = [
    { name: "Popular mug", viewed: 9000, addedToCart: 900, purchased: 450, revenue: 9000, viewToPurchaseRate: 5 },
    { name: "Looked at, never bought", viewed: 4000, addedToCart: 60, purchased: 8, revenue: 200, viewToPurchaseRate: 0.2 },
    { name: "Barely seen", viewed: 40, addedToCart: 0, purchased: 0, revenue: 0, viewToPurchaseRate: 0 },
    { name: "Steady", viewed: 1200, addedToCart: 200, purchased: 90, revenue: 3600, viewToPurchaseRate: 7.5 },
    { name: "Quiet", viewed: 800, addedToCart: 40, purchased: 12, revenue: 480, viewToPurchaseRate: 1.5 },
  ];

  it("ranks best sellers by revenue", () => {
    assert.deepEqual(
      topItems(items, 2).map((i) => i.name),
      ["Popular mug", "Steady"],
    );
  });

  it("ignores products with too little traffic to judge", () => {
    // A product with 40 views and no sales is the expected outcome of 40 views, not a broken page.
    const weak = underperformingItems(items);
    assert.ok(!weak.some((i) => i.name === "Barely seen"));
    assert.ok(weak.every((i) => i.viewed >= MIN_ITEM_VIEWS));
  });

  it("surfaces the page that gets traffic and does not convert", () => {
    assert.equal(underperformingItems(items, 1)[0].name, "Looked at, never bought");
  });

  it("declines to rank at all when there are too few comparable products", () => {
    // Two eligible products is a comparison of two products, not a distribution.
    assert.deepEqual(underperformingItems(items.slice(0, 2)), []);
  });
});

describe("benchmark segment", () => {
  it("picks the best-converting segment with enough purchases behind it", () => {
    const segments = [segment("desktop", 5000, 150), segment("mobile", 12000, 120), segment("tablet", 200, 30)];
    // Tablet converts best of the three at 15%, and is thrown out for having only 200 sessions
    // behind it — a rate off that little traffic is not something to hold another segment to.
    assert.equal(benchmarkSegment(segments)?.label, "desktop");
  });

  it("refuses to benchmark against a segment with almost no purchases", () => {
    const segments = [segment("desktop", 5000, 3), segment("mobile", 12000, 2)];
    assert.equal(benchmarkSegment(segments), null);
  });

  it("has no benchmark when there is only one comparable segment", () => {
    assert.equal(benchmarkSegment([segment("mobile", 12000, 120)]), null);
  });
});

/* ── The evidence catalogue ──────────────────────────────────────────────────────────────────── */

const DATASET: CroConversionDataset = {
  propertyId: "123456789",
  currencyCode: "USD",
  startDate: "2026-07-24",
  endDate: "2026-08-20",
  daysWithSessions: 28,
  totals: {
    sessions: 20000,
    transactions: 300,
    revenue: 15000,
    totalUsers: 16000,
    conversionRate: 1.5,
    averageOrderValue: 50,
  },
  engagement: { engagementRate: 62.4, averageSessionDuration: 91 },
  byDevice: [segment("mobile", 14000, 120), segment("desktop", 6000, 180)],
  byChannel: [segment("Organic Search", 12000, 200), segment("Paid Search", 8000, 100)],
  byLandingPage: [segment("/products/a", 9000, 150), segment("/collections/mugs", 6000, 90)],
  byNewReturning: [segment("new", 15000, 150), segment("returning", 5000, 150)],
  funnel: [
    { event: "view_item", label: "viewed a product", sessions: 10000, count: 42000 },
    { event: "add_to_cart", label: "added to cart", sessions: 2000, count: 5200 },
  ],
  items: [{ name: "Popular mug", viewed: 9000, addedToCart: 900, purchased: 450, revenue: 9000, viewToPurchaseRate: 5 }],
};

describe("the citable catalogue", () => {
  const evidence = buildCroAnalyticsEvidence(DATASET);
  const byId = new Map(evidence.map((e) => [e.id, e]));

  it("gives every fact a unique id, since a bullet cites by id", () => {
    assert.equal(byId.size, evidence.length);
  });

  it("states the device gap as a computed number rather than leaving it to be inferred", () => {
    // The one number a mobile-conversion bullet will want. Computed here, so it is checkable.
    const gap = evidence.find((e) => e.id === "ga4-gap-mobile");
    assert.ok(gap, `no mobile gap in: ${[...byId.keys()].join(", ")}`);
    // desktop 3% - mobile 0.86% = 2.14pp
    assert.equal(gap.value, 2.14);
    assert.match(gap.label, /percentage points below desktop/);
  });

  it("omits a segment too small to be evidence of anything", () => {
    const small: CroConversionDataset = { ...DATASET, byChannel: [segment("Email", 40, 0)] };
    const ids = buildCroAnalyticsEvidence(small).map((e) => e.id);
    assert.ok(!ids.some((id) => id.startsWith("ga4-channel-email")));
  });

  it("expresses the engagement rate as a percentage, not GA4's ratio", () => {
    assert.match(String(byId.get("ga4-engagement")?.label), /62\.4%/);
  });

  it("carries the funnel and its drops", () => {
    assert.ok(byId.has("ga4-funnel-view-item"));
    assert.match(String(byId.get("ga4-drop-viewed-a-product")?.label), /80%/);
  });

  it("names where every fact came from, so a reader can go and check it", () => {
    assert.ok(evidence.every((e) => e.source.includes("123456789")));
  });
});

describe("the segment table", () => {
  it("shows every segment large enough to mean something, labelled by dimension", () => {
    const slide = buildSegmentTableSlide(DATASET);
    assert.ok(slide.table);
    assert.deepEqual(slide.table.columns, ["Segment", "Sessions", "Transactions", "Conversion rate", "Revenue"]);
    assert.ok(slide.table.rows.some((r) => r.label === "Device: mobile"));
    assert.ok(slide.table.rows.some((r) => r.label === "Visitor: returning"));
    assert.ok(slide.table.rows.some((r) => r.label === "Landing page type: Product (PDP)"));
  });

  it("says on the slide why small segments are absent", () => {
    // Otherwise a client asks where Email went and the honest answer is not on the page.
    assert.match(String(buildSegmentTableSlide(DATASET).table?.caption), /sessions are omitted/);
  });

  it("carries no bullets — it is a table, and is not treated as a thin slide", () => {
    assert.deepEqual(buildSegmentTableSlide(DATASET).bullets, []);
  });
});
