import { type CmpAdapter, ACCEPT_PATTERNS, PREFS_PATTERNS, REJECT_PATTERNS, clickByAccessibleName, safeEval } from "./types.js";

/** Last-resort adapter for a CMP we don't have a vendor integration for — an in-house banner, a
 * Shopify app, or a vendor that was swapped in since this list was last touched.
 *
 * It exists so an unrecognised CMP degrades to text-matched clicking rather than dropping out of
 * coverage entirely. Coverage gaps are the failure mode that matters here: a site silently going
 * untested looks identical to a site that passed. */
export const heuristicAdapter: CmpAdapter = {
  id: "heuristic",
  label: "Unrecognised CMP (heuristic)",

  async detect(page) {
    // Something banner-shaped mentioning cookies, with a button in it. Deliberately loose: this
    // adapter is only ever reached after every vendor adapter has already declined.
    return safeEval(
      page,
      () => {
        const nodes = Array.from(document.querySelectorAll<HTMLElement>("div, section, aside, dialog"));
        return nodes.some((el) => {
          const text = (el.textContent || "").slice(0, 400);
          if (!/cookie|consent|privacy|tracking/i.test(text)) return false;
          if (!el.querySelector("button, a[href], [role='button']")) return false;
          const rect = el.getBoundingClientRect();
          return rect.width > 200 && rect.height > 40 && rect.height < window.innerHeight * 0.9;
        });
      },
      false,
    );
  },

  async waitForBanner(page, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await this.detect(page)) return true;
      await new Promise((r) => setTimeout(r, 250));
    }
    return false;
  },

  async rejectAll(page) {
    return clickByAccessibleName(page, REJECT_PATTERNS);
  },

  async acceptAll(page) {
    return clickByAccessibleName(page, ACCEPT_PATTERNS);
  },

  async readState() {
    // No API to read. Returning null (rather than a guess) keeps the CMP-state assertions
    // `skipped` instead of inventing a pass or a fail from nothing.
    return null;
  },

  async openPreferences(page) {
    return clickByAccessibleName(page, PREFS_PATTERNS);
  },
};
