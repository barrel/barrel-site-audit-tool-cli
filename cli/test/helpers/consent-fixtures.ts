// Builders for a synthetic consent scan. The engine drives a real headless browser against a real
// storefront and takes minutes; every assertion in testcases.ts is nonetheless a pure function of
// the capture it produced, so the capture is what these fabricate. Nothing here opens a socket.
import type { ConsentCookie, ConsentStateId } from "@barrel/site-audit-shared";
import type { EngineResult, GpcProbe, RawStateCapture } from "../../src/analyzers/consent/engine.js";
import type { TestContext } from "../../src/analyzers/consent/testcases.js";

/** A state the browser reached, with nothing going on in it. Override only what a test is about —
 * a fixture that spells out all thirty fields buries the one line that matters. */
export function reachedState(state: ConsentStateId, over: Partial<RawStateCapture> = {}): RawStateCapture {
  return {
    state,
    reached: true,
    cookies: [],
    preChoiceCookies: [],
    trackersPre: [],
    trackersPost: [],
    transmissionsPre: [],
    transmissionsPost: [],
    scriptLoadsPre: [],
    scriptLoadsPost: [],
    requestsPre: [],
    requestsPost: [],
    requestCount: 0,
    cmpState: null,
    bannerVisible: true,
    consoleErrors: [],
    ...over,
  };
}

/** A state the scan could not get to — the case the whole `blocked` vs `fail` distinction is for. */
export function unreachedState(state: ConsentStateId, blockedReason = "The banner never appeared."): RawStateCapture {
  return { ...reachedState(state), reached: false, bannerVisible: false, blockedReason };
}

export const ALL_STATES: ConsentStateId[] = ["clean", "dismiss", "reject", "accept", "granular", "returning"];

export function gpcProbe(over: Partial<GpcProbe> = {}): GpcProbe {
  return { ran: true, marketingTrackers: [], cmpState: null, ...over };
}

export function engineResult(over: Partial<EngineResult> = {}): EngineResult {
  return {
    cmp: "cookiebot",
    cmpLabel: "Cookiebot",
    states: [],
    gpc: gpcProbe(),
    ...over,
  };
}

export function context(over: Partial<TestContext> = {}): TestContext {
  return { engine: engineResult(), expect: {}, region: "us", ...over };
}

export function cookie(name: string, over: Partial<ConsentCookie> = {}): ConsentCookie {
  return { name, domain: ".example.com", category: "marketing", expires: "session", ...over };
}
