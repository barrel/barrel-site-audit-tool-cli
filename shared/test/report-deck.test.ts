// The site-diagnostic deck view's composition rules.
//
// Lives under shared/test/ because that (with cli/test/) is where the harness looks; the code it
// exercises is web/lib/report-deck.ts, which is pure TypeScript with no React and no Next runtime
// — the same reason data-analysis.test.ts and mirror-drift.test.ts reach across into web/.
//
// What is worth asserting here is not the wording of a slide but the two things a deck can get
// wrong in front of a client: saying something the run never found, and quietly clipping half a
// slide because too much was packed onto it. Everything below is one of those two.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildReportDeck, deckMarkdown, reportScorecard } from "../../web/lib/report-deck.js";
import type { ClientRecommendation, Report } from "../../web/lib/shared.js";

function recommendation(overrides: Partial<ClientRecommendation> = {}): ClientRecommendation {
  return {
    title: "Cut the product page's load time",
    area: "Product page",
    why: "The product page is where the decision gets made, and it currently takes longer to become usable than a shopper will wait.",
    what: "Defer the review widget and the chat bubble until after the page is interactive.",
    expectedImpact: "Fewer abandoned product-page visits, most visibly on mobile.",
    evidence: ["Lighthouse performance 41/100 (mobile)"],
    effort: "quick win",
    ...overrides,
  };
}

/** The thinnest report that still renders: no AI sections, no Lighthouse, no analytics. Every
 * slide the deck can build is optional, and this is the shape that proves it. */
function bareReport(overrides: Partial<Report> = {}): Report {
  return {
    id: "2026-09-08-1200",
    storeSlug: "acme",
    storeName: "Acme Supply",
    storeUrl: "https://acme.example",
    createdAt: "2026-09-08T16:00:00.000Z",
    durationMs: 120_000,
    overallScore: 72,
    sections: {},
    ...overrides,
  };
}

const slideIds = (report: Report) => buildReportDeck(report).map((s) => s.id);

describe("what a deck is allowed to contain", () => {
  it("opens on a cover, the standing and the scorecard, even with nothing but a score", () => {
    assert.deepEqual(slideIds(bareReport()), ["cover", "standing", "scorecard"]);
  });

  it("says what the scorecard is when no summary or recommendation prose exists", () => {
    const [, standing] = buildReportDeck(bareReport());
    // Not left blank, and not filled with a claim about the storefront: the fallback states what
    // the reader is looking at and nothing else.
    assert.match(standing.intro ?? "", /scored Acme Supply 72 out of 100/);
  });

  it("prefers the recommendation headline over the executive summary for the standing", () => {
    const report = bareReport({
      sections: {
        summary: { overview: "Summary overview.", keyFindings: [] },
        recommendations: { headline: "Recommendation headline.", strengths: [], recommendations: [] },
      },
    });
    assert.equal(buildReportDeck(report)[1].intro, "Recommendation headline.");
  });

  it("drops the strengths slide rather than inventing a compliment", () => {
    // Nothing scored an A and no strengths were written, so there is nothing true to put on it.
    const report = bareReport({ sections: { health: { score: 61, checks: [] } } });
    assert.ok(!slideIds(report).includes("strengths"));
  });

  it("falls back to A-graded areas, stated as the score they earned", () => {
    const report = bareReport({ sections: { health: { score: 94, checks: [] } } });
    const strengths = buildReportDeck(report).find((s) => s.id === "strengths");
    assert.ok(strengths);
    assert.deepEqual(strengths.bullets, [
      { lead: "Site Health", text: "Scored 94 out of 100 — an A on this audit's scale." },
    ]);
  });

  it("uses the written strengths verbatim when the run produced them", () => {
    const report = bareReport({
      sections: {
        health: { score: 94, checks: [] },
        recommendations: { headline: "H", strengths: ["Checkout is fast on mobile."], recommendations: [] },
      },
    });
    const strengths = buildReportDeck(report).find((s) => s.id === "strengths");
    assert.deepEqual(strengths?.bullets, [{ text: "Checkout is fast on mobile." }]);
  });

  it("splits a long overview across pages at a sentence boundary, never mid-sentence", () => {
    // A 1,100-character overview is typical, and the slide clips in silence — so the split has to
    // happen here. Cutting mid-sentence would be the first thing a client noticed.
    const sentence = `${"The storefront converts at 1.4% on mobile and 3.2% on desktop. ".repeat(60)}`;
    const report = bareReport({ sections: { summary: { overview: sentence, keyFindings: [] } } });
    const pages = buildReportDeck(report).filter((s) => s.id.startsWith("standing"));
    assert.ok(pages.length >= 2);
    for (const page of pages) assert.match(page.intro ?? "", /\.$/, "a page ended mid-sentence");
    // Nothing may be lost on the way: the deck is the report's argument, not an abridgement.
    assert.equal(pages.map((p) => p.intro).join(" "), sentence.trim());
    assert.equal(pages[1].title, `The storefront today (2 of ${pages.length})`);
  });

  it("never scores an area the run did not measure", () => {
    const scores = reportScorecard(bareReport({ sections: { health: { score: 80, checks: [] } } }));
    assert.deepEqual(scores, [
      { label: "Overall Score", score: 72 },
      { label: "Site Health", score: 80 },
    ]);
  });

  it("leaves a null security score off the scorecard entirely", () => {
    // Null means too little was confirmed to rank. A gauge has nowhere to say that, and a zero
    // would read as "this site failed everything".
    const report = bareReport({
      sections: {
        security: {
          score: null,
          scannedUrl: "https://acme.example",
          checks: [],
          totals: { pass: 0, warn: 0, fail: 0, notTested: 12, critical: 0 },
          thirdPartyScriptOrigins: [],
        },
      },
    });
    assert.deepEqual(reportScorecard(report).map((s) => s.label), ["Overall Score"]);
  });
});

