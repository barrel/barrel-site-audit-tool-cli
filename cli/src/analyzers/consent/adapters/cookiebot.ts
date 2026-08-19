import type { Page } from "puppeteer-core";
import type { TrackerCategory } from "@barrel/site-audit-shared";
import { type CmpAdapter, type CmpCategoryState, ACCEPT_PATTERNS, REJECT_PATTERNS, clickByAccessibleName, safeEval, waitFor } from "./types.js";

/** Cookiebot. Exposes the richest JS API of any CMP we run into, including true granular consent
 * via submitCustomConsent(preferences, statistics, marketing) — note Cookiebot calls the
 * analytics category "statistics". */
export const cookiebotAdapter: CmpAdapter = {
  id: "cookiebot",
  label: "Cookiebot",

  async detect(page) {
    return safeEval(page, () => typeof (window as any).Cookiebot !== "undefined", false);
  },

  async waitForBanner(page, timeoutMs) {
    // hasResponse tells us the dialog has *rendered and is awaiting an answer*; waiting on the
    // DOM node alone races with Cookiebot's own async config fetch.
    return waitFor(
      page,
      () => {
        const cb = (window as any).Cookiebot;
        return Boolean(cb && (cb.dialog || cb.hasResponse === false));
      },
      timeoutMs,
    );
  },

  async rejectAll(page) {
    const viaApi = await safeEval(
      page,
      () => {
        const cb = (window as any).Cookiebot;
        if (!cb) return false;
        if (typeof cb.submitCustomConsent === "function") {
          cb.submitCustomConsent(false, false, false);
          return true;
        }
        if (typeof cb.withdraw === "function") {
          cb.withdraw();
          return true;
        }
        return false;
      },
      false,
    );
    return viaApi || clickByAccessibleName(page, REJECT_PATTERNS);
  },

  async acceptAll(page) {
    const viaApi = await safeEval(
      page,
      () => {
        const cb = (window as any).Cookiebot;
        if (!cb) return false;
        if (cb.dialog && typeof cb.dialog.submitAll === "function") {
          cb.dialog.submitAll();
          return true;
        }
        if (typeof cb.submitCustomConsent === "function") {
          cb.submitCustomConsent(true, true, true);
          return true;
        }
        return false;
      },
      false,
    );
    return viaApi || clickByAccessibleName(page, ACCEPT_PATTERNS);
  },

  async granular(page: Page, allow: TrackerCategory[]) {
    const prefs = allow.includes("preferences");
    const stats = allow.includes("analytics");
    const marketing = allow.includes("marketing");
    return safeEval(
      page,
      () => {
        const cb = (window as any).Cookiebot;
        return Boolean(cb && typeof cb.submitCustomConsent === "function");
      },
      false,
    ).then(async (ok) => {
      if (!ok) return false;
      await page.evaluate(
        (p: boolean, s: boolean, m: boolean) => (window as any).Cookiebot.submitCustomConsent(p, s, m),
        prefs,
        stats,
        marketing,
      );
      return true;
    });
  },

  async readState(page) {
    return safeEval<CmpCategoryState | null>(
      page,
      () => {
        const c = (window as any).Cookiebot?.consent;
        if (!c) return null;
        return {
          necessary: Boolean(c.necessary),
          preferences: Boolean(c.preferences),
          analytics: Boolean(c.statistics),
          marketing: Boolean(c.marketing),
        };
      },
      null,
    );
  },

  async openPreferences(page) {
    return safeEval(
      page,
      () => {
        const cb = (window as any).Cookiebot;
        if (cb && typeof cb.renew === "function") {
          cb.renew();
          return true;
        }
        return false;
      },
      false,
    );
  },
};
