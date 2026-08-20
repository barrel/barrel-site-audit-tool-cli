import type {
  ConsentCookie,
  ConsentEvidence,
  ConsentSeverity,
  ConsentSiteExpectations,
  ConsentStateId,
  ConsentSuiteId,
  ConsentTestResult,
  ConsentTestStatus,
} from "@barrel/site-audit-shared";
import type { EngineResult, RawStateCapture } from "./engine.js";
import { describeTransmission, isConsentDeniedPing, isTransmissionFor, trackerById } from "./trackers.js";

export interface TestContext {
  engine: EngineResult;
  expect: ConsentSiteExpectations;
  region: string;
  /** HTTP status of the privacy-policy link found on the page, or null if there was none. */
  policyLinkStatus?: number | null;
}

export type TestOutcome = Pick<ConsentTestResult, "status" | "detail" | "recommendation" | "evidence">;

export interface TestDef {
  id: string;
  suite: ConsentSuiteId;
  title: string;
  severity: ConsentSeverity;
  run(ctx: TestContext): TestOutcome;
}

/* ── helpers ─────────────────────────────────────────────────────────────────────────────── */

function state(ctx: TestContext, id: ConsentStateId): RawStateCapture | undefined {
  return ctx.engine.states.find((s) => s.state === id);
}

/** Every assertion that depends on a state runs through this. A state we couldn't reach yields
 * `blocked`, never `fail` — the difference between "this site is non-compliant" and "we couldn't
 * get far enough to say", which is the distinction the whole report's credibility rests on. */
function requireState(ctx: TestContext, id: ConsentStateId, fn: (s: RawStateCapture) => TestOutcome): TestOutcome {
  const s = state(ctx, id);
  if (!s) return { status: "blocked", detail: `The "${id}" state was never captured.` };
  if (!s.reached) {
    // A CMP running an opt-out model has no accept/reject flow to drive, so these assertions are
    // not testable rather than untested. Reported `skipped` only on the engine's positive
    // finding that every category was granted with no banner shown — never inferred from a
    // missing banner alone, because "the banner is broken" produces exactly the same silence and
    // must keep reading as a coverage gap.
    if (ctx.engine.optOutModel) return skip(ctx.engine.optOutReason ?? "No consent choice is offered in this region.");
    return { status: "blocked", detail: s.blockedReason ?? `The "${id}" state could not be reached.` };
  }
  return fn(s);
}

function names(ids: string[]): string {
  return ids.map((id) => trackerById(id)?.name ?? id).join(", ");
}

function marketingIn(ids: string[]): string[] {
  return ids.filter((id) => trackerById(id)?.category === "marketing");
}

function analyticsIn(ids: string[]): string[] {
  return ids.filter((id) => trackerById(id)?.category === "analytics");
}

/** Narrows a state's captured request list to the trackers a finding actually names.
 *
 * Without this the evidence is merely "some tracker URLs from that page load", which reads as
 * corroboration while proving nothing — the reader checks the URL, sees a different vendor than
 * the one in the sentence above it, and stops trusting the whole report. */
function urlsFor(ids: string[], urls: string[]): string[] {
  const sigs = ids.map((id) => trackerById(id)).filter((s): s is NonNullable<typeof s> => Boolean(s));
  return urls
    // Denied Consent Mode pings are excluded here for the same reason they no longer count as a
    // fire: quoting one under "this tag fired after reject" hands the reader a URL that, read
    // closely, says the opposite.
    .filter((u) => sigs.some((s) => s.pattern.test(u) && !isConsentDeniedPing(u, s.category)))
    .slice(0, 10);
}

/** Cookies Shopify sets itself, rather than a third-party tag setting them.
 *
 * They are still marketing/analytics cookies dropped before a choice, so they are still reported.
 * What differs is the remedy: there is no script tag to block, because Shopify writes these and
 * gates them through its own Customer Privacy API. Listing them beside `_fbp` under "block these
 * tags" prescribes a fix that cannot be applied, which is how a report earns the reputation of
 * not knowing the platform it is auditing. */
const SHOPIFY_OWNED = /^_shopify_/i;

function splitByOwner(cookies: ConsentCookie[]): { shopify: ConsentCookie[]; thirdParty: ConsentCookie[] } {
  return {
    shopify: cookies.filter((c) => SHOPIFY_OWNED.test(c.name)),
    thirdParty: cookies.filter((c) => !SHOPIFY_OWNED.test(c.name)),
  };
}

/** Evidence for a transmission finding: the endpoint plus the parameters that identify it.
 *
 * A reader has to be able to check the claim without trusting us, and a bare URL buried in a
 * hundred query parameters does not let them. `pixel id, event name` does. */
function transmissionEvidence(ids: string[], urls: string[]): string[] {
  const sigs = ids.map((id) => trackerById(id)).filter((s): s is NonNullable<typeof s> => Boolean(s));
  return urls
    .filter((u) => sigs.some((s) => s.pattern.test(u) && isTransmissionFor(u, s)))
    .map(describeTransmission)
    .slice(0, 10);
}

/** Renders cookie names, disambiguating by domain only when the same name appears on more than
 * one host — `MUID, MUID` is not a useful thing to put in front of someone. */
