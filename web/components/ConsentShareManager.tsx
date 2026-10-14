"use client";

import { useCallback, useEffect, useState } from "react";

interface ShareSummary {
  id: string;
  emails: string[];
  createdAt: string;
  expiresAt: string;
  revokedAt?: string;
}

const inputClass =
  "w-full text-sm border border-[#E5E5E5] rounded-md px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-[#1A1A1A]/10";

/** Creates and revokes the password-protected external links for one scan.
 *
 * The password is typed here and never shown again — only a salted hash is stored — so the
 * creator has to pass it to recipients themselves, by a different route than the link. */
export function ConsentShareManager({ scanId }: { scanId: string }) {
  const [open, setOpen] = useState(false);
  const [emails, setEmails] = useState("");
  const [password, setPassword] = useState("");
  const [days, setDays] = useState(30);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<{ url: string; emails: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [shares, setShares] = useState<ShareSummary[]>([]);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/consent-share?scan=${encodeURIComponent(scanId)}`);
      if (res.ok) setShares((await res.json()).shares);
    } catch {
      // The list is a convenience; creating a link does not depend on it.
    }
  }, [scanId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/consent-share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scanId, emails, password, expiresInDays: days }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not create the link.");
      setCreated({ url: data.url, emails });
      setPassword("");
      setCopied(false);
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the link.");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    if (!window.confirm("Revoke this link? Anyone using it loses access immediately.")) return;
    await fetch("/api/consent-share", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    void load();
  }

  const live = shares.filter((s) => !s.revokedAt && new Date(s.expiresAt).getTime() > Date.now());

  return (
    <section className="print:hidden bg-white border border-[#E5E5E5] rounded-lg">
      <div className="px-5 py-3 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold text-[#1A1A1A]">Share outside Barrel</h2>
          <p className="text-xs text-[#6B6B6B]">
            A link that opens only for the emails you list, and only with a password you set.
            {live.length > 0 && ` ${live.length} active link${live.length === 1 ? "" : "s"}.`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="text-sm font-semibold text-white bg-[#1A1A1A] hover:bg-black px-3.5 py-2 rounded-lg transition-colors"
        >
          {open ? "Close" : "Create protected link"}
        </button>
      </div>

      {open && (
        <div className="px-5 pb-5 border-t border-[#E5E5E5] pt-4 space-y-3">
          {created ? (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-[#1A1A1A]">Link created for {created.emails.split(/[\s,;]+/).filter(Boolean).join(", ")}</p>
              <input readOnly value={created.url} onFocus={(e) => e.currentTarget.select()} className={inputClass} />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    await navigator.clipboard.writeText(created.url).catch(() => {});
                    setCopied(true);
                  }}
                  className="text-xs font-semibold text-[#1A1A1A] bg-[#f0efed] hover:bg-[#EDECE8] px-3 py-1.5 rounded-lg"
                >
                  {copied ? "Copied!" : "Copy link"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCreated(null);
                    setEmails("");
                  }}
                  className="text-xs font-medium text-[#6B6B6B] hover:underline"
                >
                  Create another
                </button>
              </div>
              <p className="text-xs text-[#6B6B6B]">
                The password isn&apos;t stored in a form anyone can read back, so send it to them separately from the link — a
                different channel is best.
              </p>
            </div>
          ) : (
            <>
              <label className="block text-xs font-semibold text-[#1A1A1A]">
                Who can open it (emails, separated by commas or new lines)
                <textarea
                  value={emails}
                  onChange={(e) => setEmails(e.target.value)}
                  rows={2}
                  placeholder="name@client.com, other@client.com"
                  className={`${inputClass} mt-1 font-normal`}
                />
              </label>
              <div className="grid sm:grid-cols-2 gap-3">
                <label className="block text-xs font-semibold text-[#1A1A1A]">
                  Password you choose (8+ characters)
                  <input
                    type="text"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="off"
                    className={`${inputClass} mt-1 font-normal`}
                  />
                </label>
                <label className="block text-xs font-semibold text-[#1A1A1A]">
                  Link expires after
                  <select value={days} onChange={(e) => setDays(Number(e.target.value))} className={`${inputClass} mt-1 font-normal`}>
                    <option value={7}>7 days</option>
                    <option value={30}>30 days</option>
                    <option value={90}>90 days</option>
                  </select>
                </label>
              </div>
              {error && <p className="text-xs text-[#B91C1C]">{error}</p>}
              <button
                type="button"
                disabled={busy || !emails.trim() || password.length < 8}
                onClick={create}
                className="text-sm font-semibold text-white bg-[#1A1A1A] hover:bg-black px-3.5 py-2 rounded-lg transition-colors disabled:opacity-50"
              >
                {busy ? "Creating…" : "Create link"}
              </button>
            </>
          )}

          {shares.length > 0 && (
            <div className="pt-3 border-t border-[#E5E5E5]">
              <h3 className="text-[10px] font-semibold uppercase tracking-wider text-[#6B6B6B] mb-1.5">Links for this scan</h3>
              <ul className="divide-y divide-[#E5E5E5] text-xs">
                {shares.map((s) => {
                  const expired = new Date(s.expiresAt).getTime() <= Date.now();
                  const status = s.revokedAt ? "Revoked" : expired ? "Expired" : "Active";
                  return (
                    <li key={s.id} className="py-2 flex items-center justify-between gap-3">
                      <span className="min-w-0">
                        <span className="text-[#1A1A1A] break-words">{s.emails.join(", ")}</span>
                        <span className="block text-[#9A9A9A]">
                          {status} · expires {new Date(s.expiresAt).toLocaleDateString()}
                        </span>
                      </span>
                      {status === "Active" && (
                        <button type="button" onClick={() => revoke(s.id)} className="shrink-0 font-semibold text-[#B91C1C] hover:underline">
                          Revoke
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
