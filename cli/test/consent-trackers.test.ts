import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  categorizeCookie,
  classifyRequest,
  describeTransmission,
  isConsentDeniedPing,
  isTransmissionFor,
  matchScriptLoads,
  matchTrackers,
  matchTransmissions,
  readConsentModePing,
  TRACKERS,
  trackerById,
  trackersInCategory,
} from "../src/analyzers/consent/trackers.js";

const META_SCRIPT = "https://connect.facebook.net/en_US/fbevents.js";
const META_BEACON = "https://www.facebook.com/tr?id=123456789&ev=PageView&dl=https%3A%2F%2Fshop.example";
const GA4_COLLECT = "https://www.google-analytics.com/g/collect?v=2&tid=G-ABC123";
const KLAVIYO = trackerById("klaviyo")!;

describe("classifyRequest", () => {
  it("treats a file extension as decisive, even when the path also reads like a beacon", () => {
    // The regression this exists for: `events.js` under a `/pixel/` directory was reported as an
    // identified event, which is a finding a client's developer can correctly dismiss.
    assert.equal(classifyRequest("https://analytics.tiktok.com/i18n/pixel/events.js"), "script");
    assert.equal(classifyRequest("https://example.com/collect/tracker.js"), "script");
    assert.equal(classifyRequest("https://example.com/track/pixel.png"), "script");
    assert.equal(classifyRequest(META_SCRIPT), "script");
  });

  it("ignores the query string when looking for an extension", () => {
    assert.equal(classifyRequest("https://connect.facebook.net/en_US/fbevents.js?v=2.9.100"), "script");
    // …and the reverse: a `.js` in the query does not make a beacon a script.
    assert.equal(classifyRequest("https://www.facebook.com/tr?id=1&src=fbevents.js"), "transmission");
  });

  it("calls an extensionless endpoint a transmission", () => {
    assert.equal(classifyRequest(META_BEACON), "transmission");
    assert.equal(classifyRequest(GA4_COLLECT), "transmission");
    // Uncatalogued endpoints included — erring toward "this transmitted" is checkable against the
    // quoted evidence, whereas a missed transmission is invisible.
    assert.equal(classifyRequest("https://vendor.example/some/unknown/endpoint"), "transmission");
  });

  it("honours a vendor's infrastructure allowlist, but only when that vendor is named", () => {
    assert.equal(classifyRequest("https://static.klaviyo.com/onsite/js/klaviyo", KLAVIYO), "script");
    assert.equal(classifyRequest("https://static.klaviyo.com/custom-fonts/abc", KLAVIYO), "script");
    // Without the signature there is nothing to consult, so the same URL is a transmission.
    assert.equal(classifyRequest("https://static.klaviyo.com/onsite/js/klaviyo"), "transmission");
    // The allowlist is narrow on purpose: Klaviyo's actual measurement endpoints stay transmissions.
    assert.equal(classifyRequest("https://a.klaviyo.com/onsite/track-analytics", KLAVIYO), "transmission");
    assert.equal(classifyRequest("https://a.klaviyo.com/client/events", KLAVIYO), "transmission");
  });

  it("falls back to transmission when the URL cannot be parsed", () => {
    assert.equal(classifyRequest("not-a-url"), "transmission");
    assert.equal(classifyRequest(""), "transmission");
  });
});

describe("readConsentModePing", () => {
  it("reads the two storage flags when Consent Mode is active", () => {
    assert.deepEqual(readConsentModePing("https://x.example/collect?gcs=G100"), {
      adStorage: false,
      analyticsStorage: false,
    });
    assert.deepEqual(readConsentModePing("https://x.example/collect?gcs=G111"), {
      adStorage: true,
      analyticsStorage: true,
    });
    assert.deepEqual(readConsentModePing("https://x.example/collect?v=2&gcs=G110&cid=1"), {
      adStorage: true,
      analyticsStorage: false,
    });
  });

  it("returns null when the request declares nothing", () => {
    // `G1--` is Consent Mode reporting that it has no opinion yet, not a denial.
    assert.equal(readConsentModePing("https://x.example/collect?gcs=G1--"), null);
    assert.equal(readConsentModePing("https://x.example/collect"), null);
    // A leading `0` means Consent Mode is not running at all; the flags after it mean nothing.
    assert.equal(readConsentModePing("https://x.example/collect?gcs=G000"), null);
  });
});

