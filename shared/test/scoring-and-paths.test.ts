import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CONSENT_INDEX_BLOB_PATH,
  MANIFEST_BLOB_PATH,
  RUNS_INDEX_BLOB_PATH,
  STORES_INDEX_BLOB_PATH,
  consentFleetBlobPath,
  consentScreenshotBlobPath,
  consentSiteBlobPath,
  reportBlobPath,
  runRecordBlobPath,
  storeConfigBlobPath,
} from "../src/blob-paths.js";
import { average, colorForScore, gradeForScore } from "../src/scoring.js";

describe("gradeForScore", () => {
  it("uses the documented cutoffs, inclusive at the boundary", () => {
    assert.deepEqual([100, 90, 89, 80, 79, 70, 69, 50, 49, 0].map(gradeForScore), [
      "A", "A", "B", "B", "C", "C", "D", "D", "F", "F",
    ]);
  });
});

describe("colorForScore", () => {
  it("changes colour at exactly the same cutoffs the letter grade does", () => {
    // A score whose colour and letter disagree is worse than either alone — the reader trusts
    // the colour and quotes the letter.
    let previous = colorForScore(0);
    for (let score = 1; score <= 100; score++) {
      const colour = colorForScore(score);
      if (colour === previous) continue;
      assert.notEqual(gradeForScore(score), gradeForScore(score - 1), `colour changed at ${score} but the grade did not`);
      previous = colour;
    }
  });

  it("never returns blue, which means medium severity elsewhere in the UI", () => {
    const blues = ["#2563EB", "#3B82F6", "#1D4ED8"];
    for (let score = 0; score <= 100; score++) {
      assert.equal(blues.includes(colorForScore(score)), false);
    }
  });
});

describe("average", () => {
  it("rounds to a whole number", () => {
    assert.equal(average([1, 2]), 2);
    assert.equal(average([90, 80, 70]), 80);
  });

  it("drops non-finite entries rather than poisoning the mean with NaN", () => {
    assert.equal(average([80, Number.NaN, 100]), 90);
    assert.equal(average([80, Number.POSITIVE_INFINITY]), 80);
  });

  it("returns 0 for an empty list instead of NaN", () => {
    assert.equal(average([]), 0);
    assert.equal(average([Number.NaN]), 0);
  });
});

describe("blob paths", () => {
  it("keeps each namespace distinct, so no listing ever picks up another's objects", () => {
    const prefixes = [
      MANIFEST_BLOB_PATH,
      STORES_INDEX_BLOB_PATH,
      RUNS_INDEX_BLOB_PATH,
      CONSENT_INDEX_BLOB_PATH,
      reportBlobPath("acme", "r1"),
      storeConfigBlobPath("acme"),
      runRecordBlobPath("run1"),
      consentFleetBlobPath("scan1"),
      consentSiteBlobPath("scan1", "acme"),
      consentScreenshotBlobPath("acme", "scan1", "reject"),
    ];
    assert.equal(new Set(prefixes).size, prefixes.length);
  });

  it("keeps a fleet consent scan out of the per-store report manifest's prefix", () => {
    // A fleet scan spans every store rather than belonging to one; if it landed under reports/ it
    // would show up in every store's report list.
    assert.ok(consentFleetBlobPath("scan1").startsWith("consent/"));
    assert.ok(!consentFleetBlobPath("scan1").startsWith("reports/"));
  });

  it("puts consent evidence under screenshots/, the one prefix the web proxy will serve", () => {
    // The blob proxy is hard-scoped to screenshots/ so it can never read arbitrary blobs.
    assert.ok(consentScreenshotBlobPath("acme", "scan1", "reject").startsWith("screenshots/"));
  });

  it("builds the exact paths the readers on the other side expect", () => {
    assert.equal(reportBlobPath("acme", "r1"), "reports/acme/r1.json");
    assert.equal(storeConfigBlobPath("acme"), "stores/acme/config.json");
    assert.equal(runRecordBlobPath("run1"), "runs/run1.json");
    assert.equal(consentSiteBlobPath("scan1", "acme"), "consent/scan1/acme.json");
    assert.equal(consentScreenshotBlobPath("acme", "scan1", "reject"), "screenshots/consent/acme/scan1/reject.jpg");
  });
});
