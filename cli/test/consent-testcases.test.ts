import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ConsentTestResult, ConsentTestStatus } from "@barrel/site-audit-shared";
import { runTests, SUITE_NAMES, TEST_DEFS } from "../src/analyzers/consent/testcases.js";
import {
  ALL_STATES,
  context,
  cookie,
  engineResult,
  gpcProbe,
  reachedState,
  unreachedState,
} from "./helpers/consent-fixtures.js";

const META_BEACON = "https://www.facebook.com/tr?id=99&ev=PageView";

function run(id: string, ctx = context()): ConsentTestResult {
  const result = runTests(ctx).find((t) => t.id === id);
  assert.ok(result, `no test ${id}`);
  return result;
}

/** Every test the report can ever produce, when the scan never got past the front door. */
function statusesWithNothingReached(over: Parameters<typeof engineResult>[0] = {}): Map<string, ConsentTestStatus> {
  const ctx = context({
    engine: engineResult({
      states: ALL_STATES.map((s) => unreachedState(s)),
      gpc: gpcProbe({ ran: false }),
      ...over,
    }),
  });
  return new Map(runTests(ctx).map((t) => [t.id, t.status]));
}

describe("the blocked/fail boundary", () => {
  it("reports a state that was never reached as blocked, carrying the reason", () => {
    const ctx = context({
      engine: engineResult({ states: [unreachedState("reject", "Cookiebot banner did not appear within 12s.")] }),
    });
    const c1 = run("C1", ctx);
    assert.equal(c1.status, "blocked");
    assert.match(c1.detail, /did not appear within 12s/);
  });

  it("reports a state that was never captured at all as blocked", () => {
    const c1 = run("C1", context({ engine: engineResult({ states: [] }) }));
    assert.equal(c1.status, "blocked");
    assert.match(c1.detail, /never captured/);
  });

  it("turns an unreached state into skipped when the CMP runs an opt-out model", () => {
    // Not testable, rather than untested: there is no accept/reject flow to drive.
    const ctx = context({
      engine: engineResult({
        states: [unreachedState("reject")],
        optOutModel: true,
        optOutReason: "Cookiebot granted every category with no prompt.",
      }),
    });
    const c1 = run("C1", ctx);
    assert.equal(c1.status, "skipped");
    assert.match(c1.detail, /granted every category/);
  });

  it("does not infer an opt-out model from a missing banner alone", () => {
    // "The banner is broken" produces exactly the same silence and must keep reading as a
    // coverage gap, so only the engine's positive finding may downgrade blocked to skipped.
    const ctx = context({ engine: engineResult({ states: [unreachedState("reject")], optOutModel: false }) });
    assert.equal(run("C1", ctx).status, "blocked");
  });

  it("never reports a fail for a state-dependent assertion when nothing was reached", () => {
    const statuses = statusesWithNothingReached();
    // G1 and G3 read the clean capture directly instead of going through requireState, so they
    // assert "no privacy policy link was found on the page" about a page that never loaded. That
    // is a real defect, pinned here rather than hidden: if it is fixed, this list must shrink and
    // this test will say so.
    const KNOWN_UNGUARDED = new Set(["G1", "G3"]);
    const failing = [...statuses].filter(([, s]) => s === "fail").map(([id]) => id);
    assert.deepEqual(
      new Set(failing),
      KNOWN_UNGUARDED,
      "a state-dependent assertion failed on a site that was never reached",
    );
  });

  it("never reports a fail when the opt-out model applies and nothing was reached", () => {
    const statuses = statusesWithNothingReached({ optOutModel: true, optOutReason: "No choice is offered here." });
    const failing = [...statuses].filter(([, s]) => s === "fail").map(([id]) => id);
    assert.deepEqual(new Set(failing), new Set(["G1", "G3"]));
    assert.equal(statuses.get("C1"), "skipped");
    assert.equal(statuses.get("F2"), "skipped");
    assert.equal(statuses.get("B1"), "skipped");
  });
});