describe("isConsentDeniedPing", () => {
  it("recognises a denial for the category it applies to", () => {
    assert.equal(isConsentDeniedPing("https://x.example/collect?gcs=G100", "marketing"), true);
    assert.equal(isConsentDeniedPing("https://x.example/collect?gcs=G100", "analytics"), true);
    assert.equal(isConsentDeniedPing("https://x.example/collect?gcs=G110", "marketing"), false);
    assert.equal(isConsentDeniedPing("https://x.example/collect?gcs=G110", "analytics"), true);
    assert.equal(isConsentDeniedPing("https://x.example/collect?gcs=G111", "marketing"), false);
  });

  it("is false when nothing was declared — absence is not consent", () => {
    assert.equal(isConsentDeniedPing("https://x.example/collect?gcs=G1--", "marketing"), false);
    assert.equal(isConsentDeniedPing(META_BEACON, "marketing"), false);
  });

  it("never reads a denial for essential or preference tags", () => {
    assert.equal(isConsentDeniedPing("https://x.example/collect?gcs=G100", "essential"), false);
    assert.equal(isConsentDeniedPing("https://x.example/collect?gcs=G100", "preferences"), false);
  });
});

describe("matchTransmissions", () => {
  it("counts a beacon and ignores the library fetch that preceded it", () => {
    assert.deepEqual(matchTransmissions([META_SCRIPT]).map((t) => t.id), []);
    assert.deepEqual(matchTransmissions([META_BEACON]).map((t) => t.id), ["meta"]);
    assert.deepEqual(matchTransmissions([META_SCRIPT, META_BEACON]).map((t) => t.id), ["meta"]);
  });

  it("does not count a tag that only reported consent was withheld", () => {
    assert.deepEqual(matchTransmissions([`${GA4_COLLECT}&gcs=G100&npa=1`]).map((t) => t.id), []);
  });

  it("counts a tag that sent a real hit alongside its denied pings", () => {
    const urls = [`${GA4_COLLECT}&gcs=G100`, `${GA4_COLLECT}&gcs=G111`];
    assert.deepEqual(matchTransmissions(urls).map((t) => t.id), ["ga4"]);
  });

  it("returns each vendor once, in catalogue order", () => {
    const ids = matchTransmissions([META_BEACON, META_BEACON, GA4_COLLECT]).map((t) => t.id);
    assert.deepEqual(ids, ["meta", "ga4"]);
  });
});

describe("matchScriptLoads", () => {
  it("reports a vendor whose library was fetched but which sent nothing", () => {
    assert.deepEqual(matchScriptLoads([META_SCRIPT]).map((t) => t.id), ["meta"]);
  });

  it("stays silent about a vendor that also transmitted — the stronger finding subsumes it", () => {
    assert.deepEqual(matchScriptLoads([META_SCRIPT, META_BEACON]).map((t) => t.id), []);
  });

  it("does not treat an uncatalogued endpoint as a script load", () => {
    assert.deepEqual(matchScriptLoads(["https://connect.facebook.net/signals/config/123"]).map((t) => t.id), []);
  });
});

describe("matchTrackers", () => {
  it("answers the weaker question — was this vendor on the page at all", () => {
    assert.deepEqual(matchTrackers([META_SCRIPT]).map((t) => t.id), ["meta"]);
    // Still excludes a pure denial ping, for the same reason matchTransmissions does.
    assert.deepEqual(matchTrackers([`${GA4_COLLECT}&gcs=G100`]).map((t) => t.id), []);
  });
});

describe("isTransmissionFor", () => {
  it("agrees with the finding it is quoted under", () => {
    const meta = trackerById("meta")!;
    assert.equal(isTransmissionFor(META_BEACON, meta), true);
    assert.equal(isTransmissionFor(META_SCRIPT, meta), false);
    const ga4 = trackerById("ga4")!;
    assert.equal(isTransmissionFor(`${GA4_COLLECT}&gcs=G100`, ga4), false);
  });
});

