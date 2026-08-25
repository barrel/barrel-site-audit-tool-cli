"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { BarrelFactTicker } from "./BarrelFactTicker";
import { useLocalAgent, DEFAULT_AGENT_PORT } from "@/lib/use-local-agent";
import { parseAdaScope } from "@/lib/shared";

interface CheckDef {
  key: string;
  label: string;
  detail: string;
  indent?: boolean;
  /** Runs from HTTP responses alone — no headless browser, no theme checkout.
   *
   * The distinction is what decides whether a check could ever run anywhere but a laptop. Anything
   * that drives Chrome or reads theme files needs the CLI on a machine that has them; the rest is
   * fetch and parse. Marked per check rather than described in prose so the answer sits next to
   * the box you are ticking. */
  online?: boolean;
}

// One entry per CLI `--skip-*` flag (cli/src/index.ts) — shown inverted as "include this check,"
// checked by default, since that reads more naturally than a wall of pre-checked "skip" boxes.
const CHECKS: CheckDef[] = [
  { key: "skipCode", label: "Theme code & structure", detail: "Theme Check lint + orphaned files/page-builder detection. Needs theme code — the run stops immediately if this store has none, rather than quietly leaving those sections out of the report." },
  { key: "skipThemeArchitecture", label: "AI theme architecture", detail: "Claude-written platform-fit assessment. Needs theme code + ANTHROPIC_API_KEY.", indent: true },
  { key: "skipPerformance", label: "Performance (Lighthouse)", detail: "Multi-page, multi-device Lighthouse pass — the slowest analyzer, expect several minutes." },
  { key: "skipAxe", label: "Accessibility (axe-core)", detail: "A second, independent accessibility signal beyond Lighthouse." },
  { key: "skipHealth", label: "Site health", detail: "HTTPS, meta tags, canonical, structured data, robots.txt, sitemap.", online: true },
  { key: "skipPixels", label: "Pixels & consent", detail: "Live browser check for Meta/GA4/TikTok/etc. pixels and a cookie-consent mechanism." },
  { key: "skipGeoSeo", label: "SEO & GEO", detail: "SEO opportunities plus AI/agentic-commerce (GEO) readiness.", online: true },
  { key: "skipAgentReadiness", label: "Agent readiness", detail: "Per-SKU schema, hydration, policy data, product-feed drift.", online: true },
  { key: "skipUx", label: "UX & conversion", detail: "One collection page + one product page, AI-reviewed for conversion issues." },
  { key: "skipAnalytics", label: "Traffic & revenue (GA4)", detail: "Only produces anything if the store has a ga4PropertyId configured.", online: true },
  { key: "skipScreenshots", label: "Screenshots", detail: "Homepage + competitor screenshots." },
  { key: "skipAiSuggestions", label: "AI suggestions", detail: "Claude-written performance/accessibility fixes." },
  { key: "skipSummary", label: "AI executive summary", detail: "Claude-written overview and key findings." },
  { key: "skipRecommendations", label: "Client-ready recommendations", detail: "The Recommendations tab: 5-10 conversion actions synthesized from every other section, written for a client deck. Runs last, so it needs the rest of the run to have happened." },
];

// Everything on by default except GA4, which is only meaningful once a property is linked.
// Leaving it ticked meant every run for an unlinked store carried a check that could only ever
// produce nothing, which reads in the report as "no traffic" rather than "never connected".
const DEFAULT_INCLUDED: Record<string, boolean> = Object.fromEntries(
  CHECKS.map((c) => [c.key, c.key !== "skipAnalytics"]),
);

// Shown as the textarea's placeholder — a real, recurring Barrel ADA scope, so it's obvious what
// to paste and in what shape. Every client's scope differs; this is only an example.
const ADA_SCOPE_PLACEHOLDER = `Test and ensure basic accessibility features are in place, such as:
Each link and UI element can be navigated using the TAB key to move to each control on the page
Focus outlines are visible and noticeable for all links and UI elements when the item receives focus
Navigation contains a hidden link to skip Navigation content
Alt text is printed for all images that are fully populated by the Client
Initial designs that adhere to color contrast ratios between foreground and background elements`;

