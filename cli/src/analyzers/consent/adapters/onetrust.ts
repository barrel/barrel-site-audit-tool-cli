import type { TrackerCategory } from "@barrel/site-audit-shared";
import { type CmpAdapter, type CmpCategoryState, ACCEPT_PATTERNS, REJECT_PATTERNS, clickByAccessibleName, readGatedScripts, safeEval, waitFor, dismissBanner} from "./types.js";

/** OneTrust. Category membership is read from the OptanonActiveGroups string (",C0001,C0002,"),
 * whose group IDs are OneTrust's own fixed taxonomy and stable across tenants. */
const GROUPS = { necessary: "C0001", analytics: "C0002", preferences: "C0003", marketing: "C0004" } as const;

export const onetrustAdapter: CmpAdapter = {
  id: "onetrust",
  label: "OneTrust",

  async detect(page) {
    return safeEval(
      page,
      () => typeof (window as any).OneTrust !== "undefined" || typeof (window as any).Optanon !== "undefined",
      false,
    );
  },

  async waitForBanner(page, timeoutMs) {
    return waitFor(
      page,
      () => {
        const ot = (window as any).OneTrust;
        const banner = document.getElementById("onetrust-banner-sdk");
        return Boolean(ot && banner && banner.offsetParent !== null);
      },
      timeoutMs,
    );
  },

  async rejectAll(page) {
    const viaApi = await safeEval(
      page,
      () => {
        const ot = (window as any).OneTrust;
        if (ot && typeof ot.RejectAll === "function") {
          ot.RejectAll();
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
        const ot = (window as any).OneTrust;
        if (ot && typeof ot.AllowAll === "function") {
          ot.AllowAll();
          return true;
        }
        return false;
      },
      false,
    );
    return viaApi || clickByAccessibleName(page, ACCEPT_PATTERNS);
  },

  async granular(page, allow: TrackerCategory[]) {
    // UpdateConsent takes one "C0002:1"-style pair per call; send the full set so unlisted
    // categories are explicitly denied rather than left at whatever the default was.
    const pairs = [
      `${GROUPS.analytics}:${allow.includes("analytics") ? 1 : 0}`,
      `${GROUPS.preferences}:${allow.includes("preferences") ? 1 : 0}`,
      `${GROUPS.marketing}:${allow.includes("marketing") ? 1 : 0}`,
    ];
    return safeEval(
      page,
      () => {
        const ot = (window as any).OneTrust;
        return Boolean(ot && typeof ot.UpdateConsent === "function");
      },
      false,
    ).then(async (ok) => {
      if (!ok) return false;
      for (const pair of pairs) {
        await page.evaluate((p: string) => (window as any).OneTrust.UpdateConsent("Category", p), pair).catch(() => undefined);
      }
      return true;
    });
  },

  async dismiss(page) {
    return dismissBanner(page, () => this.waitForBanner(page, 1_500));
  },

  async readState(page) {
    return safeEval<CmpCategoryState | null>(
      page,
      () => {
        const active = (window as any).OptanonActiveGroups;
        if (typeof active !== "string") return null;
        const has = (g: string) => active.includes(g);
        return {
          necessary: has("C0001"),
          analytics: has("C0002"),
          preferences: has("C0003"),
          marketing: has("C0004"),
        };
      },
      null,
    );
  },

  async readClassification(page) {
    // OneTrust carries the category in a class — `optanon-category-C0004` — rather than an
    // attribute, and neutralises the tag with `type="text/plain"`. The numeric codes are its
    // stock taxonomy and are expanded so the column reads as words; an unrecognised code is
    // passed through verbatim rather than mapped to a guess, because a customer can define
    // categories of their own and inventing a name for one would be worse than showing the code.
    const CATEGORIES: Record<string, string> = {
      C0001: "C0001 (Strictly Necessary)",
      C0002: "C0002 (Performance)",
      C0003: "C0003 (Functional)",
      C0004: "C0004 (Targeting)",
      C0005: "C0005 (Social Media)",
    };
    const gated = await readGatedScripts(page, "script[class*='optanon-category-'], script[data-ot-ignore]", (el) => {
      if (el.hasAttribute("data-ot-ignore")) return "IGNORED by vendor markup";
      const m = /optanon-category-([A-Za-z0-9]+)/.exec(el.className || "");
      return m ? m[1] : "";
    });
    return {
      rules: gated.map((s) => ({
        match: s.src,
        category: CATEGORIES[s.category] ?? s.category,
        kind: "script" as const,
      })),
    };
  },

  async openPreferences(page) {
    return safeEval(
      page,
      () => {
        const ot = (window as any).OneTrust;
        if (ot && typeof ot.ToggleInfoDisplay === "function") {
          ot.ToggleInfoDisplay();
          return true;
        }
        return false;
      },
      false,
    );
  },
};
