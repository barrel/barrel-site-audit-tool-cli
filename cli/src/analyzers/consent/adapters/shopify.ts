import type { TrackerCategory } from "@barrel/site-audit-shared";
import { type CmpAdapter, type CmpCategoryState, ACCEPT_PATTERNS, REJECT_PATTERNS, clickByAccessibleName, safeEval, waitFor, dismissBanner} from "./types.js";

/** Shopify's own Customer Privacy API, used by the native privacy banner and by any store whose
 * tags go through Customer Events. setTrackingConsent is callback-based, so each call is wrapped
 * in a promise — resolving on the callback rather than returning immediately, because the tags
 * downstream only react once Shopify has persisted the choice. */
export const shopifyAdapter: CmpAdapter = {
  id: "shopify-native",
  label: "Shopify Customer Privacy",

  async detect(page) {
    return safeEval(page, () => typeof (window as any).Shopify?.customerPrivacy !== "undefined", false);
  },

  async waitForBanner(page, timeoutMs) {
    return waitFor(
      page,
      () => {
        const cp = (window as any).Shopify?.customerPrivacy;
        if (!cp) return false;
        // Rendered, not merely present in the DOM, and never a bare `true` fallback. Shopify keeps
        // the banner markup on the page whether or not it is shown, so DOM presence reported a
        // banner on storefronts that prompt nobody — passing A2 at blocker severity. The old
        // `: true` default did the same on any build without shouldShowBanner. On 10 of 23
        // recorded A2 passes the very next test said "no accept control was found to compare
        // against": the report was claiming a banner was on screen and no buttons existed.
        const el = document.querySelector<HTMLElement>(".shopify-pc__banner");
        if (el) {
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          return rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
        }
        return typeof cp.shouldShowBanner === "function" ? Boolean(cp.shouldShowBanner()) : false;
      },
      timeoutMs,
    );
  },

  async rejectAll(page) {
    const viaApi = await setConsent(page, { analytics: false, marketing: false, preferences: false, sale_of_data: false });
    return viaApi || clickByAccessibleName(page, REJECT_PATTERNS);
  },

  async acceptAll(page) {
    const viaApi = await setConsent(page, { analytics: true, marketing: true, preferences: true, sale_of_data: true });
    return viaApi || clickByAccessibleName(page, ACCEPT_PATTERNS);
  },

  async granular(page, allow: TrackerCategory[]) {
    return setConsent(page, {
      analytics: allow.includes("analytics"),
      marketing: allow.includes("marketing"),
      preferences: allow.includes("preferences"),
      sale_of_data: allow.includes("marketing"),
    });
  },

  async dismiss(page) {
    return dismissBanner(page, () => this.waitForBanner(page, 1_500));
  },

  async readState(page) {
    return safeEval<CmpCategoryState | null>(
      page,
      () => {
        const cp = (window as any).Shopify?.customerPrivacy;
        if (!cp) return null;
        return {
          necessary: true,
          preferences: typeof cp.preferencesAllowed === "function" ? Boolean(cp.preferencesAllowed()) : undefined,
          analytics: typeof cp.analyticsProcessingAllowed === "function" ? Boolean(cp.analyticsProcessingAllowed()) : undefined,
          marketing: typeof cp.marketingAllowed === "function" ? Boolean(cp.marketingAllowed()) : undefined,
        };
      },
      null,
    );
  },
};

function setConsent(
  page: Parameters<CmpAdapter["rejectAll"]>[0],
  consent: { analytics: boolean; marketing: boolean; preferences: boolean; sale_of_data: boolean },
): Promise<boolean> {
  return page
    .evaluate(async (c: Record<string, boolean>) => {
      const cp = (window as any).Shopify?.customerPrivacy;
      if (!cp || typeof cp.setTrackingConsent !== "function") return false;
      await new Promise<void>((resolve) => {
        let settled = false;
        const done = () => {
          if (!settled) {
            settled = true;
            resolve();
          }
        };
        // Shopify does not guarantee the callback fires (it silently drops on a malformed
        // payload); the timer keeps one unlucky call from hanging the whole state.
        setTimeout(done, 3000);
        try {
          cp.setTrackingConsent(c, done);
        } catch {
          done();
        }
      });
      return true;
    }, consent as unknown as Record<string, boolean>)
    .catch(() => false);
}
