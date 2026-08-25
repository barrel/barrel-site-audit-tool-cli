"use client";

import { useState } from "react";

/** Mints a signed, single-audit, 30-day link a client can open with no Barrel account.
 *
 * Same token machinery as the site audit's share links, scoped so it authorises this CRO audit's
 * screenshots and nothing else. */
export function CroShareButton({ slug, croId }: { slug: string; croId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/cro-share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, id: croId }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? "The link could not be created.");
        return;
      }
      setUrl(data.url);
      try {
        await navigator.clipboard.writeText(data.url);
        setCopied(true);
      } catch {
        // Clipboard access can be refused; the link is on screen either way.
      }
    } finally {
      setBusy(false);
    }
  }

  if (url) {
    return (
      <div className="flex flex-col items-end gap-1 print:hidden">
        <input
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          className="w-[280px] border border-[#E5E5E5] rounded-lg px-3 py-1.5 text-[11px] text-[#6B6B6B]"
        />
        <span className="text-[10px] text-[#9A9A9A]">{copied ? "Copied — expires in 30 days" : "Expires in 30 days"}</span>
      </div>
    );
  }

  return (
    <div className="print:hidden">
      <button
        type="button"
        onClick={create}
        disabled={busy}
        className="text-sm font-medium text-[#1A1A1A] bg-[#f0efed] hover:bg-[#EDECE8] px-3.5 py-2 rounded-lg disabled:opacity-50 transition-colors"
      >
        {busy ? "Creating…" : "Share with client"}
      </button>
      {error && <p className="mt-1 text-[11px] text-[#B91C1C]">{error}</p>}
    </div>
  );
}
