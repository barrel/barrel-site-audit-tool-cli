import * as chromeLauncher from "chrome-launcher";
import { discoverJourneyPages } from "./journey.js";

/** Live-browser accessibility probe for the three things a scoped ADA checklist almost always
 * asks for and a static rule engine can't answer: whether the TAB key actually reaches every
 * control, whether focus is visibly indicated when it lands, and whether a working skip-nav link
 * exists. axe-core covers the rest (alt text, contrast, labels, ARIA) and is not duplicated here.
 *
 * Driven with real `keyboard.press("Tab")` presses rather than synthetic events, because a
 * dispatched keydown doesn't move focus — only a genuine key press does, which is the whole
 * point of the check. */

// Same rationale as ux.ts / accessibility.ts: don't advertise "HeadlessChrome" from a legitimate
// audit tool.
const DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// Pages get the same throttle as the other live-browser analyzers — one session, sequential
// loads, a human-plausible pause between them.
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function throttleDelay(): Promise<void> {
  return sleep(2000 + Math.random() * 2000);
}

/** Hard ceiling on TAB presses per page, whatever the DOM says — a page with a thousand links
 * shouldn't turn one probe into a multi-minute crawl. Generous relative to the element count
 * because plenty of presses land somewhere that isn't a candidate at all (inside a third-party
 * iframe, or on markup injected after the page settled), and a budget that merely matches the
 * element count runs out before the footer — which used to read as "the footer is unreachable".
 * When the budget does run out, the page is reported as truncated rather than as failing. */
const MAX_TABS = 300;
/** Journey pages to probe. The keyboard pass is the slow part, so it's capped independently of
 * how many pages axe/Lighthouse scanned. */
const MAX_PAGES = 4;
/** Selectors are for a human to act on, not an exhaustive dump. */
const MAX_SELECTORS = 8;

export interface AdaProbePageResult {
  page: string;
  url: string;
  /** Visible, enabled interactive elements found in the DOM. */
  interactiveCount: number;
  /** How many of those the TAB key actually reached. */
  reachableCount: number;
  /** Interactive elements TAB never reached. */
  unreachable: string[];
  /** Elements with a positive tabindex — these override DOM order and are a scope violation on
   * their own even when everything is technically reachable. */
  positiveTabindex: string[];
  /** Interactive elements explicitly removed from the tab order with tabindex="-1". */
  negativeTabindexInteractive: string[];
  /** Elements that received focus during the traversal. */
  focusChecked: number;
  /** Whether the TAB pass actually finished — focus wrapped past the last element, or completed a
   * cycle — rather than running out of key presses. When false, `unreachable` is deliberately left
   * empty: elements the pass never got to are unproven, not proven unreachable. */
  traversalComplete: boolean;
  /** TAB stops that landed on something that wasn't a tagged candidate — third-party iframe
   * internals, or markup added after the page settled. High counts explain a truncated pass. */
  nonCandidateStops: number;
  /** Focused elements whose computed appearance (outline, box-shadow, border, background,
   * text-decoration, ::before/::after) did not change at all when focused. */
  focusInvisible: string[];
  /** Set when focus cycled inside a small subtree — a modal/consent/drawer focus trap. Reaching
   * the rest of the page by keyboard is impossible until it's dismissed, which is itself the
   * finding, and it also means the reachability numbers above are a floor, not a verdict. */
  focusTrap?: string;
  skipLink: {
    present: boolean;
    text?: string;
    href?: string;
    /** The fragment target actually exists in the document. */
    targetExists: boolean;
    /** It leaves its visually-hidden position once the TAB key lands on it, as a sighted keyboard
     * user needs. Only meaningful when `focusAssessed` is true. */
    visibleOnFocus: boolean;
    /** Whether the TAB pass actually landed on the link, which is the only way to measure the
     * above: themes commonly reveal the link with `:focus-visible`, which a scripted `.focus()`
     * call does not reliably trigger. */
    focusAssessed: boolean;
    /** Something took focus back off the link before its focused state could be measured —
     * typically a consent dialog's focus trap. Makes `visibleOnFocus` inconclusive rather than
     * false: the real finding in that case is the trap, reported via `focusTrap`. */
    focusStolen: boolean;
    /** It was among the first few focusable elements, rather than buried mid-page. */
    firstFocusable: boolean;
  };
  images: {
    total: number;
    /** <img> with no alt attribute at all — unambiguously a failure. */
    missingAlt: string[];
    /** alt="" — correct for decorative images, so counted rather than failed. */
    emptyAlt: number;
  };
}

