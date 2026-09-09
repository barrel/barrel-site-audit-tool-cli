// The inventory's deterministic half. Everything asserted here is a pure function of a capture,
// so nothing opens a socket — same contract as consent-testcases.test.ts.
//
// The verdict rules are what these lock down. The inventory's whole claim to being usable in front
// of a client is that "classified correctly?" and "fires before consent?" are traceable to an
// observation, so the cases worth a test are the ones where an honest answer differs from a
// convenient one: an unreadable ruleset, a state that was never reached, a vendor nobody
// catalogued, and a CMP marker that gates without naming a category.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildInventory } from "../src/analyzers/consent/inventory.js";
import { observeVendors, registrableDomain, trackerForUrl, vendorKeyForUrl } from "../src/analyzers/consent/vendors.js";
import type { CmpClassification } from "../src/analyzers/consent/adapters/types.js";
import { reachedState, unreachedState } from "./helpers/consent-fixtures.js";
import type { RawStateCapture } from "../src/analyzers/consent/engine.js";

const URL = "https://shop.example.com/";

function build(states: RawStateCapture[], classification: CmpClassification | null = null) {
  return buildInventory({ states, classification, cmpLabel: "Cookiebot", url: URL });
}

/** A state in which `hosts` were contacted, each with a transmission. */
function withVendors(
  state: Parameters<typeof reachedState>[0],
  observations: Array<{ key: string; hosts: string[]; transmitted?: boolean; initiators?: string[] }>,
  over: Partial<RawStateCapture> = {},
): RawStateCapture {
  return reachedState(state, {
    vendorObservations: observations.map((o) => ({
      key: o.key,
      hosts: o.hosts,
      transmitted: o.transmitted !== false,
      scriptLoaded: o.transmitted === false,
      initiators: o.initiators ?? [],
    })),
    ...over,
  });
}

describe("registrable domain", () => {
  it("groups a vendor's subdomains into one key", () => {
    assert.equal(registrableDomain("static-tracking.klaviyo.com"), "klaviyo.com");
    assert.equal(registrableDomain("a.klaviyo.com"), "klaviyo.com");
  });

  it("keeps two-level public suffixes intact", () => {
    // Without this every British vendor collapses into a single `co.uk` row.
    assert.equal(registrableDomain("tags.example.co.uk"), "example.co.uk");
    assert.equal(registrableDomain("cdn.shop.com.au"), "shop.com.au");
  });
});

describe("vendor identification", () => {
  it("keys a catalogued vendor by tracker id, not by domain", () => {
    // Meta serves from two registrable domains; keying by domain splits one vendor across two
    // rows and makes each fragment look like it behaved differently.
    assert.equal(vendorKeyForUrl("https://connect.facebook.net/en_US/fbevents.js"), "meta");
    assert.equal(vendorKeyForUrl("https://www.facebook.com/tr?id=1&ev=PageView"), "meta");
  });

  it("never identifies a vendor from the query string", () => {
    // A cookie-sync endpoint names its partner in a parameter. Matching the whole URL attributed
    // ten unrelated ad-tech hosts to Amazon Ads and put `s.amazon-adsystem.com` in Google Ads'
    // host list — a vendor is identified by where the request went, not by whom it mentions.
    assert.equal(trackerForUrl("https://odr.mookie1.com/sync?partner=amazon-adsystem.com"), undefined);
    assert.equal(vendorKeyForUrl("https://odr.mookie1.com/sync?partner=amazon-adsystem.com"), "mookie1.com");
    assert.equal(trackerForUrl("https://c.amazon-adsystem.com/aat/amzn.js")?.id, "amazon-ads");
  });

  it("drops the site's own hosts, but keeps a vendor-owned domain used as a first-party CNAME", () => {
    // The site's own uncatalogued hosts are its own infrastructure and are dropped.
    const firstParty = observeVendors(
      [{ url: "https://metrics.shop.example.com/collect?tid=1", completed: true }],
      "shop.example.com",
      () => "transmission",
    );
    assert.equal(firstParty.length, 0);

    // A *separate* domain acting as a vendor's first-party CNAME is kept — this is the shape the
    // inventory has to expose, e.g. `forms.wearpepper.com` fronting Digioh.
    const cloaked = observeVendors(
      [{ url: "https://cdn.lightboxcdn.com/vendor/abc/lightbox_inline.js", completed: true }],
      "shop.example.com",
      () => "script",
    );
    assert.equal(cloaked.length, 1);
    assert.equal(cloaked[0].key, "lightboxcdn.com");
  });

  it("cannot see a cloaked tracker on the site's own domain — a known blind spot", () => {
    // Documented rather than papered over. A vendor CNAMEd onto `data.shop.example.com` is
    // first-party by hostname and matches no vendor pattern, so nothing distinguishes it from the
    // shop's own endpoints. Keeping every first-party host instead would put dozens of the site's
    // own asset and API routes in the table, which buries the third parties the client asked
    // about. Catching this needs a DNS lookup the scanner does not do.
    const observed = observeVendors(
      [{ url: "https://data.shop.example.com/collect?tid=1", completed: true }],
      "shop.example.com",
      () => "transmission",
    );
    assert.equal(observed.length, 0);
  });

  it("discounts a request that never arrived", () => {
    const observed = observeVendors(
      [{ url: "https://connect.facebook.net/en_US/fbevents.js", completed: false }],
      "shop.example.com",
      () => "transmission",
    );
    assert.equal(observed.length, 0);
  });

  it("drops platform and font infrastructure", () => {
    const observed = observeVendors(
      [
        { url: "https://monorail-edge.shopifysvc.com/v1/produce", completed: true },
        { url: "https://use.typekit.net/abc.css", completed: true },
        { url: "https://ct.pinterest.com/v3/?event=init", completed: true },
      ],
      "shop.example.com",
      () => "transmission",
    );
    assert.deepEqual(
      observed.map((o) => o.key),
      ["pinterest"],
    );
  });
});

