"use client";

import { useState } from "react";
import Link from "next/link";
import { CURRENT_VERSION } from "@/lib/release-notes";

const POINTS = [
  "Every score comes from a live audit of the real, live storefront — not a cached snapshot or a synthetic sample.",
  "Performance figures are a real Lighthouse run (mobile + desktop), not the throttled public PageSpeed API.",
  "Theme code checks run Shopify's own official Theme Check engine against the actual theme source.",
  "Site health, pixel/consent, and structured-data checks are live browser/HTTP checks against the current site.",
  "AI-written sections (executive summary, suggested fixes) are clearly labeled and grounded in the real data collected above — never fabricated from nothing.",
  "Reports are timestamped and stored as generated — never edited after the fact.",
];

/** A small, always-available "is this real?" badge — for anyone (teammate or client) who wants
 * to know how a report's numbers were actually produced before trusting them. */
export function AboutBadge() {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="About this report"
        aria-expanded={open}
        className="w-7 h-7 rounded-full border border-[#E5E5E5] text-[#6B6B6B] hover:text-[#1A1A1A] hover:border-[#1A1A1A]/40 flex items-center justify-center text-xs font-bold shrink-0 transition-colors"
      >
        i
      </button>

      {open && (
        <>
          {/* Click-away layer — sits below the popover but above everything else. */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-2 w-[320px] bg-white border border-[#E5E5E5] rounded-lg shadow-lg p-4 z-50 text-left">
            <p className="text-[11px] font-semibold text-[#9A9A9A] uppercase tracking-wider mb-2">
              How this report is generated
            </p>
            <ul className="space-y-1.5 text-xs text-[#6B6B6B] leading-relaxed list-disc pl-4">
              {POINTS.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
            <Link
              href="/release-notes"
              onClick={() => setOpen(false)}
              className="block mt-3 pt-3 border-t border-[#E5E5E5] text-xs font-medium text-[#2563EB] hover:underline"
            >
              Release notes (v{CURRENT_VERSION}) →
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
