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
  readState(page: Page): Promise<CmpCategoryState | null>;
  /** The configured consent model, when the vendor exposes it. Absent adapters fall back to a
   * conservative inference in the engine. */
  readPosture?(page: Page): Promise<CmpPosture | null>;
  openPreferences?(page: Page): Promise<boolean>;
}

/** Every adapter prefers the vendor's JS API over clicking; these are the fallbacks for when it
 * isn't exposed. Text matching beats CSS selectors here — a CMP redesign changes class names far
 * more often than it changes the word "Reject". */
export const REJECT_PATTERNS = /^(reject|decline|deny|refuse)( all)?$|necessary only|only necessary|essential only|opt.?out|do not (sell|accept)|continue without/i;
export const ACCEPT_PATTERNS = /^(accept|allow|agree|got it|ok)( all| cookies| and close)?$|i (accept|agree)|enable all/i;
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
