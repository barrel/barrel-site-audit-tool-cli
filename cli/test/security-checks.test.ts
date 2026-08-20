// Every assertion here is a pure function over a fabricated Response, cookie list or HTML string.
// Nothing opens a socket: the analyzer's own fetches live in `analyzeSecurity`, and each verdict
// it reaches is a separate function precisely so the verdict can be tested without the network.
//
// The bias throughout is towards proving the analyzer *refuses to claim* things. A false pass in
// this section is worse than a false positive — the report has legal weight, and "no finding" is
// read as "we checked and it was fine".
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as cheerio from "cheerio";
import type { SecurityCheck, SecurityCheckCategory, SecuritySeverity } from "@barrel/site-audit-shared";
import {
  certificateVerdict,
  classifyCertError,
  cookieHttpOnlyCheck,
  cookieSameSiteCheck,
  cookieSecureCheck,
  cspCheck,
  describeUnusablePage,
  EXPOSED_PROBES,
  frameAncestorsCheck,
  hstsCheck,
  jqueryVerdict,
  jqueryVersionFrom,
  looksLikeSecretBundle,
  mixedContentCheck,
  nosniffCheck,
  PAGE_DERIVED_CHECKS,
  parseCookies,
  permissionsPolicyCheck,
  readCsp,
  referrerPolicyCheck,
  sourceMapCheck,
  sriCheck,
  thirdPartyOriginCheck,
  versionDisclosureCheck,
  wildcardedCapabilities,
} from "../src/analyzers/security.js";

/* ── fixtures ────────────────────────────────────────────────────────────────────────────── */

function response(headers: Record<string, string | string[]> = {}, init: { status?: number; body?: string } = {}): Response {
  const h = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    for (const one of Array.isArray(value) ? value : [value]) h.append(name, one);
  }
  return new Response(init.body ?? "<html></html>", { status: init.status ?? 200, headers: h });
}

function csp(over: { enforced?: string | null; header?: string | null; reportOnly?: string | null } = {}) {
  const header = over.header ?? null;
  return {
    enforced: over.enforced ?? header,
    source: header ? "the Content-Security-Policy response header" : over.enforced ? "a <meta http-equiv> tag in the page" : null,
    header,
    reportOnly: over.reportOnly ?? null,
  };
}

function cookies(...lines: string[]) {
  return parseCookies(response({ "set-cookie": lines }));
}

const noCsp = csp();

/* ── 1. exposed files: /config.json must not fire on bare JSON ───────────────────────────── */

describe("looksLikeSecretBundle", () => {
  const configProbe = EXPOSED_PROBES.find((p) => p.path === "/config.json");

  it("does not treat well-formed JSON as a leaked credential", () => {
    // This was the defect: the match condition was "does this parse", so a headless storefront
    // whose catch-all answers unknown paths with a JSON 200 was reported at `critical`, told to
    // rotate every credential it owns, and pushed through the score's critical-failure gate.
    for (const body of [
      "{}",
      "[]",
      '{"error":"Not found"}',
      '{"status":404,"message":"No route matches /config.json"}',
      '{"name":"storefront","version":"1.4.0","locales":["en","fr"]}',
      '{"data":{"products":[]}}',
      "null",
      '"a string"',
    ]) {
      assert.equal(looksLikeSecretBundle(body), false, `should not match: ${body}`);
      assert.equal(configProbe?.matches(body), false, `probe should not match: ${body}`);
    }
  });

  it("does not match HTML, however much it talks about passwords", () => {
    assert.equal(looksLikeSecretBundle('<html><body>Enter your password: <input name="password"></body></html>'), false);
  });

  it("matches a secret-shaped key carrying a real value", () => {
    assert.equal(looksLikeSecretBundle('{"api_key":"sk_live_51H8xQ2LmNq"}'), true);
    assert.equal(looksLikeSecretBundle('{"database":{"password":"hunter2hunter2"}}'), true);
    assert.equal(looksLikeSecretBundle('{"shopify":{"adminAccessToken":"shpat_0123456789abcdef"}}'), true);
    assert.equal(looksLikeSecretBundle('{"clientSecret":"abcdefghijkl"}'), true);
  });

  it("ignores placeholder and empty secret values", () => {
    // A committed template is not a leak, and reporting one as a `critical` costs the section its
    // credibility with the engineers who know the file.
    assert.equal(looksLikeSecretBundle('{"password":""}'), false);
    assert.equal(looksLikeSecretBundle('{"api_key":"TODO"}'), false);
    assert.equal(looksLikeSecretBundle('{"secret":null}'), false);
  });

  it("matches a PEM private key wherever it appears", () => {
    assert.equal(looksLikeSecretBundle("-----BEGIN RSA PRIVATE KEY-----\nMIIEow...\n"), true);
  });

  it("leaves the .env and .git signatures alone", () => {
    const env = EXPOSED_PROBES.find((p) => p.path === "/.env");
    assert.equal(env?.matches("SHOPIFY_API_KEY=abc123\nSECRET=x\n"), true);
    assert.equal(env?.matches("<html><body>Not found</body></html>"), false);
    const gitConfig = EXPOSED_PROBES.find((p) => p.path === "/.git/config");
    assert.equal(gitConfig?.matches("[core]\n\trepositoryformatversion = 0\n"), true);
    assert.equal(gitConfig?.matches("[core]\n"), false);
  });
});

