import type { Page } from "puppeteer-core";
import type { CmpVendor, TrackerCategory } from "@barrel/site-audit-shared";

/** The CMP's own view of which categories are consented. Deliberately separate from Shopify's
 * Customer Privacy API state — the two disagreeing is itself a finding worth reporting. */
export interface CmpCategoryState {
  necessary?: boolean;
  preferences?: boolean;
  analytics?: boolean;
  marketing?: boolean;
}

/** What the CMP's own configuration says about whether it asks permission at all.
 *
 * Read from the vendor rather than inferred from the page, because the two things that produce
 * an empty screen — "configured for implied consent" and "the banner is broken" — look identical
 * from the outside and mean opposite things to the client. */
export interface CmpPosture {
  /** True when the CMP is set to an implied/opt-out model: no prompt, consent assumed. */
  impliedConsent: boolean;
  /** The vendor's own jurisdiction label, e.g. `us-fl`. Reported verbatim, never interpreted. */
  jurisdiction?: string;
}

/** One consent-management platform, reduced to the handful of things a test needs to do to it.
 *
 * Every method returns a boolean rather than throwing: a CMP that can't be driven yields
 * `blocked`, not `fail`, and an adapter that threw would be indistinguishable from a site that
 * is genuinely non-compliant. */
export interface CmpAdapter {
  id: CmpVendor;
  label: string;
  /** Is this CMP present on the page at all? Cheap check, run against every adapter in turn. */
  detect(page: Page): Promise<boolean>;
  waitForBanner(page: Page, timeoutMs: number): Promise<boolean>;
  rejectAll(page: Page): Promise<boolean>;
  acceptAll(page: Page): Promise<boolean>;
  /** Consent to exactly `allow` and nothing else. Absent when the CMP offers no granular API —
   * Suite F is then reported `skipped`, which is honest, rather than silently passing. */
  granular?(page: Page, allow: TrackerCategory[]): Promise<boolean>;
  /** Close the banner *without* choosing — the X, the overlay, Escape.
   *
   * Its own method rather than a variant of reject because the whole question is whether the CMP
   * treats the two the same. A banner offering no way to dismiss is a correct design, not a
   * failure, so absence of a control yields `false` and the suite reports `skipped`. */
  dismiss?(page: Page): Promise<boolean>;
  readState(page: Page): Promise<CmpCategoryState | null>;
  /** The configured consent model, when the vendor exposes it. Absent adapters fall back to a
   * conservative inference in the engine. */
  readPosture?(page: Page): Promise<CmpPosture | null>;
  openPreferences?(page: Page): Promise<boolean>;
}

/** Every adapter prefers the vendor's JS API over clicking; these are the fallbacks for when it
 * isn't exposed. Text matching beats CSS selectors here — a CMP redesign changes class names far
 * more often than it changes the word "Reject". */
// The optional words repeat because the stock labels stack them: OneTrust ships "Accept All
// Cookies" and Cookiebot "Allow all cookies", and neither matched a pattern that allowed only one
// suffix. A3 was reported `skipped` — which reads as "not applicable" — on 20 of 41 recorded runs
// for want of these, and on a banner whose reject read "Use necessary cookies only" it went
// further and *accused* the site of offering no reject control at all.
export const REJECT_PATTERNS = /^(reject|decline|deny|refuse)( all)?( cookies)?$|necessary only|only necessary|necessary cookies only|essential only|essential cookies only|opt.?out|do not (sell|accept)|continue without|^no,? thanks$/i;
export const ACCEPT_PATTERNS = /^(accept|allow|agree|got it|ok)( all)?( cookies)?( and (close|continue))?$|i (accept|agree)|enable all/i;
/** Controls that close a banner without expressing a preference either way. */
export const DISMISS_PATTERNS = /^(close|dismiss|×|x|✕|✖|not now|maybe later|no thanks)$|close (this )?(banner|dialog|notice)/i;

export const PREFS_PATTERNS = /cookie (settings|preferences)|manage (cookies|preferences|consent)|privacy (settings|preferences)|customi[sz]e/i;

/** Text that marks a container as the consent UI rather than some other dialog. */
const CONSENT_CONTEXT = /cookie|consent|privacy|tracking|gdpr|ccpa|do not sell/i;

/** Marketing interstitials that share vocabulary with a consent banner.
 *
 * An email-capture popup routinely offers "No thanks, continue without discount" and "OK" — which
 * match REJECT_PATTERNS and ACCEPT_PATTERNS respectively. Clicking one and reporting it as a
 * consent choice produces a `reject` state in which nobody rejected anything, and every tracker
 * then looks correctly blocked. That is a false pass on the one test this whole scan exists for,
 * so these containers are excluded before matching, and the match is additionally required to sit
 * inside something that talks about cookies. */
const MARKETING_POPUP = /klaviyo|attentive|privy|justuno|optinmonster|wisepops|omnisend|mailmunch|sumo|postscript|yotpo|smsbump/i;

/** Clicks the first visible, enabled element whose accessible name matches `pattern`.
 *
 * Runs entirely inside the page rather than via Puppeteer selectors so it can reach into open
 * shadow roots, which several CMPs (Osano, some OneTrust templates) render their banner into and
 * which `page.$()` cannot see. */
