"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useLocalAgent, DEFAULT_AGENT_PORT } from "@/lib/use-local-agent";
import { CRO_PAGE_GROUP_LABELS, type CroBrief, type CroPageGroup } from "@/lib/shared";

/** The capture half of a CRO audit: everything that needs a real browser.
 *
 * The other half — the analytics step from GA4 and the key-insights synthesis — runs in the
 * dashboard from a button on the finished report, with no CLI involved. That split is not a
 * limitation of this form; it is the design. Anything that has to watch a page render needs Chrome
 * on somebody's machine, and anything that reads an API does not.
 *
 * Modelled directly on RunAuditForm: same local-agent detection, same streamed log, same
 * done-marker convention, same Stop-is-an-abort behaviour. Two components rather than one because
 * the two commands share no options and merging them produced a form where half the controls were
 * always irrelevant.
 */

const DONE_MARKER = /__BARREL_CRO_DONE__(-?\d+)__/;
const ERROR_MARKER = /__BARREL_AUDIT_ERROR__\n?([\s\S]*?)\n?__BARREL_AUDIT_ERROR_END__/;

/** Checkout is off by default, and stays a separate opt-in rather than a page group in the list:
 * reaching it means adding a real item to a real cart on the client's live store, which leaves an
 * abandoned checkout in their admin. Search is off by default because it is the one page group
 * that is not part of the standard deck. */
const GROUPS: Array<{ key: CroPageGroup; on: boolean; detail: string }> = [
  { key: "nav", on: true, detail: "The header and its menu, opened. Not a page, but reviewed on every CRO audit." },
  { key: "home", on: true, detail: "The first screen a new visitor sees, and how far the page runs past it." },
  { key: "plp", on: true, detail: "The largest published collection, not /collections/all." },
  { key: "pdp", on: true, detail: "The most-viewed product in GA4, when a property is linked — otherwise the first purchasable one." },
  { key: "cart", on: true, detail: "With a real item added, so the page shows a cart rather than the empty state." },
  { key: "search", on: false, detail: "Results for a term taken from a real product title." },
];

function displayableLog(raw: string): string {
  return raw.replace(ERROR_MARKER, "$1").replace(DONE_MARKER, "").trimEnd();
}

function extractFailureReason(raw: string): string | null {
  return raw.match(ERROR_MARKER)?.[1]?.trim() || null;
}

/** The CLI prints the stored path on success; this is what turns a finished run into a link. */
function extractCroLink(log: string): { slug: string; id: string } | null {
  const match = log.match(/cro\/([^/\s]+)\/([^/\s]+)\.json/);
  return match ? { slug: match[1], id: match[2] } : null;
}