/* ── 2. the homepage response has to actually be the homepage ────────────────────────────── */

describe("describeUnusablePage", () => {
  const home = new URL("https://shop.example/");

  it("accepts an ordinary 200", () => {
    assert.equal(describeUnusablePage(response(), "<html><body>Shop</body></html>", home), null);
  });

  it("refuses any non-ok status, naming the code", () => {
    for (const status of [403, 429, 500, 503]) {
      const reason = describeUnusablePage(response({}, { status }), "<html></html>", home);
      assert.ok(reason, `HTTP ${status} should be unusable`);
      assert.match(reason, new RegExp(String(status)));
    }
  });

  it("catches a Cloudflare challenge served with HTTP 200", () => {
    // The dangerous case, and the reason the guard cannot be a status check alone: an interstitial
    // sends x-frame-options, nosniff and referrer-policy of its own, so without this the storefront
    // is credited with three header controls it may not set anywhere.
    const headers = { "x-frame-options": "SAMEORIGIN", "x-content-type-options": "nosniff", "referrer-policy": "same-origin" };
    const body = "<html><head><title>Just a moment...</title></head><body><div id='cf-challenge-running'>Enable JavaScript and cookies to continue</div></body></html>";
    assert.ok(describeUnusablePage(response(headers, { body }), body, home));

    // …and those three checks really would have passed on it, which is what makes the guard load-bearing.
    assert.equal(nosniffCheck(response(headers)).status, "pass");
    assert.equal(referrerPolicyCheck(response(headers)).status, "pass");
    assert.equal(frameAncestorsCheck(response(headers), noCsp).status, "pass");
  });

  it("catches Cloudflare's mitigation header even on a clean-looking body", () => {
    assert.ok(describeUnusablePage(response({ "cf-mitigated": "challenge" }), "<html><body>ok</body></html>", home));
  });

  it("catches a Shopify password page", () => {
    assert.ok(describeUnusablePage(response(), "<html></html>", new URL("https://shop.example/password")));
    assert.ok(describeUnusablePage(response(), '<form method="post" action="/password"><input name="password"></form>', home));
  });

  it("names every page-derived check in a table that matches what the checks emit", () => {
    // The guard reports these as not-tested from a table rather than by running the checks against
    // a page that is not the storefront. This asserts the table cannot drift away from the real
    // metadata — a mismatch would rename or re-weight a check only on the unusable-page path.
    const produced: Record<string, SecurityCheck> = {
      csp: cspCheck(noCsp),
      "frame-ancestors": frameAncestorsCheck(response(), noCsp),
      hsts: hstsCheck(response(), true),
      "x-content-type-options": nosniffCheck(response()),
      "referrer-policy": referrerPolicyCheck(response()),
      "permissions-policy": permissionsPolicyCheck(response()),
      "mixed-content": mixedContentCheck(cheerio.load("<html></html>"), true, noCsp),
      "cookie-secure": cookieSecureCheck(cookies("a=b"), true),
      "cookie-samesite": cookieSameSiteCheck(cookies("a=b")),
      "cookie-httponly": cookieHttpOnlyCheck(cookies("a=b")),
      "version-disclosure": versionDisclosureCheck(response()),
      "script-sri": sriCheck([]),
      "third-party-origins": thirdPartyOriginCheck([]),
      "jquery-version": jqueryVerdict([]),
    };

    for (const meta of PAGE_DERIVED_CHECKS) {
      // source-maps is the one entry whose producer is async; it short-circuits on an empty script
      // list without a request, so it is asserted separately below.
      if (meta.id === "source-maps") continue;
      const actual = produced[meta.id];
      assert.ok(actual, `no producer wired up for ${meta.id}`);
      assert.equal(actual.category, meta.category as SecurityCheckCategory, `${meta.id} category`);
      assert.equal(actual.title, meta.title, `${meta.id} title`);
      assert.equal(actual.severity, meta.severity as SecuritySeverity, `${meta.id} severity`);
    }
    assert.equal(PAGE_DERIVED_CHECKS.length, Object.keys(produced).length + 1);
  });

  it("keeps the source-maps metadata in step too", async () => {
    const meta = PAGE_DERIVED_CHECKS.find((m) => m.id === "source-maps");
    const actual = await sourceMapCheck([], "https://shop.example");
    assert.equal(actual.status, "not-tested");
    assert.equal(actual.category, meta?.category);
    assert.equal(actual.title, meta?.title);
    assert.equal(actual.severity, meta?.severity);
  });
});

