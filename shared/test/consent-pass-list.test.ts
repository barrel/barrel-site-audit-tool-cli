// The Privacy Compliance report's "what's working" list.
//
// This is the half of the report a client reads to find out what the site already gets right, so
// the assertions that matter are about what it must never claim: a pass it did not observe, a
// "tag correctly held back" for a tag that isn't installed at all, or a pass ratio padded by
// checks that never ran.
//
// The last describe block runs the app's copy (web/lib/consent-pass-list.ts) over the same
// sections as the original. They are separate files because web/ deploys standalone and cannot
// import this package; a test comparing their source text would pass on two files that behaved
// differently.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ConsentSection, ConsentStateId, ConsentSuiteId, ConsentTestResult, ConsentTestStatus } from "../src/types.js";
import { buildConsentPassList } from "../src/consent-pass-list.js";
import { buildConsentPassList as webBuildConsentPassList } from "../../web/lib/consent-pass-list.js";

const ALL_STATES: ConsentStateId[] = ["clean", "dismiss", "reject", "accept", "granular", "returning"];

function test(
  id: string,
  suite: ConsentSuiteId,
  status: ConsentTestStatus,
  detail = `${id} detail`,
): ConsentTestResult {
  return { id, suite, title: `${id} title`, severity: "error", status, detail };
}

function section(over: Partial<ConsentSection> = {}): ConsentSection {
  return {
    score: 80,
    cmp: "osano",
    cmpDetail: "Osano",
    region: "us",
    states: ALL_STATES.map((state) => ({ state, reached: true, cookies: [], trackers: [], requestCount: 0 })),
    trackers: [],
    tests: [],
    totals: { pass: 0, fail: 0, blocked: 0, skipped: 0, flaky: 0, blockers: 0 },
    ...over,
  };
}

