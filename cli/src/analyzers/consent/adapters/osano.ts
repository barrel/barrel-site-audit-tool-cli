import type { TrackerCategory } from "@barrel/site-audit-shared";
import { type CmpAdapter, type CmpCategoryState, ACCEPT_PATTERNS, REJECT_PATTERNS, clickByAccessibleName, safeEval, waitFor } from "./types.js";

/** Osano. Renders its banner into a shadow root, which is why the text-matching fallback in
 * types.ts walks shadow roots rather than using page.$(). */
export const osanoAdapter: CmpAdapter = {
  id: "osano",
  label: "Osano",

  async detect(page) {
    return safeEval(page, () => typeof (window as any).Osano?.cm !== "undefined", false);
  },

  async waitForBanner(page, timeoutMs) {
    // `cm.dialogOpen` rather than a DOM probe. Osano keeps a fully-rendered banner in the page
    // under an implied-consent configuration and merely hides it, so "is the markup there?"
    // answers yes on sites that prompt nobody — and the element even reports a non-zero height,
    // which defeats the usual visibility heuristics. The vendor's own flag is the only reliable
    // answer. Older builds without it fall back to the class the hidden state carries.
    return waitFor(
      page,
      () => {
        const cm = (window as any).Osano?.cm;
        if (cm && typeof cm.dialogOpen === "boolean") return cm.dialogOpen;
        const el = document.querySelector(".osano-cm-dialog");
        return Boolean(el && !el.classList.contains("osano-cm-dialog--hidden"));
      },
      timeoutMs,
    );
  },

  async rejectAll(page) {
    const viaApi = await safeEval(
      page,
      () => {
        const cm = (window as any).Osano?.cm;
        if (cm && typeof cm.denyAll === "function") {
          cm.denyAll();
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
        const cm = (window as any).Osano?.cm;
        if (cm && typeof cm.acceptAll === "function") {
          cm.acceptAll();
          return true;
        }
        return false;
      },
      false,
    );
    return viaApi || clickByAccessibleName(page, ACCEPT_PATTERNS);
  },

  async granular(page, allow: TrackerCategory[]) {
    const consent = {
      ESSENTIAL: "ACCEPT",
      STORAGE: allow.includes("preferences") ? "ACCEPT" : "DENY",
      PERSONALIZATION: allow.includes("preferences") ? "ACCEPT" : "DENY",
      ANALYTICS: allow.includes("analytics") ? "ACCEPT" : "DENY",
      MARKETING: allow.includes("marketing") ? "ACCEPT" : "DENY",
    };
    return page
      .evaluate((c: Record<string, string>) => {
        const cm = (window as any).Osano?.cm;
        if (!cm || typeof cm.setConsent !== "function") return false;
        cm.setConsent(c);
        return true;
      }, consent)
      .catch(() => false);
  },

  async readState(page) {
    return safeEval<CmpCategoryState | null>(
      page,
      () => {
        const c = (window as any).Osano?.cm?.getConsent?.();
        if (!c) return null;
        const yes = (v: unknown) => v === "ACCEPT";
        return {
          necessary: yes(c.ESSENTIAL),
          preferences: yes(c.STORAGE) || yes(c.PERSONALIZATION),
          analytics: yes(c.ANALYTICS),
          marketing: yes(c.MARKETING),
        };
      },
      null,
    );
  },

  async readPosture(page) {
    return safeEval<{ impliedConsent: boolean; jurisdiction?: string } | null>(
      page,
      () => {
        const cm = (window as any).Osano?.cm;
        if (!cm || typeof cm.consentModel !== "string") return null;
        return { impliedConsent: cm.consentModel === "implicit", jurisdiction: cm.jurisdiction };
      },
      null,
    );
  },

  async openPreferences(page) {
    return safeEval(
      page,
      () => {
        const cm = (window as any).Osano?.cm;
        if (cm && typeof cm.showDrawer === "function") {
          cm.showDrawer("osano-cm-dom-info-dialog-open");
          return true;
        }
        return false;
      },
      false,
    );
  },
};