/* ── 3. jQuery: the oldest copy on the page is the finding ───────────────────────────────── */

describe("jqueryVerdict", () => {
  const reading = (url: string, version: string | null, fetched = true) => ({ url, version, fetched });

  it("reports the lowest version, not the first one it could read", () => {
    // The defect: a theme loading 3.7.1 and an app loading 1.12.4 passed on the theme's copy and
    // never looked at the second, because the loop returned on the first readable version.
    const verdict = jqueryVerdict([reading("https://shop.example/theme.js", "3.7.1"), reading("https://cdn.app/jquery.js", "1.12.4")]);
    assert.equal(verdict.status, "fail");
    assert.match(verdict.detail, /1\.12\.4/);
    assert.match(verdict.detail, /cdn\.app/);
  });

  it("considers a third copy, which the old two-candidate slice could never reach", () => {
    const verdict = jqueryVerdict([
      reading("https://a/jquery.js", "3.7.1"),
      reading("https://b/jquery.js", "3.6.0"),
      reading("https://c/jquery.js", "2.2.4"),
    ]);
    assert.equal(verdict.status, "fail");
    assert.match(verdict.detail, /2\.2\.4/);
    assert.match(verdict.detail, /no longer maintained/);
  });

  it("passes only when every readable copy is at or past the fix", () => {
    const verdict = jqueryVerdict([reading("https://a/jquery.js", "3.7.1"), reading("https://b/jquery.js", "3.5.0")]);
    assert.equal(verdict.status, "pass");
    assert.match(verdict.detail, /3\.5\.0/);
  });

  it("says so when a copy could not be read, rather than passing silently", () => {
    const verdict = jqueryVerdict([reading("https://a/jquery.js", "3.7.1"), reading("https://b/jquery.js", null, false)]);
    assert.equal(verdict.status, "pass");
    assert.match(verdict.detail, /could not be read/);
    assert.match(verdict.detail, /could be older/);
  });

  it("is not-tested when no version could be read at all", () => {
    assert.equal(jqueryVerdict([reading("https://a/jquery.js", null, true)]).status, "not-tested");
    assert.equal(jqueryVerdict([]).status, "not-tested");
  });

  it("reads a version out of the file rather than out of the filename", () => {
    assert.equal(jqueryVersionFrom("/*! jQuery v3.7.1 | (c) OpenJS */"), "3.7.1");
    assert.equal(jqueryVersionFrom('jQuery.fn.jquery = "1.12.4";'), "1.12.4");
    assert.equal(jqueryVersionFrom("var x = 1;"), null);
  });
});

/* ── 4. frame-ancestors ──────────────────────────────────────────────────────────────────── */