describe("pagination — the slide clips silently, so the code must not let it", () => {
  it("never puts more than five points on one page", () => {
    const report = bareReport({
      sections: {
        summary: { overview: "o", keyFindings: ["one", "two", "three", "four", "five", "six", "seven"] },
      },
    });
    const pages = buildReportDeck(report).filter((s) => s.id.startsWith("key-findings"));
    assert.deepEqual(pages.map((p) => p.bullets.length), [5, 2]);
  });

  it("splits earlier when the points are long, not only when there are five of them", () => {
    // Deliberately far past any plausible budget rather than tuned to the current one: the
    // assertion is that length paginates at all, not what the number happens to be today.
    const long = "x".repeat(500);
    const report = bareReport({
      sections: { summary: { overview: "o", keyFindings: [long, long, long, long, long, long] } },
    });
    const pages = buildReportDeck(report).filter((s) => s.id.startsWith("key-findings"));
    assert.ok(pages.every((p) => p.bullets.length < 5), "a page of four 300-char findings would overflow");
    assert.ok(pages.length >= 2);
  });

  it("marks a continuation as one, and does not repeat the intro on it", () => {
    const report = bareReport({
      sections: {
        recommendations: {
          headline: "H",
          strengths: [],
          recommendations: Array.from({ length: 7 }, (_, i) => recommendation({ title: `Action ${i + 1}` })),
        },
      },
    });
    const pages = buildReportDeck(report).filter((s) => s.id.startsWith("recommendations"));
    assert.ok(pages.length >= 2);
    assert.equal(pages[0].title, "What we recommend next");
    assert.ok(pages[0].intro);
    assert.equal(pages[1].title, `What we recommend next (2 of ${pages.length})`);
    assert.equal(pages[1].intro, undefined, "a continuation loses a third of its room to a repeated intro");
    // Ids have to stay distinct: they are React keys and the anchor a reader cites.
    assert.equal(new Set(pages.map((p) => p.id)).size, pages.length);
  });
});

