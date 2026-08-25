// The CRO deck's format and anti-fabrication rules.
//
// These are the assertions that decide what a client sees. Everything else about a CRO audit is
// gathering; this is the gate that says which of the model's sentences may appear on a slide, and
// the whole claim of the feature — that the output is presentable without being rewritten — rests
// on it.
//
// Three things are being tested, and the third matters as much as the first two:
//   1. The house format is actually enforced.
//   2. A figure the evidence does not support is caught.
//   3. The CLI's copy (shared/src/cro-slides.ts) and the app's copy (web/lib/cro-slides.ts) agree.
//      They are separate files because web/ deploys standalone and cannot import this package. A
//      test that compared their source text would pass on two files that behaved differently; this
//      one runs both over the same corpus.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  INSIGHT_CARD_LIMITS,
  MAX_BULLETS_PER_SLIDE,
  MAX_TITLE_CHARS,
  MAX_DESCRIPTION_CHARS,
  MAX_TITLE_WORDS,
  allowedNumbers,
  bulletShapeProblem,
  composeSlides,
  croBulletId,
  formatBullet,
  slideIsThin,
  unsupportedNumbers,
  validateBullets,
} from "../src/cro-slides.js";
import * as webCopy from "../../web/lib/cro-slides.js";
import {
  allowedNumbers as dataAnalysisAllowedNumbers,
  unsupportedNumbers as dataAnalysisUnsupportedNumbers,
} from "../../web/lib/data-analysis.js";
import type { CroBulletEdit, CroEvidenceItem, CroSlide } from "../src/cro-types.js";

const EVIDENCE: CroEvidenceItem[] = [
  {
    id: "pdp-mobile-cta-fold",
    label: "The primary call to action sits 1240px down — 396px below the first screen on mobile.",
    source: "Product (PDP) (mobile) capture",
    value: 1240,
  },
  {
    id: "pdp-mobile-reviews",
    label: "Reviews / social proof — No reviews widget or rating markup detected.",
    source: "Product (PDP) (mobile) capture",
  },
];

function bullet(title: string, description: string, evidenceIds = ["pdp-mobile-cta-fold"]) {
  return { title, description, impact: "high", evidenceIds };
}

describe("bullet shape", () => {
  it("accepts a bullet in the house format", () => {
    assert.equal(
      bulletShapeProblem("Raise the add-to-cart above the fold", "Moving it into the first screen removes a scroll before the only action on the page."),
      null,
    );
  });

  it("rejects a title too long to fit on a slide", () => {
    const long = "x".repeat(MAX_TITLE_CHARS + 1);
    assert.match(String(bulletShapeProblem(long, "A perfectly good description.")), /characters/);
  });

  it("rejects a title that is really a sentence", () => {
    // Short enough to fit, and still too many words to be a label. Kept distinct from the
    // character check above: a title can fail either, and each says something different about it.
    const wordy = Array.from({ length: MAX_TITLE_WORDS + 1 }, () => "an").join(" ");
    assert.ok(wordy.length <= MAX_TITLE_CHARS, "this case must fail on words, not characters");
    assert.match(String(bulletShapeProblem(wordy, "A perfectly good description.")), /words/);
  });

  it("rejects a title carrying a colon, which collides with the rendered format", () => {
    // The bullet renders as `title: description`. A colon in the title produces a line with two,
    // and a reader cannot tell which half is the label.
    assert.match(String(bulletShapeProblem("PDP: raise the CTA", "Fine description.")), /colon/);
  });

  it("rejects a title that frames the finding as a fault", () => {
    for (const title of ["Missing trust signals", "Poor mobile hierarchy", "Broken filter UI", "Weak social proof"]) {
      assert.match(String(bulletShapeProblem(title, "Fine description.")), /opportunity/, title);
    }
  });

  it("accepts an opportunity-framed title that mentions the same absence", () => {
    // The tone rule is about the leading word, not a vocabulary ban — a description saying what is
    // absent is exactly what a good bullet does.
    assert.equal(
      bulletShapeProblem("Add trust signals near the CTA", "No shipping or returns messaging appears beside the add-to-cart."),
      null,
    );
  });

  it("counts sentences without tripping on decimals", () => {
    // "1.4%" is not a sentence boundary. Getting this wrong rejects most good copy about rates.
    assert.equal(bulletShapeProblem("Raise the CTA", "Mobile converts at 1.4% against desktop's 3.2% here."), null);
  });

  it("rejects a description that runs past the slide", () => {
    assert.match(String(bulletShapeProblem("Raise the CTA", "x".repeat(MAX_DESCRIPTION_CHARS + 1))), /characters/);
  });

  it("renders in the fixed format", () => {
    assert.equal(formatBullet({ title: "Raise the CTA", description: "It is below the fold." }), "Raise the CTA: It is below the fold.");
  });
});

