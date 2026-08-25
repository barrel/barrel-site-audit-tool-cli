// The browser half of a CRO audit: what each page group actually looks like, on each device.
//
// This produces evidence, not conclusions. Nothing here calls a model or decides whether anything
// is good. That separation is the point: a capture can be interpreted more than once — with a
// better prompt, with the client's hypotheses added, or from the deployed web app where there is
// no browser at all — without going back to the client's storefront. Today's two-page UX analyzer
// fuses the two and therefore cannot be re-run without re-crawling.
//
// Politeness: one browser, one page, sequential loads with a 2–4s human-plausible pause between
// them, no retries, no concurrency, a real browser UA. A full sweep is a dozen or so page views —
// more than the site audit's UX pass, and enough that an aggressive WAF might notice, which is why
// none of it is parallelised.

import * as chromeLauncher from "chrome-launcher";
import type { Page } from "puppeteer-core";
import type {
  CroCapture,
  CroCompetitorCapture,
  CroDevice,
  CroMeasurements,
  CroPageCapture,
  CroPageGroup,
  CroSectionOffset,
} from "@barrel/site-audit-shared";
import { autoScrollToBottom, waitForImages } from "../screenshot.js";
import { DESKTOP_UA, MOBILE_UA, signalsForGroup, sleep, throttleDelay } from "./signals.js";
import type { CroTarget } from "./discover.js";

/** iPhone 14 and a common laptop width. Real device metrics rather than round numbers, because the
 * fold position this whole feature argues about is a property of the viewport height. */
const VIEWPORTS: Record<CroDevice, { width: number; height: number; deviceScaleFactor: number; isMobile: boolean }> = {
  mobile: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true },
  desktop: { width: 1440, height: 900, deviceScaleFactor: 1, isMobile: false },
};

/** Uploads one screenshot and returns the blob pathname it was stored at, or undefined if it could
 * not be stored. Injected rather than imported so this module has no opinion about storage — the
 * command wires Blob, and a --no-upload run passes a no-op. */
export type ScreenshotSink = (
  group: CroPageGroup,
  device: CroDevice,
  crop: "full" | "fold",
  image: Buffer,
) => Promise<string | undefined>;

export interface CaptureOptions {
  targets: CroTarget[];
  devices: readonly CroDevice[];
  uploadScreenshot?: ScreenshotSink;
  onStage?: (stage: string) => void;
}

/* ── In-page measurement ─────────────────────────────────────────────────────────────────────── */

/** Selectors for "the thing this page wants you to click", most specific first.
 *
 * A CRO audit's single most repeated finding is that the primary action sits below the fold on
 * mobile, and that claim needs a number rather than an impression. Getting the *right* element
 * matters: on a PDP the add-to-cart is the primary action, not the newsletter button in the footer,
 * so the ordering here is per group. */
const PRIMARY_CTA_SELECTORS: Record<CroPageGroup, string[]> = {
  nav: ["header a[href*='cart']", "header button", "header a"],
  // One combined selector rather than a priority list, because on a home page the priority list is
  // the bug. Theme class names do not reliably mark the hero: on a real storefront the only
  // `[class*='banner'] a.button` sat 6,123px down while the actual hero CTA — "SHOP NOW" at 422px —
  // matched a lower-priority selector, so priority beat correctness and the slide would have said
  // the primary action was 6,000px below the fold. On a home page the primary call to action simply
  // is the topmost thing the page asks you to click, which is what a single selector plus
  // topmost-wins gives.
  home: [
    "main a[class*='button'], main a.btn, main a.button, main button[class*='button']," +
      " [class*='hero'] a[class*='button'], [class*='hero'] a.btn," +
      " [class*='banner'] a[class*='button'], [class*='banner'] a.btn",
  ],
  plp: ["[class*='card'] button[name='add']", "[class*='card'] a[class*='button']", "main a[href*='/products/']"],
  pdp: ["button[name='add']", "form[action*='/cart/add'] button", "[class*='add-to-cart']", "button[class*='atc']"],
  cart: ["button[name='checkout']", "[name='checkout']", "a[href*='/checkout']", "button[class*='checkout']"],
  checkout: ["button[type='submit']", "#continue_button", "button[class*='continue']"],
  search: ["[class*='card'] a", "main a[href*='/products/']"],
};

/** Runs in the page. Returns the numbers no screenshot can be asked for after the fact.
 *
 * Written as one evaluate rather than several so every number describes the same layout — between
 * two calls a lazy section can render and move everything below it. */