function cookieNames(cookies: ConsentCookie[]): string {
  const counts = new Map<string, number>();
  for (const c of cookies) counts.set(c.name, (counts.get(c.name) ?? 0) + 1);
  return cookies.map((c) => ((counts.get(c.name) ?? 0) > 1 ? `${c.name} (${c.domain})` : c.name)).join(", ");
}

function ok(detail: string, evidence?: ConsentEvidence): TestOutcome {
  return { status: "pass", detail, evidence };
}

function bad(detail: string, recommendation: string, evidence?: ConsentEvidence): TestOutcome {
  return { status: "fail", detail, recommendation, evidence };
}

function skip(detail: string): TestOutcome {
  return { status: "skipped", detail };
}

/** What an error from each vendor actually looks like.
 *
 * Matched on the vendor's own script hostnames and API names, not on its id. The id was used
 * before, which for `shopify-native` produced the regex /shopify/i — matching essentially every
 * error on a Shopify storefront. One recorded site was failed at blocker severity, and told its
 * domain-group ID had expired, on the strength of a Trekkie analytics beacon failing to reach
 * monorail-edge: nothing to do with consent, and Shopify Customer Privacy has no domain-group ID.
 * The mirror error was quieter and worse — /onetrust/i never matches a failure from
 * cdn.cookielaw.org, so genuine OneTrust faults went unattributed in every recorded run. */
const CMP_ERROR_SIGNATURE: Partial<Record<string, RegExp>> = {
  cookiebot: /cookiebot|consent\.cookiebot/i,
  onetrust: /onetrust|cookielaw\.org|otSDKStub|OptanonWrapper/i,
  osano: /osano/i,
  cookieyes: /cookieyes|cky/i,
  "shopify-native": /customerPrivacy|consent-tracking-api|shopify-pc__/i,
  heuristic: /consent|cookie/i,
};

const GRANTED = "granted";
const DENIED = "denied";
const CMV2_SIGNALS = ["ad_storage", "analytics_storage", "ad_user_data", "ad_personalization"] as const;

/* ── Suite A · Presence ──────────────────────────────────────────────────────────────────── */

const A1: TestDef = {
  id: "A1",
  suite: "A",
  title: "CMP script loads successfully",
  severity: "blocker",
  run(ctx) {
    if (ctx.engine.cmp === "none") {
      return bad(
        "No consent-management platform was detected on the page.",
        "Install and configure a CMP, or route all tags through Shopify Customer Events so the Customer Privacy API gates them.",
      );
    }
    const clean = state(ctx, "clean");
    const cmpErrors = (clean?.consoleErrors ?? []).filter((e) => CMP_ERROR_SIGNATURE[ctx.engine.cmp]?.test(e) ?? false);
    if (cmpErrors.length > 0) {
      return bad(
        `${ctx.engine.cmpLabel} loaded but logged ${cmpErrors.length} error(s) — often an expired or wrong domain-group ID.`,
        "Check the CMP's site/domain-group ID in the theme against the one in the vendor dashboard.",
        { notes: cmpErrors },
      );
    }
    return ok(`${ctx.engine.cmpLabel} loaded and is responding to its JS API.`);
  },
};

const A2: TestDef = {
  id: "A2",
  suite: "A",
  title: "Banner is visible on a clean load",
  severity: "blocker",
  run(ctx) {
    if (ctx.expect.banner === false) return skip("sites.yml records that this site intentionally shows no banner.");
    return requireState(ctx, "clean", (s) =>
      s.bannerVisible
        ? ok("The consent banner appeared for a first-time visitor.")
        : bad(
            "No consent banner appeared on a clean first load.",
            "Check the CMP's geo-targeting rules — a banner scoped to the EU only will not show for a US visitor, which leaves US privacy laws unaddressed.",
            { screenshotPath: undefined },
          ),
    );
  },
};

const A3: TestDef = {
  id: "A3",
  suite: "A",
  title: "Reject is offered at the same prominence as Accept",
  severity: "warning",
  run(ctx) {
    return requireState(ctx, "clean", (s) => {
      const b = s.buttons;
      if (!b || !b.accept.found) return skip("No accept control was found to compare against.");
      if (!b.reject.found) {
        return bad(
          "The banner offers Accept but no top-level Reject control.",
          "Add a reject/decline button to the first layer of the banner. Burying rejection one click deeper than acceptance is the most commonly cited dark pattern in consent enforcement actions.",
        );
      }
      const ratio = b.reject.area / Math.max(b.accept.area, 1);
      return ratio >= 0.5
        ? ok(`Reject is ${Math.round(ratio * 100)}% the size of Accept.`)
        : bad(
            `Reject is only ${Math.round(ratio * 100)}% the visual size of Accept.`,
            "Give the reject control comparable size and contrast to the accept control.",
          );
    });
  },
};

