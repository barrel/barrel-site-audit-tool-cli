import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ConsentSeverity, ConsentStateCapture, ConsentTestResult, ConsentTestStatus } from "@barrel/site-audit-shared";
import { attachScreenshots, scoreOf } from "../src/analyzers/consent/index.js";
import { TEST_DEFS } from "../src/analyzers/consent/testcases.js";
import { engineResult } from "./helpers/consent-fixtures.js";

function result(status: ConsentTestStatus, severity: ConsentSeverity = "warning", id = "X1"): ConsentTestResult {
  return { id, suite: "A", title: id, severity, status, detail: "…" };
}

function many(n: number, status: ConsentTestStatus, severity: ConsentSeverity = "warning"): ConsentTestResult[] {
  return Array.from({ length: n }, (_, i) => result(status, severity, `X${i}`));
}

const engine = engineResult();

describe("scoreOf", () => {
  it("returns null below the confirmed-result threshold", () => {
    // A number computed from four results would be read as a verdict on the site rather than on
    // how little we managed to test.
    for (let n = 0; n < 5; n++) {
      assert.equal(scoreOf(many(n, "pass"), engine), null, `${n} confirmed results should not score`);
    }
    assert.equal(scoreOf(many(5, "pass"), engine), 100);
  });

  it("counts only pass and fail toward the threshold", () => {
    const mixed = [...many(4, "pass"), ...many(6, "blocked"), ...many(6, "skipped"), ...many(6, "flaky")];
    assert.equal(scoreOf(mixed, engine), null);
  });

  it("returns null when the site could not be loaded at all", () => {
    assert.equal(scoreOf(many(20, "pass"), engineResult({ fatalError: "net::ERR_NAME_NOT_RESOLVED" })), null);
  });

  it("excludes flaky and blocked from both sides of the ratio", () => {
    // Crediting an untested result as half-good put the one site we had entirely failed to test
    // at the top of a real fleet ranking, so neither side may see them.
    const base = [...many(5, "pass"), ...many(5, "fail")];
    const withUnknowns = [...base, ...many(10, "flaky"), ...many(10, "blocked"), ...many(10, "skipped")];
    assert.equal(scoreOf(base, engine), scoreOf(withUnknowns, engine));
    assert.equal(scoreOf(base, engine), 50);
  });

  it("weighs a blocker ten times a warning", () => {
    // One passing blocker (10) against ten failing warnings (10) is exactly half the weight.
    const tests = [result("pass", "blocker"), ...many(10, "fail")];
    assert.equal(scoreOf(tests, engine), 50);
  });

  it("is proportional to what actually applied, not to a fixed 100", () => {
    // A site showing no banner has most of the suite inapplicable; it must not be marked down for
    // questions that were never asked.
    const narrow = [...many(4, "pass"), result("fail", "warning", "X9")];
    assert.equal(scoreOf(narrow, engine), 80);
  });

  it("forces any confirmed blocker failure under 50, however good the rest is", () => {
    const nearlyPerfect = [...many(99, "pass"), result("fail", "blocker", "B1")];
    const score = scoreOf(nearlyPerfect, engine);
    assert.ok(score !== null && score < 50, `expected <50, got ${score}`);
  });

  it("still separates one blocker from four", () => {
    const one = [...many(20, "pass", "error"), result("fail", "blocker", "B1")];
    const four = [...many(20, "pass", "error"), ...many(4, "fail", "blocker")];
    const a = scoreOf(one, engine)!;
    const b = scoreOf(four, engine)!;
    assert.ok(a > b, `one blocker (${a}) should outscore four (${b})`);
    assert.ok(a < 50 && b < 50);
  });

  it("does not let a flaky blocker drag the score into the penalty band", () => {
    // "Inconsistent across two runs" is not a confirmed leak, and must not be scored as one.
    const flakyBlocker = [...many(9, "pass"), result("flaky", "blocker", "C1")];
    assert.equal(scoreOf(flakyBlocker, engine), 100);
  });

  it("returns a whole number in 0…100", () => {
    for (const tests of [many(5, "pass"), many(5, "fail"), [...many(3, "pass"), ...many(4, "fail")]]) {
      const score = scoreOf(tests, engine)!;
      assert.equal(Number.isInteger(score), true);
      assert.ok(score >= 0 && score <= 100);
    }
  });
});

describe("attachScreenshots", () => {
  const states: ConsentStateCapture[] = (["clean", "dismiss", "reject", "accept", "granular", "returning"] as const).map(
    (state) => ({ state, reached: true, cookies: [], trackers: [], requestCount: 0, screenshotPath: `shot-${state}.jpg` }),
  );

  function pathFor(id: string, status: ConsentTestStatus = "fail"): string | undefined {
    const def = TEST_DEFS.find((d) => d.id === id)!;
    const tests: ConsentTestResult[] = [
      { id: def.id, suite: def.suite, title: def.title, severity: def.severity, status, detail: "…" },
    ];
    attachScreenshots(tests, states);
    return tests[0].evidence?.screenshotPath;
  }

  it("points each suite's failures at the state its assertion read from", () => {
    assert.equal(pathFor("B1"), "shot-clean.jpg");
    assert.equal(pathFor("C1"), "shot-reject.jpg");
    assert.equal(pathFor("D1"), "shot-accept.jpg");
    assert.equal(pathFor("E1"), "shot-returning.jpg");
    assert.equal(pathFor("F2"), "shot-granular.jpg");
  });

  it("covers every suite a test can belong to", () => {
    // Suite H shipped without an entry and its blocker failures lost their evidence silently.
    for (const def of TEST_DEFS) {
      if (def.id === "G4") continue; // deliberately has none — see below
      assert.ok(pathFor(def.id), `${def.id} (suite ${def.suite}) got no screenshot`);
    }
  });

  it("honours the per-test overrides", () => {
    assert.equal(pathFor("G2"), "shot-accept.jpg");
    // G4's evidence is the GPC probe; a screenshot of an ordinary visit would be evidence of the
    // wrong thing.
    assert.equal(pathFor("G4"), undefined);
  });

  it("attaches nothing to a result that is not a failure", () => {
    for (const status of ["pass", "blocked", "skipped"] as const) {
      assert.equal(pathFor("C1", status), undefined, status);
    }
    assert.equal(pathFor("C1", "flaky"), "shot-reject.jpg");
  });
});
