"use client";

import { useState } from "react";

/** Mints a client-facing share link for a specific baseline/latest pair.
 *
 * Separate from the existing report ShareButton because the link means something different: this
 * one hands over a summary rather than the full audit, and it names two reports rather than one.
 * Collapsing them into one control would make it easy to send a client the wrong thing. */
export function ClientReportShareButton({
  slug,
  latestId,
  baselineId,
}: {
  slug: string;
  latestId: string;
  baselineId?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, id: latestId, compareId: baselineId, kind: "client" }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? `Could not create the link (${res.status}).`);
        return;
      }
      setUrl(data.url);
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }

  if (url) {
    return (
      <div className="flex items-center gap-2 min-w-0">
        <input
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          className="text-xs font-mono border border-[#E5E5E5] rounded-lg px-2.5 py-2 w-[280px] min-w-0 text-[#1A1A1A]"
        />
        <button
          type="button"
          onClick={() => {
            navigator.clipboard
              ?.writeText(url)
              .then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              })
              .catch(() => setError("Could not copy — select the link and copy it manually."));
          }}
          className="text-sm font-semibold text-white bg-[#1A1A1A] hover:bg-black px-3.5 py-2 rounded-lg transition-colors whitespace-nowrap"
        >
          {copied ? "Copied" : "Copy link"}
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      {error && <span className="text-xs text-[#B91C1C]">{error}</span>}
      <button
        type="button"
        onClick={create}
        disabled={busy}
        className="text-sm font-semibold text-white bg-[#1A1A1A] hover:bg-black disabled:bg-[#9A9A9A] px-3.5 py-2 rounded-lg transition-colors whitespace-nowrap"
      >
        {busy ? "Creating…" : "Create share link"}
      </button>
    </div>
  );
}
