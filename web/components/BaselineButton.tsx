"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Toggles a report's isBaseline flag via /api/baseline, then refreshes so every dependent
 * view (this page's delta math, the Baseline & Reporting list) reflects the new baseline
 * immediately. */
export function BaselineButton({ slug, id, isBaseline }: { slug: string; id: string; isBaseline: boolean }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function toggle() {
    setLoading(true);
    try {
      const res = await fetch("/api/baseline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, id }),
      });
      if (res.ok) router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={loading}
      className={`text-[11px] font-semibold uppercase tracking-wider px-2.5 py-1 rounded-full transition-colors disabled:opacity-60 ${
        isBaseline
          ? "bg-[#1A1A1A] text-white hover:bg-[#333]"
          : "bg-[#f0efed] text-[#6B6B6B] hover:bg-[#EDECE8] hover:text-[#1A1A1A]"
      }`}
    >
      {loading ? "…" : isBaseline ? "Baseline ✓" : "Set baseline"}
    </button>
  );
}
