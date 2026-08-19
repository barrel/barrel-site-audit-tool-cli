import * as chromeLauncher from "chrome-launcher";
import type { Browser, BrowserContext, Page } from "puppeteer-core";
import type {
  CmpVendor,
  ConsentCookie,
  ConsentModeSignals,
  ConsentStateId,
  ShopifyConsentState,
} from "@barrel/site-audit-shared";
import { type CmpAdapter, type CmpCategoryState, type CmpPosture, detectCmp } from "./adapters/index.js";
import { categorizeCookie, matchScriptLoads, matchTrackers, matchTransmissions } from "./trackers.js";

/** How long to wait for a consent banner to appear before calling the state unreachable. */
const BANNER_TIMEOUT_MS = 12_000;
/** Settle time after initial load, before anything is read. */
const LOAD_SETTLE_MS = 3_000;
/** Settle time after a consent choice. Deliberately generous: a great many tags are injected by
 * a tag manager reacting to the consent event, so they land well after the click and a shorter
 * window produces false passes on exactly the sites that matter most. */
const POST_CHOICE_SETTLE_MS = 5_000;

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/** One network request and whether it actually got through. */
export interface ObservedRequest {
  url: string;
  completed: boolean;
  status?: number;
}

/** URLs of requests that completed. A 4xx/5xx still counts: the vendor received it and answered,
 * which is precisely the disclosure at issue — only a request that never arrived is discounted. */
export function deliveredUrls(requests: ObservedRequest[]): string[] {
  return requests.filter((r) => r.completed).map((r) => r.url);
}

export interface ButtonProbe {
  found: boolean;
  /** Rendered area in px². Used to compare Reject against Accept for the dark-pattern check. */
  area: number;
}

export interface PolicyLinks {
  privacyPolicy?: string;
  doNotSell?: string;
}

/** Everything observed in one browser state. Richer than the serialisable ConsentStateCapture —
 * the extra fields here are what the assertions read; only a summary reaches the report. */
export interface RawStateCapture {
  state: ConsentStateId;
  reached: boolean;
  blockedReason?: string;
  cookies: ConsentCookie[];
  /** Cookies present *before* the consent choice was made, for the "were they cleared?" check. */
  preChoiceCookies: ConsentCookie[];
  /** Tracker IDs that fired before the consent choice (everything, in the clean state). */
  trackersPre: string[];
  /** Tracker IDs that fired after the consent choice. */
  trackersPost: string[];
  /** Trackers that actually sent the vendor data about the visitor, script loads excluded. This
   * is what every blocker-severity assertion reads. */
  transmissionsPre: string[];
  transmissionsPost: string[];
  /** Trackers whose library was fetched without any data being sent. Reported separately and at
   * lower severity: the vendor learns an IP and a referrer, which is a weaker and more arguable
   * disclosure than an identified event. */
  scriptLoadsPre: string[];
  scriptLoadsPost: string[];
  requestsPre: string[];
  requestsPost: string[];
  requestCount: number;
  consentMode?: ConsentModeSignals;
  shopifyConsent?: ShopifyConsentState;
  cmpState: CmpCategoryState | null;
  bannerVisible: boolean;
  buttons?: { accept: ButtonProbe; reject: ButtonProbe; prefs: ButtonProbe };
  links?: PolicyLinks;
  consoleErrors: string[];
  /** A marketing interstitial covering the page — an email or SMS capture modal, a spin-to-win.
   * Recorded because it changes how the rest of the state should be read: it can sit over the
   * consent banner, and it fires its own vendor's tags on load. */
  marketingInterstitial?: string;
  screenshot?: Buffer;
  /** returning state only. */
  bannerAfterReload?: boolean;
  cmpStateAfterReload?: CmpCategoryState | null;
  trackersAfterNavigate?: string[];
  cmpStateAfterNavigate?: CmpCategoryState | null;
  /** accept state only — whether the preference centre could be reopened. */
  preferencesReopenable?: boolean;
}

export interface GpcProbe {
  ran: boolean;
  /** Marketing trackers that fired despite the GPC signal. */
  marketingTrackers: string[];
  cmpState: CmpCategoryState | null;
  shopifyConsent?: ShopifyConsentState;
}

