import { type CmpAdapter, type CmpCategoryState, ACCEPT_PATTERNS, REJECT_PATTERNS, clickByAccessibleName, safeEval, waitFor, dismissBanner} from "./types.js";

/** CookieYes. Exposes getCkyConsent() for reading but no supported setter, so the choice has to
 * be made through the DOM. Its button classes are stable enough to try first, with the generic
 * text matcher behind them. */
async function clickCky(page: Parameters<CmpAdapter["rejectAll"]>[0], selector: string): Promise<boolean> {
  return page
    .evaluate((sel: string) => {
      const el = document.querySelector<HTMLElement>(sel);
      if (!el) return false;
      el.click();
      return true;
    }, selector)
    .catch(() => false);
}

export const cookieyesAdapter: CmpAdapter = {
  id: "cookieyes",
  label: "CookieYes",

  async detect(page) {
    return safeEval(
      page,
      () => typeof (window as any).getCkyConsent === "function" || Boolean(document.querySelector(".cky-consent-container")),
      false,
    );
  },

  async waitForBanner(page, timeoutMs) {
    return waitFor(page, () => Boolean(document.querySelector(".cky-consent-container, .cky-modal")), timeoutMs);
  },

  async rejectAll(page) {
    return (await clickCky(page, ".cky-btn-reject")) || clickByAccessibleName(page, REJECT_PATTERNS);
  },

  async acceptAll(page) {
    return (await clickCky(page, ".cky-btn-accept")) || clickByAccessibleName(page, ACCEPT_PATTERNS);
  },

  async dismiss(page) {
    return dismissBanner(page, () => this.waitForBanner(page, 1_500));
  },

  async readState(page) {
    return safeEval<CmpCategoryState | null>(
      page,
      () => {
        const c = (window as any).getCkyConsent?.();
        const cats = c?.categories;
        if (!cats) return null;
        return {
          necessary: Boolean(cats.necessary),
          preferences: Boolean(cats.functional),
          analytics: Boolean(cats.analytics) || Boolean(cats.performance),
          marketing: Boolean(cats.advertisement),
        };
      },
      null,
    );
  },

  async openPreferences(page) {
    return (await clickCky(page, "[data-cky-tag='settings-button'], .cky-banner-element")) || false;
  },
};