async function measure(page: Page, group: CroPageGroup, device: CroDevice): Promise<CroMeasurements> {
  const ctaSelectors = PRIMARY_CTA_SELECTORS[group];

  return await page.evaluate(
    (selectors: string[], isMobile: boolean) => {
      const viewportHeight = window.innerHeight;
      const documentHeight = Math.max(
        document.body?.scrollHeight ?? 0,
        document.documentElement?.scrollHeight ?? 0,
        viewportHeight,
      );

      const visible = (el: Element): boolean => {
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return false;
        const style = window.getComputedStyle(el);
        return style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity ?? "1") > 0.05;
      };

      // Absolute document offset. getBoundingClientRect is viewport-relative and the page may
      // already have been scrolled by the lazy-load pass, so scrollY has to be added back.
      const absoluteTop = (el: Element): number => Math.round(el.getBoundingClientRect().top + window.scrollY);

      // Highest-priority selector that matches anything wins; within it, the *topmost* match wins.
      //
      // Both halves are load-bearing. Priority is what stops a PDP's "primary action" being a
      // newsletter button in the footer. Topmost-within-priority is what stops it being the fourth
      // section that happens to carry a "hero" class: document order alone picked a home-page CTA
      // 6,839px down a real storefront, which would have printed as "the primary call to action is
      // 6,000px below the fold" — technically true of that element, and not what anyone means.
      let cta: Element | null = null;
      for (const selector of selectors) {
        const matches = Array.from(document.querySelectorAll(selector)).filter(visible);
        if (matches.length === 0) continue;
        cta = matches.reduce((topmost, el) => (absoluteTop(el) < absoluteTop(topmost) ? el : topmost));
        break;
      }

      const parseColor = (value: string): [number, number, number, number] | null => {
        const m = value.match(/rgba?\(([^)]+)\)/);
        if (!m) return null;
        const parts = m[1].split(",").map((p) => parseFloat(p.trim()));
        if (parts.length < 3 || parts.some((p) => !Number.isFinite(p))) return null;
        return [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1];
      };

      const relativeLuminance = ([r, g, b]: [number, number, number, number]): number => {
        const channel = (c: number) => {
          const s = c / 255;
          return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
        };
        return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
      };

      /** Contrast of the CTA's text against the first opaque background behind it, or undefined when
       * it cannot honestly be determined.
       *
       * Walking up for an opaque ancestor is necessary because a button's own background is very
       * often transparent, and treating that as black would report a fake failure on every ghost
       * button. Two cases return undefined rather than a number, both found against real
       * storefronts:
       *
       *  - A background *image* or gradient anywhere between the text and the first opaque colour.
       *    There is no single background colour to measure against, and the colour we would find by
       *    walking past it is not what the text is sitting on.
       *  - A computed ratio at or near 1:1, which means the two colours we read were the same one.
       *    That is what happens when a button paints its background in an image and inherits the
       *    page's text colour — and "1:1" printed on a slide is a fabricated accessibility failure,
       *    which is worse than saying nothing.
       *
       * A real design can be at 1.05:1, and this will decline to report it. That is the right way
       * round: a missed finding costs one bullet, a false one costs the deck's credibility. */
      const contrastOf = (el: Element): number | undefined => {
        const style = window.getComputedStyle(el);
        const fg = parseColor(style.color);
        if (!fg) return undefined;

        let node: Element | null = el;
        let bg: [number, number, number, number] | null = null;
        while (node) {
          const nodeStyle = window.getComputedStyle(node);
          if (nodeStyle.backgroundImage && nodeStyle.backgroundImage !== "none") return undefined;
          const candidate = parseColor(nodeStyle.backgroundColor);
          if (candidate && candidate[3] > 0.5) {
            bg = candidate;
            break;
          }
          node = node.parentElement;
        }
        if (!bg) bg = [255, 255, 255, 1];

        const l1 = relativeLuminance(fg);
        const l2 = relativeLuminance(bg);
        const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
        if (ratio < 1.05) return undefined;
        return Math.round(ratio * 100) / 100;
      };

      const interactiveSelector = "a[href], button, input:not([type='hidden']), select, textarea, [role='button']";
      const interactive = Array.from(document.querySelectorAll(interactiveSelector)).filter(visible);

      const interactiveBelowFold = interactive.filter((el) => absoluteTop(el) > viewportHeight).length;

      const smallTapTargets = isMobile
        ? interactive.filter((el) => {
            const rect = el.getBoundingClientRect();
            return rect.width < 44 || rect.height < 44;
          }).length
        : undefined;

      // Sticky/fixed positioning is what makes the fold argument moot: a persistent add-to-cart bar
      // is visible wherever the shopper is, so "the CTA is 1,200px down" stops being the finding.
      const stickyAddToCart = Array.from(document.querySelectorAll("div, section, form, button, aside")).some((el) => {
        const style = window.getComputedStyle(el);
        if (style.position !== "fixed" && style.position !== "sticky") return false;
        if (!visible(el)) return false;
        return /add to (cart|bag)|add to basket|buy now/i.test(el.textContent ?? "");
      });

      /** The page's own reading order, as a shopper scrolls it. Direct children of the main content
       * container, filtered to things tall enough to be a section rather than a spacer. */
      const sectionRoot =
        document.querySelector("main") ??
        document.querySelector("#MainContent") ??
        document.querySelector("[role='main']") ??
        document.body;
      const sectionOffsets = Array.from(sectionRoot?.children ?? [])
        .filter((el) => visible(el) && el.getBoundingClientRect().height >= 120)
        .slice(0, 30)
        .map((el) => {
          const heading = el.querySelector("h1, h2, h3");
          const headingText = heading?.textContent?.trim().replace(/\s+/g, " ").slice(0, 60);
          const cls = (el.getAttribute("class") ?? "").trim().split(/\s+/)[0];
          return {
            label: headingText || (cls ? `${el.tagName.toLowerCase()}.${cls}` : el.tagName.toLowerCase()),
            top: absoluteTop(el),
            height: Math.round(el.getBoundingClientRect().height),
          };
        });

      const form = document.querySelector("form[action*='cart'], form[action*='checkout'], main form");
      const formFieldCount = form
        ? form.querySelectorAll("input:not([type='hidden']):not([type='submit']), select, textarea").length
        : undefined;

      const primaryCtaY = cta ? absoluteTop(cta) : undefined;

      return {
        viewportHeight,
        documentHeight,
        primaryCtaY,
        primaryCtaAboveFold: primaryCtaY === undefined ? undefined : primaryCtaY + 20 <= viewportHeight,
        sectionOffsets: sectionOffsets as CroSectionOffset[],
        interactiveBelowFold,
        stickyAddToCart,
        smallTapTargets,
        ctaContrast: cta ? contrastOf(cta) : undefined,
        formFieldCount,
      } satisfies CroMeasurements;
    },
    ctaSelectors,
    VIEWPORTS[device].isMobile,
  );
}