export interface AdaProbeResult {
  pages: AdaProbePageResult[];
}

const INTERACTIVE_SELECTOR = [
  "a[href]",
  "button",
  'input:not([type="hidden"])',
  "select",
  "textarea",
  "summary",
  "[tabindex]",
  '[role="button"]',
  '[role="link"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="option"]',
  "audio[controls]",
  "video[controls]",
  "iframe",
  '[contenteditable="true"]',
].join(", ");

/** Runs inside the page: tags every candidate, snapshots its unfocused appearance, and reports
 * the DOM-only findings (tabindex misuse, skip link, images). Everything it needs later is
 * stashed on `window.__barrelAda` — the same JS context survives across page.evaluate calls as
 * long as we don't navigate. */
function setupScript(interactiveSelector: string, maxSelectors: number) {
  return `(async () => {
    const MAX = ${maxSelectors};
    const cssPath = (el) => {
      if (!el || el.nodeType !== 1) return "unknown";
      if (el.id) return el.tagName.toLowerCase() + "#" + el.id;
      const parts = [];
      let node = el;
      for (let depth = 0; node && node.nodeType === 1 && depth < 4; depth++) {
        let part = node.tagName.toLowerCase();
        const cls = (node.getAttribute("class") || "").trim().split(/\\s+/).filter(Boolean)[0];
        if (cls) part += "." + cls;
        else if (node.parentElement) {
          const sibs = Array.from(node.parentElement.children).filter((c) => c.tagName === node.tagName);
          if (sibs.length > 1) part += ":nth-of-type(" + (sibs.indexOf(node) + 1) + ")";
        }
        parts.unshift(part);
        if (node.id) { parts[0] = node.tagName.toLowerCase() + "#" + node.id; break; }
        node = node.parentElement;
      }
      return parts.join(" > ");
    };

    const isVisible = (el) => {
      if (el.closest("[inert]") || el.closest('[aria-hidden="true"]')) return false;
      // Content inside a collapsed <details> is deliberately out of the tab order until it's
      // opened — the <summary> itself is what a keyboard user reaches.
      const collapsed = el.closest("details:not([open])");
      if (collapsed && el.tagName !== "SUMMARY" && el.parentElement !== collapsed) return false;
      if (el.disabled) return false;
      const rect = el.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return false;
      const style = getComputedStyle(el);
      return style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity) > 0.01;
    };

    const STYLE_PROPS = [
      "outlineStyle", "outlineWidth", "outlineColor", "outlineOffset", "boxShadow",
      "borderTopColor", "borderTopWidth", "borderBottomColor", "borderBottomWidth",
      "backgroundColor", "backgroundImage", "color", "textDecorationLine", "textDecorationColor",
      "filter", "transform", "opacity", "fontWeight",
    ];
    const snapshot = (el) => {
      const out = [];
      const base = getComputedStyle(el);
      for (const p of STYLE_PROPS) out.push(String(base[p]));
      for (const pseudo of ["::before", "::after"]) {
        const ps = getComputedStyle(el, pseudo);
        out.push(String(ps.content), String(ps.outlineStyle), String(ps.boxShadow),
                 String(ps.backgroundColor), String(ps.opacity), String(ps.transform),
                 String(ps.width), String(ps.height));
      }
      return out.join("|");
    };

    const all = Array.from(document.querySelectorAll(${JSON.stringify(interactiveSelector)}));
    const candidates = [];
    const positiveTabindex = [];
    const negativeTabindexInteractive = [];
    const NATIVELY_INTERACTIVE = new Set(["A", "BUTTON", "INPUT", "SELECT", "TEXTAREA", "SUMMARY"]);

    for (const el of all) {
      const ti = el.getAttribute("tabindex");
      if (ti !== null && Number(ti) > 0 && positiveTabindex.length < MAX) positiveTabindex.push(cssPath(el));
      if (ti !== null && Number(ti) < 0 && NATIVELY_INTERACTIVE.has(el.tagName) && isVisible(el) &&
          negativeTabindexInteractive.length < MAX) {
        negativeTabindexInteractive.push(cssPath(el));
      }
      if (!isVisible(el)) continue;
      // tabindex="-1" is a deliberate removal from the tab order, reported above rather than
      // counted as unreachable — otherwise every scripted focus target reads as a failure.
      if (ti !== null && Number(ti) < 0) continue;
      candidates.push(el);
    }

    const selectors = candidates.map(cssPath);
    const baselines = candidates.map(snapshot);
    candidates.forEach((el, i) => el.setAttribute("data-barrel-ada", String(i)));
    window.__barrelAda = { candidates, selectors, baselines, snapshot, cssPath, isVisible };

    // Skip link: a fragment link naming itself as a skip/jump, ideally among the first few
    // focusable elements in the document.
    const fragmentLinks = Array.from(document.querySelectorAll('a[href^="#"]'));
    const skipEl = fragmentLinks.find((a) => {
      const text = ((a.textContent || "") + " " + (a.getAttribute("aria-label") || "") + " " +
                    (a.getAttribute("class") || "") + " " + a.id).toLowerCase();
      return /skip|jump to|bypass/.test(text);
    });
    // Is the link actually on screen for a sighted keyboard user right now? Asked about the
    // focused state directly rather than by diffing against the unfocused one: a link that's
    // always visible passes just as well as one that reveals itself, and the reveal is usually a
    // CSS transition, so the answer is only trustworthy after the animation has had time to run.
    const skipVisible = (el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const inViewport = r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
      const bigEnough = r.width >= 8 && r.height >= 8;
      const clipped = cs.clip.indexOf("rect(0") === 0 || (cs.clipPath !== "none" && cs.clipPath !== "");
      const shown =
        typeof el.checkVisibility === "function"
          ? el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
          : cs.visibility !== "hidden" && Number(cs.opacity) > 0.1;
      return Boolean(inViewport && bigEnough && !clipped && shown);
    };

    // Whether it reveals itself is measured later, when the TAB pass actually lands on it — a
    // scripted .focus() doesn't reliably satisfy :focus-visible, which is what these links are
    // usually styled on, so measuring it here reported real, working skip links as hidden.
    window.__barrelAda.skipVisible = skipVisible;
    window.__barrelAda.skipIndex = skipEl ? candidates.indexOf(skipEl) : -1;

    let skipLink = {
      present: false,
      targetExists: false,
      visibleOnFocus: false,
      focusAssessed: false,
      focusStolen: false,
      firstFocusable: false,
    };
    if (skipEl) {
      const href = skipEl.getAttribute("href") || "";
      const id = href.slice(1);
      const target = id ? document.getElementById(id) || document.querySelector('[name="' + id + '"]') : null;
      skipLink = {
        present: true,
        text: (skipEl.textContent || "").trim().slice(0, 80),
        href,
        targetExists: Boolean(target),
        visibleOnFocus: false,
        focusAssessed: false,
        focusStolen: false,
        firstFocusable: candidates.indexOf(skipEl) > -1 && candidates.indexOf(skipEl) < 4,
      };
    }

    const imgs = Array.from(document.querySelectorAll("img"));
    const missingAlt = [];
    let emptyAlt = 0;
    for (const img of imgs) {
      if (!img.hasAttribute("alt")) {
        if (missingAlt.length < MAX) missingAlt.push(cssPath(img));
      } else if (img.getAttribute("alt").trim() === "") {
        emptyAlt++;
      }
    }

    return {
      interactiveCount: candidates.length,
      positiveTabindex,
      negativeTabindexInteractive,
      skipLink,
      skipIndex: window.__barrelAda.skipIndex,
      images: { total: imgs.length, missingAlt, emptyAlt },
    };
  })()`;
}