const MAX_ADA_SCOPE_CHARS = 20_000;

const DONE_MARKER = /__BARREL_AUDIT_DONE__(-?\d+)__/;

// The CLI fences a failed run's message in these whenever its stderr isn't a TTY — which is always
// the case here, since it's a spawned/piped process either way (see reportRunFailure in
// cli/src/index.ts). Without it the reason would only exist inside the collapsed raw log, so a run
// that stopped at second zero for a fixable reason ("no theme code to review") would read as a bare
// "exit 1". The fence is replaced by the message itself in the displayed log, not removed, so the
// raw output still reads as a normal terminal session.
const ERROR_MARKER = /__BARREL_AUDIT_ERROR__\n?([\s\S]*?)\n?__BARREL_AUDIT_ERROR_END__/;

function displayableLog(raw: string): string {
  return raw.replace(ERROR_MARKER, "$1").replace(DONE_MARKER, "").trimEnd();
}

function extractFailureReason(raw: string): string | null {
  return raw.match(ERROR_MARKER)?.[1]?.trim() || null;
}

function extractReportLink(log: string): { slug: string; id: string } | null {
  const match = log.match(/reports\/([^/\s]+)\/([^/\s]+)\.json/);
  return match ? { slug: match[1], id: match[2] } : null;
}

// The CLI prints "→ <stage>" lines only when its stdout isn't a TTY (see cli/src/commands/run.ts)
// — exactly the case here, since this is always a piped/spawned process either way (direct or via
// the local agent). Take the most recent one as "what's happening right now."
function extractCurrentStage(log: string): string | null {
  const matches = log.match(/^→ (.+)$/gm);
  return matches ? matches[matches.length - 1].slice(2) : null;
}

