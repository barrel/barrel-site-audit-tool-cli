import type {
  CmpVendor,
  ConsentSection,
  ConsentSiteExpectations,
  ConsentStateCapture,
  ConsentTestResult,
  ConsentTotals,
  ConsentTrackerHit,
} from "@barrel/site-audit-shared";
import { type EngineResult, type RawStateCapture, runConsentEngine } from "./engine.js";
import { runTests } from "./testcases.js";
import { trackerById } from "./trackers.js";

export { SUITE_NAMES, TEST_DEFS } from "./testcases.js";
export { TRACKERS } from "./trackers.js";
export type { EngineResult } from "./engine.js";

export interface AnalyzeConsentOptions {
  expectedCmp?: CmpVendor | "unknown";
  expect?: ConsentSiteExpectations;
  region?: string;
  onStage?: (stage: string) => void;
  /** Re-run the whole scan once when a blocker-severity test fails, and mark anything that
   * disagrees between the two runs `flaky` rather than reporting it as fact.
   *
   * Scoped to blockers on purpose: those are the findings that start a client conversation, so
   * they are worth paying a second full run to confirm — while a clean site never pays the cost
   * at all. Default on. */
  retryOnBlocker?: boolean;
  /** Persists a state's banner screenshot somewhere durable and returns its pathname. Injected
   * rather than imported so the analyzer has no dependency on Blob (or on there being a store). */
  uploadScreenshot?: (state: string, image: Buffer) => Promise<string | null>;
  /** Wall-clock budget per engine pass. The confirmation pass gets its own budget, so a site that
   * used its whole allowance on the first pass can still be re-checked rather than silently
   * skipping the confirmation. */
  budgetMs?: number;
}

const PENALTY: Record<string, number> = { blocker: 35, error: 15, warning: 5, info: 2 };
/** A flaky result is a partial signal — it costs something, but far less than a confirmed fail. */
const FLAKY_PENALTY = 8;

export async function analyzeConsent(url: string, options: AnalyzeConsentOptions = {}): Promise<ConsentSection> {
  const region = options.region ?? "us";
  const expect = options.expect ?? {};
  const stage = options.onStage;

  let engine = await runConsentEngine(url, {
    expectedCmp: options.expectedCmp,
    onStage: stage,
    captureScreenshots: true,
    budgetMs: options.budgetMs,
  });

  const policyLinkStatus = await checkPolicyLink(engine);
  let tests = runTests({ engine, expect, region, policyLinkStatus });

  if (options.retryOnBlocker !== false && tests.some((t) => t.severity === "blocker" && t.status === "fail")) {
    stage?.("Consent: confirming blocker findings (second pass)");
    const second = await runConsentEngine(url, {
      expectedCmp: options.expectedCmp,
      onStage: undefined,
      captureScreenshots: false,
      budgetMs: options.budgetMs,
    }).catch(() => null);
    if (second) {
      const secondTests = runTests({ engine: second, expect, region, policyLinkStatus });
      tests = reconcile(tests, secondTests);
      // Keep the first run's captures: they carry the screenshots, and the second pass exists to
      // corroborate the verdicts rather than to replace the evidence behind them.
    }
  }

  const states = await Promise.all(engine.states.map((s) => toStateCapture(s, options.uploadScreenshot)));
  attachScreenshots(tests, states);

  const totals = tally(tests);
  return {
    score: scoreOf(tests, engine),
    cmp: engine.cmp,
    cmpDetail: engine.fatalError ?? engine.cmpLabel,
    region,
    states,
    trackers: trackerMatrix(engine),
    tests,
    totals,
    impliedConsent: engine.optOutModel ? engine.optOutReason : undefined,
  };
}

/** Where the two passes disagree, the honest answer is neither verdict. */
function reconcile(first: ConsentTestResult[], second: ConsentTestResult[]): ConsentTestResult[] {
  return first.map((a) => {
    const b = second.find((t) => t.id === a.id);
    if (!b || a.status === b.status) return a;
    return {
      ...a,
      status: "flaky" as const,
      detail: `Inconsistent across two runs — first: ${a.status} ("${a.detail}"); second: ${b.status} ("${b.detail}").`,
      recommendation:
        a.recommendation ??
        "Re-run this site on its own to confirm. Intermittent results usually mean a tag is racing the CMP, firing or not depending on network timing — which is itself worth fixing.",
    };
  });
}