describe("categorizeCookie", () => {
  it("categorises the well-known advertising and analytics cookies", () => {
    for (const name of ["_fbp", "_fbc", "_gcl_au", "_ttp", "_uetsid", "__kla_id", "IDE", "_rdt_uuid"]) {
      assert.equal(categorizeCookie(name), "marketing", name);
    }
    for (const name of ["_ga", "_ga_ABC123", "_gid", "_gat_gtag_UA_1", "_clck", "_hjSessionUser", "_fs_uid"]) {
      assert.equal(categorizeCookie(name), "analytics", name);
    }
    for (const name of ["cart_currency", "localization", "secure_customer_sig", "_tracking_consent", "OptanonConsent"]) {
      assert.equal(categorizeCookie(name), "essential", name);
    }
  });

  it("resolves the overlapping Shopify prefixes longest-first", () => {
    assert.equal(categorizeCookie("_shopify_marketing_1234"), "marketing");
    assert.equal(categorizeCookie("_shopify_y"), "analytics");
    assert.equal(categorizeCookie("_shopify_analytics"), "analytics");
    assert.equal(categorizeCookie("_shopify_essential"), "essential");
  });

  it("files an unrecognised cookie under preferences rather than guessing marketing", () => {
    // Guessing "marketing" would manufacture blocker-severity failures out of cookies nobody has
    // catalogued yet, which is the one direction this must never err in.
    assert.equal(categorizeCookie("wibble"), "preferences");
    assert.equal(categorizeCookie("_some_app_state"), "preferences");
  });

  it("is case-insensitive, as cookie names in the wild are not consistent", () => {
    assert.equal(categorizeCookie("_FBP"), "marketing");
    assert.equal(categorizeCookie("optanonconsent"), "essential");
  });
});

describe("describeTransmission", () => {
  it("names the endpoint and the parameters that identify the event", () => {
    assert.equal(
      describeTransmission("https://www.facebook.com/tr?id=123&ev=PageView&noise=ignored"),
      "www.facebook.com/tr (id=123, ev=PageView)",
    );
  });

  it("renders the parameters in a fixed order rather than the order the page sent them", () => {
    const a = describeTransmission("https://x.example/c?ev=Purchase&id=9");
    const b = describeTransmission("https://x.example/c?id=9&ev=Purchase");
    assert.equal(a, b);
    assert.equal(a, "x.example/c (id=9, ev=Purchase)");
  });

  it("falls back to the bare endpoint when nothing identifying is present", () => {
    assert.equal(describeTransmission("https://www.facebook.com/tr"), "www.facebook.com/tr");
  });

  it("truncates a long parameter value so one URL cannot flood the evidence block", () => {
    const long = "x".repeat(200);
    const out = describeTransmission(`https://x.example/c?id=${long}`);
    assert.equal(out, `x.example/c (id=${"x".repeat(60)})`);
  });

  it("degrades to a truncated string rather than throwing on an unparseable URL", () => {
    assert.equal(describeTransmission("not-a-url"), "not-a-url");
    assert.equal(describeTransmission("z".repeat(500)).length, 120);
  });
});

describe("trackersInCategory", () => {
  it("filters by both membership and category", () => {
    const ids = ["meta", "ga4", "trekkie"];
    assert.deepEqual(trackersInCategory(ids, "marketing").map((t) => t.id), ["meta"]);
    assert.deepEqual(trackersInCategory(ids, "analytics").map((t) => t.id), ["ga4"]);
    assert.deepEqual(trackersInCategory(ids, "essential").map((t) => t.id), ["trekkie"]);
  });
});

describe("the tracker catalogue itself", () => {
  it("has no duplicate ids — a duplicate would silently shadow one vendor's category", () => {
    const seen = new Set<string>();
    for (const t of TRACKERS) {
      assert.equal(seen.has(t.id), false, `duplicate tracker id: ${t.id}`);
      seen.add(t.id);
    }
  });

  it("gives every signature a global-flag-free pattern", () => {
    // A `/g` regex carries lastIndex between calls, so the same URL would match on one pass and
    // not the next — the exact shape of an intermittent, unreproducible finding.
    for (const t of TRACKERS) {
      assert.equal(t.pattern.global, false, `${t.id} pattern is /g`);
      assert.equal(t.infrastructure?.global ?? false, false, `${t.id} infrastructure pattern is /g`);
    }
  });

  it("resolves every id it advertises", () => {
    for (const t of TRACKERS) assert.equal(trackerById(t.id), t);
    assert.equal(trackerById("nope"), undefined);
  });
});