const A4: TestDef = {
  id: "A4",
  suite: "A",
  title: "No JavaScript errors during the consent flow",
  severity: "warning",
  run(ctx) {
    return requireState(ctx, "clean", (s) => {
      if (s.consoleErrors.length === 0) return ok("No console errors during the clean load.");

      // Errors are separated by origin because the previous version was not, and said so anyway.
      // It was titled "console errors from the CMP" while counting every error on the page, and
      // across a 23-site fleet not one cited error came from a consent platform — they were
      // undefined theme variables, 404s and React warnings. A finding a developer can disprove in
      // ten seconds costs more than it is worth, because the next one gets disbelieved too.
      const vendor = new RegExp(ctx.engine.cmp.replace("-native", ""), "i");
      const fromCmp = s.consoleErrors.filter((e) => vendor.test(e));
      const rest = s.consoleErrors.length - fromCmp.length;

      const detail =
        fromCmp.length > 0
          ? `${fromCmp.length} console error(s) came from ${ctx.engine.cmpLabel}${rest > 0 ? `, alongside ${rest} from the page itself` : ""}.`
          : `${rest} console error(s) during load, none of them from ${ctx.engine.cmpLabel}.`;

      return {
        status: "fail",
        detail,
        recommendation:
          fromCmp.length > 0
            ? "A CMP that throws during init often fails open, allowing the tags it was meant to block. Fix these first — see A1."
            : "Not a consent fault, and listed here because a page erroring during load can leave a correctly-configured CMP half-initialised. Worth clearing, but it is theme JavaScript rather than a consent problem.",
        evidence: { notes: s.consoleErrors },
      };
    });
  },
};

/* ── Suite B · Pre-consent ───────────────────────────────────────────────────────────────── */

const B1: TestDef = {
  id: "B1",
  suite: "B",
  title: "No marketing cookies before any interaction",
  severity: "blocker",
  run(ctx) {
    if (ctx.expect.preConsentMarketing === true) return skip("sites.yml records a signed-off exception for pre-consent marketing.");
    return requireState(ctx, "clean", (s) => {
      const hits = s.cookies.filter((c) => c.category === "marketing");
      if (hits.length === 0) return ok("No marketing cookies were set before a consent choice.");
      const { shopify, thirdParty } = splitByOwner(hits);
      const detail =
        thirdParty.length > 0 && shopify.length > 0
          ? `${thirdParty.length} third-party marketing cookie(s) set before any consent choice: ${cookieNames(thirdParty)}. Shopify also set ${cookieNames(shopify)} itself.`
          : thirdParty.length > 0
            ? `${thirdParty.length} marketing cookie(s) set before any consent choice: ${cookieNames(thirdParty)}.`
            : `${shopify.length} Shopify-set marketing cookie(s) before any consent choice: ${cookieNames(shopify)}.`;
      const fix =
        thirdParty.length > 0
          ? "Block these tags until consent is granted — via the CMP's script blocking, or by moving the tag into Shopify Customer Events." +
            (shopify.length > 0
              ? " The `_shopify_*` cookies are set by Shopify itself and have no script tag to block; they stop when the CMP is wired to Shopify's Customer Privacy API (see C4)."
              : "")
          : "These are set by Shopify itself, not by a third-party tag, so there is nothing to block. Wire the CMP to Shopify's Customer Privacy API so Shopify gates them (see C4).";
      return bad(detail, fix, { cookies: hits });
    });
  },
};

const B2: TestDef = {
  id: "B2",
  suite: "B",
  title: "No marketing data transmitted before any interaction",
  severity: "blocker",
  run(ctx) {
    if (ctx.expect.preConsentMarketing === true) return skip("sites.yml records a signed-off exception for pre-consent marketing.");
    return requireState(ctx, "clean", (s) => {
      const hits = marketingIn(s.transmissionsPre);
      return hits.length === 0
        ? ok("No marketing tag transmitted anything before a consent choice.")
        : bad(
            `${names(hits)} transmitted visitor data before any consent choice was made.`,
            "Gate these tags behind the CMP so no request carrying visitor data is made until consent is granted — via the CMP's script blocking, or by moving the tag into Shopify Customer Events.",
            { requests: transmissionEvidence(hits, s.requestsPre) },
          );
    });
  },
};

const B3: TestDef = {
  id: "B3",
  suite: "B",
  title: "No analytics cookies or calls before any interaction",
  severity: "error",
  run(ctx) {
    return requireState(ctx, "clean", (s) => {
      const cookies = s.cookies.filter((c) => c.category === "analytics");
      const tags = analyticsIn(s.transmissionsPre);
      if (cookies.length === 0 && tags.length === 0) return ok("No analytics activity before a consent choice.");
      const parts: string[] = [];
      if (tags.length) parts.push(`${names(tags)} fired`);
      if (cookies.length) parts.push(`${cookies.length} analytics cookie(s) set (${cookieNames(cookies)})`);
      const { shopify } = splitByOwner(cookies);
      return bad(
        `${parts.join("; ")} before any consent choice.`,
        "Set Google Consent Mode defaults to denied and let the CMP grant analytics_storage on acceptance, so GA4 runs in cookieless ping mode until then." +
          (shopify.length > 0
            ? ` The ${cookieNames(shopify)} cookie(s) are Shopify's own and are gated by its Customer Privacy API rather than by a script tag (see C4).`
            : ""),
        { cookies, requests: transmissionEvidence(tags, s.requestsPre) },
      );
    });
  },
};