describe("frameAncestorsCheck", () => {
  it("does not accept a frame-ancestors directive delivered by <meta>", () => {
    // Browsers ignore frame-ancestors in a meta tag by specification, so a pass here would credit
    // the site with a control that is not applied anywhere.
    const verdict = frameAncestorsCheck(response(), csp({ enforced: "frame-ancestors 'self'" }));
    assert.equal(verdict.status, "fail");
    assert.match(verdict.detail, /ignore/);
  });

  it("accepts a header-delivered directive", () => {
    assert.equal(frameAncestorsCheck(response(), csp({ header: "frame-ancestors 'self'" })).status, "pass");
    assert.equal(frameAncestorsCheck(response(), csp({ header: "default-src 'self'; frame-ancestors 'none'" })).status, "pass");
  });

  it("treats https: as a wildcard, exactly as the CSP script-src check does", () => {
    for (const value of ["frame-ancestors *", "frame-ancestors https:", "frame-ancestors http:"]) {
      assert.equal(frameAncestorsCheck(response(), csp({ header: value })).status, "fail", value);
    }
    // The same token, in the same position, in the check next door.
    assert.equal(cspCheck(csp({ header: "script-src https:" })).status, "warn");
    assert.equal(cspCheck(csp({ header: "script-src 'self'" })).status, "pass");
  });

  it("still accepts X-Frame-Options, including alongside an ignored meta policy", () => {
    assert.equal(frameAncestorsCheck(response({ "x-frame-options": "DENY" }), noCsp).status, "pass");
    assert.equal(frameAncestorsCheck(response({ "x-frame-options": "SAMEORIGIN" }), csp({ enforced: "frame-ancestors *" })).status, "pass");
    // ALLOW-FROM was removed from every browser; it is not protection.
    assert.equal(frameAncestorsCheck(response({ "x-frame-options": "ALLOW-FROM https://partner.example" }), noCsp).status, "fail");
  });

  it("fails when nothing restricts framing", () => {
    assert.equal(frameAncestorsCheck(response(), noCsp).status, "fail");
  });

  it("reads a meta policy case-insensitively but keeps it out of the header slot", () => {
    const $ = cheerio.load('<meta http-equiv="Content-Security-policy" content="frame-ancestors \'self\'">');
    const context = readCsp(response(), $);
    assert.equal(context.header, null);
    assert.equal(context.enforced, "frame-ancestors 'self'");
    assert.equal(frameAncestorsCheck(response(), context).status, "fail");
  });
});

/* ── 5. permissions-policy ───────────────────────────────────────────────────────────────── */

describe("permissionsPolicyCheck", () => {
  it("does not pass a policy that wildcards the sensitive capabilities", () => {
    // `camera=*, microphone=*` grants exactly what sending no header grants. It used to pass, with
    // the permissive policy printed underneath as its own evidence.
    const verdict = permissionsPolicyCheck(response({ "permissions-policy": "camera=*, microphone=*" }));
    assert.equal(verdict.status, "warn");
    assert.match(verdict.detail, /camera, microphone/);
    assert.ok(verdict.recommendation);
  });

  it("recognises the parenthesised wildcard form", () => {
    assert.deepEqual(wildcardedCapabilities("geolocation=(*)"), ["geolocation"]);
    assert.deepEqual(wildcardedCapabilities("camera=(), microphone=(self)"), []);
    assert.deepEqual(wildcardedCapabilities('payment=(self "https://pay.example")'), []);
  });

  it("ignores a wildcard on a capability nobody would be harmed by", () => {
    assert.deepEqual(wildcardedCapabilities("fullscreen=*, autoplay=*"), []);
    assert.equal(permissionsPolicyCheck(response({ "permissions-policy": "fullscreen=*" })).status, "pass");
  });

  it("passes a restrictive policy without claiming it is the right one", () => {
    const verdict = permissionsPolicyCheck(response({ "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(self)" }));
    assert.equal(verdict.status, "pass");
    assert.match(verdict.detail, /not something this check can decide|judgement/);
  });

  it("still fails an absent header and warns on the superseded one", () => {
    assert.equal(permissionsPolicyCheck(response()).status, "fail");
    assert.equal(permissionsPolicyCheck(response({ "feature-policy": "camera 'none'" })).status, "warn");
  });
});

/* ── 6. cookies: only ask for what the site can actually change ──────────────────────────── */