export interface EngineResult {
  cmp: CmpVendor;
  cmpLabel: string;
  states: RawStateCapture[];
  gpc: GpcProbe;
  /** Set when the site could not be loaded at all — nothing below is meaningful. */
  fatalError?: string;
  /** True when the CMP is present but deliberately prompts nobody in this region, having already
   * decided every category in the visitor's absence — the opt-out model US-configured CMPs use.
   *
   * Kept separate from "the banner didn't show up" on purpose. Both leave the choice-driven
   * suites unrunnable, but one is a configuration the client chose and the other is something
   * broken, and a report that renders them identically makes the reader do that triage. */
  optOutModel?: boolean;
  optOutReason?: string;
}

export interface EngineOptions {
  expectedCmp?: CmpVendor | "unknown";
  onStage?: (stage: string) => void;
  captureScreenshots?: boolean;
  /** Total wall-clock budget for this site, in ms. Checked between states rather than enforced
   * with a race, so the browser is always torn down cleanly — an abandoned promise would leave a
   * headless Chrome running for the rest of the session. States not started in time are reported
   * `blocked`, which is the honest answer: they were never tested.
   *
   * Without this one pathologically slow storefront stalls an entire fleet scan behind it. */
  budgetMs?: number;
}

const DEFAULT_BUDGET_MS = 6 * 60_000;

/* ── page-context instrumentation ────────────────────────────────────────────────────────── */

/** Injected before any page script runs. Google Consent Mode's *default* call happens before the
 * first tag loads by design, so there is no way to observe it after the fact — the recorder has
 * to already be in place when the document starts executing.
 *
 * It both wraps dataLayer.push and leaves the raw array intact, because GTM replaces `push` with
 * its own implementation on init; the wrapper catches everything before that moment and the
 * post-hoc array scan catches everything after. */
const CONSENT_RECORDER = `
  window.__barrelConsent = { default: null, update: null };
  (function () {
    function record(args) {
      try {
        if (!args || args[0] !== 'consent') return;
        var mode = args[1], payload = args[2];
        if (mode === 'default' && !window.__barrelConsent.default) window.__barrelConsent.default = payload;
        if (mode === 'update') window.__barrelConsent.update = payload;
      } catch (e) {}
    }
    window.dataLayer = window.dataLayer || [];
    var orig = window.dataLayer.push.bind(window.dataLayer);
    window.dataLayer.push = function () {
      for (var i = 0; i < arguments.length; i++) {
        var a = arguments[i];
        if (a && typeof a === 'object' && typeof a.length === 'number') record(a);
      }
      return orig.apply(null, arguments);
    };
  })();
`;

/** Reads the recorder's findings, then rescans the raw dataLayer for anything GTM's own push
 * implementation swallowed after it took over. */
async function readConsentMode(page: Page): Promise<ConsentModeSignals | undefined> {
  return page
    .evaluate(() => {
      const out: { default?: Record<string, string>; update?: Record<string, string> } = {};
      const rec = (window as any).__barrelConsent;
      if (rec?.default) out.default = rec.default;
      if (rec?.update) out.update = rec.update;

      const dl = (window as any).dataLayer;
      if (Array.isArray(dl)) {
        for (const entry of dl) {
          if (!entry || typeof entry !== "object" || typeof (entry as any).length !== "number") continue;
          const args = Array.from(entry as ArrayLike<unknown>);
          if (args[0] !== "consent") continue;
          if (args[1] === "default" && !out.default) out.default = args[2] as Record<string, string>;
          if (args[1] === "update") out.update = args[2] as Record<string, string>;
        }
      }
      return out.default || out.update ? out : undefined;
    })
    .catch(() => undefined);
}

async function readShopifyConsent(page: Page): Promise<ShopifyConsentState | undefined> {
  return page
    .evaluate(() => {
      const cp = (window as any).Shopify?.customerPrivacy;
      if (!cp) return undefined;
      const call = (fn: unknown) => (typeof fn === "function" ? Boolean((fn as () => boolean)()) : undefined);
      return {
        analyticsAllowed: call(cp.analyticsProcessingAllowed),
        marketingAllowed: call(cp.marketingAllowed),
        preferencesAllowed: call(cp.preferencesAllowed),
        saleOfDataAllowed: call(cp.saleOfDataAllowed),
      };
    })
    .catch(() => undefined);
}

/** Cookies via CDP rather than page.cookies(): the Puppeteer-level helpers have moved between
 * Page and BrowserContext across recent majors, while Network.getAllCookies has not moved at all.
 * It also returns cookies for every domain in the context, not just the current document's. */
