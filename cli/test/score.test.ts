// The headline score is the single number a client reads and the only one Baseline & Reporting
// trends, so what it is an average of is worth pinning down.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ReportSections } from "@barrel/site-audit-shared";
import { buildScoreBreakdown } from "../src/report/score.js";

const lighthouse = { score: 80, audits: [] };

function sections(over: Partial<ReportSections> = {}): ReportSections {
  return {
    health: { score: 90 } as ReportSections["health"],
    performance: {
      performance: lighthouse,
      accessibility: lighthouse,
      bestPractices: lighthouse,
      seo: lighthouse,
    } as unknown as ReportSections["performance"],
    ...over,
  };
}

describe("buildScoreBreakdown", () => {
  it("averages only the areas that produced a number, and names the ones that did not", () => {
    const breakdown = buildScoreBreakdown(sections());

    assert.deepEqual(
      breakdown.contributors.map((c) => c.id),
      ["lighthousePerformance", "lighthouseAccessibility", "lighthouseBestPractices", "lighthouseSeo", "health"],
    );
    // (80 × 4 + 90) / 5
    assert.equal(breakdown.score, 82);
    assert.ok(breakdown.missing.some((m) => m.id === "ux"), "an area that did not run is named, not merely absent");
    assert.ok(!breakdown.missing.some((m) => m.id === "health"));
  });

  it("counts the Lighthouse pass as four areas, not one", () => {
    const withoutLighthouse = buildScoreBreakdown(sections({ performance: undefined }));
    assert.equal(withoutLighthouse.contributors.length, 1);
    assert.equal(buildScoreBreakdown(sections()).contributors.length, 5);
  });

  // The behaviour change worth locking in: compliance scores are a weighted proportion of what
  // could be confirmed, not a percentage of a fixed total, so averaging them with Lighthouse's
  // 0-100s produced a number that was neither.
  it("leaves consent and security out of the average entirely", () => {
    const withCompliance = buildScoreBreakdown(
      sections({
        consent: { score: 20 } as ReportSections["consent"],
        security: { score: 20 } as ReportSections["security"],
      }),
    );

    assert.equal(withCompliance.score, buildScoreBreakdown(sections()).score, "compliance scores do not move it");
    assert.ok(!withCompliance.contributors.some((c) => c.section === "consent" || c.section === "security"));
    assert.ok(
      !withCompliance.missing.some((m) => m.section === "consent" || m.section === "security"),
      "nor are they listed as missing — they are not scored areas at all",
    );
  });

  it("scores nothing as 0 rather than throwing, and says everything is missing", () => {
    const empty = buildScoreBreakdown({});
    assert.equal(empty.score, 0);
    assert.equal(empty.contributors.length, 0);
    assert.ok(empty.missing.length > 10);
  });
});