describe("cookie checks and ownership", () => {
  it("does not fail a storefront for vendor-set cookies missing Secure", () => {
    // `_shopify_y` is Shopify's and `_ga` is gtag's. Neither has a place in this codebase where a
    // flag could be added, so a `fail` with "add the flag where it is issued" is an instruction
    // nobody can follow.
    const verdict = cookieSecureCheck(cookies("_shopify_y=abc; Path=/", "_ga=GA1.1.x; Path=/"), true);
    assert.equal(verdict.status, "warn");
    assert.match(verdict.recommendation ?? "", /not set by the storefront|Shopify or by a third-party tag/);
  });

  it("still fails when a cookie the site owns is missing Secure", () => {
    const verdict = cookieSecureCheck(cookies("cart_session=abc; Path=/", "_ga=GA1.1.x"), true);
    assert.equal(verdict.status, "fail");
    assert.match(verdict.detail, /cart_session/);
    // The vendor cookie is still disclosed, but named as not the storefront's to change.
    assert.match(verdict.detail, /_ga/);
    assert.match(verdict.detail, /not the storefront's to change/);
  });

  it("passes when every cookie carries Secure", () => {
    assert.equal(cookieSecureCheck(cookies("a=b; Secure", "_ga=x; Secure"), true).status, "pass");
  });

  it("applies the same ownership split to SameSite", () => {
    const vendorOnly = cookieSameSiteCheck(cookies("_shopify_s=abc; Secure", "_fbp=fb.1.2; Secure"));
    assert.equal(vendorOnly.status, "warn");
    assert.match(vendorOnly.recommendation ?? "", /Shopify or by a third-party tag/);

    const siteOwned = cookieSameSiteCheck(cookies("cart=abc; Secure", "_shopify_s=abc; Secure"));
    assert.equal(siteOwned.status, "warn");
    assert.match(siteOwned.recommendation ?? "", /cart/);
  });

  it("keeps SameSite=None without Secure a failure, and says whose it is", () => {
    const verdict = cookieSameSiteCheck(cookies("checkout=abc; SameSite=None"));
    assert.equal(verdict.status, "fail");
    assert.match(verdict.recommendation ?? "", /checkout/);
  });

  it("asks for HttpOnly only on session cookies the storefront owns", () => {
    assert.equal(cookieHttpOnlyCheck(cookies("_shopify_sa_t=abc", "_ga=x")).status, "not-tested");
    assert.equal(cookieHttpOnlyCheck(cookies("customer_session=abc; Secure")).status, "fail");
    assert.equal(cookieHttpOnlyCheck(cookies("customer_session=abc; Secure; HttpOnly")).status, "pass");
  });

  it("never quotes a cookie value back into the report", () => {
    const verdict = cookieSecureCheck(cookies("session_id=THE-ACTUAL-CREDENTIAL"), true);
    assert.ok(!JSON.stringify(verdict).includes("THE-ACTUAL-CREDENTIAL"));
  });
});

/* ── 7. mixed content vs upgrade-insecure-requests ───────────────────────────────────────── */

describe("mixedContentCheck", () => {
  const withScript = cheerio.load('<html><body><script src="http://cdn.example/a.js"></script></body></html>');
  const withImage = cheerio.load('<html><body><img src="http://cdn.example/a.png"></body></html>');

  it("does not call active content broken on a site that upgrades it", () => {
    // upgrade-insecure-requests rewrites these to https:// before the request is made, so "these
    // are broken as well as insecure" would be a false statement about a page that renders fine.
    const verdict = mixedContentCheck(withScript, true, csp({ header: "upgrade-insecure-requests" }));
    assert.equal(verdict.status, "warn");
    assert.match(verdict.detail, /rewrite each of these to https/);
    assert.ok(!/blocked outright|broken as well as insecure/.test(verdict.detail));
  });

  it("still fails active content with no upgrade directive", () => {
    const verdict = mixedContentCheck(withScript, true, noCsp);
    assert.equal(verdict.status, "fail");
    assert.match(verdict.detail, /block insecure active content/);
  });

  it("honours the directive from a meta policy, which browsers do apply for this one", () => {
    assert.equal(mixedContentCheck(withScript, true, csp({ enforced: "upgrade-insecure-requests" })).status, "warn");
  });

  it("warns on passive content and passes on a clean page", () => {
    assert.equal(mixedContentCheck(withImage, true, noCsp).status, "warn");
    assert.equal(mixedContentCheck(cheerio.load('<img src="https://cdn.example/a.png">'), true, noCsp).status, "pass");
  });

  it("is not-tested on a plaintext page, where nothing is mixed", () => {
    assert.equal(mixedContentCheck(withScript, false, noCsp).status, "not-tested");
  });
});

/* ── 8. TLS: an incomplete chain is not an outage ────────────────────────────────────────── */

describe("certificateVerdict", () => {
  const now = Date.parse("2026-01-01T00:00:00Z");
  const base = { subject: "shop.example", issuer: "Let's Encrypt", validTo: "Dec 31 00:00:00 2026 GMT" };

  it("classifies the error codes it acts on", () => {
    assert.equal(classifyCertError("UNABLE_TO_VERIFY_LEAF_SIGNATURE"), "incomplete-chain");
    assert.equal(classifyCertError("CERT_HAS_EXPIRED"), "hard-trust");
    assert.equal(classifyCertError("ERR_TLS_CERT_ALTNAME_INVALID"), "hard-trust");
    assert.equal(classifyCertError("SOMETHING_NEW"), "unclassified");
    assert.equal(classifyCertError(undefined), "unclassified");
  });

  it("does not claim visitors see a warning when the chain is merely incomplete", () => {
    // Node stops where the served chain stops; browsers follow the certificate's AIA extension and
    // complete it themselves. Reporting `critical` here — "visitors reach an interstitial browser
    // warning" — would be a false statement about a site that loads fine in every browser.
    const verdict = certificateVerdict({ ...base, authorized: false, authorizationError: "UNABLE_TO_VERIFY_LEAF_SIGNATURE" }, "shop.example", now);
    assert.equal(verdict.status, "warn");
    assert.notEqual(verdict.severity, "critical");
    assert.ok(!/interstitial/.test(verdict.detail));
    assert.match(verdict.detail, /AIA/);
  });

  it("keeps a genuinely untrusted leaf critical, and says why the browser cannot save it", () => {
    const verdict = certificateVerdict({ ...base, authorized: false, authorizationError: "CERT_HAS_EXPIRED" }, "shop.example", now);
    assert.equal(verdict.status, "fail");
    assert.equal(verdict.severity, "critical");
    assert.match(verdict.detail, /interstitial/);
  });

  it("reports an unrecognised error without claiming what a browser does with it", () => {
    const verdict = certificateVerdict({ ...base, authorized: false, authorizationError: "SOME_NEW_OPENSSL_CODE" }, "shop.example", now);
    assert.equal(verdict.status, "fail");
    assert.ok(!/interstitial/.test(verdict.detail));
    assert.match(verdict.detail, /makes no claim/);
  });

  it("still reads expiry off a valid certificate", () => {
    assert.equal(certificateVerdict({ ...base, authorized: true }, "shop.example", now).status, "pass");
    assert.equal(certificateVerdict({ ...base, authorized: true, validTo: "Jan 5 00:00:00 2026 GMT" }, "shop.example", now).status, "warn");
    assert.equal(certificateVerdict({ ...base, authorized: true, validTo: "Dec 1 00:00:00 2025 GMT" }, "shop.example", now).status, "fail");
    assert.equal(certificateVerdict({ ...base, authorized: true, validTo: undefined }, "shop.example", now).status, "not-tested");
  });
});

/* ── header checks that the guard depends on behaving normally ───────────────────────────── */

describe("header checks", () => {
  it("reads HSTS max-age and scope", () => {
    assert.equal(hstsCheck(response({ "strict-transport-security": "max-age=31536000; includeSubDomains" }), true).status, "pass");
    assert.equal(hstsCheck(response({ "strict-transport-security": "max-age=600" }), true).status, "warn");
    assert.equal(hstsCheck(response({ "strict-transport-security": "max-age=0" }), true).status, "fail");
    assert.equal(hstsCheck(response(), true).status, "fail");
    assert.equal(hstsCheck(response({ "strict-transport-security": "max-age=31536000" }), false).status, "not-tested");
  });

  it("only fails version disclosure on an actual version", () => {
    assert.equal(versionDisclosureCheck(response({ server: "nginx/1.25.3" })).status, "fail");
    assert.equal(versionDisclosureCheck(response({ server: "cloudflare" })).status, "pass");
    assert.equal(versionDisclosureCheck(response({ "x-powered-by": "Express" })).status, "warn");
  });
});
