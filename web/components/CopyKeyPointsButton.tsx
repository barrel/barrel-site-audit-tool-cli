"use client";

import { useState } from "react";

/** Puts the deck on the clipboard as markdown — one heading per slide, one line per point.
 *
 * The reason the deck view is not the whole feature: the deck a client sees is built in Slides or
 * Keynote, and what that build needs is the words, not a PDF of somebody else's layout. The
 * markdown is composed server-side (lib/report-deck.ts) and handed here already finished, so the
 * paste and the printed page cannot say different things. */
export function CopyKeyPointsButton({ markdown }: { markdown: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(markdown);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="print:hidden shrink-0 text-sm font-medium text-[#1A1A1A] bg-[#f0efed] hover:bg-[#EDECE8] px-3.5 py-2 rounded-lg transition-colors"
    >
      {copied ? "Copied!" : "Copy key points"}
    </button>
  );
}