const B4: TestDef = {
  id: "B4",
  suite: "B",
  title: "Google Consent Mode v2 default is denied",
  severity: "error",
  run(ctx) {
    if (ctx.expect.consentModeV2 === false) return skip("sites.yml records that this site does not use Google Consent Mode.");
    return requireState(ctx, "clean", (s) => {
      const def = s.consentMode?.default;
      if (!def) {
        return bad(
          "No gtag('consent','default',…) call was observed before tags loaded.",
          "Add a Consent Mode default block that denies ad_storage, analytics_storage, ad_user_data and ad_personalization, placed above the GTM/gtag snippet in theme.liquid.",
        );
      }
      const granted = CMV2_SIGNALS.filter((k) => def[k] === GRANTED);
      return granted.length === 0
        ? ok("Consent Mode defaults deny all four v2 signals.")
        : bad(
            `Consent Mode defaults already grant ${granted.join(", ")} before the visitor has chosen.`,
            "Set every v2 signal to 'denied' in the default call; grant them only in the update call the CMP fires on acceptance.",
            { notes: [JSON.stringify(def)] },
          );
    });
  },
};

const B5: TestDef = {
  id: "B5",
  suite: "B",
  title: "No marketing vendor's script is loaded before any interaction",
  severity: "warning",
  run(ctx) {
    if (ctx.expect.preConsentMarketing === true) return skip("sites.yml records a signed-off exception for pre-consent marketing.");
    return requireState(ctx, "clean", (s) => {
      const hits = marketingIn(s.scriptLoadsPre);
      return hits.length === 0
        ? ok("No marketing vendor's script was fetched before a consent choice.")
        : bad(
            `${names(hits)} had its script fetched before any consent choice, though no visitor data was sent.`,
            "Weaker than a transmission and reported separately for that reason: fetching the script discloses the visitor's IP address and the page they were on to the vendor, which some readings of GDPR treat as a transfer in itself. If that reading matters for this site's audience, block the script tag until consent is granted rather than only the events.",
            { requests: urlsFor(hits, s.requestsPre) },
          );
    });
  },
};

/* ── Suite C · Reject ────────────────────────────────────────────────────────────────────── */

const C1: TestDef = {
  id: "C1",
  suite: "C",
  title: "No marketing data is transmitted after reject",
  severity: "blocker",
  run(ctx) {
    return requireState(ctx, "reject", (s) => {
      const hits = marketingIn(s.transmissionsPost);
      return hits.length === 0
        ? ok("No marketing tag transmitted anything after the visitor rejected.")
        : bad(
            `${names(hits)} transmitted visitor data even after the visitor rejected consent.`,
            "This is the core failure this scan exists to find. Check that these tags are registered with the CMP's blocking mechanism — a tag injected by an app or hardcoded in theme.liquid is invisible to a CMP that only rewrites script tags it knows about.",
            { requests: transmissionEvidence(hits, s.requestsPost) },
          );
    });
  },
};

const C2: TestDef = {
  id: "C2",
  suite: "C",
  title: "Non-essential cookies set before the choice are cleared",
  severity: "error",
  run(ctx) {
    return requireState(ctx, "reject", (s) => {
      const before = s.preChoiceCookies.filter((c) => c.category === "marketing" || c.category === "analytics");
      if (before.length === 0) return ok("No non-essential cookies existed before the choice, so nothing needed clearing.");
      const stillThere = before.filter((b) => s.cookies.some((c) => c.name === b.name && c.domain === b.domain));
      return stillThere.length === 0
        ? ok(`All ${before.length} pre-choice non-essential cookie(s) were cleared on reject.`)
        : bad(
            `${stillThere.length} non-essential cookie(s) survived the rejection: ${cookieNames(stillThere)}.`,
            "Enable the CMP's cookie-cleanup on withdrawal, or clear these explicitly in the consent-changed callback. Rejecting must remove what was set, not just stop new writes.",
            { cookies: stillThere },
          );
    });
  },
};

const C3: TestDef = {
  id: "C3",
  suite: "C",
  title: "Consent Mode update fires with denied signals",
  severity: "error",
  run(ctx) {
    if (ctx.expect.consentModeV2 === false) return skip("sites.yml records that this site does not use Google Consent Mode.");
    return requireState(ctx, "reject", (s) => {
      const update = s.consentMode?.update;
      if (!update) return skip("No Consent Mode update call was observed — the defaults still stand, which is the safe state.");
      const granted = CMV2_SIGNALS.filter((k) => update[k] === GRANTED);
      return granted.length === 0
        ? ok("The update call denies every v2 signal.")
        : bad(
            `The update call granted ${granted.join(", ")} despite the visitor rejecting.`,
            "Check the CMP's Consent Mode integration mapping — the categories are almost certainly wired to the wrong signals.",
            { notes: [JSON.stringify(update)] },
          );
    });
  },
};

