// Lighthouse's accessibility category is axe-core under another name, and both were collected, so
// one missing image alt could be counted five times: once by Lighthouse and once per journey page
// by axe. Every "N issues" a client reads is downstream of this.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dedupeFindings, type Finding } from "../../web/lib/findings.js";

function finding(over: Partial<Finding> & { id: string }): Finding {
  return { title: "Image elements do not have [alt] attributes", severity: "medium", description: "", ...over };
}

describe("dedupeFindings", () => {
  it("merges the same rule reported by Lighthouse and by axe", () => {
    const out = dedupeFindings([
      finding({ id: "a11y-image-alt", dedupeKey: "a11y:image-alt", sources: ["Lighthouse"], scope: "Homepage", severity: "medium" }),
      finding({ id: "axe-Home-image-alt-0", dedupeKey: "a11y:image-alt", sources: ["axe-core"], scope: "Home page", severity: "critical" }),
    ]);

    assert.equal(out.length, 1);
    assert.deepEqual(out[0].sources, ["Lighthouse", "axe-core"], "the merged finding says both found it");
    assert.equal(out[0].severity, "critical", "the worst severity reported wins");
  });

  it("collapses one rule failing on several pages into one finding naming them", () => {
    const out = dedupeFindings(
      ["Homepage", "Collection page", "Product page"].map((page, i) =>
        finding({ id: `axe-${page}-color-contrast-${i}`, dedupeKey: "a11y:color-contrast", sources: ["axe-core"], scope: page }),
      ),
    );

    assert.equal(out.length, 1);
    assert.equal(out[0].scope, "Homepage, Collection and Product pages");
  });

  it("keeps the description carrying the element counts", () => {
    const out = dedupeFindings([
      finding({ id: "a", dedupeKey: "a11y:label", description: "Form elements must have labels." }),
      finding({ id: "b", dedupeKey: "a11y:label", description: "Form elements must have labels — 14 element(s) affected: input#email." }),
    ]);

    assert.match(out[0].description, /14 element/);
  });

  it("leaves everything without a dedupe key alone", () => {
    const out = dedupeFindings([
      finding({ id: "perf-lcp", title: "LCP" }),
      finding({ id: "security-hsts", title: "HSTS" }),
      finding({ id: "code-a.liquid-3", title: "UnusedAssign" }),
    ]);

    assert.equal(out.length, 3, "only the known overlap participates");
  });

  it("preserves the order findings were collected in", () => {
    const out = dedupeFindings([
      finding({ id: "perf-lcp" }),
      finding({ id: "a11y-image-alt", dedupeKey: "a11y:image-alt" }),
      finding({ id: "security-hsts" }),
      finding({ id: "axe-Home-image-alt-0", dedupeKey: "a11y:image-alt" }),
    ]);

    assert.deepEqual(out.map((f) => f.id), ["perf-lcp", "a11y-image-alt", "security-hsts"]);
  });
});
