"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

interface CheckDef {
  key: string;
  label: string;
  detail: string;
  indent?: boolean;
}

// One entry per CLI `--skip-*` flag (cli/src/index.ts) — shown inverted as "include this check,"
// checked by default, since that reads more naturally than a wall of pre-checked "skip" boxes.
const CHECKS: CheckDef[] = [
  { key: "skipCode", label: "Theme code & structure", detail: "Theme Check lint + orphaned files/page-builder detection. No-ops if the store has no theme code yet." },
  { key: "skipThemeArchitecture", label: "AI theme architecture", detail: "Claude-written platform-fit assessment. Needs theme code + ANTHROPIC_API_KEY.", indent: true },
  { key: "skipPerformance", label: "Performance (Lighthouse)", detail: "Multi-page, multi-device Lighthouse pass — the slowest analyzer, expect several minutes." },
  { key: "skipAxe", label: "Accessibility (axe-core)", detail: "A second, independent accessibility signal beyond Lighthouse." },
  { key: "skipHealth", label: "Site health", detail: "HTTPS, meta tags, canonical, structured data, robots.txt, sitemap." },
  { key: "skipPixels", label: "Pixels & consent", detail: "Live browser check for Meta/GA4/TikTok/etc. pixels and a cookie-consent mechanism." },
  { key: "skipGeoSeo", label: "SEO & GEO", detail: "SEO opportunities plus AI/agentic-commerce (GEO) readiness." },
  { key: "skipAgentReadiness", label: "Agent readiness", detail: "Per-SKU schema, hydration, policy data, product-feed drift." },
  { key: "skipUx", label: "UX & conversion", detail: "One collection page + one product page, AI-reviewed for conversion issues." },
  { key: "skipAnalytics", label: "Traffic & revenue (GA4)", detail: "Only produces anything if the store has a ga4PropertyId configured." },
  { key: "skipScreenshots", label: "Screenshots", detail: "Homepage + competitor screenshots." },
  { key: "skipAiSuggestions", label: "AI suggestions", detail: "Claude-written performance/accessibility fixes." },
  { key: "skipSummary", label: "AI executive summary", detail: "Claude-written overview and key findings." },
];

const DEFAULT_INCLUDED: Record<string, boolean> = Object.fromEntries(CHECKS.map((c) => [c.key, true]));

const AGENT_PORT_KEY = "barrel-audit-agent-port";
const AGENT_TOKEN_KEY = "barrel-audit-agent-token";
const DEFAULT_PORT = "5757";

function extractReportLink(log: string): { slug: string; id: string } | null {
  const match = log.match(/reports\/([^/\s]+)\/([^/\s]+)\.json/);
  return match ? { slug: match[1], id: match[2] } : null;
}

/** Detects and talks to the local `barrel-audit serve` agent — a small HTTP server bound to
 * 127.0.0.1 on the user's own machine. The browser reaches it directly (never through Vercel)
 * regardless of which origin this page was loaded from, which is what lets "Run audit" work from
 * the deployed dashboard, not just a locally-running copy of this app. */
function useLocalAgent() {
  const [port, setPort] = useState(DEFAULT_PORT);
  const [token, setToken] = useState("");
  const [detected, setDetected] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    setPort(localStorage.getItem(AGENT_PORT_KEY) ?? DEFAULT_PORT);
    setToken(localStorage.getItem(AGENT_TOKEN_KEY) ?? "");
  }, []);

  const check = useCallback(async (p: string) => {
    setChecking(true);
    try {
      const res = await fetch(`http://127.0.0.1:${p}/health`, { signal: AbortSignal.timeout(1500) });
      setDetected(res.ok);
    } catch {
      setDetected(false);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    check(port);
  }, [port, check]);

  function savePort(p: string) {
    setPort(p);
    localStorage.setItem(AGENT_PORT_KEY, p);
  }

  function saveToken(t: string) {
    setToken(t);
    localStorage.setItem(AGENT_TOKEN_KEY, t);
  }

  function clearToken() {
    saveToken("");
  }

  return { port, token, detected, checking, savePort, saveToken, clearToken, check, recheck: () => check(port) };
}