describe("bullet identity", () => {
  it("is stable across casing and trailing punctuation", () => {
    assert.equal(
      croBulletId("ux", "ux-pdp", "Raise the add-to-cart above the fold"),
      croBulletId("ux", "ux-pdp", "  raise the add-to-cart above the fold.  "),
    );
  });

  it("differs by slide, so the same title on two slides is two bullets", () => {
    assert.notEqual(croBulletId("ux", "ux-pdp", "Raise the CTA"), croBulletId("ux", "ux-plp", "Raise the CTA"));
  });

  it("changes when the wording changes, which is what orphans an edit", () => {
    // Deliberate: an edit made against one sentence must not silently re-apply to a different one.
    assert.notEqual(croBulletId("ux", "ux-pdp", "Raise the CTA"), croBulletId("ux", "ux-pdp", "Lower the CTA"));
  });
});

describe("fabricated figures", () => {
  it("allows a figure restated from the evidence, rounded", () => {
    const allowed = allowedNumbers(["The CTA sits 1240px down."]);
    assert.deepEqual(unsupportedNumbers("Roughly 1240px down the page.", allowed), []);
  });

  it("catches an invented uplift", () => {
    // The failure this whole guard exists for: a plausible percentage that appears nowhere in the
    // input, which on a slide is indistinguishable from a measurement.
    const allowed = allowedNumbers(["The CTA sits 1240px down."]);
    assert.deepEqual(unsupportedNumbers("Typically lifts add-to-cart by 15%.", allowed), ["15"]);
  });

  it("allows a small integer used as English", () => {
    const allowed = allowedNumbers(["Reviews were not detected."]);
    assert.deepEqual(unsupportedNumbers("Show the top 3 reviews inline.", allowed), []);
  });

  it("does not extend that allowance to a quantified figure", () => {
    const allowed = allowedNumbers(["Reviews were not detected."]);
    assert.deepEqual(unsupportedNumbers("Worth about 3% of revenue.", allowed), ["3"]);
  });
});