describe("classified-correctly verdicts", () => {
  it("reports `unknown`, never a finding, when no ruleset could be read", () => {
    // The distinction the column lives or dies by: we could not read their configuration, which
    // is our gap. Reporting it as `incorrect` would invite a client to fix something that may
    // well be right.
    const inv = build([withVendors("clean", [{ key: "meta", hosts: ["connect.facebook.net"] }])], null);
    assert.equal(inv.vendors[0].classifiedCorrectly, "unknown");
    assert.ok(inv.classificationUnavailable, "expected a stated reason");
    assert.equal(inv.classificationSource, undefined);
  });

  it("separates `unclassified` from `incorrect` when a readable ruleset has no rule", () => {
    // An absent gating marker has an innocent explanation — a tag injected by script was never a
    // script tag for the CMP to rewrite — so it must not be called misclassification.
    const inv = build([withVendors("clean", [{ key: "meta", hosts: ["connect.facebook.net"] }])], { rules: [] });
    assert.equal(inv.vendors[0].classifiedCorrectly, "unclassified");
    assert.match(inv.vendors[0].classificationNote ?? "", /No gating rule covers this vendor/);
  });

  it("calls a marketing vendor declared ESSENTIAL incorrect", () => {
    const inv = build([withVendors("clean", [{ key: "meta", hosts: ["connect.facebook.net"] }])], {
      rules: [{ match: "https://connect.facebook.net/en_US/fbevents.js", category: "ESSENTIAL", kind: "script" }],
    });
    assert.equal(inv.vendors[0].classifiedCorrectly, "incorrect");
    assert.match(inv.vendors[0].classificationNote ?? "", /never gated/);
  });

  it("agrees when the CMP's own label matches the vendor's category", () => {
    const inv = build([withVendors("clean", [{ key: "meta", hosts: ["connect.facebook.net"] }])], {
      rules: [{ match: "connect.facebook.net", category: "MARKETING", kind: "script" }],
    });
    assert.equal(inv.vendors[0].classifiedCorrectly, "correct");
  });

  it("treats a vendor's own bypass marker as incorrect and says the markup must change", () => {
    const inv = build([withVendors("clean", [{ key: "meta", hosts: ["connect.facebook.net"] }])], {
      rules: [{ match: "connect.facebook.net", category: "IGNORE", kind: "script" }],
    });
    assert.equal(inv.vendors[0].classifiedCorrectly, "incorrect");
    assert.match(inv.vendors[0].classificationNote ?? "", /markup has to change/);
  });

  it("reports `partly` for a marker that gates without naming a category", () => {
    // Osano's `osano/blocked` proves the tag is held back but not on which category, so claiming
    // agreement or disagreement would both overstate what the page shows.
    const inv = build([withVendors("clean", [{ key: "meta", hosts: ["connect.facebook.net"] }])], {
      rules: [{ match: "connect.facebook.net", category: "BLOCKED (non-essential)", kind: "script" }],
    });
    assert.equal(inv.vendors[0].classifiedCorrectly, "partly");
  });

  it("names the ruleset variant it audited", () => {
    const inv = build([withVendors("clean", [{ key: "meta", hosts: ["connect.facebook.net"] }])], {
      rules: [{ match: "connect.facebook.net", category: "MARKETING" }],
      variant: "live us-fl ruleset",
    });
    assert.equal(inv.classificationSource, "Cookiebot (live us-fl ruleset)");
  });
});