/** The largest device pixel ratio at which a full-page screenshot stays inside the model API's
 * 8,000px-per-dimension ceiling.
 *
 * Under the ceiling rather than at it, because documentHeight was measured before the shot and a
 * lazy section can still settle a few pixels either way between the two. Floored at 0.25: below
 * that the text in the image stops being readable, and an unreadable screenshot is worse input than
 * a truncated one — at which point the honest answer would be to send no full-page image, which is
 * what a scale that small effectively produces. */
export function fullPageScaleFactor(documentHeight: number, preferred: number): number {
  const MAX_PIXELS = 7800;
  if (!Number.isFinite(documentHeight) || documentHeight <= 0) return 1;
  if (documentHeight * preferred <= MAX_PIXELS) return preferred;
  const scale = MAX_PIXELS / documentHeight;
  return Math.max(0.25, Math.round(scale * 100) / 100);
}

/* ── Page actions ────────────────────────────────────────────────────────────────────────────── */

/** Puts an item in the cart through the storefront's own AJAX cart API, from inside the page.
 *
 * Via fetch in the page rather than by clicking add-to-cart: a click depends on the theme's markup,
 * its variant picker state and whatever app has wrapped the button, and fails differently on every
 * store. /cart/add.js is Shopify's own contract and carries the page's session cookie, so the cart
 * we then navigate to is the cart this browser owns.
 *
 * This does leave a real cart — and, with --checkout, a real abandoned checkout — in the client's
 * admin. That is disclosed at the point the run is started and in the report. */
async function addToCart(page: Page, variantId: number): Promise<string | null> {
  return await page.evaluate(async (id: number) => {
    try {
      const res = await fetch("/cart/add.js", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: [{ id, quantity: 1 }] }),
      });
      if (!res.ok) return `the storefront rejected the add-to-cart request (HTTP ${res.status})`;
      return null;
    } catch (err) {
      return `the add-to-cart request failed: ${String(err)}`;
    }
  }, variantId);
}