describe("buildConsentPassList", () => {
  it("lists only passing checks, grouped in suite order under client-facing headings", () => {
    const list = buildConsentPassList(
      section({
        tests: [
          test("C1", "C", "pass", "No marketing tag transmitted anything after the visitor rejected."),
          test("A1", "A", "pass", "Osano loaded and is responding to its JS API."),
          test("A2", "A", "fail"),
        ],
      }),
    );

    assert.deepEqual(
      list.groups.map((g) => g.suite),
      ["A", "C"],
      "groups must follow the suite order the detailed list uses, not the order tests happen to arrive in",
    );
    assert.deepEqual(
      list.groups.flatMap((g) => g.passes.map((p) => p.id)),
      ["A1", "C1"],
    );
    // The heading a client reads must not be the suite letter — the letters are for the runbook.
    assert.ok(list.groups.every((g) => g.title.length > 0 && !/^[A-H]$/.test(g.title)));
    assert.ok(list.groups.every((g) => g.meaning.length > 0));
    assert.equal(list.groups[0].passes[0].statement, "Osano loaded and is responding to its JS API.");
  });

  it("counts the ratio against checks that reached a verdict, not against every check", () => {
    // A site where most checks were blocked must not read as "3 of 3 passed". The denominator is
    // what we could actually test, which is the same distinction the blocked-vs-fail split exists
    // for everywhere else in this scanner.
    const list = buildConsentPassList(
      section({
        tests: [
          test("A1", "A", "pass"),
          test("A2", "A", "pass"),
          test("B1", "B", "fail"),
          test("B2", "B", "flaky"),
          test("C1", "C", "blocked"),
          test("C2", "C", "skipped"),
        ],
      }),
    );

    assert.equal(list.passed, 2);
    assert.equal(list.verdicts, 4);
  });

  it("omits a suite with nothing to show rather than printing an empty heading", () => {
    const list = buildConsentPassList(section({ tests: [test("A1", "A", "fail"), test("B1", "B", "pass")] }));
    assert.deepEqual(
      list.groups.map((g) => g.suite),
      ["B"],
    );
  });

  it("has nothing to say about a site where nothing passed", () => {
    const list = buildConsentPassList(section({ tests: [test("A1", "A", "fail"), test("B1", "B", "blocked")] }));
    assert.deepEqual(list.groups, []);
    assert.equal(list.passed, 0);
    assert.deepEqual(list.heldBack, []);
  });

  describe("tags credited as held back", () => {
    const trackers = [
      { id: "meta", name: "Meta Pixel", category: "marketing" as const, firedIn: ["accept", "returning"] as ConsentStateId[] },
      { id: "tiktok", name: "TikTok Pixel", category: "marketing" as const, firedIn: ["clean", "accept"] as ConsentStateId[] },
      { id: "ga4", name: "GA4", category: "analytics" as const, firedIn: ["accept"] as ConsentStateId[] },
      { id: "shopify", name: "Shopify", category: "essential" as const, firedIn: ["accept"] as ConsentStateId[] },
      { id: "klaviyo", name: "Klaviyo", category: "marketing" as const, firedIn: [] as ConsentStateId[] },
    ];

    it("credits a tag that fired on accept and stayed silent on reject and before the choice", () => {
      const list = buildConsentPassList(section({ trackers }));
      assert.deepEqual(list.heldBack, ["Meta Pixel", "GA4"]);
    });

    it("never credits a tag that also fired before the visitor chose", () => {
      // TikTok fired on a clean load. Whatever it does after a rejection, it is not being gated.
      const list = buildConsentPassList(section({ trackers }));
      assert.ok(!list.heldBack.includes("TikTok Pixel"));
    });

    it("never credits a tag that never fired anywhere", () => {
      // Klaviyo firing in no state means it is not installed, which is not a compliance win.
      const list = buildConsentPassList(section({ trackers }));
      assert.ok(!list.heldBack.includes("Klaviyo"));
    });

    it("stays silent when either state was never driven", () => {
      // The claim is a comparison between two states. Without both, there is no comparison — and
      // asserting one anyway would be the report inventing a pass out of missing coverage.
      for (const missing of ["reject", "accept"] as ConsentStateId[]) {
        const states = ALL_STATES.map((state) => ({
          state,
          reached: state !== missing,
          blockedReason: state === missing ? "The banner never appeared." : undefined,
          cookies: [],
          trackers: [],
          requestCount: 0,
        }));
        assert.deepEqual(buildConsentPassList(section({ trackers, states })).heldBack, [], `with ${missing} unreached`);
      }
    });
  });
});

describe("web/lib/consent-pass-list.ts behaves identically to shared/src/consent-pass-list.ts", () => {
  const corpus: ConsentSection[] = [
    section({ tests: [] }),
    section({
      tests: [
        test("A1", "A", "pass", "Osano loaded and is responding to its JS API."),
        test("A3", "A", "pass", "Reject is 88% the size of Accept."),
        test("B1", "B", "fail"),
        test("C1", "C", "pass", "No marketing tag transmitted anything after the visitor rejected."),
        test("E1", "E", "blocked"),
        test("G3", "G", "skipped"),
        test("H1", "H", "pass", "Closing the banner without choosing did not release any marketing tag."),
      ],
      trackers: [
        { id: "meta", name: "Meta Pixel", category: "marketing", firedIn: ["accept"] },
        { id: "tiktok", name: "TikTok Pixel", category: "marketing", firedIn: ["clean", "accept", "reject"] },
      ],
    }),
    section({
      tests: [test("A1", "A", "fail"), test("A2", "A", "blocked")],
      states: ALL_STATES.map((state) => ({
        state,
        reached: false,
        blockedReason: "The banner never appeared.",
        cookies: [],
        trackers: [],
        requestCount: 0,
      })),
    }),
  ];

  it("produces the same list for every section", () => {
    for (const [i, s] of corpus.entries()) {
      assert.deepEqual(webBuildConsentPassList(s), buildConsentPassList(s), `corpus[${i}]`);
    }
  });
});