async function readCookies(page: Page): Promise<ConsentCookie[]> {
  try {
    const client = await page.createCDPSession();
    const { cookies } = (await client.send("Network.getAllCookies")) as {
      cookies: Array<{ name: string; domain: string; expires: number }>;
    };
    await client.detach().catch(() => undefined);
    return cookies.map((c) => ({
      name: c.name,
      domain: c.domain,
      category: categorizeCookie(c.name),
      expires: c.expires && c.expires > 0 ? new Date(c.expires * 1000).toISOString() : "session",
    }));
  } catch {
    return [];
  }
}

async function probeButtons(page: Page): Promise<RawStateCapture["buttons"]> {
  const patterns = {
    accept: String(/^(accept|allow|agree|got it|ok)( all| cookies| and close)?$|i (accept|agree)|enable all/i.source),
    reject: String(
      /^(reject|decline|deny|refuse)( all)?$|necessary only|only necessary|essential only|opt.?out|do not (sell|accept)|continue without/i
        .source,
    ),
    prefs: String(
      /cookie (settings|preferences)|manage (cookies|preferences|consent)|privacy (settings|preferences)|customi[sz]e/i.source,
    ),
  };
  return page
    .evaluate((p: { accept: string; reject: string; prefs: string }) => {
      const roots: Array<Document | ShadowRoot> = [document];
      for (let i = 0; i < roots.length && i < 200; i++) {
        for (const el of Array.from(roots[i].querySelectorAll("*"))) {
          const sr = (el as HTMLElement).shadowRoot;
          if (sr) roots.push(sr);
        }
      }
      const probe = (source: string) => {
        const re = new RegExp(source, "i");
        let best = { found: false, area: 0 };
        for (const root of roots) {
          for (const el of Array.from(root.querySelectorAll<HTMLElement>('button, a[href], [role="button"]'))) {
            const name = (el.getAttribute("aria-label") || el.textContent || "").trim().replace(/\s+/g, " ");
            if (!name || !re.test(name)) continue;
            const r = el.getBoundingClientRect();
            if (r.width <= 0 || r.height <= 0) continue;
            const area = r.width * r.height;
            if (area > best.area) best = { found: true, area };
          }
        }
        return best;
      };
      return { accept: probe(p.accept), reject: probe(p.reject), prefs: probe(p.prefs) };
    }, patterns)
    .catch(() => ({ accept: { found: false, area: 0 }, reject: { found: false, area: 0 }, prefs: { found: false, area: 0 } }));
}

async function probeLinks(page: Page): Promise<PolicyLinks> {
  return page
    .evaluate(() => {
      const out: { privacyPolicy?: string; doNotSell?: string } = {};
      for (const a of Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"))) {
        const text = (a.textContent || "").trim().replace(/\s+/g, " ");
        const href = a.href;
        if (!out.privacyPolicy && (/privacy\s*(policy|notice)/i.test(text) || /\/policies\/privacy|\/privacy/i.test(href))) {
          out.privacyPolicy = href;
        }
        if (!out.doNotSell && /do not sell|do not share|your privacy choices|opt.?out of sale/i.test(text)) {
          out.doNotSell = href;
        }
      }
      return out;
    })
    .catch(() => ({}));
}

/** Names any marketing popup currently covering the page.
 *
 * Not a finding in itself — plenty of stores run one deliberately. It is reported because it
 * skews everything around it: the modal can cover the consent banner, and its vendor's tags fire
 * on load regardless of consent, so a reader who cannot see that it was there has no way to
 * account for it. */
async function detectInterstitial(page: Page): Promise<string | null> {
  return safeEvalPage<string | null>(
    page,
    () => {
      const VENDORS: Array<[string, RegExp]> = [
        ["Klaviyo", /klaviyo/i],
        ["Attentive", /attentive/i],
        ["Privy", /privy/i],
        ["Justuno", /justuno/i],
        ["OptinMonster", /optinmonster/i],
        ["Wisepops", /wisepops/i],
        ["Omnisend", /omnisend/i],
        ["Postscript", /postscript/i],
      ];
      for (const el of Array.from(document.querySelectorAll<HTMLElement>("div, section, aside, dialog, form"))) {
        const rect = el.getBoundingClientRect();
        // Modal-sized and on screen; a hidden prefetched form does not count.
        if (rect.width < 240 || rect.height < 160) continue;
        const style = window.getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") continue;
        const marker = `${el.className || ""} ${el.id || ""}`;
        for (const [name, re] of VENDORS) {
          if (re.test(marker)) return name;
        }
      }
      return null;
    },
    null,
  );
}