describe("consent behaviour", () => {
  it("says a negative post-rejection claim is unproven when reject was never reached", () => {
    // The most damaging error this scan can make is asserting consent works when it was never
    // tested, because that failure looks exactly like success.
    const inv = build([
      withVendors("clean", [{ key: "meta", hosts: ["connect.facebook.net"] }]),
      unreachedState("reject"),
    ]);
    assert.equal(inv.vendors[0].firesDespiteRejection, false);
    assert.match(inv.vendors[0].consentBehaviour, /Reject state could not be reached/);
  });

  it("grades a marketing tag that survives an explicit rejection as critical", () => {
    const inv = build([
      withVendors("clean", [{ key: "meta", hosts: ["connect.facebook.net"] }]),
      withVendors("reject", [{ key: "meta", hosts: ["connect.facebook.net"] }]),
    ]);
    assert.equal(inv.vendors[0].severity, "critical");
    assert.equal(inv.vendors[0].firesDespiteRejection, true);
    assert.match(inv.vendors[0].consentBehaviour, /after an explicit Reject All/);
  });

  it("distinguishes a script load from a transmission before consent", () => {
    // Downloading a library discloses an IP; sending an event discloses the visitor. Grading them
    // alike hands a developer a finding they can correctly dismiss.
    const inv = build([
      withVendors("clean", [{ key: "meta", hosts: ["connect.facebook.net"], transmitted: false }]),
    ]);
    assert.equal(inv.vendors[0].severity, "medium");
    assert.match(inv.vendors[0].consentBehaviour, /Script only/);

    const transmitting = build([withVendors("clean", [{ key: "meta", hosts: ["connect.facebook.net"] }])]);
    assert.equal(transmitting.vendors[0].severity, "high");
  });

  it("never grades an essential vendor", () => {
    const inv = build([withVendors("clean", [{ key: "trekkie", hosts: ["monorail-edge.shopify.com"] }])]);
    assert.equal(inv.vendors[0].severity, "none");
  });

  it("does not treat the dismiss state as a pre-consent observation", () => {
    // Whether closing a banner is a choice is what suite H exists to ask; borrowing that unsettled
    // question into a factual column would state a legal position as an observation.
    const inv = build([reachedState("clean"), withVendors("dismiss", [{ key: "meta", hosts: ["connect.facebook.net"] }])]);
    assert.equal(inv.vendors[0].firesBeforeConsent, false);
  });
});

describe("purpose provenance", () => {
  it("labels a catalogued purpose as such and never asks the model for it", () => {
    const inv = build([withVendors("clean", [{ key: "klaviyo", hosts: ["static.klaviyo.com"] }])]);
    assert.equal(inv.vendors[0].purposeSource, "catalogue");
    assert.match(inv.vendors[0].purpose, /Email\/SMS marketing/);
  });

  it("marks an uncatalogued vendor `inferred` with an empty purpose for the model to fill", () => {
    const inv = build([withVendors("clean", [{ key: "weird-adtech.example", hosts: ["px.weird-adtech.example"] }])]);
    assert.equal(inv.vendors[0].purposeSource, "inferred");
    assert.equal(inv.vendors[0].purpose, "");
    // Never guessed as marketing: manufacturing a high-severity row out of an uncatalogued host
    // is the same mistake `categorizeCookie` avoids.
    assert.equal(inv.vendors[0].observedCategory, "preferences");
  });
});

