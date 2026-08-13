"use client";

import { useState } from "react";

export function ShareButton({ slug, id }: { slug: string; id: string }) {
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [url, setUrl] = useState("");
  const [copied, setCopied] = useState(false);

  async function generateLink() {
    setStatus("loading");
    setCopied(false);
    try {
      const res = await fetch("/api/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, id }),
      });
      if (!res.ok) throw new Error("request failed");
      const data = await res.json();
      setUrl(data.url);
      setStatus("ready");
      await copyLink(data.url);
    } catch {
      setStatus("error");
    }
  }

  async function copyLink(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      // clipboard permission denied or unavailable — the link is still shown for manual copy
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => (status === "ready" ? copyLink(url) : generateLink())}
        disabled={status === "loading"}
        className="text-sm font-medium text-[#1A1A1A] bg-[#f0efed] hover:bg-[#EDECE8] px-3.5 py-2 rounded-lg transition-colors disabled:opacity-60"
      >
        {status === "loading" ? "Generating…" : status === "ready" ? (copied ? "Copied!" : "Copy link") : "Share"}
      </button>

      {status === "ready" && (
        <div className="absolute right-0 mt-2 w-80 bg-white border border-[#E5E5E5] rounded-lg shadow-lg p-3 z-10">
          <p className="text-[11px] font-semibold text-[#9A9A9A] uppercase tracking-wider mb-1.5">
            Private share link · expires in 30 days
          </p>
          <input
            type="text"
            readOnly
            value={url}
            onFocus={(e) => e.currentTarget.select()}
            className="w-full text-xs text-[#1A1A1A] bg-[#fafafa] border border-[#E5E5E5] rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#1A1A1A]/10"
          />
          <p className="text-[11px] text-[#9A9A9A] mt-1.5">
            Anyone with this link can view this report, no login required. It stops working after 30 days.
          </p>
        </div>
      )}

      {status === "error" && (
        <p className="absolute right-0 mt-2 w-64 text-xs text-red-600 bg-white border border-red-200 rounded-lg shadow-lg px-3 py-2 z-10">
          Couldn't generate a link. Try again.
        </p>
      )}
    </div>
  );
}