const C4: TestDef = {
  id: "C4",
  suite: "C",
  title: "Shopify Customer Privacy API reflects the rejection",
  severity: "error",
  run(ctx) {
    return requireState(ctx, "reject", (s) => {
      const sp = s.shopifyConsent;
      if (!sp || sp.marketingAllowed === undefined) return skip("Shopify's Customer Privacy API is not present on this storefront.");
      if (sp.marketingAllowed === false && sp.analyticsAllowed !== true) {
        return ok("Shopify's Customer Privacy API records the rejection.");
      }

      // The banner working and Shopify never hearing about it is a distinct, common and
      // specifically diagnosable fault: the vendor's script is on the page, its own state records
      // the rejection, and the Shopify connector that carries that decision across was never
      // installed. Everything running through Customer Events keeps firing, and the site looks
      // compliant from the outside because the banner does visibly respond.
      const vendorCmp = ctx.engine.cmp !== "shopify-native" && ctx.engine.cmp !== "none";
      const cmpRecordedIt = s.cmpState?.marketing === false;

      if (vendorCmp && cmpRecordedIt) {
        return bad(
          `${ctx.engine.cmpLabel} recorded the rejection, but Shopify still reports marketingAllowed=${sp.marketingAllowed}, analyticsAllowed=${sp.analyticsAllowed}. The banner is working and the decision is not reaching Shopify.`,
          `The usual cause is that ${ctx.engine.cmpLabel}'s script is installed on the storefront but its Shopify app is not, so nothing calls Shopify.customerPrivacy.setTrackingConsent() when the visitor chooses. Install the vendor's Shopify integration, or call setTrackingConsent() directly from the CMP's consent-changed callback. Until then every tag registered as a Customer Event or Web Pixel keeps firing no matter what the banner says — and the site will look compliant to anyone who only watches the banner respond.`,
          { notes: [JSON.stringify({ shopify: sp, cmp: s.cmpState })] },
        );
      }

      return bad(
        `Shopify still reports marketingAllowed=${sp.marketingAllowed}, analyticsAllowed=${sp.analyticsAllowed} after a rejection.`,
        "Wire the CMP's consent-changed callback to Shopify.customerPrivacy.setTrackingConsent(). Without it, every tag running through Customer Events keeps firing regardless of what the banner says.",
        { notes: [JSON.stringify(sp)] },
      );
    });
  },
};

const C5: TestDef = {
  id: "C5",
  suite: "C",
  title: "No marketing vendor's script is loaded after reject",
  severity: "warning",
  run(ctx) {
    return requireState(ctx, "reject", (s) => {
      const hits = marketingIn(s.scriptLoadsPost);
      return hits.length === 0
        ? ok("No marketing vendor's script was fetched after rejecting.")
        : bad(
            `${names(hits)} had its script fetched after the visitor rejected, though no visitor data was sent.`,
            "No event data left the browser, so this is not the same failure as C1. It still means the vendor was told the visitor's IP and the page they were on after they opted out — worth closing if this site serves an audience where that reading applies.",
            { requests: urlsFor(hits, s.requestsPost) },
          );
    });
  },
};

/* ── Suite D · Accept ────────────────────────────────────────────────────────────────────── */

const D1: TestDef = {
  id: "D1",
  suite: "D",
  title: "Expected trackers do fire after accept",
  severity: "error",
  run(ctx) {
    return requireState(ctx, "accept", (s) => {
      // Anything seen firing anywhere in the run proves the site has tags to gate at all. On a
      // storefront with no tags there is nothing to assert, and claiming a pass would be noise.
      const anywhere = new Set(ctx.engine.states.flatMap((st) => [...st.trackersPre, ...st.trackersPost]));
      const gateable = [...anywhere].filter((id) => {
        const cat = trackerById(id)?.category;
        return cat === "marketing" || cat === "analytics";
      });
      if (gateable.length === 0) return skip("No marketing or analytics tags were observed on this storefront at all.");

      const fired = [...marketingIn(s.transmissionsPost), ...analyticsIn(s.transmissionsPost)];
      return fired.length > 0
        ? ok(`${names(fired)} fired after accepting, so consent is being honoured in both directions.`)
        : bad(
            `Tags exist on this site (${names(gateable)}) but none fired after the visitor accepted.`,
            "A CMP that blocks everything permanently passes every reject test and is still broken — it is silently destroying attribution and ad optimisation. Check that the CMP actually unblocks on acceptance.",
          );
    });
  },
};

const D2: TestDef = {
  id: "D2",
  suite: "D",
  title: "Consent Mode update grants all four v2 signals",
  severity: "error",
  run(ctx) {
    if (ctx.expect.consentModeV2 === false) return skip("sites.yml records that this site does not use Google Consent Mode.");
    return requireState(ctx, "accept", (s) => {
      const update = s.consentMode?.update;
      if (!update) {
        return bad(
          "No Consent Mode update call fired after acceptance.",
          "Without an update call, Google's tags stay in the denied default forever — conversions go unmodelled even for consenting visitors.",
        );
      }
      const missing = CMV2_SIGNALS.filter((k) => update[k] !== GRANTED);
      return missing.length === 0
        ? ok("All four v2 signals were granted on acceptance.")
        : bad(
            `The update call left ${missing.join(", ")} un-granted after full acceptance.`,
            "Map the CMP's marketing category to ad_user_data and ad_personalization as well as ad_storage — the two v2 signals are the ones most often missed.",
            { notes: [JSON.stringify(update)] },
          );
    });
  },
};