describe("Shopify web pixels", () => {
  const pixels = [
    { id: "111", type: "APP", runtimeContext: "STRICT", privacyPurposes: [], configuration: '{"accountID":"QY4TsH"}' },
    { id: "222", type: "APP", runtimeContext: "OPEN", privacyPurposes: ["ANALYTICS", "MARKETING"] },
  ];

  it("attributes a pixel from the initiator chain, which names its id outright", () => {
    const inv = build([
      withVendors("clean", [
        {
          key: "klaviyo",
          hosts: ["static.klaviyo.com"],
          initiators: ["https://shop.example.com/web-pixels@abc/app/web-pixel-111@def/pixel.modern.js"],
        },
      ]),
      reachedState("clean", { inventoryFacts: { storageKeys: [], headScripts: [], bodyScripts: [], shopifyPixels: pixels } }),
    ]);
    const klaviyo = inv.vendors.find((v) => v.key === "klaviyo");
    assert.equal(klaviyo?.load.mechanism, "shopify-web-pixel");
    assert.equal(klaviyo?.load.shopifyPixel?.id, "111");
  });

  it("flags a pixel gated on nothing as a finding the CMP cannot fix", () => {
    const inv = build([
      withVendors("clean", [
        {
          key: "klaviyo",
          hosts: ["static.klaviyo.com"],
          initiators: ["https://shop.example.com/web-pixels@abc/app/web-pixel-111@def/pixel.modern.js"],
        },
      ]),
      reachedState("clean", { inventoryFacts: { storageKeys: [], headScripts: [], bodyScripts: [], shopifyPixels: pixels } }),
    ]);
    const note = inv.vendors.find((v) => v.key === "klaviyo")?.notes?.join(" ") ?? "";
    assert.match(note, /declares no privacyPurposes/);
    assert.match(note, /not in the CMP/);
  });

  it("reports every registered pixel, including ones no vendor claimed", () => {
    const inv = build([
      reachedState("clean", { inventoryFacts: { storageKeys: [], headScripts: [], bodyScripts: [], shopifyPixels: pixels } }),
    ]);
    assert.equal(inv.shopifyPixels.length, 2);
    assert.deepEqual(
      inv.shopifyPixels.map((p) => p.id),
      ["111", "222"],
    );
  });
});

describe("load mechanism", () => {
  const facts = (headScripts: string[]) => ({ storageKeys: [], headScripts, bodyScripts: [], shopifyPixels: [] });

  it("recognises a theme tag served through Shopify's app proxy", () => {
    // The vendor's host survives only in the path, so host-only matching reported a tag sitting
    // plainly in the head as "load mechanism not observed".
    const inv = build([
      withVendors("clean", [{ key: "bazaarvoice.com", hosts: ["apps.bazaarvoice.com"] }], {
        inventoryFacts: facts(["https://cdn.shopify.com/proxy/abc/apps.bazaarvoice.com/deployments/bv.js"]),
      }),
    ]);
    assert.equal(inv.vendors[0].load.mechanism, "theme-head");
  });

  it("names the tag manager that injected a tag", () => {
    const inv = build([
      withVendors("clean", [
        { key: "pinterest", hosts: ["ct.pinterest.com"], initiators: ["https://www.googletagmanager.com/gtm.js?id=GTM-ABC123"] },
      ]),
    ]);
    assert.equal(inv.vendors[0].load.mechanism, "tag-manager");
    assert.match(inv.vendors[0].load.description, /GTM-ABC123/);
  });

  it("reads a first-party document initiator as a theme tag, not as the shop injecting itself", () => {
    const inv = build([
      withVendors("clean", [{ key: "pinterest", hosts: ["ct.pinterest.com"], initiators: [URL] }]),
    ]);
    assert.equal(inv.vendors[0].load.mechanism, "theme-head");
    assert.doesNotMatch(inv.vendors[0].load.description, /shop\.example\.com/);
  });
});

describe("ordering", () => {
  it("puts the row worth acting on first", () => {
    const inv = build([
      withVendors("clean", [
        { key: "trekkie", hosts: ["monorail-edge.shopify.com"] },
        { key: "clarity", hosts: ["www.clarity.ms"], transmitted: false },
        { key: "meta", hosts: ["connect.facebook.net"] },
      ]),
      withVendors("reject", [{ key: "meta", hosts: ["connect.facebook.net"] }]),
    ]);
    assert.equal(inv.vendors[0].key, "meta");
    assert.equal(inv.vendors.at(-1)?.key, "trekkie");
  });
});