/** Runs inside the page after each TAB press: which candidate has focus now, and did its
 * appearance actually change. */
const AFTER_TAB_SCRIPT = `(() => {
  const state = window.__barrelAda;
  // Follow the activeElement chain into shadow roots, so a web-component control is identified
  // as itself rather than as its host.
  let el = document.activeElement;
  while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
  if (!el || el === document.body || el === document.documentElement) return { index: -1, outside: true };
  const attr = el.getAttribute && el.getAttribute("data-barrel-ada");
  const index = attr === null || attr === undefined ? -1 : Number(attr);
  const focusVisible = index >= 0 ? state.snapshot(el) !== state.baselines[index] : true;
  return {
    index,
    outside: false,
    focusVisible,
    selector: index >= 0 ? state.selectors[index] : state.cssPath(el),
    trapContainer: (() => {
      const modal = el.closest('[role="dialog"], [aria-modal="true"], dialog, [class*="modal"], [class*="popup"], [class*="drawer"], [class*="consent"], [class*="cookie"], [id*="consent"], [id*="cookie"]');
      return modal ? state.cssPath(modal) : null;
    })(),
  };
})()`;

/** Measures the skip link's appearance while the TAB key is genuinely holding focus on it —
 * polled, because the reveal is normally a CSS transition. */