export async function clickByAccessibleName(page: Page, pattern: RegExp): Promise<boolean> {
  return page
    .evaluate((source: string, flags: string, consentSource: string, marketingSource: string) => {
      const re = new RegExp(source, flags);
      const consentRe = new RegExp(consentSource, "i");
      const marketingRe = new RegExp(marketingSource, "i");

      const roots: Array<Document | ShadowRoot> = [document];
      const seen = new Set<Document | ShadowRoot>();
      for (let i = 0; i < roots.length && i < 200; i++) {
        const root = roots[i];
        if (seen.has(root)) continue;
        seen.add(root);
        for (const el of Array.from(root.querySelectorAll("*"))) {
          const sr = (el as HTMLElement).shadowRoot;
          if (sr) roots.push(sr);
        }
      }

      // Walks up from the control looking for a container that talks about cookies, and bails if
      // it passes through a known marketing popup on the way. A positive requirement rather than a
      // blocklist: a consent banner always says "cookies", "privacy" or "tracking" somewhere, and
      // an email-capture modal says "discount" and "subscribe".
      const inConsentUi = (el: HTMLElement): boolean => {
        let node: HTMLElement | null = el;
        for (let depth = 0; node && depth < 8; depth++) {
          const marker = `${node.className || ""} ${node.id || ""}`;
          if (marketingRe.test(marker)) return false;
          const text = (node.textContent || "").slice(0, 600);
          if (consentRe.test(text)) return true;
          node = node.parentElement ?? ((node.getRootNode() as ShadowRoot)?.host as HTMLElement) ?? null;
        }
        return false;
      };

      for (const root of roots) {
        const candidates = Array.from(
          root.querySelectorAll<HTMLElement>('button, a[href], [role="button"], input[type="button"], input[type="submit"]'),
        );
        for (const el of candidates) {
          const name = (el.getAttribute("aria-label") || el.textContent || "").trim().replace(/\s+/g, " ");
          if (!name || !re.test(name)) continue;
          if (!inConsentUi(el)) continue;
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          const visible =
            rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none" && style.opacity !== "0";
          if (!visible || (el as HTMLButtonElement).disabled) continue;
          el.click();
          return true;
        }
      }
      return false;
    }, pattern.source, pattern.flags, CONSENT_CONTEXT.source, MARKETING_POPUP.source)
    .catch(() => false);
}

/** Closes a banner without answering it: a dismiss control if there is one, Escape if not.
 *
 * Verifies the banner actually went away. Returning true on a click that did nothing would
 * produce a "dismissed" state in which the banner is still up and nothing was dismissed — and if
 * no tags happened to fire, that reads as a pass on precisely the thing being tested. */
export async function dismissBanner(page: Page, _stillShowing?: () => Promise<boolean>): Promise<boolean> {
  const clicked = await clickByAccessibleName(page, DISMISS_PATTERNS);
  if (!clicked) await page.keyboard.press("Escape").catch(() => undefined);
  await new Promise((r) => setTimeout(r, 1_000));

  // Judged on whether the banner is still *rendered*, not on the CMP's should-show flag. Every
  // vendor computes that flag from "has the visitor answered?", which by definition cannot change
  // when the whole point was to close the banner without answering — so the previous check could
  // never return true, and suite H returned 0 passes and 0 failures across every recorded run.
  // The CIPA test the suite exists for had never once produced a result.
  return !(await bannerStillRendered(page));
}

/** Is any consent-shaped dialog still painted on screen? Deliberately vendor-agnostic. */
async function bannerStillRendered(page: Page): Promise<boolean> {
  return safeEval(
    page,
    () => {
      const roots: Array<Document | ShadowRoot> = [document];
      for (let i = 0; i < roots.length && i < 200; i++) {
        for (const el of Array.from(roots[i].querySelectorAll("*"))) {
          const sr = (el as HTMLElement).shadowRoot;
          if (sr) roots.push(sr);
        }
      }
      for (const root of roots) {
        for (const el of Array.from(root.querySelectorAll<HTMLElement>("div, section, aside, dialog"))) {
          const text = (el.textContent || "").slice(0, 400);
          if (!/cookie|consent|privacy|tracking/i.test(text)) continue;
          if (!el.querySelector("button, a[href], [role='button']")) continue;
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          if (rect.width < 200 || rect.height < 40) continue;
          if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") continue;
          return true;
        }
      }
      return false;
    },
    true,
  );
}

/** Runs `fn` in the page, returning `fallback` on any error. Page-context code touching a CMP's
 * globals throws constantly (script not loaded yet, API renamed between versions); every such
 * throw would otherwise become a spurious `blocked`. */
export async function safeEval<T>(page: Page, fn: () => T, fallback: T): Promise<T> {
  try {
    return (await page.evaluate(fn)) as T;
  } catch {
    return fallback;
  }
}

/** Polls `fn` in the page until it returns true. Used instead of waitForSelector so adapters can
 * wait on a JS-API condition (`Cookiebot.hasResponse`) rather than a DOM node that may live in a
 * shadow root or an iframe. */
export async function waitFor(page: Page, fn: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await safeEval(page, fn, false)) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}