async function safeEvalPage<T>(page: Page, fn: () => T, fallback: T): Promise<T> {
  try {
    return (await page.evaluate(fn)) as T;
  } catch {
    return fallback;
  }
}

async function isBannerVisible(page: Page, adapter: CmpAdapter | null): Promise<boolean> {
  if (!adapter) return false;
  // A short window, not the full banner timeout: by this point the page has already settled, so
  // a banner that still isn't up is genuinely absent rather than merely slow.
  return adapter.waitForBanner(page, 1500).catch(() => false);
}

/* ── the state runner ────────────────────────────────────────────────────────────────────── */

interface StateContext {
  page: Page;
  requests: ObservedRequest[];
  consoleErrors: string[];
  /** Index into `requests` marking the moment the consent choice was made. */
  choiceAt: number;
}

interface OpenOptions {
  extraHeaders?: Record<string, string>;
  /** Extra script evaluated on every new document, including after a reload or navigation. */
  initScript?: string;
}

async function openState(browser: Browser, url: string, opts: OpenOptions = {}): Promise<{ ctx: BrowserContext; state: StateContext }> {
  // A fresh incognito context per state is the whole basis of the comparison: any cookie or
  // storage bleed between states would make "did rejecting change anything?" unanswerable.
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const requests: ObservedRequest[] = [];
  // Keyed by the request object rather than the URL: a page fires the same URL repeatedly, and
  // matching responses back by string would attribute one request's outcome to another.
  const byRequest = new Map<unknown, ObservedRequest>();
  const consoleErrors: string[] = [];

  await page.setUserAgent(USER_AGENT);
  await page.setViewport({ width: 1440, height: 900 });
  if (opts.extraHeaders) await page.setExtraHTTPHeaders(opts.extraHeaders);
  await page.evaluateOnNewDocument(CONSENT_RECORDER);
  if (opts.initScript) await page.evaluateOnNewDocument(opts.initScript);

  page.on("request", (req) => {
    const record: ObservedRequest = { url: req.url(), completed: false };
    requests.push(record);
    byRequest.set(req, record);
  });
  // A request that was blocked, aborted or never answered did not tell anyone anything. Counting
  // it as a fire is the mirror image of the script-load problem: it reports a CMP that worked as
  // one that failed.
  page.on("response", (res) => {
    const record = byRequest.get(res.request());
    if (record) {
      record.completed = true;
      record.status = res.status();
    }
  });
  page.on("requestfailed", (req) => {
    const record = byRequest.get(req);
    if (record) record.completed = false;
  });
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 300));
  });
  page.on("pageerror", (err: unknown) => consoleErrors.push(String((err as Error)?.message ?? err).slice(0, 300)));

  await page.goto(url, { waitUntil: "networkidle2", timeout: 45_000 });
  await sleep(LOAD_SETTLE_MS);

  return { ctx, state: { page, requests, consoleErrors, choiceAt: 0 } };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Hard ceiling on one browser state.
 *
 * The per-site budget is only checked *between* states, so a single state that never settles —
 * a hung socket, a CMP that polls forever — stalls the whole fleet behind it with no upper
 * bound. Every individual await here already has a timeout; this is the backstop for the ones
 * that turn out not to. Rejects rather than resolves so the caller's existing catch turns it
 * into a `blocked` state with a reason, which is the honest outcome. */
