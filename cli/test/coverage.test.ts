// The coverage tracker is the thing that stops a report from saying more than it measured, so the
// cases worth testing are the ones where a gap could be laundered into a result: an analyzer that
// threw, one that returned null, and one that never finished.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { createCoverageTracker } from "../src/report/coverage.js";

const root = new URL("../../", import.meta.url);
const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, root)), "utf-8");

describe("coverage tracker", () => {
  it("records a completed analyzer as ran, with its own start and finish", async () => {
    const track = createCoverageTracker();
    const value = await track.run("health", async () => ({ score: 90 }));

    assert.deepEqual(value, { score: 90 });
    const entry = track.coverage.health!;
    assert.equal(entry.status, "ran");
    assert.ok(entry.startedAt && entry.finishedAt, "both ends of the analyzer's own work are recorded");
    assert.ok(Date.parse(entry.finishedAt!) >= Date.parse(entry.startedAt!));
  });

  it("records a thrown analyzer as failed, keeping the reason", async () => {
    const track = createCoverageTracker();
    const value = await track.run("performance", async () => {
      throw new Error("Lighthouse did not return a result for the homepage (mobile)");
    });

    assert.equal(value, undefined, "the caller sees the same absence it saw before");
    assert.equal(track.coverage.performance?.status, "failed");
    assert.match(track.coverage.performance?.reason ?? "", /homepage/);
  });

  // The conflation this whole model exists to end: most analyzers swallow their own errors and
  // return null, which used to be indistinguishable from a section with nothing to report.
  it("records a null result as failed, not as a clean run", async () => {
    const track = createCoverageTracker();
    const value = await track.run("geoSeo", async () => null);

    assert.equal(value, undefined);
    assert.equal(track.coverage.geoSeo?.status, "failed");
    assert.match(track.coverage.geoSeo?.reason ?? "", /no result/);
  });

  it("gives up on an analyzer that never finishes, rather than hanging the run", async () => {
    const track = createCoverageTracker();
    const value = await track.run("consent", () => new Promise(() => {}), { timeoutMs: 20 });

    assert.equal(value, undefined);
    assert.equal(track.coverage.consent?.status, "failed");
    assert.match(track.coverage.consent?.reason ?? "", /budget/);
  });

  it("keeps skipped and not-applicable apart", () => {
    const track = createCoverageTracker();
    track.skipped("ux", "--skip-ux was passed.");
    track.notApplicable("analytics", "This store has no GA4 property linked.");

    assert.equal(track.coverage.ux?.status, "skipped");
    assert.equal(track.coverage.analytics?.status, "not-applicable");
  });

  it("will not annotate a truncation onto a section that never ran", () => {
    const track = createCoverageTracker();
    track.skipped("performance", "--skip-performance was passed.");
    track.truncated("performance", { kept: 15, found: 63, what: "failing audits" });

    assert.equal(track.coverage.performance?.status, "skipped");
    assert.equal(track.coverage.performance?.truncated, undefined, "a cap on output nothing produced is nonsense");
  });
});

// The type is Partial<Record<SectionKey, …>> so that reports written before coverage existed still
// typecheck, which means the type cannot enforce that a *new* run records every section. This is
// that guarantee, in the same cheap regex style as mirror-drift.test.ts: a section added to
// ReportSections and never recorded in generate.ts is a silent hole in the record.
describe("every report section has a coverage verdict", () => {
  it("names each ReportSections key in generate.ts", () => {
    const types = read("shared/src/types.ts");
    const block = types.match(/export interface ReportSections \{([\s\S]*?)\n\}/);
    assert.ok(block, "found the ReportSections interface");

    const keys = [...block[1].matchAll(/^\s{2}([A-Za-z0-9_]+)\??:/gm)].map((m) => m[1]);
    assert.ok(keys.length > 15, `expected the full section list, got ${keys.length}`);

    const generate = read("cli/src/report/generate.ts");
    // Either the tracker was called with the key by name, or the key was assigned onto the record
    // directly (the two derived sections, which have no analyzer to wrap).
    const missing = keys.filter(
      (key) => !new RegExp(`track\\.(?:run|skipped|notApplicable)\\("${key}"|track\\.coverage\\.${key}\\b`).test(generate),
    );

    assert.deepEqual(missing, [], `sections with no coverage verdict in generate.ts: ${missing.join(", ")}`);
  });
});