/** Opens the primary menu so the nav capture shows the menu rather than the closed header.
 *
 * Best-effort by design: menus are implemented every possible way, and a nav slide about the closed
 * header is still a useful slide. Returns whether it believes something opened, which the caller
 * records rather than asserts. */
async function openMenu(page: Page): Promise<boolean> {
  return await page.evaluate(() => {
    const candidates = Array.from(
      document.querySelectorAll<HTMLElement>(
        "button[aria-controls], [aria-label*='menu' i], [class*='menu-toggle'], [class*='hamburger'], summary",
      ),
    );
    for (const el of candidates) {
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      el.click();
      return true;
    }
    return false;
  });
}

/* ── One page, one device ────────────────────────────────────────────────────────────────────── */

interface PageResult {
  capture: CroPageCapture;
  /** The rendered HTML, returned rather than re-read by the caller: a second page.content() after
   * the fact is one navigation away from describing a different page. */
  html?: string;
}

async function capturePage(
  page: Page,
  target: CroTarget,
  device: CroDevice,
  upload?: ScreenshotSink,
): Promise<PageResult> {
  const base: CroPageCapture = {
    group: target.group,
    device,
    url: target.url,
    signals: [],
    measurements: { viewportHeight: 0, documentHeight: 0, sectionOffsets: [], interactiveBelowFold: 0 },
  };

  const viewport = VIEWPORTS[device];
  await page.setUserAgent(device === "mobile" ? MOBILE_UA : DESKTOP_UA);
  await page.setViewport(viewport);

  // The cart and checkout groups need stock in the cart before their URL means anything, and the
  // add has to happen on a page of the same origin so the session cookie is the one that carries.
  if (target.variantId) {
    const origin = new URL(target.url).origin;
    const primed = await page.goto(origin, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => null);
    if (!primed) return { capture: { ...base, error: "The storefront could not be loaded to prime the cart." } };
    const problem = await addToCart(page, target.variantId);
    if (problem) return { capture: { ...base, error: `The cart could not be primed — ${problem}.` } };
  }

  const response = await page.goto(target.url, { waitUntil: "networkidle2", timeout: 45000 }).catch(() => null);
  if (!response) return { capture: { ...base, error: "The page did not load within 45 seconds." } };
  if (!response.ok()) return { capture: { ...base, error: `The page returned HTTP ${response.status()}.` } };

  const finalUrl = page.url();

  // Plenty of Shopify themes have no cart *page*: /cart redirects to the home page with the cart
  // drawer opened over it. The drawer is genuinely this store's cart and its markup is in the DOM,
  // so the signal checks below are about the right thing — but every scroll-shaped measurement
  // (page height, section order, controls below the fold, small tap targets) then describes the page
  // the drawer is floating over. Publishing those as "the cart page is 8,259px tall" is how a deck
  // ends up with a confident finding about a page that does not exist.
  const overlay = target.group === "cart" && !/\/cart(\/|$|\?)/.test(new URL(finalUrl).pathname + new URL(finalUrl).search)
    ? `${new URL(target.url).pathname} redirects to ${finalUrl} — this theme has no cart page, only a drawer. The checks below read the drawer's markup; the page-level scroll measurements are omitted because they would describe the page underneath it.`
    : undefined;

  if (target.openMenu) await openMenu(page);

  // Lazy-loaded sections are the norm in Shopify themes, and their real height is what every
  // fold measurement below depends on. Same treatment as the site audit's screenshot pass.
  await autoScrollToBottom(page);
  await Promise.race([waitForImages(page), sleep(4000)]);
  // Reviews and other third-party widgets render after the network settles.
  await sleep(1500);

  const html = await page.content().catch(() => "");
  const measurements = await measure(page, target.group, device).catch(() => base.measurements);

  const fold = await page.screenshot({ type: "jpeg", quality: 72, fullPage: false }).catch(() => null);

  // A full-page shot of a long storefront at a retina scale factor is an enormous raster: an
  // 8,259px page at deviceScaleFactor 2 is 16,518px tall, and the model API refuses any image over
  // 8,000px in either dimension outright. Scaling the *device pixel ratio* rather than resizing
  // afterwards keeps the CSS layout identical — the page is still 390px wide and laid out exactly
  // as measured — and needs no image library. Restored straight after, so nothing else in the run
  // inherits it.
  const scale = fullPageScaleFactor(measurements.documentHeight, viewport.deviceScaleFactor);
  if (scale !== viewport.deviceScaleFactor) {
    await page.setViewport({ ...viewport, deviceScaleFactor: scale });
  }
  const full = await page.screenshot({ type: "jpeg", quality: 68, fullPage: true }).catch(() => null);
  if (scale !== viewport.deviceScaleFactor) {
    await page.setViewport(viewport).catch(() => undefined);
  }

  const screenshotFold = fold && upload ? await upload(target.group, device, "fold", Buffer.from(fold)) : undefined;
  const screenshotFull = full && upload ? await upload(target.group, device, "full", Buffer.from(full)) : undefined;

  return {
    capture: {
      group: target.group,
      device,
      url: finalUrl,
      screenshotFold,
      screenshotFull,
      signals: signalsForGroup(target.group, html),
      measurements,
      note: overlay,
      overlay: overlay ? true : undefined,
    },
    html,
  };
}