async function withDeadline<T>(label: string, ms: number, work: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} did not finish within ${Math.round(ms / 1000)}s.`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Ceiling for one state: load, banner wait, choice, settle, plus room for a slow storefront. */
const STATE_DEADLINE_MS = 120_000;

/** An opt-out CMP has decided everything before the visitor arrives. Distinguishing that from a
 * banner that simply failed to render is the difference between "this is how the site is
 * configured" and "this is broken", so it is asserted positively rather than inferred from the
 * absence of a banner alone. */
function decidedWithoutAsking(cmpState: CmpCategoryState | null): boolean {
  if (!cmpState) return false;
  return cmpState.analytics === true && cmpState.marketing === true;
}

/** Trims evidence URL lists. A busy storefront fires hundreds of requests; the first handful of
 * matches proves the point and keeps the report blob to a sane size.
 *
 * Kept broad here rather than narrowed per-tracker: which tracker an assertion ends up naming
 * isn't known until the tests run, and evidence filtered to the wrong tracker is worse than no
 * evidence at all. testcases.ts narrows it to the tags it actually names. */
function evidenceUrls(urls: string[]): string[] {
  const matched = urls.filter((u) => matchTrackers([u]).length > 0);
  return Array.from(new Set(matched)).slice(0, 60);
}

async function finishCapture(
  state: ConsentStateId,
  sc: StateContext,
  adapter: CmpAdapter | null,
  opts: { screenshots: boolean; preChoiceCookies?: ConsentCookie[] },
): Promise<RawStateCapture> {
  // Only delivered requests count. A request the CMP aborted, or that never got an answer, told
  // the vendor nothing — and reporting it as a fire turns a working CMP into a failing one.
  const pre = deliveredUrls(sc.requests.slice(0, sc.choiceAt || sc.requests.length));
  const post = deliveredUrls(sc.choiceAt ? sc.requests.slice(sc.choiceAt) : []);

  const capture: RawStateCapture = {
    state,
    reached: true,
    cookies: await readCookies(sc.page),
    preChoiceCookies: opts.preChoiceCookies ?? [],
    trackersPre: matchTrackers(pre).map((t) => t.id),
    trackersPost: matchTrackers(post).map((t) => t.id),
    transmissionsPre: matchTransmissions(pre).map((t) => t.id),
    transmissionsPost: matchTransmissions(post).map((t) => t.id),
    scriptLoadsPre: matchScriptLoads(pre).map((t) => t.id),
    scriptLoadsPost: matchScriptLoads(post).map((t) => t.id),
    requestsPre: evidenceUrls(pre),
    requestsPost: evidenceUrls(post),
    requestCount: sc.requests.length,
    consentMode: await readConsentMode(sc.page),
    shopifyConsent: await readShopifyConsent(sc.page),
    cmpState: adapter ? await adapter.readState(sc.page).catch(() => null) : null,
    bannerVisible: await isBannerVisible(sc.page, adapter),
    marketingInterstitial: (await detectInterstitial(sc.page)) ?? undefined,
    consoleErrors: Array.from(new Set(sc.consoleErrors)).slice(0, 10),
  };

  if (opts.screenshots) {
    const shot = await sc.page.screenshot({ type: "jpeg", quality: 70 }).catch(() => null);
    if (shot) capture.screenshot = Buffer.from(shot);
  }
  return capture;
}

function unreachable(state: ConsentStateId, reason: string): RawStateCapture {
  return {
    state,
    reached: false,
    blockedReason: reason,
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
    bannerVisible: false,
    consoleErrors: [],
  };
}

/* ── entry point ─────────────────────────────────────────────────────────────────────────── */

export async function runConsentEngine(url: string, options: EngineOptions = {}): Promise<EngineResult> {
  const screenshots = options.captureScreenshots !== false;
  const stage = options.onStage ?? (() => undefined);
  const deadline = Date.now() + (options.budgetMs ?? DEFAULT_BUDGET_MS);
  const outOfTime = () => Date.now() > deadline;
  const BUDGET_REASON = "Per-site time budget exceeded before this state could be run.";

  const chrome = await chromeLauncher.launch({
    chromeFlags: ["--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
  });

  // Connecting is inside its own guard because a failure here would otherwise leave the Chrome
  // launched above running for the rest of the process. One orphan is survivable; one per site
  // across a fleet scan exhausts the machine and takes down the sites still queued behind it.
  let browser: Browser;
  try {
    const puppeteer = (await import("puppeteer-core")).default;
    browser = await puppeteer.connect({ browserURL: `http://localhost:${chrome.port}` });
  } catch (err) {
    chrome.kill();
    throw err;
  }

  const states: RawStateCapture[] = [];
  let adapter: CmpAdapter | null = null;
  let gpc: GpcProbe = { ran: false, marketingTrackers: [], cmpState: null };
  let fatalError: string | undefined;
  let optOutModel = false;
  let optOutReason: string | undefined;
  let cleanPosture: CmpPosture | null = null;

  try {
    /* — S0 clean — the only state that runs even when there is no CMP at all, because "pixels
       fire with no consent mechanism anywhere" is the single most important thing to catch. */
    stage("Consent: clean load");
    let cleanCtx: BrowserContext | null = null;
    try {
      const { ctx, state } = await openState(browser, url);
      cleanCtx = ctx;
      adapter = await detectCmp(state.page, options.expectedCmp);
      const clean = await finishCapture("clean", state, adapter, { screenshots });
      cleanPosture = adapter?.readPosture ? await adapter.readPosture(state.page).catch(() => null) : null;
      clean.buttons = await probeButtons(state.page);
      clean.links = await probeLinks(state.page);
      // Detection runs after load, so re-check visibility with the full timeout — on a slow CMP
      // the banner can still be mid-render when the settle window expires.
      if (adapter && !clean.bannerVisible) clean.bannerVisible = await adapter.waitForBanner(state.page, BANNER_TIMEOUT_MS).catch(() => false);
      states.push(clean);
    } catch (err: any) {
      fatalError = `Could not load ${url}: ${String(err?.message ?? err).slice(0, 200)}`;
    } finally {
      await cleanCtx?.close().catch(() => undefined);
    }

    if (fatalError) return { cmp: adapter?.id ?? "none", cmpLabel: adapter?.label ?? "None detected", states, gpc, fatalError };

    if (!adapter) {
      const reason = "No consent-management platform detected on the page.";
      for (const s of ["reject", "accept", "granular", "returning"] as ConsentStateId[]) states.push(unreachable(s, reason));
      return { cmp: "none", cmpLabel: "None detected", states, gpc };
    }

    const cleanState = states.find((s) => s.state === "clean");
    if (cleanState && !cleanState.bannerVisible) {
      // The vendor's own configuration first; the inference only where no adapter reports one.
      const posture = cleanPosture;
      if (posture?.impliedConsent) {
        optOutModel = true;
        const where = posture.jurisdiction ? ` (jurisdiction \`${posture.jurisdiction}\`)` : "";
        optOutReason =
          `${adapter.label} is configured for implied consent${where}: no banner is shown and every category is ` +
          `granted before the visitor interacts, so there is no accept or reject flow to drive.`;
      } else if (!posture && decidedWithoutAsking(cleanState.cmpState)) {
        optOutModel = true;
        optOutReason =
          `${adapter.label} shows no banner in this region and reports every category already granted, which is the ` +
          `signature of an opt-out configuration. There is no accept or reject flow to drive.`;
      }
    }

    /* Every state below runs under a hard deadline as well as the shared budget. runChoiceState
       catches its own failures, but it cannot catch never returning at all. */
    const guarded = (id: ConsentStateId, work: () => Promise<RawStateCapture>): Promise<RawStateCapture> =>
      withDeadline(`The "${id}" state`, STATE_DEADLINE_MS, work()).catch((err: any) =>
        unreachable(id, String(err?.message ?? err).slice(0, 200)),
      );

    /* — S1 reject — */
    stage("Consent: reject-all");
    states.push(
      outOfTime()
        ? unreachable("reject", BUDGET_REASON)
        : await guarded("reject", () => runChoiceState(browser, url, adapter!, "reject", screenshots)),
    );

    /* — S2 accept — */
    stage("Consent: accept-all");
    states.push(
      outOfTime()
        ? unreachable("accept", BUDGET_REASON)
        : await guarded("accept", () => runChoiceState(browser, url, adapter!, "accept", screenshots)),
    );

    /* — S3 granular — */
    stage("Consent: granular (analytics only)");
    if (outOfTime()) {
      states.push(unreachable("granular", BUDGET_REASON));
    } else if (!adapter.granular) {
      states.push(unreachable("granular", `${adapter.label} exposes no granular consent API.`));
    } else {
      states.push(await guarded("granular", () => runChoiceState(browser, url, adapter!, "granular", screenshots)));
    }

    /* — S4 returning — */
    stage("Consent: returning visitor");
    states.push(
      outOfTime()
        ? unreachable("returning", BUDGET_REASON)
        : await guarded("returning", () => runReturningState(browser, url, adapter!, screenshots)),
    );

    /* — GPC probe — */
    if (!outOfTime()) {
      stage("Consent: Global Privacy Control");
      gpc = await withDeadline("The GPC probe", STATE_DEADLINE_MS, runGpcProbe(browser, url, adapter)).catch(() => ({
        ran: false,
        marketingTrackers: [],
        cmpState: null,
      }));
    }
  } finally {
    await browser.disconnect().catch(() => undefined);
    chrome.kill();
  }

  return {
    cmp: adapter?.id ?? "none",
    cmpLabel: adapter?.label ?? "None detected",
    states,
    gpc,
    optOutModel,
    optOutReason,
  };
}