describe("the recommendation slides", () => {
  const report = bareReport({
    sections: {
      recommendations: {
        headline: "H",
        strengths: [],
        recommendations: [
          recommendation({ title: "Quick one", effort: "quick win" }),
          recommendation({ title: "Bigger one", effort: "larger project" }),
        ],
      },
    },
  });

  it("leads with why the work matters, not with how it gets done", () => {
    const slide = buildReportDeck(report).find((s) => s.id === "recommendations");
    assert.equal(slide?.bullets[0].lead, "Quick one");
    assert.match(slide?.bullets[0].text ?? "", /where the decision gets made/);
    assert.equal(slide?.bullets[0].tag, "Product page · quick win");
  });

  it("describes the quick wins as the work itself", () => {
    const slide = buildReportDeck(report).find((s) => s.id === "quick-wins");
    assert.deepEqual(slide?.bullets.map((b) => b.lead), ["Quick one"]);
    assert.match(slide?.bullets[0].text ?? "", /Defer the review widget/);
  });

  it("splits the work by effort once there is more than one bucket", () => {
    const slide = buildReportDeck(report).find((s) => s.id === "sequencing");
    assert.deepEqual(slide?.table?.rows.map((r) => r.label), ["Quick wins (1)", "Larger projects (1)"]);
  });

  it("skips the sequencing slide when everything is one size", () => {
    const oneBucket = bareReport({
      sections: {
        recommendations: {
          headline: "H",
          strengths: [],
          recommendations: [recommendation(), recommendation({ title: "Another" })],
        },
      },
    });
    // A single bucket holding everything is not a sequence, and a table saying so adds nothing to
    // the recommendation list it would follow.
    assert.ok(!slideIds(oneBucket).includes("sequencing"));
  });
});

describe("the exposure slide", () => {
  function withConsent(status: "fail" | "pass", severity: "blocker" | "warning") {
    return bareReport({
      sections: {
        consent: {
          score: 40,
          cmp: "cookiebot",
          cmpDetail: "Cookiebot detected",
          region: "us",
          states: [],
          trackers: [],
          tests: [
            {
              id: "B1",
              suite: "B",
              title: "No marketing cookies before a choice",
              severity,
              status,
              detail: "Two marketing cookies were set before the banner was answered.",
            },
          ],
          totals: { pass: 0, fail: 1, blocked: 0, skipped: 0, flaky: 0, blockers: 1 },
        },
      },
    });
  }

  it("carries a failing blocker as the scan's own sentence, with no verdict-shaped lead", () => {
    // The test's title asserts the behaviour the site was supposed to have, so bolding it in front
    // of the failure ("No marketing cookies before a choice: two were set…") contradicts itself.
    const slide = buildReportDeck(withConsent("fail", "blocker")).find((s) => s.id === "exposure");
    assert.equal(slide?.bullets[0].lead, undefined);
    assert.equal(slide?.bullets[0].text, "Two marketing cookies were set before the banner was answered.");
    assert.equal(slide?.bullets[0].tag, "Consent");
  });

  it("says nothing at all when there is no exposure to report", () => {
    // The absence of a risk slide is the honest outcome; a slide reading "no blockers found" in a
    // deck about a site whose consent suites were mostly untestable would be a claim, not a fact.
    assert.ok(!slideIds(withConsent("pass", "blocker")).includes("exposure"));
    assert.ok(!slideIds(withConsent("fail", "warning")).includes("exposure"));
  });
});

describe("the clipboard form", () => {
  const report = bareReport({
    sections: {
      health: { score: 94, checks: [] },
      summary: { overview: "Overview sentence.", keyFindings: ["A finding."] },
      recommendations: { headline: "Headline.", strengths: ["Fast checkout."], recommendations: [recommendation()] },
    },
  });

  it("carries every slide as a heading, and the cover as the document title", () => {
    const md = deckMarkdown(report, buildReportDeck(report));
    assert.match(md, /^# Site Diagnostic — Acme Supply/);
    assert.match(md, /^## What's already working$/m);
    assert.match(md, /^- Fast checkout\.$/m);
    assert.match(md, /^- \[Product page · quick win\] \*\*Cut the product page's load time:\*\*/m);
    assert.match(md, /^- \*\*Overall Score:\*\* 72\/100 \(C\)$/m);
  });

  it("says the same things the slides do", () => {
    // The whole point of composing the markdown from the built slides rather than from the report
    // a second time: a slide built from the paste and a slide built from the page cannot disagree.
    const slides = buildReportDeck(report);
    const md = deckMarkdown(report, slides);
    for (const slide of slides) {
      for (const bullet of slide.bullets) assert.ok(md.includes(bullet.text), `missing: ${bullet.text}`);
      for (const row of slide.table?.rows ?? []) assert.ok(md.includes(row.label), `missing row: ${row.label}`);
    }
  });
});