const SKIP_REVEAL_SCRIPT = `(async () => {
  const state = window.__barrelAda;
  const el = state.candidates[state.skipIndex];
  if (!el) return null;
  let visible = false;
  for (let i = 0; i < 10 && !visible; i++) {
    await new Promise((r) => setTimeout(r, 80));
    visible = state.skipVisible(el);
  }
  return { visible, focusStolen: document.activeElement !== el };
})()`;

async function probePage(
  page: import("puppeteer-core").Page,
  pageName: string,
  url: string,
): Promise<AdaProbePageResult | null> {
  const response = await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 }).catch(() => null);
  if (!response || !response.ok()) return null;

  const setup = (await page.evaluate(setupScript(INTERACTIVE_SELECTOR, MAX_SELECTORS))) as {
    interactiveCount: number;
    positiveTabindex: string[];
    negativeTabindexInteractive: string[];
    skipLink: AdaProbePageResult["skipLink"];
    skipIndex: number;
    images: AdaProbePageResult["images"];
  };
  const skipLink = { ...setup.skipLink };

  // Start the traversal from the very top of the document, the way a keyboard user arriving on
  // the page does — otherwise the first TAB continues from wherever focus happened to be.
  await page.evaluate(() => {
    document.body.setAttribute("tabindex", "-1");
    (document.body as HTMLElement).focus();
    document.body.removeAttribute("tabindex");
  });

  const reached = new Set<number>();
  const focusInvisible: string[] = [];
  const focusOrder: number[] = [];
  let focusChecked = 0;
  let focusTrap: string | undefined;
  let traversalComplete = false;
  let nonCandidateStops = 0;
  const trapCandidates = new Map<string, number>();

  const maxTabs = Math.min(MAX_TABS, setup.interactiveCount * 3 + 30);
  for (let i = 0; i < maxTabs; i++) {
    await page.keyboard.press("Tab");
    const state = (await page
      .evaluate(AFTER_TAB_SCRIPT)
      .catch(() => null)) as { index: number; outside: boolean; focusVisible?: boolean; selector?: string; trapContainer?: string | null } | null;
    if (!state) break;
    // Focus left the document (browser chrome) — the page's whole tab order has been walked.
    if (state.outside && focusOrder.length > 0) {
      traversalComplete = true;
      break;
    }
    if (state.index < 0 && !state.outside) nonCandidateStops++;
    if (state.index >= 0) {
      focusChecked++;
      reached.add(state.index);
      focusOrder.push(state.index);
      if (state.focusVisible === false && state.selector && focusInvisible.length < MAX_SELECTORS) {
        focusInvisible.push(state.selector);
      }
    }
    if (skipLink.present && state.index === setup.skipIndex && !skipLink.focusAssessed) {
      const reveal = (await page.evaluate(SKIP_REVEAL_SCRIPT).catch(() => null)) as
        | { visible: boolean; focusStolen: boolean }
        | null;
      if (reveal) {
        skipLink.focusAssessed = true;
        skipLink.visibleOnFocus = reveal.visible;
        skipLink.focusStolen = reveal.focusStolen;
      }
    }
    if (state.trapContainer) {
      trapCandidates.set(state.trapContainer, (trapCandidates.get(state.trapContainer) ?? 0) + 1);
    }
    // A completed cycle: focus returned to the first element it visited.
    if (focusOrder.length > 1 && state.index === focusOrder[0] && focusOrder.length > 2) {
      traversalComplete = true;
      break;
    }
  }

  // Focus cycling inside one small container while most of the page went unvisited is a trap,
  // not a page with 90% unreachable controls — say which it is.
  if (setup.interactiveCount > 8 && reached.size < setup.interactiveCount * 0.5) {
    const [container, hits] = [...trapCandidates.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];
    if (container && hits && hits >= Math.max(2, focusChecked * 0.5)) focusTrap = container;
  }
  // A trap is itself the finding — the pass ending inside one isn't an inconclusive truncation.
  if (focusTrap) traversalComplete = true;

  const unreachable = !traversalComplete
    ? []
    : ((await page.evaluate(
        (reachedIndexes: number[], max: number) => {
          const state = (window as any).__barrelAda;
          const set = new Set(reachedIndexes);
          const out: string[] = [];
          for (let i = 0; i < state.selectors.length; i++) {
            if (!set.has(i) && out.length < max) out.push(state.selectors[i]);
          }
          return out;
        },
        [...reached],
        MAX_SELECTORS,
      )) as string[]);

  return {
    page: pageName,
    url,
    interactiveCount: setup.interactiveCount,
    reachableCount: reached.size,
    unreachable,
    positiveTabindex: setup.positiveTabindex,
    negativeTabindexInteractive: setup.negativeTabindexInteractive,
    focusChecked,
    traversalComplete,
    nonCandidateStops,
    focusInvisible,
    focusTrap,
    skipLink,
    images: setup.images,
  };
}

/** Probes every discovered journey page (capped) for keyboard reachability, focus visibility and
 * a working skip link. Returns null — never throws — if not even the homepage could be probed. */
export async function probeAdaBehavior(baseUrl: string): Promise<AdaProbeResult | null> {
  const journeyPages = (await discoverJourneyPages(baseUrl)).slice(0, MAX_PAGES);
  const chrome = await chromeLauncher.launch({
    chromeFlags: ["--headless=new", "--no-sandbox", "--disable-gpu"],
  });

  try {
    const puppeteer = (await import("puppeteer-core")).default;
    const browser = await puppeteer.connect({ browserURL: `http://localhost:${chrome.port}` });

    try {
      const page = await browser.newPage();
      await page.setUserAgent(DESKTOP_UA);
      await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });
      await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });

      const pages: AdaProbePageResult[] = [];
      for (let i = 0; i < journeyPages.length; i++) {
        const { page: pageName, url } = journeyPages[i];
        if (i > 0) await throttleDelay();
        const result = await probePage(page, pageName, url).catch(() => null);
        if (result) pages.push(result);
      }

      return pages.length > 0 ? { pages } : null;
    } finally {
      await browser.disconnect();
    }
  } catch {
    return null;
  } finally {
    await chrome.kill();
  }
}