async function runChoiceState(
  browser: Browser,
  url: string,
  adapter: CmpAdapter,
  state: Extract<ConsentStateId, "reject" | "accept" | "granular">,
  screenshots: boolean,
): Promise<RawStateCapture> {
  let ctx: BrowserContext | null = null;
  try {
    const opened = await openState(browser, url);
    ctx = opened.ctx;
    const sc = opened.state;

    const shown = await adapter.waitForBanner(sc.page, BANNER_TIMEOUT_MS);
    if (!shown) return unreachable(state, `${adapter.label} banner did not appear within ${BANNER_TIMEOUT_MS / 1000}s.`);

    const preChoiceCookies = await readCookies(sc.page);
    sc.choiceAt = sc.requests.length;

    const acted =
      state === "reject"
        ? await adapter.rejectAll(sc.page)
        : state === "accept"
          ? await adapter.acceptAll(sc.page)
          : await adapter.granular!(sc.page, ["analytics"]);

    if (!acted) return unreachable(state, `Could not drive ${adapter.label} into the "${state}" state.`);

    // Confirm the CMP actually registered it. A click that landed on some other dialog — an email
    // capture modal offering "continue without discount" — reports success just as readily, and
    // the state that follows looks like a rejection nobody made, in which every tracker appears
    // correctly blocked. Reporting that as a pass on C1 is the worst outcome this scan can
    // produce, so an unconfirmed choice becomes `blocked` instead.
    if (!(await choiceRegistered(sc.page, adapter, state))) {
      return unreachable(
        state,
        `${adapter.label} did not register the "${state}" choice — the banner was still showing afterwards, so the ` +
          `control that was activated may belong to another dialog on the page.`,
      );
    }

    await sleep(POST_CHOICE_SETTLE_MS);
    const capture = await finishCapture(state, sc, adapter, { screenshots, preChoiceCookies });

    if (state === "accept" && adapter.openPreferences) {
      capture.preferencesReopenable = await adapter.openPreferences(sc.page).catch(() => false);
    }
    return capture;
  } catch (err: any) {
    return unreachable(state, String(err?.message ?? err).slice(0, 200));
  } finally {
    await ctx?.close().catch(() => undefined);
  }
}