export function RunAuditForm() {
  const agent = useLocalAgent();
  const [showAgentSettings, setShowAgentSettings] = useState(false);
  const [portInput, setPortInput] = useState("");
  const [tokenInput, setTokenInput] = useState("");

  const [target, setTarget] = useState("");
  const [included, setIncluded] = useState<Record<string, boolean>>(DEFAULT_INCLUDED);
  const [sitespeed, setSitespeed] = useState(false);
  const [competitors, setCompetitors] = useState<string[]>([]);
  const [status, setStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [log, setLog] = useState("");
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [usedBackend, setUsedBackend] = useState<"agent" | "server" | null>(null);
  const logRef = useRef<HTMLPreElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  function toggle(key: string) {
    setIncluded((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      // AI theme architecture is a no-op without theme code & structure — keep the UI honest
      // about that instead of letting it show checked while silently not running.
      if (key === "skipCode" && !next.skipCode) next.skipThemeArchitecture = false;
      return next;
    });
  }

  function updateCompetitor(i: number, value: string) {
    setCompetitors((prev) => prev.map((c, idx) => (idx === i ? value : c)));
  }

  async function streamResponse(res: Response): Promise<number | null> {
    if (!res.body) return null;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const doneMatch = buffer.match(/__BARREL_AUDIT_DONE__(-?\d+)__/);
      setLog(doneMatch ? buffer.replace(doneMatch[0], "").trimEnd() : buffer);
      logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
    }
    const finalMatch = buffer.match(/__BARREL_AUDIT_DONE__(-?\d+)__/);
    return finalMatch ? Number(finalMatch[1]) : null;
  }

  async function runAudit() {
    setStatus("running");
    setLog("");
    setExitCode(null);
    setUsedBackend(null);
    const controller = new AbortController();
    abortRef.current = controller;

    const body: Record<string, unknown> = { target, sitespeed, competitorUrls: competitors.filter((c) => c.trim()) };
    for (const c of CHECKS) body[c.key] = !included[c.key];

    const useAgent = agent.detected && agent.token;

    try {
      const res = useAgent
        ? await fetch(`http://127.0.0.1:${agent.port}/run`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${agent.token}` },
            body: JSON.stringify(body),
            signal: controller.signal,
          })
        : await fetch("/api/run", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: controller.signal,
          });

      setUsedBackend(useAgent ? "agent" : "server");

      if (res.status === 401 && useAgent) {
        agent.clearToken();
        setLog("The saved token was rejected by the local agent. Paste the token it printed again and retry.");
        setStatus("error");
        return;
      }

      if (!res.ok || !res.body) {
        setLog(await res.text());
        setStatus("error");
        return;
      }

      const code = await streamResponse(res);
      setExitCode(code);
      setStatus(code === 0 ? "done" : "error");
    } catch (err: any) {
      if (err?.name !== "AbortError") {
        setLog((prev) => `${prev}\n${err?.message ?? String(err)}`);
        setStatus("error");
      }
    }
  }

  function cancel() {
    abortRef.current?.abort();
    setStatus("idle");
  }

  const reportLink = status === "done" ? extractReportLink(log) : null;
  const running = status === "running";
  const canRunViaAgent = agent.detected && agent.token;

  return (
    <div className="space-y-5">
      <div className="bg-white border border-[#E5E5E5] rounded-lg p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: agent.checking ? "#D97706" : canRunViaAgent ? "#10B981" : agent.detected ? "#D97706" : "#9A9A9A" }}
            />
            <span className="text-sm font-medium text-[#1A1A1A]">
              {agent.checking
                ? "Checking for local CLI agent…"
                : canRunViaAgent
                  ? `Local agent connected (port ${agent.port})`
                  : agent.detected
                    ? "Local agent detected — paste its token below to connect"
                    : "Local agent not detected"}
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              setShowAgentSettings((v) => !v);
              setPortInput(agent.port);
              setTokenInput(agent.token);
            }}
            className="text-xs font-medium text-[#6B6B6B] hover:text-[#1A1A1A]"
          >
            {showAgentSettings ? "Hide" : agent.detected ? "Settings" : "Set up"}
          </button>
        </div>

        {!agent.detected && !agent.checking && (
          <p className="text-xs text-[#9A9A9A] mt-2">
            Without this, "Run audit" below only works if this dashboard itself is running locally via{" "}
            <code className="bg-[#fafafa] px-1 rounded">pnpm dev</code>. To run it from anywhere — including the
            deployed site — start the agent on your machine:{" "}
            <code className="bg-[#fafafa] px-1 rounded">pnpm barrel-audit serve</code>, then paste the token it
            prints.
          </p>
        )}

        {showAgentSettings && (
          <div className="mt-3 pt-3 border-t border-[#E5E5E5] space-y-2.5">
            <div>
              <label className="block text-xs font-medium text-[#6B6B6B] mb-1">Port</label>
              <input
                type="text"
                value={portInput}
                onChange={(e) => setPortInput(e.target.value)}
                className="w-32 rounded-lg border border-[#E5E5E5] px-2.5 py-1.5 text-sm text-[#1A1A1A] focus:outline-none focus:ring-2 focus:ring-[#1A1A1A]/10 focus:border-[#1A1A1A]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#6B6B6B] mb-1">
                Token (printed by <code>pnpm barrel-audit serve</code>)
              </label>
              <input
                type="text"
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                placeholder="paste token here"
                className="w-full rounded-lg border border-[#E5E5E5] px-2.5 py-1.5 text-sm text-[#1A1A1A] font-mono placeholder:text-[#9A9A9A] placeholder:font-sans focus:outline-none focus:ring-2 focus:ring-[#1A1A1A]/10 focus:border-[#1A1A1A]"
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  const p = portInput.trim() || DEFAULT_PORT;
                  agent.savePort(p);
                  agent.saveToken(tokenInput.trim());
                  // Explicit — setPort() above is a no-op when the port didn't actually change
                  // (the common case, since most users only ever touch the token field), so the
                  // effect that re-checks on port change never fires on its own in that case.
                  agent.check(p);
                  setShowAgentSettings(false);
                }}
                className="text-sm font-medium text-white bg-[#1A1A1A] hover:bg-black px-3 py-1.5 rounded-lg transition-colors"
              >
                Save & check
              </button>
              <button
                type="button"
                onClick={() => agent.recheck()}
                className="text-sm font-medium text-[#6B6B6B] hover:text-[#1A1A1A] px-2 py-1.5"
              >
                Check again
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="bg-white border border-[#E5E5E5] rounded-lg p-5">
        <label className="block text-sm font-semibold text-[#1A1A1A] mb-1.5">Store slug or URL</label>
        <input
          type="text"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          disabled={running}
          placeholder="https://client-store.com or an existing store slug"
          className="w-full rounded-lg border border-[#E5E5E5] px-3 py-2 text-sm text-[#1A1A1A] placeholder:text-[#9A9A9A] focus:outline-none focus:ring-2 focus:ring-[#1A1A1A]/10 focus:border-[#1A1A1A] disabled:opacity-60"
        />
        <p className="text-xs text-[#9A9A9A] mt-1.5">
          A live URL auto-creates the store from its hostname. An existing store slug re-runs against its
          configured URL.
        </p>
      </div>

      <div className="bg-white border border-[#E5E5E5] rounded-lg p-5">
        <h3 className="text-sm font-semibold text-[#1A1A1A] mb-3">What to run</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
          {CHECKS.map((c) => {
            const disabled = running || (c.indent && !included.skipCode);
            return (
            <label
              key={c.key}
              className={`flex items-start gap-2.5 rounded-md px-2.5 py-2 hover:bg-[#fafafa] cursor-pointer ${c.indent ? "sm:col-start-1 ml-5" : ""} ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              <input
                type="checkbox"
                checked={included[c.key]}
                onChange={() => toggle(c.key)}
                disabled={disabled}
                className="mt-0.5 accent-[#1A1A1A]"
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-[#1A1A1A]">{c.label}</span>
                <span className="block text-xs text-[#9A9A9A]">{c.detail}</span>
              </span>
            </label>
            );
          })}
          <label className="flex items-start gap-2.5 rounded-md px-2.5 py-2 hover:bg-[#fafafa] cursor-pointer">
            <input
              type="checkbox"
              checked={sitespeed}
              onChange={() => setSitespeed((v) => !v)}
              disabled={running}
              className="mt-0.5 accent-[#1A1A1A]"
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-[#1A1A1A]">Sitespeed.io (opt-in)</span>
              <span className="block text-xs text-[#9A9A9A]">
                A second, independent performance signal — off by default, roughly doubles run time.
              </span>
            </span>
          </label>
        </div>
      </div>

      <div className="bg-white border border-[#E5E5E5] rounded-lg p-5">
        <h3 className="text-sm font-semibold text-[#1A1A1A] mb-1.5">Competitor benchmarking</h3>
        <p className="text-xs text-[#9A9A9A] mb-3">Optional — up to 5 competitor storefront URLs to benchmark alongside this store.</p>
        <div className="space-y-2">
          {competitors.map((c, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="text"
                value={c}
                onChange={(e) => updateCompetitor(i, e.target.value)}
                disabled={running}
                placeholder="https://competitor-site.com"
                className="flex-1 rounded-lg border border-[#E5E5E5] px-3 py-2 text-sm text-[#1A1A1A] placeholder:text-[#9A9A9A] focus:outline-none focus:ring-2 focus:ring-[#1A1A1A]/10 focus:border-[#1A1A1A] disabled:opacity-60"
              />
              <button
                type="button"
                onClick={() => setCompetitors((prev) => prev.filter((_, idx) => idx !== i))}
                disabled={running}
                className="text-sm text-[#9A9A9A] hover:text-[#B91C1C] px-2 disabled:opacity-60"
              >
                Remove
              </button>
            </div>
          ))}
          {competitors.length < 5 && (
            <button
              type="button"
              onClick={() => setCompetitors((prev) => [...prev, ""])}
              disabled={running}
              className="text-sm font-medium text-[#1A1A1A] bg-[#f0efed] hover:bg-[#EDECE8] px-3 py-1.5 rounded-lg transition-colors disabled:opacity-60"
            >
              + Add competitor
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={runAudit}
          disabled={running || !target.trim()}
          className="text-sm font-semibold text-white bg-[#1A1A1A] hover:bg-black px-4 py-2.5 rounded-lg transition-colors disabled:opacity-50"
        >
          {running ? "Running…" : "Run audit"}
        </button>
        {running && (
          <button
            type="button"
            onClick={cancel}
            className="text-sm font-medium text-[#6B6B6B] hover:text-[#1A1A1A] px-3 py-2.5"
          >
            Cancel
          </button>
        )}
        <p className="text-xs text-[#9A9A9A]">
          {canRunViaAgent
            ? "Will run via your local agent — works from this dashboard anywhere, including the deployed site."
            : "Will run via this server process — only works if this dashboard is itself running locally (pnpm dev)."}
        </p>
      </div>

      {(log || status !== "idle") && (
        <div className="bg-[#1A1A1A] rounded-lg overflow-hidden">
          <div className="px-4 py-2 border-b border-white/10 flex items-center justify-between">
            <span className="text-[10px] font-semibold text-white/50 uppercase tracking-wider">
              CLI output {usedBackend === "agent" ? "(local agent)" : usedBackend === "server" ? "(this server)" : ""}
            </span>
            {status === "done" && exitCode === 0 && (
              <span className="text-[10px] font-semibold text-[#34D399] uppercase tracking-wider">Complete</span>
            )}
            {status === "error" && (
              <span className="text-[10px] font-semibold text-[#F87171] uppercase tracking-wider">
                Failed{exitCode !== null ? ` (exit ${exitCode})` : ""}
              </span>
            )}
          </div>
          <pre ref={logRef} className="text-xs text-white/90 p-4 overflow-auto max-h-[420px] whitespace-pre-wrap">
            {log || "Starting…"}
          </pre>
        </div>
      )}

      {reportLink && (
        <div className="bg-white border border-[#E5E5E5] rounded-lg px-5 py-4 flex items-center justify-between">
          <p className="text-sm text-[#1A1A1A]">Report generated and already live.</p>
          <Link
            href={`/reports/${reportLink.slug}/${reportLink.id}`}
            className="text-sm font-semibold text-white bg-[#1A1A1A] hover:bg-black px-4 py-2 rounded-lg transition-colors"
          >
            View report →
          </Link>
        </div>
      )}
    </div>
  );
}