function extractCurrentStage(log: string): string | null {
  const matches = log.match(/^→ (.+)$/gm);
  return matches ? matches[matches.length - 1].slice(2) : null;
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

type Status = "idle" | "running" | "done" | "error" | "stopped";

export function CroRunForm({
  stores,
  deployed,
}: {
  stores: Array<{ slug: string; name: string; url: string; brief?: CroBrief; ga4: boolean }>;
  deployed: boolean;
}) {
  const agent = useLocalAgent();
  const [target, setTarget] = useState("");
  const [groups, setGroups] = useState<Record<string, boolean>>(
    () => Object.fromEntries(GROUPS.map((g) => [g.key, g.on])) as Record<string, boolean>,
  );
  const [devices, setDevices] = useState({ mobile: true, desktop: true });
  const [checkout, setCheckout] = useState(false);
  const [competitorsOn, setCompetitorsOn] = useState(true);
  const [captureOnly, setCaptureOnly] = useState(false);
  const [tokenInput, setTokenInput] = useState("");

  const [status, setStatus] = useState<Status>("idle");
  const [log, setLog] = useState("");
  const [failureReason, setFailureReason] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [usedBackend, setUsedBackend] = useState<"agent" | "server" | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const logRef = useRef<HTMLPreElement>(null);

  const matched = stores.find((s) => s.slug === target.trim() || s.url.includes(target.trim()));
  const competitorCount = matched?.brief?.competitorUrls?.length ?? 0;

  useEffect(() => {
    if (status !== "running") return;
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [status]);

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

  async function run() {
    setStatus("running");
    setLog("");
    setFailureReason(null);
    setElapsed(0);
    setUsedBackend(null);

    const controller = new AbortController();
    abortRef.current = controller;

    const selectedGroups = GROUPS.filter((g) => groups[g.key]).map((g) => g.key);
    const body = {
      target: target.trim(),
      groups: checkout ? [...selectedGroups, "checkout"] : selectedGroups,
      devices: Object.entries(devices)
        .filter(([, on]) => on)
        .map(([key]) => key),
      checkout,
      captureOnly,
      skipCompetitors: !competitorsOn,
    };

    const useAgent = Boolean(agent.detected && agent.token);

    try {
      const res = useAgent
        ? await fetch(`http://127.0.0.1:${agent.port}/cro`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${agent.token}` },
            body: JSON.stringify(body),
            signal: controller.signal,
          })
        : await fetch("/api/cro-run", {
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
      setStatus(code === 0 ? "done" : "error");
    } catch (err: any) {
      if (err?.name !== "AbortError") {
        setLog((prev) => `${prev}\n${err?.message ?? String(err)}`);
        setStatus("error");
      }
    }
  }

  // Aborting the request is what stops the capture: both backends treat a dropped connection as
  // "stop" and kill the whole spawned process group, the CLI's headless Chrome included.
  function stop() {
    abortRef.current?.abort();
    setStatus("stopped");
  }

  const running = status === "running";
  const canRunViaAgent = Boolean(agent.detected && agent.token);
  const link = status === "done" ? extractCroLink(log) : null;
  const stage = extractCurrentStage(log);
  const selectedCount = GROUPS.filter((g) => groups[g.key]).length + (checkout ? 1 : 0);
  const deviceCount = Object.values(devices).filter(Boolean).length;
  const pageLoads = selectedCount * deviceCount + competitorCount * (competitorsOn ? selectedCount : 0);

  const label = "text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-wider";

  return (
    <div className="space-y-5">
      {/* ── The agent ─────────────────────────────────────────────────────────────────── */}
      <div className="bg-white border border-[#E5E5E5] rounded-lg p-5">
        <div className="flex items-center gap-2.5">
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{
              backgroundColor: agent.checking
                ? "#D97706"
                : canRunViaAgent
                  ? "#10B981"
                  : agent.detected
                    ? "#D97706"
                    : "#9A9A9A",
            }}
          />
          <span className="text-sm font-medium text-[#1A1A1A]">
            {agent.checking
              ? "Checking for the local CLI agent…"
              : canRunViaAgent
                ? `Local agent connected (port ${agent.port})`
                : agent.detected
                  ? "Local agent detected — paste its token below to connect"
                  : "Local agent not detected"}
          </span>
        </div>
        <p className="mt-2 text-[12.5px] text-[#6B6B6B] leading-relaxed max-w-[80ch]">
          A capture drives a real browser, so it runs on your machine rather than on this site. Start
          it with <code className="text-[12px]">barrel-audit serve</code> and paste the token it
          prints — the browser talks to it directly, so this works from the deployed dashboard too.
          {deployed && !canRunViaAgent && (
            <>
              {" "}
              Without it, nothing can be captured from here:{" "}
              <code className="text-[12px]">pnpm barrel-audit cro &lt;url&gt;</code> in a checkout does the same job.
            </>
          )}
        </p>
        {!canRunViaAgent && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder="Token printed by `barrel-audit serve`"
              className="flex-1 min-w-[240px] border border-[#E5E5E5] rounded-md px-3 py-2 text-[13px] focus:outline-none focus:border-[#9A9A9A]"
            />
            <input
              value={agent.port}
              onChange={(e) => agent.savePort(e.target.value)}
              className="w-[90px] border border-[#E5E5E5] rounded-md px-3 py-2 text-[13px] focus:outline-none focus:border-[#9A9A9A]"
              aria-label="Agent port"
              placeholder={DEFAULT_AGENT_PORT}
            />
            <button
              type="button"
              onClick={() => {
                agent.saveToken(tokenInput.trim());
                agent.recheck();
              }}
              className="text-sm font-medium text-[#1A1A1A] bg-[#f0efed] hover:bg-[#EDECE8] px-3.5 py-2 rounded-lg transition-colors"
            >
              Connect
            </button>
          </div>
        )}
      </div>

      {/* ── The target ────────────────────────────────────────────────────────────────── */}
      <div className="bg-white border border-[#E5E5E5] rounded-lg p-5">
        <label className="block">
          <span className={label}>Store URL or slug</span>
          <input
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder="https://client-store.com"
            disabled={running}
            className="mt-1 w-full border border-[#E5E5E5] rounded-md px-3 py-2 text-sm focus:outline-none focus:border-[#9A9A9A] disabled:bg-[#fafafa]"
          />
        </label>
        {stores.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {stores.slice(0, 12).map((store) => (
              <button
                key={store.slug}
                type="button"
                disabled={running}
                onClick={() => setTarget(store.slug)}
                className="text-[12px] px-2.5 py-1 rounded-md border border-[#E5E5E5] text-[#6B6B6B] hover:bg-[#f0efed] hover:text-[#1A1A1A] transition-colors disabled:opacity-50"
              >
                {store.name}
              </button>
            ))}
          </div>
        )}
        {matched && (
          <p className="mt-3 text-[12.5px] text-[#6B6B6B] leading-relaxed">
            {matched.ga4
              ? "GA4 is linked, so the product page reviewed will be the one that actually gets the traffic, and the analytics step can be generated as soon as this finishes."
              : "No GA4 property is linked. The capture still works, but the product page will be chosen from catalogue order and the analytics step will have nothing to read."}{" "}
            <Link href={`/cro/${matched.slug}/brief`} className="text-[#2563EB] hover:underline">
              CRO brief
            </Link>
            {competitorCount > 0
              ? ` — ${competitorCount} competitor${competitorCount === 1 ? "" : "s"} recorded.`
              : " — no competitors recorded, so there will be no benchmark."}
          </p>
        )}
      </div>

      {/* ── What to capture ───────────────────────────────────────────────────────────── */}
      <div className="bg-white border border-[#E5E5E5] rounded-lg p-5">
        <h2 className="text-sm font-semibold text-[#1A1A1A]">What to capture</h2>
        <ul className="mt-3 space-y-2.5">
          {GROUPS.map((group) => (
            <li key={group.key}>
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={Boolean(groups[group.key])}
                  disabled={running}
                  onChange={(e) => setGroups((prev) => ({ ...prev, [group.key]: e.target.checked }))}
                  className="mt-0.5 accent-[#1A1A1A]"
                />
                <span className="min-w-0">
                  <span className="text-[13px] font-medium text-[#1A1A1A]">{CRO_PAGE_GROUP_LABELS[group.key]}</span>
                  <span className="block text-[11.5px] text-[#9A9A9A] leading-relaxed">{group.detail}</span>
                </span>
              </label>
            </li>
          ))}
          <li className="pt-1">
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={checkout}
                disabled={running}
                onChange={(e) => setCheckout(e.target.checked)}
                className="mt-0.5 accent-[#1A1A1A]"
              />
              <span className="min-w-0">
                <span className="text-[13px] font-medium text-[#1A1A1A]">{CRO_PAGE_GROUP_LABELS.checkout}</span>
                <span className="block text-[11.5px] text-[#D97706] leading-relaxed">
                  Reaching checkout means adding a real item to a real cart on the client&rsquo;s live store, which
                  leaves an abandoned checkout in their admin. Off unless you mean it.
                </span>
              </span>
            </label>
          </li>
        </ul>

        <div className="mt-5 pt-4 border-t border-[#f0efed] flex flex-wrap gap-x-8 gap-y-3">
          <div>
            <span className={label}>Devices</span>
            <div className="mt-1.5 flex gap-3">
              {(["mobile", "desktop"] as const).map((device) => (
                <label key={device} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={devices[device]}
                    disabled={running}
                    onChange={(e) => setDevices((prev) => ({ ...prev, [device]: e.target.checked }))}
                    className="accent-[#1A1A1A]"
                  />
                  <span className="text-[13px] text-[#1A1A1A] capitalize">{device}</span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <span className={label}>Also</span>
            <div className="mt-1.5 space-y-1.5">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={competitorsOn}
                  disabled={running}
                  onChange={(e) => setCompetitorsOn(e.target.checked)}
                  className="accent-[#1A1A1A]"
                />
                <span className="text-[13px] text-[#1A1A1A]">Competitive benchmark</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={captureOnly}
                  disabled={running}
                  onChange={(e) => setCaptureOnly(e.target.checked)}
                  className="accent-[#1A1A1A]"
                />
                <span className="text-[13px] text-[#1A1A1A]">Capture only — write no slides</span>
              </label>
            </div>
          </div>
        </div>

        <p className="mt-4 text-[11.5px] text-[#9A9A9A] leading-relaxed">
          {pageLoads} page load{pageLoads === 1 ? "" : "s"}, one at a time with a two-to-four second pause between
          them. Expect roughly {Math.max(1, Math.ceil((pageLoads * 12) / 60))}–
          {Math.max(2, Math.ceil((pageLoads * 20) / 60))} minutes, plus a model call per slide.
        </p>
      </div>

      {/* ── Run ───────────────────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={run}
          disabled={running || !target.trim() || selectedCount === 0 || deviceCount === 0}
          className="text-sm font-semibold text-white bg-[#1A1A1A] hover:bg-black px-4 py-2.5 rounded-lg disabled:opacity-40 transition-colors"
        >
          {running ? `Capturing… ${formatElapsed(elapsed)}` : "Start capture"}
        </button>
        {running && (
          <button
            type="button"
            onClick={stop}
            className="text-sm font-medium text-[#B91C1C] bg-[#f0efed] hover:bg-[#EDECE8] px-3.5 py-2 rounded-lg transition-colors"
          >
            Stop
          </button>
        )}
        {stage && running && <span className="text-[12.5px] text-[#6B6B6B]">{stage}</span>}
      </div>

      {/* ── Output ────────────────────────────────────────────────────────────────────── */}
      {(log || status !== "idle") && (
        <div className="bg-white border border-[#E5E5E5] rounded-lg overflow-hidden">
          <div className="px-5 py-3 border-b border-[#E5E5E5] flex flex-wrap items-center justify-between gap-3">
            <span className="text-[11px] font-semibold text-[#6B6B6B] uppercase tracking-wider">
              CLI output {usedBackend === "agent" ? "(local agent)" : usedBackend === "server" ? "(this server)" : ""}
            </span>
            {link && (
              <Link
                href={`/cro/${link.slug}/${link.id}`}
                className="text-sm font-semibold text-white bg-[#1A1A1A] hover:bg-black px-3.5 py-2 rounded-lg transition-colors"
              >
                Open the audit →
              </Link>
            )}
          </div>
          {failureReason && (
            <p className="px-5 py-3 text-[13px] text-[#B91C1C] leading-relaxed border-b border-[#E5E5E5]">
              {failureReason}
            </p>
          )}
          {status === "done" && !link && (
            <p className="px-5 py-3 text-[13px] text-[#D97706] leading-relaxed border-b border-[#E5E5E5]">
              The capture finished, but no stored path was found in its output — check the log below.
            </p>
          )}
          {status === "stopped" && (
            <p className="px-5 py-3 text-[13px] text-[#6B6B6B] leading-relaxed border-b border-[#E5E5E5]">
              Stopped after {formatElapsed(elapsed)}. Nothing was published.
            </p>
          )}
          <pre
            ref={logRef}
            className="max-h-[320px] overflow-auto px-5 py-3 text-[11.5px] leading-relaxed text-[#6B6B6B] whitespace-pre-wrap"
          >
            {log || "Waiting…"}
          </pre>
        </div>
      )}
    </div>
  );
}