/** Points a failed test at the screenshot for the state it read from, so the report can show what
 * the banner actually looked like at the moment the assertion was made. */
function attachScreenshots(tests: ConsentTestResult[], states: ConsentStateCapture[]): void {
  const suiteState: Record<string, string> = { A: "clean", B: "clean", C: "reject", D: "accept", E: "returning", F: "granular", G: "clean" };
  // Per-test overrides where the suite's usual state isn't the one the assertion read from.
  // G4 gets none at all: its evidence comes from the GPC probe, and showing a screenshot of an
  // ordinary visit beside it would be evidence of the wrong thing.
  const testState: Record<string, string | null> = { G2: "accept", G4: null };
  for (const test of tests) {
    if (test.status !== "fail" && test.status !== "flaky") continue;
    const target = test.id in testState ? testState[test.id] : suiteState[test.suite];
    if (!target) continue;
    const path = states.find((s) => s.state === target)?.screenshotPath;
    if (!path) continue;
    test.evidence = { ...(test.evidence ?? {}), screenshotPath: path };
  }
}

async function toStateCapture(
  raw: RawStateCapture,
  upload?: (state: string, image: Buffer) => Promise<string | null>,
): Promise<ConsentStateCapture> {
  const screenshotPath = raw.screenshot && upload ? ((await upload(raw.state, raw.screenshot).catch(() => null)) ?? undefined) : undefined;
  return {
    state: raw.state,
    reached: raw.reached,
    blockedReason: raw.blockedReason,
    cookies: raw.cookies,
    trackers: Array.from(new Set([...raw.trackersPre, ...raw.trackersPost])),
    requestCount: raw.requestCount,
    consentMode: raw.consentMode,
    shopifyConsent: raw.shopifyConsent,
    screenshotPath,
  };
}

/** The state × tracker grid: for each tag seen anywhere, which states it fired in. Reading a row
 * across is how you tell a correctly gated tag from one that ignores the banner. */
function trackerMatrix(engine: EngineResult): ConsentTrackerHit[] {
  const byId = new Map<string, ConsentTrackerHit>();
  for (const state of engine.states) {
    for (const id of new Set([...state.trackersPre, ...state.trackersPost])) {
      const sig = trackerById(id);
      if (!sig) continue;
      const existing = byId.get(id) ?? { id, name: sig.name, category: sig.category, firedIn: [] };
      if (!existing.firedIn.includes(state.state)) existing.firedIn.push(state.state);
      byId.set(id, existing);
    }
  }
  const order = { marketing: 0, analytics: 1, preferences: 2, essential: 3 };
  return [...byId.values()].sort((a, b) => order[a.category] - order[b.category] || a.name.localeCompare(b.name));
}

function tally(tests: ConsentTestResult[]): ConsentTotals {
  const totals: ConsentTotals = { pass: 0, fail: 0, blocked: 0, skipped: 0, flaky: 0, blockers: 0 };
  for (const t of tests) {
    totals[t.status] += 1;
    if (t.status === "fail" && t.severity === "blocker") totals.blockers += 1;
  }
  return totals;
}

function scoreOf(tests: ConsentTestResult[], engine: EngineResult): number {
  if (engine.fatalError) return 0;
  const evaluated = tests.filter((t) => t.status === "pass" || t.status === "fail" || t.status === "flaky");
  // Nothing actually got tested — a 100 here would read as "compliant" when it means "unknown".
  if (evaluated.length === 0) return 0;
  const penalty = tests.reduce((sum, t) => {
    if (t.status === "fail") return sum + (PENALTY[t.severity] ?? 5);
    if (t.status === "flaky") return sum + FLAKY_PENALTY;
    return sum;
  }, 0);
  return Math.max(0, 100 - penalty);
}

/** HEAD first, falling back to GET: a surprising number of storefront policy pages reject HEAD
 * with a 405 while serving the page perfectly well. */
async function checkPolicyLink(engine: EngineResult): Promise<number | null> {
  const clean = engine.states.find((s) => s.state === "clean");
  const href = clean?.links?.privacyPolicy;
  if (!href) return null;
  for (const method of ["HEAD", "GET"] as const) {
    try {
      const res = await fetch(href, { method, redirect: "follow", signal: AbortSignal.timeout(10_000) });
      if (res.status !== 405) return res.status;
    } catch {
      return null;
    }
  }
  return null;
}