/* ── The sweep ───────────────────────────────────────────────────────────────────────────────── */

export interface CaptureResult {
  pages: CroPageCapture[];
  /** Raw HTML per page, kept in memory only — it is what detectFeatures() needs for the competitive
   * matrix, and it is far too large to store. */
  html: string[];
  limitations: string[];
}

/** One browser session over every requested group × device. Never throws: a page that will not load
 * becomes a `CroPageCapture` carrying its error, because a slide saying "the cart could not be
 * reached" is information and a missing slide is not. */
export async function captureStorefront(options: CaptureOptions): Promise<CaptureResult> {
  const pages: CroPageCapture[] = [];
  const html: string[] = [];
  const limitations: string[] = [];

  const chrome = await chromeLauncher.launch({
    chromeFlags: ["--headless=new", "--no-sandbox", "--disable-gpu"],
  });

  try {
    const puppeteer = (await import("puppeteer-core")).default;
    const browser = await puppeteer.connect({ browserURL: `http://localhost:${chrome.port}` });
    try {
      const page = await browser.newPage();
      await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });

      let first = true;
      for (const device of options.devices) {
        for (const target of options.targets) {
          if (!first) await throttleDelay();
          first = false;

          options.onStage?.(`Capturing ${target.group.toUpperCase()} (${device})`);
          const result = await capturePage(page, target, device, options.uploadScreenshot).catch(
            (err): PageResult => ({
              capture: {
                group: target.group,
                device,
                url: target.url,
                signals: [],
                measurements: { viewportHeight: 0, documentHeight: 0, sectionOffsets: [], interactiveBelowFold: 0 },
                error: String((err as Error)?.message ?? err).slice(0, 200),
              },
            }),
          );
          pages.push(result.capture);
          if (result.capture.error) {
            limitations.push(`${target.group.toUpperCase()} (${device}): ${result.capture.error}`);
          } else if (result.html) {
            html.push(result.html);
          }
        }
      }
    } finally {
      await browser.disconnect();
    }
  } catch (err) {
    limitations.push(`The browser could not be driven: ${String((err as Error)?.message ?? err).slice(0, 200)}`);
  } finally {
    await chrome.kill();
  }

  return { pages, html, limitations };
}

/** A competitor's own sweep. Deliberately the same capture over the same groups: a benchmark that
 * compared our six-page review against a competitor's home page would be an unfair comparison
 * dressed as an audit. */
export async function captureCompetitor(
  url: string,
  targets: CroTarget[],
  devices: readonly CroDevice[],
  onStage?: (stage: string) => void,
): Promise<{ capture: CroCompetitorCapture; html: string[] }> {
  const name = new URL(url).hostname.replace(/^www\./, "");
  const result = await captureStorefront({ targets, devices, onStage });
  return {
    capture: {
      name,
      url,
      pages: result.pages,
      error: result.pages.every((p) => p.error) ? "No page of this competitor's storefront could be captured." : undefined,
    },
    html: result.html,
  };
}

/** Assembles the stored capture record. Kept here so the shape is built in one place, next to the
 * code that produced its contents. */
export function buildCapture(input: {
  id: string;
  storeSlug: string;
  storeUrl: string;
  durationMs: number;
  pages: CroPageCapture[];
  competitors?: CroCompetitorCapture[];
  limitations: string[];
}): CroCapture {
  return {
    id: input.id,
    storeSlug: input.storeSlug,
    storeUrl: input.storeUrl,
    createdAt: new Date().toISOString(),
    durationMs: input.durationMs,
    pages: input.pages,
    competitors: input.competitors,
    limitations: input.limitations,
  };
}