/** Did the CMP take the choice, or did the click go somewhere else?
 *
 * Either signal is enough: the vendor's own state reflecting a decision, or the banner going away.
 * Deliberately permissive — the job is to catch a click that missed the CMP entirely, not to
 * adjudicate how a particular vendor records consent. A stricter check would turn working sites
 * into coverage gaps, which is its own kind of wrong answer. */
async function choiceRegistered(
  page: Page,
  adapter: CmpAdapter,
  state: Extract<ConsentStateId, "reject" | "accept" | "granular">,
): Promise<boolean> {
  const cmpState = await adapter.readState(page).catch(() => null);
  if (cmpState) {
    const decided =
      state === "accept"
        ? cmpState.marketing === true || cmpState.analytics === true
        : state === "reject"
          ? cmpState.marketing === false
          : cmpState.analytics === true && cmpState.marketing === false;
    if (decided) return true;
  }
  // No usable state to read (the heuristic adapter has none), so fall back to the banner having
  // gone — which is what a shopper would see, and what a mis-click would fail to produce.
  return !(await adapter.waitForBanner(page, 2_000).catch(() => false));
}

/** Accept, then reload and navigate — the only way to tell a CMP that persists a choice from one
 * that merely appears to, which is a failure shoppers experience as a banner that never goes away. */
async function runReturningState(browser: Browser, url: string, adapter: CmpAdapter, screenshots: boolean): Promise<RawStateCapture> {
  let ctx: BrowserContext | null = null;
  try {
    const opened = await openState(browser, url);
    ctx = opened.ctx;
    const sc = opened.state;

    const shown = await adapter.waitForBanner(sc.page, BANNER_TIMEOUT_MS);
    if (!shown) return unreachable("returning", `${adapter.label} banner did not appear within ${BANNER_TIMEOUT_MS / 1000}s.`);

    sc.choiceAt = sc.requests.length;
    if (!(await adapter.acceptAll(sc.page))) return unreachable("returning", `Could not accept via ${adapter.label}.`);
    await sleep(POST_CHOICE_SETTLE_MS);

    await sc.page.reload({ waitUntil: "networkidle2", timeout: 45_000 });
    await sleep(LOAD_SETTLE_MS);
    const bannerAfterReload = await isBannerVisible(sc.page, adapter);
    const cmpStateAfterReload = await adapter.readState(sc.page).catch(() => null);

    // A second page in the same context, so persistence is tested across a real navigation
    // rather than a reload of the same document.
    const secondUrl = new URL("/collections/all", url).toString();
    const beforeNav = sc.requests.length;
    await sc.page.goto(secondUrl, { waitUntil: "networkidle2", timeout: 45_000 }).catch(() => undefined);
    await sleep(LOAD_SETTLE_MS);
    const trackersAfterNavigate = matchTrackers(deliveredUrls(sc.requests.slice(beforeNav))).map((t) => t.id);
    const cmpStateAfterNavigate = await adapter.readState(sc.page).catch(() => null);

    const capture = await finishCapture("returning", sc, adapter, { screenshots });
    capture.bannerAfterReload = bannerAfterReload;
    capture.cmpStateAfterReload = cmpStateAfterReload;
    capture.trackersAfterNavigate = trackersAfterNavigate;
    capture.cmpStateAfterNavigate = cmpStateAfterNavigate;
    return capture;
  } catch (err: any) {
    return unreachable("returning", String(err?.message ?? err).slice(0, 200));
  } finally {
    await ctx?.close().catch(() => undefined);
  }
}

