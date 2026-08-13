"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Toggles a report's archived flag via /api/archive, then refreshes the list. Archiving only
 * hides a report from the default landing-page list — the report itself, its direct link, and
 * its place in Baseline & Reporting history are all unaffected. */
export function ArchiveButton({
  slug,
  id,
  archived,
  variant = "compact",
}: {
  slug: string;
  id: string;
  archived: boolean;
  /** "compact" — quiet text button for dense list rows. "header" — matches the pill buttons
   * (Share, CLI Instructions) in the report page header. */
  variant?: "compact" | "header";
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function toggle(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setLoading(true);
    try {
      const res = await fetch("/api/archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, id }),
      });
      if (res.ok) router.refresh();
    } finally {
      setLoading(false);
    }
  }

  const className =
    variant === "header"
      ? `text-sm font-medium px-3.5 py-2 rounded-lg transition-colors disabled:opacity-60 ${
          archived ? "bg-[#1A1A1A] text-white hover:bg-[#333]" : "bg-[#f0efed] text-[#1A1A1A] hover:bg-[#EDECE8]"
        }`
      : "text-xs font-medium text-[#9A9A9A] hover:text-[#1A1A1A] px-2 py-1 rounded-md hover:bg-[#f0efed] transition-colors disabled:opacity-60 shrink-0";

  return (
    <button type="button" onClick={toggle} disabled={loading} className={className}>
      {loading ? "…" : archived ? "Unarchive" : "Archive"}
    </button>
  );
}