describe("C1 — no marketing data transmitted after reject", () => {
  it("passes when the reject state saw no marketing transmission", () => {
    const ctx = context({ engine: engineResult({ states: [reachedState("reject")] }) });
    assert.equal(run("C1", ctx).status, "pass");
  });

  it("fails and quotes the request when a marketing tag transmitted anyway", () => {
    const ctx = context({
      engine: engineResult({
        states: [reachedState("reject", { transmissionsPost: ["meta"], requestsPost: [META_BEACON] })],
      }),
    });
    const c1 = run("C1", ctx);
    assert.equal(c1.status, "fail");
    assert.equal(c1.severity, "blocker");
    assert.match(c1.detail, /Meta Pixel/);
    assert.deepEqual(c1.evidence?.requests, ["www.facebook.com/tr (id=99, ev=PageView)"]);
  });

  it("ignores an analytics transmission — this assertion is about marketing only", () => {
    const ctx = context({
      engine: engineResult({ states: [reachedState("reject", { transmissionsPost: ["ga4"] })] }),
    });
    assert.equal(run("C1", ctx).status, "pass");
  });

  it("quotes only the requests belonging to the vendor it named", () => {
    const ctx = context({
      engine: engineResult({
        states: [
          reachedState("reject", {
            transmissionsPost: ["meta"],
            requestsPost: [META_BEACON, "https://www.google-analytics.com/g/collect?tid=G-1"],
          }),
        ],
      }),
    });
    assert.deepEqual(run("C1", ctx).evidence?.requests, ["www.facebook.com/tr (id=99, ev=PageView)"]);
  });
});

describe("B1 — no marketing cookies before any interaction", () => {
  it("separates Shopify's own cookies from a third party's, because the remedy differs", () => {
    const ctx = context({
      engine: engineResult({
        states: [reachedState("clean", { cookies: [cookie("_fbp"), cookie("_shopify_marketing_1")] })],
      }),
    });
    const b1 = run("B1", ctx);
    assert.equal(b1.status, "fail");
    assert.match(b1.detail, /1 third-party marketing cookie\(s\).*_fbp/);
    assert.match(b1.detail, /Shopify also set _shopify_marketing_1/);
    assert.match(b1.recommendation ?? "", /Customer Privacy API/);
  });

  it("prescribes only the applicable fix when Shopify set all of them", () => {
    const ctx = context({
      engine: engineResult({ states: [reachedState("clean", { cookies: [cookie("_shopify_marketing_1")] })] }),
    });
    const b1 = run("B1", ctx);
    assert.equal(b1.status, "fail");
    assert.match(b1.recommendation ?? "", /nothing to block/);
  });

  it("disambiguates a cookie name that appears on more than one host", () => {
    const ctx = context({
      engine: engineResult({
        states: [
          reachedState("clean", {
            cookies: [cookie("MUID", { domain: ".bing.com" }), cookie("MUID", { domain: ".clarity.ms" })],
          }),
        ],
      }),
    });
    assert.match(run("B1", ctx).detail, /MUID \(\.bing\.com\), MUID \(\.clarity\.ms\)/);
  });

  it("honours a signed-off exception from sites.yml as skipped, not passed", () => {
    // `pass` would claim the site is clean; `skipped` says we were told not to ask.
    const ctx = context({
      expect: { preConsentMarketing: true },
      engine: engineResult({ states: [reachedState("clean", { cookies: [cookie("_fbp")] })] }),
    });
    for (const id of ["B1", "B2", "B5"]) assert.equal(run(id, ctx).status, "skipped", id);
  });
});

describe("F2 — analytics-only leaves marketing blocked", () => {
  it("passes when only analytics fired under a granular choice", () => {
    const ctx = context({
      engine: engineResult({ states: [reachedState("granular", { transmissionsPost: ["ga4"] })] }),
    });
    assert.equal(run("F2", ctx).status, "pass");
  });

  it("fails when a marketing tag fired under an analytics-only choice", () => {
    const ctx = context({
      engine: engineResult({
        states: [reachedState("granular", { transmissionsPost: ["meta", "ga4"], requestsPost: [META_BEACON] })],
      }),
    });
    const f2 = run("F2", ctx);
    assert.equal(f2.status, "fail");
    assert.match(f2.detail, /Meta Pixel/);
    assert.doesNotMatch(f2.detail, /Google Analytics/);
  });
});