/** Loads the page as a browser broadcasting Global Privacy Control and makes no consent choice at
 * all. Under CPRA a GPC signal *is* the opt-out, so marketing firing here is a finding even
 * though nobody clicked anything. */
async function runGpcProbe(browser: Browser, url: string, adapter: CmpAdapter | null): Promise<GpcProbe> {
  let ctx: BrowserContext | null = null;
  try {
    // The header alone isn't enough — most CMPs read navigator.globalPrivacyControl, which Chrome
    // only exposes when the user has enabled the feature, so it has to be defined in-page too.
    // It must go in as an init script rather than a plain evaluate(): a property defined on the
    // live document is discarded by the very next navigation, so the CMP would never see it.
    const opened = await openState(browser, url, {
      extraHeaders: { "Sec-GPC": "1" },
      initScript: `Object.defineProperty(navigator, "globalPrivacyControl", { get: function () { return true; }, configurable: true });`,
    });
    ctx = opened.ctx;
    const sc = opened.state;
    await sleep(POST_CHOICE_SETTLE_MS);

    const marketing = matchTransmissions(deliveredUrls(sc.requests))
      .filter((t) => t.category === "marketing")
      .map((t) => t.id);

    return {
      ran: true,
      marketingTrackers: marketing,
      cmpState: adapter ? await adapter.readState(sc.page).catch(() => null) : null,
      shopifyConsent: await readShopifyConsent(sc.page),
    };
  } catch {
    return { ran: false, marketingTrackers: [], cmpState: null };
  } finally {
    await ctx?.close().catch(() => undefined);
  }
}

/* ── inventory ───────────────────────────────────────────────────────────────────────────── */

export interface InventoryResult {
  cmp: CmpVendor;
  cmpLabel: string;
  bannerVisible: boolean;
  /** Trackers firing on a plain load with no consent choice — enough to spot the worst cases
   * without paying for a full behavioural scan. */
  trackers: string[];
  error?: string;
}

/** One page load, CMP detection only. This is what answers "what is installed where?" across the
 * whole fleet in minutes rather than hours — the behavioural suites are the expensive part, and
 * an inventory pass is useful long before every site has been through one. */
export async function runCmpInventory(url: string, expectedCmp?: CmpVendor | "unknown"): Promise<InventoryResult> {
  const chrome = await chromeLauncher.launch({
    chromeFlags: ["--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
  });
  const puppeteer = (await import("puppeteer-core")).default;
  const browser = await puppeteer.connect({ browserURL: `http://localhost:${chrome.port}` });
  let ctx: BrowserContext | null = null;
  try {
    const opened = await openState(browser, url);
    ctx = opened.ctx;
    const adapter = await detectCmp(opened.state.page, expectedCmp);
    return {
      cmp: adapter?.id ?? "none",
      cmpLabel: adapter?.label ?? "None detected",
      bannerVisible: adapter ? await adapter.waitForBanner(opened.state.page, BANNER_TIMEOUT_MS).catch(() => false) : false,
      trackers: matchTrackers(deliveredUrls(opened.state.requests)).map((t) => t.id),
    };
  } catch (err: any) {
    return { cmp: "none", cmpLabel: "Unreachable", bannerVisible: false, trackers: [], error: String(err?.message ?? err).slice(0, 200) };
  } finally {
    await ctx?.close().catch(() => undefined);
    await browser.disconnect().catch(() => undefined);
    chrome.kill();
  }
}