const D3: TestDef = {
  id: "D3",
  suite: "D",
  title: "Shopify Customer Privacy API reflects the acceptance",
  severity: "error",
  run(ctx) {
    return requireState(ctx, "accept", (s) => {
      const sp = s.shopifyConsent;
      if (!sp || sp.marketingAllowed === undefined) return skip("Shopify's Customer Privacy API is not present on this storefront.");
      return sp.marketingAllowed === true
        ? ok("Shopify's Customer Privacy API records the acceptance.")
        : bad(
            `Shopify still reports marketingAllowed=${sp.marketingAllowed} after full acceptance.`,
            "Wire the CMP's consent-changed callback to Shopify.customerPrivacy.setTrackingConsent() so Customer Events tags are released on acceptance.",
            { notes: [JSON.stringify(sp)] },
          );
    });
  },
};

/* ── Suite E · Persistence ───────────────────────────────────────────────────────────────── */

const E1: TestDef = {
  id: "E1",
  suite: "E",
  title: "The choice survives a reload",
  severity: "error",
  run(ctx) {
    return requireState(ctx, "returning", (s) => {
      const after = s.cmpStateAfterReload;
      if (!after) return skip(`${ctx.engine.cmpLabel} exposes no readable consent state.`);
      return after.marketing === true || after.analytics === true
        ? ok("The accepted choice was still in effect after a reload.")
        : bad(
            "The consent choice was lost on reload.",
            "Check the consent cookie's domain and expiry — a choice written to the wrong host or with a session-only lifetime is forgotten immediately.",
          );
    });
  },
};

const E2: TestDef = {
  id: "E2",
  suite: "E",
  title: "The choice survives navigation",
  severity: "error",
  run(ctx) {
    return requireState(ctx, "returning", (s) => {
      const after = s.cmpStateAfterNavigate;
      if (!after) return skip(`${ctx.engine.cmpLabel} exposes no readable consent state.`);
      return after.marketing === true || after.analytics === true
        ? ok("The accepted choice persisted across a page navigation.")
        : bad(
            "The consent choice was lost when navigating to another page.",
            "The consent cookie is probably scoped to a path rather than the whole site. Set it at path=/.",
          );
    });
  },
};

const E3: TestDef = {
  id: "E3",
  suite: "E",
  title: "Banner does not re-prompt a consented visitor",
  severity: "warning",
  run(ctx) {
    return requireState(ctx, "returning", (s) =>
      s.bannerAfterReload === false
        ? ok("The banner stayed down for a returning, consented visitor.")
        : bad(
            "The banner reappeared after the visitor had already consented.",
            "Beyond being an irritant this usually indicates the consent record isn't being read back correctly — the same fault that makes E1/E2 fail.",
          ),
    );
  },
};

const E4: TestDef = {
  id: "E4",
  suite: "E",
  title: "Banner returns after cookies are cleared",
  severity: "warning",
  run(ctx) {
    const clean = state(ctx, "clean");
    const accept = state(ctx, "accept");
    if (!accept?.reached) return { status: "blocked", detail: "No accepted state to compare a cleared browser against." };
    // Every state runs in its own fresh incognito context, so the clean load *is* the
    // cookies-cleared case — there is no separate trip to make.
    return clean?.bannerVisible
      ? ok("A cookie-free browser is prompted again, so the record is keyed to the cookie and not cached elsewhere.")
      : bad(
          "A cookie-free browser was not prompted, even though consent had been recorded in a separate session.",
          "Check for a consent record persisted in localStorage or on the server that outlives the cookie — a visitor who clears cookies must be asked again.",
        );
  },
};

/* ── Suite F · Granular ──────────────────────────────────────────────────────────────────── */

const F1: TestDef = {
  id: "F1",
  suite: "F",
  title: "Analytics-only: analytics is allowed through",
  severity: "error",
  run(ctx) {
    return requireState(ctx, "granular", (s) => {
      const anywhere = new Set(ctx.engine.states.flatMap((st) => [...st.trackersPre, ...st.trackersPost]));
      if (analyticsIn([...anywhere]).length === 0) return skip("No analytics tags exist on this storefront to grant.");
      const fired = analyticsIn(s.transmissionsPost);
      return fired.length > 0
        ? ok(`${names(fired)} transmitted under an analytics-only choice, as expected.`)
        : bad(
            "Granting analytics only did not release any analytics tag.",
            "The CMP's analytics category is probably not mapped to these tags — check the category assignment in the vendor dashboard.",
          );
    });
  },
};

const F2: TestDef = {
  id: "F2",
  suite: "F",
  title: "Analytics-only: marketing stays blocked",
  severity: "error",
  run(ctx) {
    return requireState(ctx, "granular", (s) => {
      const leaked = marketingIn(s.transmissionsPost);
      return leaked.length === 0
        ? ok("No marketing tags fired under an analytics-only choice.")
        : bad(
            `${names(leaked)} fired even though only analytics was granted.`,
            "These tags are miscategorised in the CMP — they are filed under analytics (or left uncategorised, which most CMPs treat as always-on) when they belong under marketing.",
            { requests: transmissionEvidence(leaked, s.requestsPost) },
          );
    });
  },
};

