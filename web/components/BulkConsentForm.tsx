"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const DONE = /__BARREL_CONSENT_DONE__(-?\d+)__/;

/** Rough guide only, and labelled as such — a real site takes 90s–4min depending on how many
 * states can be driven and whether a blocker triggers the confirmation pass. A number presented
 * with more confidence than that just makes the wait feel broken. */
function estimate(count: number, concurrency: number): string {
  if (count === 0) return "every active site in sites.yml";
  const minutes = Math.ceil((count / Math.max(concurrency, 1)) * 2.5);
  return `${count} site${count === 1 ? "" : "s"} — roughly ${minutes} min`;
}

function countTargets(raw: string): number {
  return raw.split(/[\s,]+/).filter(Boolean).length;
}

/** The command that does exactly what the Run button would have done.
 *
 * Shown instead of the button on the deployed site. Quoting is deliberate: a pasted URL with a
 * query string will otherwise be mangled by the shell, and a command that looks right and silently
 * scans the wrong thing is worse than no command at all. */
function commandFor(raw: string, concurrency: number, inventory: boolean): string {
  const targets = raw
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => (/^[a-z0-9][a-z0-9.:/_-]*$/i.test(t) ? t : `'${t.replace(/'/g, "'\\''")}'`));
  const parts = ["pnpm", "barrel-audit", "consent-scan", ...targets];
  if (concurrency !== 4) parts.push("--concurrency", String(concurrency));
  if (inventory) parts.push("--inventory");
  return parts.join(" ");
}