describe("D1 — a CMP that blocks everything forever is also broken", () => {
  it("skips when the storefront has no gateable tags at all", () => {
    const ctx = context({ engine: engineResult({ states: [reachedState("accept")] }) });
    assert.equal(run("D1", ctx).status, "skipped");
  });

  it("fails when tags exist elsewhere in the run but none fired on accept", () => {
    const ctx = context({
      engine: engineResult({
        states: [reachedState("clean", { trackersPre: ["meta"] }), reachedState("accept")],
      }),
    });
    const d1 = run("D1", ctx);
    assert.equal(d1.status, "fail");
    assert.match(d1.recommendation ?? "", /silently destroying attribution/);
  });

  it("passes once a gated tag is released", () => {
    const ctx = context({
      engine: engineResult({
        states: [
          reachedState("clean", { trackersPre: ["meta"] }),
          reachedState("accept", { transmissionsPost: ["meta"] }),
        ],
      }),
    });
    assert.equal(run("D1", ctx).status, "pass");
  });
});

describe("B4 — Consent Mode v2 defaults", () => {
  it("fails when no default call was seen at all", () => {
    const ctx = context({ engine: engineResult({ states: [reachedState("clean")] }) });
    const b4 = run("B4", ctx);
    assert.equal(b4.status, "fail");
    assert.match(b4.detail, /No gtag\('consent','default'/);
  });

  it("names exactly the signals that were granted early", () => {
    const ctx = context({
      engine: engineResult({
        states: [
          reachedState("clean", {
            consentMode: { default: { ad_storage: "denied", analytics_storage: "granted", ad_user_data: "granted" } },
          }),
        ],
      }),
    });
    const b4 = run("B4", ctx);
    assert.equal(b4.status, "fail");
    assert.match(b4.detail, /grant analytics_storage, ad_user_data /);
  });

  it("passes when all four are denied", () => {
    const denied = Object.fromEntries(
      ["ad_storage", "analytics_storage", "ad_user_data", "ad_personalization"].map((k) => [k, "denied"]),
    );
    const ctx = context({
      engine: engineResult({ states: [reachedState("clean", { consentMode: { default: denied } })] }),
    });
    assert.equal(run("B4", ctx).status, "pass");
  });
});

describe("G4 — Global Privacy Control", () => {
  it("is blocked, not failed, when the probe never completed", () => {
    const ctx = context({ engine: engineResult({ gpc: gpcProbe({ ran: false }) }) });
    assert.equal(run("G4", ctx).status, "blocked");
  });

  it("fails when marketing fired for a visitor broadcasting GPC", () => {
    const ctx = context({ engine: engineResult({ gpc: gpcProbe({ marketingTrackers: ["meta"] }) }) });
    const g4 = run("G4", ctx);
    assert.equal(g4.status, "fail");
    assert.match(g4.detail, /Meta Pixel fired despite/);
  });
});

describe("runTests as a whole", () => {
  it("returns one result per definition, in definition order", () => {
    const results = runTests(context());
    assert.deepEqual(results.map((t) => t.id), TEST_DEFS.map((d) => d.id));
  });

  it("gives every test a unique id and a suite that has a name", () => {
    const ids = new Set<string>();
    for (const def of TEST_DEFS) {
      assert.equal(ids.has(def.id), false, `duplicate test id ${def.id}`);
      ids.add(def.id);
      assert.ok(SUITE_NAMES[def.suite], `suite ${def.suite} has no name`);
    }
  });

  it("converts a throwing assertion into blocked rather than letting it kill the scan", () => {
    // An assertion that throws is a bug in this tool, not a finding about the site — and one
    // broken check must not cost the other thirty their results.
    const exploding = { ...TEST_DEFS[0] };
    const original = TEST_DEFS[0];
    TEST_DEFS[0] = {
      ...exploding,
      run() {
        throw new Error("kaboom");
      },
    };
    try {
      const result = runTests(context()).find((t) => t.id === original.id);
      assert.equal(result?.status, "blocked");
      assert.match(result?.detail ?? "", /Check errored: kaboom/);
    } finally {
      TEST_DEFS[0] = original;
    }
  });

  it("always produces a detail — a status with no sentence beside it is unreadable", () => {
    for (const t of runTests(context())) {
      assert.ok(t.detail.trim().length > 0, `${t.id} has an empty detail`);
    }
  });

  it("attaches a recommendation to every failure", () => {
    const ctx = context({
      engine: engineResult({
        states: ALL_STATES.map((s) =>
          reachedState(s, { transmissionsPre: ["meta"], transmissionsPost: ["meta"], cookies: [cookie("_fbp")] }),
        ),
        gpc: gpcProbe({ marketingTrackers: ["meta"] }),
      }),
    });
    for (const t of runTests(ctx)) {
      if (t.status !== "fail") continue;
      assert.ok(t.recommendation, `${t.id} failed with no recommendation`);
    }
  });
});