/* ── Suite G · Compliance surface ────────────────────────────────────────────────────────── */

const G1: TestDef = {
  id: "G1",
  suite: "G",
  title: "Privacy policy link present and reachable",
  severity: "warning",
  run(ctx) {
    // Through requireState, not state(): read directly, a page that never loaded produced no
    // links, and "no privacy policy link was found" is then a claim about a page nobody saw.
    // That is the coverage-gap-as-finding conflation the rest of this file exists to prevent.
    return requireState(ctx, "clean", (clean) => {
    const href = clean.links?.privacyPolicy;
    if (!href) {
      return bad("No privacy policy link was found on the page.", "Add a privacy policy link to the site footer.");
    }
    if (ctx.policyLinkStatus == null) return ok(`Privacy policy link found (${href}); reachability was not checked.`);
    return ctx.policyLinkStatus < 400
      ? ok(`Privacy policy link resolves (HTTP ${ctx.policyLinkStatus}).`)
      : bad(
          `The privacy policy link returns HTTP ${ctx.policyLinkStatus}.`,
          `Fix or replace the link target: ${href}`,
          { notes: [href] },
        );
    });
  },
};

const G2: TestDef = {
  id: "G2",
  suite: "G",
  title: "Preference centre can be reopened after a choice",
  severity: "warning",
  run(ctx) {
    return requireState(ctx, "accept", (s) => {
      if (s.preferencesReopenable === undefined) return skip(`${ctx.engine.cmpLabel} exposes no API for reopening preferences.`);
      return s.preferencesReopenable
        ? ok("The preference centre reopened after a choice had been made.")
        : bad(
            "Consent could not be changed after the initial choice.",
            "Add a persistent \"Cookie settings\" link to the footer. Withdrawal must be as easy as granting.",
          );
    });
  },
};

const G3: TestDef = {
  id: "G3",
  suite: "G",
  title: '"Do Not Sell or Share" link present',
  severity: "warning",
  run(ctx) {
    if (!ctx.region.startsWith("us") && ctx.region !== "ca-us") {
      return skip(`Not applicable to the "${ctx.region}" region.`);
    }
    return requireState(ctx, "clean", (clean) => {
    if (clean.links?.doNotSell) {
      // Present on the scanned page — but the requirement is every page, and a footer that only
      // carries the link on the homepage meets it in appearance rather than in fact.
      const returning = state(ctx, "returning");
      const second = returning?.linksAfterNavigate;
      if (returning?.reached && second && !second.doNotSell) {
        return bad(
          `A Do Not Sell / Your Privacy Choices link is present on the scanned page, but missing from ${returning.secondPageUrl ?? "a second page"}.`,
          "The opt-out has to be reachable from every page, not only the one it was first found on. Move the link into the global footer or header rather than a template that only some pages use.",
        );
      }
      return ok(
        second?.doNotSell
          ? "A Do Not Sell / Your Privacy Choices link is present, and still present after navigating to another page."
          : "A Do Not Sell / Your Privacy Choices link is present.",
      );
    }
    return bad(
      "No \"Do Not Sell or Share My Personal Information\" link was found.",
      "California, Colorado, Connecticut and several other state laws require a clearly labelled opt-out link in the footer for sites that share data with advertising partners.",
    );
    });
  },
};

const G4: TestDef = {
  id: "G4",
  suite: "G",
  title: "Global Privacy Control is honoured",
  severity: "warning",
  run(ctx) {
    const gpc = ctx.engine.gpc;
    if (!gpc.ran) return { status: "blocked", detail: "The GPC probe did not complete." };
    if (gpc.marketingTrackers.length === 0) return ok("No marketing tags transmitted for a visitor broadcasting GPC.");

    // Judged as a difference, not a snapshot. The probe makes no consent choice, so on a site
    // that transmits before anyone chooses, marketing transmits under GPC as well — for that
    // reason, not because the signal was ignored. Read as a snapshot this test failed on 18 of
    // 23 sites and on every one of them B2 had already failed too: it produced no independent
    // signal at all, while adding a second finding to the sites that could least afford one.
    const clean = state(ctx, "clean");
    const alsoWithoutGpc = clean?.reached
      ? marketingIn(clean.transmissionsPre).filter((id) => gpc.marketingTrackers.includes(id))
      : [];
    const suppressed = gpc.marketingTrackers.filter((id) => !alsoWithoutGpc.includes(id));

    if (alsoWithoutGpc.length > 0 && suppressed.length === 0) {
      return bad(
        `${names(gpc.marketingTrackers)} transmitted under a Global Privacy Control signal — but they transmit for every visitor before any choice, so the signal changed nothing rather than being specifically ignored.`,
        "The same root cause as B2: nothing is gated on consent for anyone, so there is no gate for GPC to reach. Fix the pre-consent firing first and this resolves with it — treat it as one piece of work, not two.",
        { notes: ["Sec-GPC: 1 and navigator.globalPrivacyControl were both set."] },
      );
    }

    return bad(
      `${names(suppressed.length > 0 ? suppressed : gpc.marketingTrackers)} transmitted despite a Global Privacy Control signal, on a site that does otherwise gate tags on consent.`,
      "Configure the CMP to treat GPC as an opt-out. Under CPRA, and Colorado's universal opt-out rules, the signal is a binding opt-out on its own with no click required — whether either applies to this site's visitors is a question for counsel.",
      { notes: ["Sec-GPC: 1 and navigator.globalPrivacyControl were both set."] },
    );
  },
};