describe("validateBullets", () => {
  it("accepts a well-formed bullet and keeps only the evidence it cited", () => {
    const { accepted, rejected } = validateBullets(
      [bullet("Raise the add-to-cart above the fold", "It sits 1240px down, below the first screen on mobile.")],
      { step: "ux", slideId: "ux-pdp", evidence: EVIDENCE },
    );
    assert.equal(rejected.length, 0);
    assert.equal(accepted.length, 1);
    assert.deepEqual(accepted[0].evidenceIds, ["pdp-mobile-cta-fold"]);
    assert.equal(accepted[0].impact, "high");
  });

  it("rejects a bullet citing evidence that does not exist", () => {
    const { accepted, rejected } = validateBullets(
      [bullet("Raise the add-to-cart", "Fine.", ["pdp-mobile-invented"])],
      { step: "ux", slideId: "ux-pdp", evidence: EVIDENCE },
    );
    assert.equal(accepted.length, 0);
    assert.match(rejected[0].reason, /does not exist/);
  });

  it("rejects a bullet citing nothing at all", () => {
    const { accepted, rejected } = validateBullets([bullet("Raise the add-to-cart", "Fine.", [])], {
      step: "ux",
      slideId: "ux-pdp",
      evidence: EVIDENCE,
    });
    assert.equal(accepted.length, 0);
    assert.match(rejected[0].reason, /cited none/);
  });

  it("allows an uncited bullet where the step's material is not a measured catalogue", () => {
    const { accepted } = validateBullets([bullet("Lead with the refill story", "Customers describe it unprompted.", [])], {
      step: "voc",
      slideId: "voc-themes",
      evidence: EVIDENCE,
      requireEvidence: false,
    });
    assert.equal(accepted.length, 1);
  });

  it("rejects a bullet whose figure came from a different page's evidence", () => {
    // A bullet may only restate numbers from the evidence it cited. Borrowing the PDP's fold
    // measurement into a bullet about reviews is a real and easy mistake.
    const { accepted, rejected } = validateBullets(
      [bullet("Surface ratings on the grid", "This sits 1240px down.", ["pdp-mobile-reviews"])],
      { step: "ux", slideId: "ux-pdp", evidence: EVIDENCE },
    );
    assert.equal(accepted.length, 0);
    assert.match(rejected[0].reason, /1240/);
  });

  it("collapses a repeated bullet rather than letting two share an id", () => {
    const one = bullet("Raise the add-to-cart", "It sits 1240px down.");
    const { accepted, rejected } = validateBullets([one, { ...one }], {
      step: "ux",
      slideId: "ux-pdp",
      evidence: EVIDENCE,
    });
    assert.equal(accepted.length, 1);
    assert.match(rejected[0].reason, /repeats/);
  });

  it("stops at the slide's ceiling", () => {
    const many = Array.from({ length: MAX_BULLETS_PER_SLIDE + 3 }, (_, i) =>
      bullet(`Raise element ${i}`, "It sits 1240px down."),
    );
    const { accepted } = validateBullets(many, { step: "ux", slideId: "ux-pdp", evidence: EVIDENCE });
    assert.equal(accepted.length, MAX_BULLETS_PER_SLIDE);
  });

  it("treats a non-array answer as nothing rather than throwing", () => {
    const { accepted, rejected } = validateBullets(null, { step: "ux", slideId: "ux-pdp", evidence: EVIDENCE });
    assert.deepEqual([accepted, rejected], [[], []]);
  });
});

describe("composing a strategist's edits", () => {
  const slides = (): CroSlide[] => [
    {
      id: "ux-pdp",
      label: "Product (PDP)",
      bullets: [
        { id: "a", title: "Raise the CTA", description: "Original.", evidenceIds: [] },
        { id: "b", title: "Add trust signals", description: "Original.", evidenceIds: [] },
      ],
    },
  ];
  const edit = (partial: Partial<CroBulletEdit>): CroBulletEdit => ({ updatedAt: "2026-08-21T00:00:00.000Z", ...partial });

  it("returns the generated slides untouched when there are no edits", () => {
    const composed = composeSlides(slides(), undefined);
    assert.equal(composed.editedCount, 0);
    assert.equal(composed.slides[0].bullets[0].description, "Original.");
  });

  it("applies an edit without mutating the generated report", () => {
    const original = slides();
    const composed = composeSlides(original, { a: edit({ description: "Corrected." }) });
    assert.equal(composed.slides[0].bullets[0].description, "Corrected.");
    assert.equal(composed.editedCount, 1);
    // The point of the overlay: the record of what the tool concluded is unchanged, because it may
    // already have been sent to a client.
    assert.equal(original[0].bullets[0].description, "Original.");
  });

  it("removes a hidden bullet from every rendered surface", () => {
    const composed = composeSlides(slides(), { b: edit({ hidden: true }) });
    assert.deepEqual(
      composed.slides[0].bullets.map((x) => x.id),
      ["a"],
    );
  });

  it("reports edits that no longer match any bullet instead of dropping them", () => {
    const composed = composeSlides(slides(), { zzz: edit({ description: "Corrected." }) });
    assert.deepEqual(composed.orphanedEditIds, ["zzz"]);
  });
});

describe("thin slides", () => {
  it("flags a slide with too few bullets", () => {
    assert.equal(slideIsThin({ id: "x", label: "x", bullets: [{ id: "a", title: "t", description: "d", evidenceIds: [] }] }), true);
  });

  it("never flags a slide whose content is a table", () => {
    assert.equal(
      slideIsThin({ id: "x", label: "x", bullets: [], table: { columns: ["a", "b"], rows: [{ label: "r", cells: [true] }] } }),
      false,
    );
  });
});

/* ── The two copies ──────────────────────────────────────────────────────────────────────────── */