export function BulkConsentForm({ local }: { local: boolean }) {
  const [targets, setTargets] = useState("");
  const [concurrency, setConcurrency] = useState(4);
  const [inventory, setInventory] = useState(false);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const logRef = useRef<HTMLPreElement | null>(null);

  useEffect(() => {
    // Follow the tail while it streams; a log that has to be scrolled by hand during a ten-minute
    // scan is a log nobody watches.
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setRunning(false);
  }, []);

  const start = useCallback(async () => {
    setLog("");
    setError(null);
    setExitCode(null);
    setRunning(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/consent-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targets, concurrency, inventory }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        setError((await res.text()) || `Request failed (${res.status}).`);
        setRunning(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const match = DONE.exec(buffer);
        if (match) {
          setExitCode(Number(match[1]));
          buffer = buffer.replace(DONE, "");
        }
        setLog(buffer);
      }
    } catch (err: any) {
      if (err?.name !== "AbortError") setError(err?.message ?? String(err));
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }, [targets, concurrency, inventory]);

  const count = countTargets(targets);

  return (
    <div className="space-y-5">
      <div className="bg-white border border-[#E5E5E5] rounded-lg overflow-hidden">
        <div className="px-5 py-3 border-b border-[#E5E5E5] bg-[#faf9f7]">
          <h2 className="text-sm font-semibold text-[#1A1A1A]">Sites to scan</h2>
          <p className="mt-0.5 text-xs text-[#6B6B6B]">
            One per line, or comma-separated. URLs or registry slugs, mixed freely. A bare domain like{" "}
            <code className="font-mono">example.com</code> is treated as <code className="font-mono">https://</code>.
            Leave it empty to scan every active site in <code className="font-mono">sites.yml</code>.
          </p>
        </div>
        <div className="p-5 space-y-4">
          <textarea
            value={targets}
            onChange={(e) => setTargets(e.target.value)}
            disabled={running}
            rows={10}
            spellCheck={false}
            placeholder={"https://www.example.com/\nanother-store.com\ndrinkwaterloo-com"}
            className="w-full font-mono text-sm border border-[#E5E5E5] rounded-lg px-3 py-2.5 focus:outline-none focus:border-[#1A1A1A] disabled:bg-[#fafafa] disabled:text-[#9A9A9A]"
          />

          <div className="flex items-end gap-5 flex-wrap">
            <label className="text-xs">
              <span className="block font-semibold uppercase tracking-wider text-[10px] text-[#6B6B6B] mb-1">
                Concurrency
              </span>
              <input
                type="number"
                min={1}
                max={12}
                value={concurrency}
                disabled={running}
                onChange={(e) => setConcurrency(Number(e.target.value))}
                className="w-20 border border-[#E5E5E5] rounded-lg px-2.5 py-1.5 text-sm tabular-nums focus:outline-none focus:border-[#1A1A1A] disabled:bg-[#fafafa]"
              />
            </label>

            <label className="flex items-center gap-2 text-sm text-[#1A1A1A] pb-1.5">
              <input
                type="checkbox"
                checked={inventory}
                disabled={running}
                onChange={(e) => setInventory(e.target.checked)}
              />
              Inventory only
              <span className="text-xs text-[#6B6B6B]">— which CMP is where, no behavioural tests. Much faster.</span>
            </label>

            <div className="ml-auto flex items-center gap-3">
              <span className="text-xs text-[#6B6B6B]">{estimate(count, concurrency)}</span>
              {!local ? null : running ? (
                <button
                  type="button"
                  onClick={stop}
                  className="text-sm font-semibold text-[#B91C1C] border border-[#B91C1C] hover:bg-[#B91C1C0A] px-3.5 py-2 rounded-lg transition-colors"
                >
                  Stop
                </button>
              ) : (
                <button
                  type="button"
                  onClick={start}
                  className="text-sm font-semibold text-white bg-[#1A1A1A] hover:bg-black px-3.5 py-2 rounded-lg transition-colors"
                >
                  Run scan
                </button>
              )}
            </div>
          </div>

          {error && (
            <div className="text-sm text-[#B91C1C] bg-[#B91C1C0A] border border-[#B91C1C33] rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          {!local && (
            <div className="border border-[#E5E5E5] rounded-lg overflow-hidden">
              <div className="px-4 py-2.5 bg-[#faf9f7] border-b border-[#E5E5E5]">
                <div className="text-sm font-semibold text-[#1A1A1A]">Run this from your checkout</div>
                <p className="mt-0.5 text-xs text-[#6B6B6B] max-w-[80ch] leading-relaxed">
                  A scan drives a real browser through five states per site, so it runs on your machine rather than
                  here. The results still land on this dashboard — the CLI publishes them the moment it finishes.
                </p>
              </div>
              <div className="p-4 space-y-2.5">
                <pre className="font-mono text-xs text-[#1A1A1A] bg-[#fafafa] border border-[#E5E5E5] rounded px-3 py-2.5 whitespace-pre-wrap break-all leading-relaxed">
                  {commandFor(targets, concurrency, inventory)}
                </pre>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard
                        ?.writeText(commandFor(targets, concurrency, inventory))
                        .then(() => {
                          setCopied(true);
                          setTimeout(() => setCopied(false), 2000);
                        })
                        .catch(() => setError("Could not copy — select the command above instead."));
                    }}
                    className="text-sm font-semibold text-white bg-[#1A1A1A] hover:bg-black px-3.5 py-2 rounded-lg transition-colors"
                  >
                    {copied ? "Copied" : "Copy command"}
                  </button>
                  <span className="text-xs text-[#6B6B6B]">
                    {count === 0
                      ? "With no sites listed it scans every active entry in sites.yml."
                      : `${count} site${count === 1 ? "" : "s"}.`}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {(log || running) && (
        <div className="bg-white border border-[#E5E5E5] rounded-lg overflow-hidden">
          <div className="px-5 py-2.5 border-b border-[#E5E5E5] bg-[#faf9f7] flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-[#1A1A1A]">Output</h2>
            {exitCode !== null && (
              <span className="text-xs text-[#6B6B6B]">
                {/* Non-zero here means a blocker was found, not that the scan broke — the CLI uses
                    the exit code to gate CI. Saying "failed" would be wrong and alarming. */}
                {exitCode === 0 ? "Finished — no blocker-severity failures." : "Finished — blocker-severity failures found."}
              </span>
            )}
          </div>
          <pre
            ref={logRef}
            className="px-5 py-4 text-xs font-mono text-[#1A1A1A] whitespace-pre-wrap break-words max-h-[460px] overflow-y-auto"
          >
            {log || "Starting…"}
          </pre>
        </div>
      )}
    </div>
  );
}