const A5: TestDef = {
  id: "A5",
  suite: "A",
  title: "CMP loads before the tag manager",
  severity: "error",
  run(ctx) {
    return requireState(ctx, "clean", (s) => {
      if (s.cmpBeforeTagManager === undefined) {
        return skip("Either the CMP script or a tag manager was absent, so there is no ordering to check.");
      }
      return s.cmpBeforeTagManager
        ? ok("The CMP's script was requested before the tag manager's.")
        : bad(
            "The tag manager was requested before the CMP's own script.",
            "A CMP that loads second cannot gate what the tag manager has already fired, however correct its configuration. Move the CMP script above the GTM snippet in theme.liquid so consent state exists before any tag is evaluated.",
          );
    });
  },
};

const G5: TestDef = {
  id: "G5",
  suite: "G",
  title: "GPC opt-out is visibly confirmed to the visitor",
  severity: "warning",
  run(ctx) {
    if (!ctx.engine.gpc.ran) return { status: "blocked", detail: "The GPC probe did not complete." };
    if (ctx.region !== "us") return skip("Visible GPC confirmation is a US-state requirement; this scan ran elsewhere.");
    return ctx.engine.gpc.confirmationShown
      ? ok("The page visibly acknowledges the Global Privacy Control signal.")
      : bad(
          "No visible confirmation was shown to a visitor sending a Global Privacy Control signal.",
          "California has required a visible confirmation that the opt-out was processed since January 2026, and Colorado has a parallel rule. Honouring the signal silently satisfies only half of it — surface a notice or a persistent indicator when GPC is detected. Whether either rule applies to this site is a question for counsel.",
        );
  },
};

/* ── Suite H · Dismissal ─────────────────────────────────────────────────────────────────── */

const H1: TestDef = {
  id: "H1",
  suite: "H",
  title: "Closing the banner is not treated as consent",
  severity: "blocker",
  run(ctx) {
    return requireState(ctx, "dismiss", (s) => {
      const hits = marketingIn(s.transmissionsPost);
      return hits.length === 0
        ? ok("Closing the banner without choosing did not release any marketing tag.")
        : bad(
            `${names(hits)} transmitted visitor data after the visitor closed the banner without choosing.`,
            "Dismissing a banner is not affirmative consent, and a CMP that starts tags on close is transmitting on a choice the visitor never made. Configure the close control to leave consent undecided — the same state as before the banner was shown — rather than mapping it to accept.",
            { requests: transmissionEvidence(hits, s.requestsPost) },
          );
    });
  },
};

const H2: TestDef = {
  id: "H2",
  suite: "H",
  title: "Closing the banner does not record a consent decision",
  severity: "error",
  run(ctx) {
    return requireState(ctx, "dismiss", (s) => {
      const cmp = s.cmpState;
      const shopify = s.shopifyConsent;
      const cmpGranted = cmp ? cmp.marketing === true || cmp.analytics === true : false;
      const shopifyGranted = shopify ? shopify.marketingAllowed === true : false;
      if (!cmp && !shopify) return skip("Neither the CMP nor Shopify exposes a consent state to read after dismissal.");
      return !cmpGranted && !shopifyGranted
        ? ok("No consent was recorded when the banner was closed without a choice.")
        : bad(
            `Closing the banner recorded consent: ${JSON.stringify(cmp ?? shopify)}.`,
            "The close control is wired to accept. A visitor who dismissed the banner has not agreed to anything, and a stored 'granted' here will also suppress the banner on their next visit, so they are never asked again.",
            { notes: [JSON.stringify({ cmp, shopify })] },
          );
    });
  },
};

export const TEST_DEFS: TestDef[] = [A1, A2, A3, A4, A5, B1, B2, B3, B4, B5, C1, C2, C3, C4, C5, D1, D2, D3, E1, E2, E3, E4, F1, F2, G1, G2, G3, G4, G5, H1, H2];

export const SUITE_NAMES: Record<ConsentSuiteId, string> = {
  A: "Presence",
  B: "Pre-consent",
  C: "Reject",
  D: "Accept",
  E: "Persistence",
  F: "Granular",
  G: "Compliance surface",
  H: "Dismissal",
};

export function runTests(ctx: TestContext): ConsentTestResult[] {
  return TEST_DEFS.map((def) => {
    let outcome: TestOutcome;
    try {
      outcome = def.run(ctx);
    } catch (err: any) {
      // An assertion that throws is a bug in this tool, not a finding about the site.
      outcome = { status: "blocked" as ConsentTestStatus, detail: `Check errored: ${String(err?.message ?? err).slice(0, 160)}` };
    }
    return { id: def.id, suite: def.suite, title: def.title, severity: def.severity, ...outcome };
  });
}