// A Shopify theme-preview target is a wall of query params (`?_ab=0&_fd=0&preview_theme_id=...`),
// which is unreadable as a heading and wraps to three lines. Show what identifies the store and
// say it's a preview link, rather than reprinting the token.
function displayTarget(target: string): string {
  const trimmed = target.trim();
  try {
    const url = new URL(trimmed);
    const path = url.pathname.replace(/\/$/, "");
    return `${url.host}${path}${url.search ? " (preview link)" : ""}`;
  } catch {
    return trimmed;
  }
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Links a GA4 property to a store, from the dashboard.
 *
 * Sits inside the GA4 check rather than in a settings page of its own, because the question it
 * answers — "why is this box unticked?" — is only ever asked here. */
function Ga4Link({
  store,
  linked,
  disabled,
  onChange,
}: {
  store: StoreGa4 | null;
  linked?: string;
  disabled: boolean;
  onChange: (slug: string, propertyId?: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  if (!store) {
    return (
      <span className="block text-xs text-[#9A9A9A] mt-1">
        Pick an existing store above to link a GA4 property — a one-off URL has no stored config to
        attach one to.
      </span>
    );
  }

  async function submit(propertyId: string) {
    setBusy(true);
    setError(null);
    setWarning(null);
    try {
      const res = await fetch("/api/ga4", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: store!.slug, propertyId }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? `Request failed (${res.status}).`);
        return;
      }
      onChange(store!.slug, data.linked ? data.propertyId : undefined);
      setWarning(data.warning ?? null);
      setOpen(false);
      setValue("");
    } catch (err: unknown) {
      setError((err as Error)?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="block mt-1.5" onClick={(e) => e.preventDefault()}>
      {linked ? (
        <span className="flex items-center gap-2 flex-wrap text-xs">
          <span className="text-[#10B981] font-medium">Linked</span>
          <span className="font-mono text-[#6B6B6B]">property {linked}</span>
          <button
            type="button"
            disabled={disabled || busy}
            onClick={() => submit("")}
            className="text-[#6B6B6B] hover:text-[#B91C1C] underline"
          >
            {busy ? "…" : "Unlink"}
          </button>
        </span>
      ) : open ? (
        <span className="flex items-center gap-2 flex-wrap">
          <input
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="GA4 property ID (e.g. 312345678)"
            className="text-xs font-mono border border-[#E5E5E5] rounded px-2 py-1 w-[220px] focus:outline-none focus:border-[#1A1A1A]"
          />
          <button
            type="button"
            disabled={busy || !value.trim()}
            onClick={() => submit(value)}
            className="text-xs font-semibold text-white bg-[#1A1A1A] hover:bg-black disabled:bg-[#9A9A9A] px-2.5 py-1 rounded"
          >
            {busy ? "Checking…" : "Link"}
          </button>
          <button type="button" onClick={() => setOpen(false)} className="text-xs text-[#6B6B6B] hover:text-[#1A1A1A]">
            Cancel
          </button>
        </span>
      ) : (
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen(true)}
          className="text-xs font-medium text-[#2563EB] hover:underline"
        >
          Connect GA4 →
        </button>
      )}
      {error && <span className="block mt-1 text-xs text-[#B91C1C] max-w-[60ch] leading-relaxed">{error}</span>}
      {warning && <span className="block mt-1 text-xs text-[#D97706] max-w-[60ch] leading-relaxed">{warning}</span>}
      {open && !error && (
        <span className="block mt-1 text-xs text-[#9A9A9A] max-w-[60ch] leading-relaxed">
          The numeric ID from GA4 → Admin → Property Settings, not the <code className="font-mono">G-</code>
          measurement ID. We check the service account can actually read it before saving.
        </span>
      )}
    </span>
  );
}

export interface StoreGa4 {
  slug: string;
  name: string;
  ga4PropertyId?: string;
}

export function RunAuditForm({ stores = [] }: { stores?: StoreGa4[] }) {
  const agent = useLocalAgent();
  const [showAgentSettings, setShowAgentSettings] = useState(false);
  const [portInput, setPortInput] = useState("");
  const [tokenInput, setTokenInput] = useState("");

  const [target, setTarget] = useState("");
  const [included, setIncluded] = useState<Record<string, boolean>>(DEFAULT_INCLUDED);
  // Local mirror of what the GA4 form has linked, so the checkbox reacts without a page reload.
  const [ga4, setGa4] = useState<Record<string, string | undefined>>(() =>
    Object.fromEntries(stores.map((st) => [st.slug, st.ga4PropertyId])),
  );

  // The store the target names, when it names one at all. A pasted URL has no config to link
  // against, so the GA4 control simply does not apply to it.
  const selectedStore = stores.find((st) => st.slug === target.trim().toLowerCase()) ?? null;
  const linkedProperty = selectedStore ? ga4[selectedStore.slug] : undefined;

  useEffect(() => {
    // Tick GA4 exactly when it can do something, and untick it when the target changes to a store
    // that has no property. Only this one key is touched, so a deliberate choice elsewhere in the
    // list survives switching stores.
    setIncluded((prev) => (prev.skipAnalytics === Boolean(linkedProperty) ? prev : { ...prev, skipAnalytics: Boolean(linkedProperty) }));
  }, [linkedProperty]);
  const [sitespeed, setSitespeed] = useState(false);
  const [competitors, setCompetitors] = useState<string[]>([]);
  const [adaScope, setAdaScope] = useState("");
  const [localRepo, setLocalRepo] = useState("");
  const [status, setStatus] = useState<"idle" | "running" | "done" | "error" | "stopped">("idle");
  const [log, setLog] = useState("");
  // Pulled out of the stream separately from `log` so the failure can headline the modal instead of
  // only existing somewhere inside the raw CLI output.
  const [failureReason, setFailureReason] = useState<string | null>(null);
  // Stopping an audit throws away several minutes of Lighthouse and browser work with no report to
  // show for it, and the button sits one stray click away from a run you wanted — so it asks first.
  const [confirmStop, setConfirmStop] = useState(false);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [usedBackend, setUsedBackend] = useState<"agent" | "server" | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [showRawOutput, setShowRawOutput] = useState(false);
  // The run takes minutes and the page behind it is a form you shouldn't be editing mid-run, so
  // progress takes over the screen. It stays up after the run finishes — that's when it carries
  // the outcome and the link to the report — until it's explicitly dismissed.
  const [showModal, setShowModal] = useState(false);
  const logRef = useRef<HTMLPreElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (status !== "running") return;
    const id = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(id);
  }, [status]);

  // Locks background scrolling while the modal owns the screen, moves focus into it, and hands
  // focus back to whatever opened it on close.
  useEffect(() => {
    if (!showModal) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus?.();
    };
  }, [showModal]);

  // Escape closes, but only once the run is over — mid-run it would read as "cancel", which is
  // its own explicit button. Tab cycles within the dialog so keyboard focus can't wander behind
  // the scrim while it's up.
  useEffect(() => {
    if (!showModal) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        // While the "stop this audit?" interstitial is up, Escape backs out of it rather than the
        // modal — dismissing the whole thing here would read as an answer to a question about
        // killing the run.
        if (confirmStop) {
          e.preventDefault();
          setConfirmStop(false);
        } else if (status !== "running") {
          e.preventDefault();
          setShowModal(false);
        }
        return;
      }
      if (e.key !== "Tab") return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [showModal, status, confirmStop]);

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
      setLog(displayableLog(buffer));
      logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
    }
    setFailureReason(extractFailureReason(buffer));
    const finalMatch = buffer.match(DONE_MARKER);
    return finalMatch ? Number(finalMatch[1]) : null;
  }

  async function runAudit() {
    setStatus("running");
    setShowModal(true);
    setLog("");
    setExitCode(null);
    setUsedBackend(null);
    setElapsed(0);
    setShowRawOutput(false);
    setFailureReason(null);
    setConfirmStop(false);
    const controller = new AbortController();
    abortRef.current = controller;

    const body: Record<string, unknown> = {
      target,
      sitespeed,
      competitorUrls: competitors.filter((c) => c.trim()),
      adaScope: adaScope.trim() || undefined,
      localRepo: included.skipCode ? localRepo.trim() || undefined : undefined,
    };
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

  // Aborting the request is what actually stops the audit: both backends treat a dropped
  // connection as "stop" and kill the whole spawned process group — the CLI, its headless Chrome
  // instances and anything else it started (killRunTree in web/app/api/run/route.ts and
  // cli/src/commands/serve.ts). The modal stays up afterwards, on a "stopped" screen, so it's clear
  // the run ended because you ended it and not because it finished.
  function stopAudit() {
    abortRef.current?.abort();
    setConfirmStop(false);
    setStatus("stopped");
  }

  const reportLink = status === "done" ? extractReportLink(log) : null;
  const running = status === "running";
  const canRunViaAgent = agent.detected && agent.token;
  const currentStage = extractCurrentStage(log);
  const adaScopeItems = adaScope.trim() ? parseAdaScope(adaScope) : [];

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
                  const p = portInput.trim() || DEFAULT_AGENT_PORT;
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
                <span className="block text-sm font-medium text-[#1A1A1A]">
                  {c.label}
                  {c.online && (
                    <span
                      className="ml-2 align-middle text-[9px] font-semibold uppercase tracking-wider text-[#10B981] bg-[#10B98114] px-1.5 py-0.5 rounded"
                      title="Reads HTTP responses only — no browser and no theme code, so this one does not need a machine running the CLI."
                    >
                      Online
                    </span>
                  )}
                </span>
                <span className="block text-xs text-[#9A9A9A]">{c.detail}</span>
                {c.key === "skipAnalytics" && (
                  <Ga4Link
                    store={selectedStore}
                    linked={linkedProperty}
                    disabled={running}
                    onChange={(slug, propertyId) => setGa4((prev) => ({ ...prev, [slug]: propertyId }))}
                  />
                )}
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

      {/* Only meaningful alongside code review, so it appears with it. The CLI can auto-detect a
          theme from the directory it was invoked in, but a dashboard run is spawned in the data root
          — so from here the path has to be given explicitly or there is nothing to detect. */}
      {included.skipCode && (
        <div className="bg-white border border-[#E5E5E5] rounded-lg p-5">
          <h3 className="text-sm font-semibold text-[#1A1A1A] mb-1.5">Theme code location</h3>
          <p className="text-xs text-[#9A9A9A] mb-3">
            Absolute path to a local theme checkout to review — the folder containing{" "}
            <code className="bg-[#fafafa] px-1 rounded">layout/theme.liquid</code>. Saved to the store, so
            later runs and &ldquo;Suggest fix&rdquo; reuse it without re-entering it. Leave blank to use
            whatever this store already has (a path saved earlier, or a theme pulled into its own folder)
            — if there&apos;s nothing there, the run stops right away instead of producing a report with no
            code findings in it.
          </p>
          <input
            type="text"
            value={localRepo}
            onChange={(e) => setLocalRepo(e.target.value)}
            disabled={running}
            placeholder="/Users/you/code/client-theme"
            className="w-full rounded-lg border border-[#E5E5E5] px-3 py-2 text-sm text-[#1A1A1A] font-mono placeholder:text-[#9A9A9A] placeholder:font-sans focus:outline-none focus:ring-2 focus:ring-[#1A1A1A]/10 focus:border-[#1A1A1A] disabled:opacity-60"
          />
        </div>
      )}

      <div className="bg-white border border-[#E5E5E5] rounded-lg p-5">
        <h3 className="text-sm font-semibold text-[#1A1A1A] mb-1.5">ADA scope</h3>
        <p className="text-xs text-[#9A9A9A] mb-3">
          Optional — paste the accessibility requirements scoped for this client, one per line (bullets, numbers and a
          "such as:" preamble are all fine). Each line is verified against axe-core, Google Lighthouse and a live
          keyboard/focus pass, and anything not yet complete comes back with a developer action item. Saved to the
          store, so re-running an audit doesn't mean re-pasting it.
        </p>
        <textarea
          value={adaScope}
          onChange={(e) => setAdaScope(e.target.value.slice(0, MAX_ADA_SCOPE_CHARS))}
          disabled={running}
          rows={7}
          placeholder={ADA_SCOPE_PLACEHOLDER}
          className="w-full rounded-lg border border-[#E5E5E5] px-3 py-2 text-sm text-[#1A1A1A] placeholder:text-[#9A9A9A] focus:outline-none focus:ring-2 focus:ring-[#1A1A1A]/10 focus:border-[#1A1A1A] disabled:opacity-60 font-mono leading-relaxed"
        />
        {adaScopeItems.length > 0 && (
          <div className="mt-2.5 bg-[#fafafa] border border-[#E5E5E5] rounded-lg px-3.5 py-3">
            <div className="text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-wider mb-1.5">
              {adaScopeItems.length} scope item{adaScopeItems.length === 1 ? "" : "s"} detected
            </div>
            <ol className="list-decimal pl-5 space-y-0.5 m-0">
              {adaScopeItems.map((item) => (
                <li key={item.id} className="text-xs text-[#6B6B6B] leading-relaxed">
                  {item.text}
                </li>
              ))}
            </ol>
          </div>
        )}
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
        <p className="text-xs text-[#9A9A9A]">
          {canRunViaAgent
            ? "Will run via your local agent — works from this dashboard anywhere, including the deployed site."
            : "Will run via this server process — only works if this dashboard is itself running locally (pnpm dev)."}
        </p>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
          {/* Scrim opacity, shadow and max height match SuggestFixPanel, the app's other modal,
              so the two read as the same component. */}
          <div
            className="absolute inset-0 bg-black/40"
            onClick={running ? undefined : () => setShowModal(false)}
            aria-hidden="true"
          />
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="run-modal-title"
            tabIndex={-1}
            className="relative w-full max-w-[720px] max-h-[85vh] overflow-auto bg-white border border-[#E5E5E5] rounded-lg p-6 sm:p-8 text-center shadow-xl focus:outline-none"
          >
            {/* Only offered once there's nothing left to interrupt — while the audit is running,
                the way out is Cancel, which actually stops it, rather than an X that would leave
                the run going invisibly. */}
            {!running && (
              <button
                type="button"
                onClick={() => setShowModal(false)}
                aria-label="Close"
                className="absolute top-3 right-3 w-8 h-8 flex items-center justify-center rounded-full text-[#6B6B6B] hover:text-[#1A1A1A] hover:bg-[#f0efed] transition-colors text-lg leading-none"
              >
                ×
              </button>
            )}

            {running && !confirmStop && (
              <>
                <div className="flex items-center justify-center gap-3 mb-1">
                  <span className="text-2xl" style={{ animation: "fadein 1.2s ease-in-out infinite alternate" }}>
                    🛢️
                  </span>
                  <h3 id="run-modal-title" className="text-lg font-semibold text-[#1A1A1A] break-words">
                    Auditing {displayTarget(target)}…
                  </h3>
                </div>
                <p className="text-sm text-[#6B6B6B] mb-4">{formatElapsed(elapsed)} elapsed</p>

                <div className="bg-[#fafafa] border border-[#E5E5E5] rounded-lg px-4 py-3 mb-4">
                  <p className="text-sm font-medium text-[#1A1A1A]" aria-live="polite">
                    {currentStage ?? "Starting up…"}
                  </p>
                </div>

                <div className="max-w-[560px] mx-auto min-h-[40px]">
                  <BarrelFactTicker />
                </div>

                <p className="text-xs font-semibold text-white bg-[#B91C1C] rounded-lg px-3 py-2 mt-5 inline-block">
                  Keep this browser tab open, and the terminal (or agent) running the CLI — closing
                  either one stops the run.
                </p>

                <div className="mt-5">
                  <button
                    type="button"
                    onClick={() => setConfirmStop(true)}
                    className="text-sm font-medium text-[#6B6B6B] hover:text-[#B91C1C] border border-[#E5E5E5] hover:border-[#B91C1C]/40 hover:bg-[#fafafa] px-4 py-2 rounded-lg transition-colors"
                  >
                    Stop audit
                  </button>
                </div>
              </>
            )}

            {/* Takes over the dialog rather than sitting alongside the progress it is about to
                destroy — the only two things worth clicking at this point are the two answers. */}
            {running && confirmStop && (
              <>
                <div className="flex items-center justify-center gap-3 mb-1">
                  <span className="text-2xl">🛑</span>
                  <h3 id="run-modal-title" className="text-lg font-semibold text-[#1A1A1A]">
                    Stop this audit?
                  </h3>
                </div>
                <p className="text-sm text-[#6B6B6B] mb-5 max-w-[460px] mx-auto">
                  The run is terminated on your machine straight away — Lighthouse, the live browser
                  passes and any AI calls all stop where they are. Nothing is kept: no report is
                  written, and the {formatElapsed(elapsed)} it has spent so far is discarded.
                </p>
                <div className="flex items-center justify-center gap-2.5">
                  <button
                    type="button"
                    autoFocus
                    onClick={() => setConfirmStop(false)}
                    className="text-sm font-semibold text-white bg-[#1A1A1A] hover:bg-black px-4 py-2.5 rounded-lg transition-colors"
                  >
                    Keep running
                  </button>
                  <button
                    type="button"
                    onClick={stopAudit}
                    className="text-sm font-semibold text-[#B91C1C] border border-[#B91C1C]/40 hover:bg-[#B91C1C]/5 px-4 py-2.5 rounded-lg transition-colors"
                  >
                    Yes, stop audit
                  </button>
                </div>
              </>
            )}

            {status === "stopped" && (
              <>
                <div className="flex items-center justify-center gap-3 mb-1">
                  <span className="text-2xl">🛑</span>
                  <h3 id="run-modal-title" className="text-lg font-semibold text-[#1A1A1A]">
                    Audit stopped
                  </h3>
                </div>
                <p className="text-sm text-[#6B6B6B] mb-2">
                  {displayTarget(target)} · stopped by you after {formatElapsed(elapsed)}. No report was
                  written — nothing partial is saved.
                </p>
                <p className="text-xs text-[#9A9A9A]">
                  Your settings below are untouched, so you can adjust what to run and start again.
                </p>
              </>
            )}

            {status === "done" && (
              <>
                <div className="flex items-center justify-center gap-3 mb-1">
                  <span className="text-2xl">✅</span>
                  <h3 id="run-modal-title" className="text-lg font-semibold text-[#1A1A1A]">
                    Audit complete
                  </h3>
                </div>
                <p className="text-sm text-[#6B6B6B] mb-5">
                  {displayTarget(target)} · finished in {formatElapsed(elapsed)}
                </p>
                {reportLink ? (
                  <>
                    <Link
                      href={`/reports/${reportLink.slug}/${reportLink.id}`}
                      className="inline-block text-sm font-semibold text-white bg-[#1A1A1A] hover:bg-black px-5 py-2.5 rounded-lg transition-colors"
                    >
                      View report →
                    </Link>
                    <p className="text-xs text-[#9A9A9A] mt-3">
                      It&apos;s already live on the report site — nothing to publish or deploy.
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-[#6B6B6B]">
                    The run finished, but no report link was found in its output — check the CLI output
                    below for what happened.
                  </p>
                )}
              </>
            )}

            {status === "error" && (
              <>
                <div className="flex items-center justify-center gap-3 mb-1">
                  <span className="text-2xl">⚠️</span>
                  <h3 id="run-modal-title" className="text-lg font-semibold text-[#1A1A1A]">
                    Audit failed{exitCode !== null ? ` (exit ${exitCode})` : ""}
                  </h3>
                </div>
                <p className="text-sm text-[#6B6B6B] mb-4">
                  {displayTarget(target)} · stopped after {formatElapsed(elapsed)}. The full CLI output is
                  below, and stays on the page after you close this.
                </p>
                {/* The reason, when the CLI gave one — an audit that refuses at second zero because
                    a requested check has nothing to work with (no theme code, no Blob token) is
                    fixable in a few seconds, but only if you can see what it said. */}
                {failureReason && (
                  <pre className="text-left text-xs text-[#1A1A1A] bg-[#B91C1C]/5 border border-[#B91C1C]/20 rounded-lg px-3.5 py-3 mb-2 whitespace-pre-wrap font-mono leading-relaxed overflow-auto max-h-[280px]">
                    {failureReason}
                  </pre>
                )}
              </>
            )}

            {/* Available in every state: mid-run for anyone who wants the live log, and afterwards
                as the record of what happened. */}
            <div className="mt-4">
              <button
                type="button"
                onClick={() => setShowRawOutput((v) => !v)}
                className="text-xs font-medium text-[#9A9A9A] hover:text-[#1A1A1A]"
              >
                {showRawOutput ? "Hide" : "Show"} raw CLI output
              </button>
            </div>

            {showRawOutput && (
              <pre
                ref={logRef}
                className="mt-3 text-left text-xs bg-[#1A1A1A] text-white/90 rounded-lg p-4 overflow-auto max-h-[300px] whitespace-pre-wrap"
              >
                {log || "Starting…"}
              </pre>
            )}
          </div>
        </div>
      )}

      {status !== "running" && (log || status !== "idle") && (
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
            {status === "stopped" && (
              <span className="text-[10px] font-semibold text-[#FBBF24] uppercase tracking-wider">
                Stopped
              </span>
            )}
          </div>
          <pre className="text-xs text-white/90 p-4 overflow-auto max-h-[420px] whitespace-pre-wrap">
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