describe("web/lib/cro-slides.ts behaves identically to shared/src/cro-slides.ts", () => {
  const TITLES = [
    "Raise the add-to-cart above the fold",
    "Missing trust signals",
    "PDP: raise the CTA",
    "Add trust signals near the CTA",
    "A title that is definitely far too long to fit on any slide anywhere",
    "Pull Add to Cart onto screen one",
    "",
  ];
  const DESCRIPTIONS = [
    "Moving it into the first screen removes a scroll before the only action on the page.",
    "Mobile converts at 1.4% against desktop's 3.2% here.",
    "One sentence. Then a second. And a third.",
    "x".repeat(MAX_DESCRIPTION_CHARS + 1),
    "",
  ];

  it("agrees on every shape verdict", () => {
    for (const title of TITLES) {
      for (const description of DESCRIPTIONS) {
        assert.equal(
          webCopy.bulletShapeProblem(title, description),
          bulletShapeProblem(title, description),
          `disagreed on ${JSON.stringify({ title, description })}`,
        );
      }
    }
  });

  it("agrees on bullet ids", () => {
    for (const title of TITLES) {
      assert.equal(webCopy.croBulletId("ux", "ux-pdp", title), croBulletId("ux", "ux-pdp", title));
    }
  });

  it("agrees on which figures are unsupported", () => {
    const texts = ["Typically lifts add-to-cart by 15%.", "Roughly 1240px down.", "Show the top 3 reviews.", "About 3% of revenue."];
    const sources = ["The CTA sits 1240px down."];
    for (const text of texts) {
      assert.deepEqual(
        webCopy.unsupportedNumbers(text, webCopy.allowedNumbers(sources)),
        unsupportedNumbers(text, allowedNumbers(sources)),
        text,
      );
    }
  });

  it("agrees with the Data Analysis feature's guards, which these were copied from", () => {
    // The original pair lives in web/lib/data-analysis.ts. If one is tightened and the other is
    // not, two features in the same app would disagree about what counts as a fabricated metric.
    const texts = ["Typically lifts conversion by 15-20%.", "0.9% on mobile against 2.4% on desktop.", "the top 3 landing pages", "$1,240 of revenue"];
    const sources = ["Mobile converts at 0.9%.", "Desktop converts at 2.4%."];
    for (const text of texts) {
      assert.deepEqual(
        unsupportedNumbers(text, allowedNumbers(sources)),
        dataAnalysisUnsupportedNumbers(text, dataAnalysisAllowedNumbers(sources)),
        text,
      );
    }
  });

  it("agrees on validation outcomes", () => {
    const raw = [
      bullet("Raise the add-to-cart above the fold", "It sits 1240px down, below the first screen on mobile."),
      bullet("Missing trust signals", "Fine."),
      bullet("Surface ratings", "Typically lifts conversion by 15%.", ["pdp-mobile-reviews"]),
    ];
    const options = { step: "ux" as const, slideId: "ux-pdp", evidence: EVIDENCE };
    const a = validateBullets(raw, options);
    const b = webCopy.validateBullets(raw, options);
    assert.deepEqual(b.accepted, a.accepted);
    assert.deepEqual(b.rejected, a.rejected);
  });
});

describe("per-step description limits", () => {
  it("holds a slide bullet to one sentence", () => {
    assert.match(
      String(bulletShapeProblem("Raise the CTA", "It sits below the fold. Moving it up removes a scroll. Mobile suffers most.")),
      /sentences/,
    );
  });

  it("allows a Key Insight card the two or three its format calls for", () => {
    assert.equal(
      bulletShapeProblem(
        "Lead with fit confidence",
        "It sits below the fold. Moving it up removes a scroll. Mobile suffers most.",
        INSIGHT_CARD_LIMITS,
      ),
      null,
    );
  });

  it("still holds a card to every other rule", () => {
    // The card format is longer, not laxer: the tone rule is unchanged.
    assert.match(String(bulletShapeProblem("Missing fit guidance", "One. Two. Three.", INSIGHT_CARD_LIMITS)), /opportunity/);
  });

  it("agrees between the two copies on the card limits too", () => {
    const description = "It sits below the fold. Moving it up removes a scroll. Mobile suffers most.";
    assert.equal(
      webCopy.bulletShapeProblem("Lead with fit confidence", description, webCopy.INSIGHT_CARD_LIMITS),
      bulletShapeProblem("Lead with fit confidence", description, INSIGHT_CARD_LIMITS),
    );
  });
});
