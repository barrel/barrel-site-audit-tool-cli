"use client";

import { useState } from "react";

/** Copies a scan's site list as tab-separated "client, url" lines, which pastes cleanly into a
 * spreadsheet and still reads fine in a doc or a chat. The text is composed server-side so what is
 * copied is exactly the set of sites the table shows. */
export function CopySiteListButton({ text, count }: { text: string; count: number }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="shrink-0 text-xs font-semibold text-[#1A1A1A] bg-[#f0efed] hover:bg-[#EDECE8] px-3 py-1.5 rounded-lg transition-colors"
    >
      {copied ? "Copied!" : `Copy site list (${count})`}
    </button>
  );
}
