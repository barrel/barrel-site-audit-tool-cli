"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useLocalAgent } from "@/lib/use-local-agent";
import type { RoadmapItem } from "@/lib/findings";

type Phase = "loading" | "diff" | "error";
type ActionStatus = "idle" | "pending" | "done" | "error";

interface SuggestFixResponse {
  file: string;
  baseContentSha256: string;
  before: string;
  after: string;
  diff: string;
  explanation: string;
  themeCheck: { newErrorCount: number; newWarningCount: number; offenses: { check: string; message: string; line?: number; severity: string }[] };
}

function DiffView({ diff }: { diff: string }) {
  const lines = diff.split("\n");
  return (
    <pre className="text-xs leading-relaxed overflow-x-auto bg-[#fafafa] border border-[#E5E5E5] rounded-lg p-3">
      {lines.map((line, i) => {
        const isAdd = line.startsWith("+") && !line.startsWith("+++");
        const isDel = line.startsWith("-") && !line.startsWith("---");
        return (
          <div
            key={i}
            className={isAdd ? "text-[#10B981]" : isDel ? "text-[#B91C1C]" : "text-[#6B6B6B]"}
            style={{ backgroundColor: isAdd ? "#10B98114" : isDel ? "#B91C1C14" : undefined }}
          >
            {line || " "}
          </div>
        );
      })}
    </pre>
  );
}

export function SuggestFixPanel({
  item,
  storeSlug,
  reportUrl,
  onClose,
}: {
  item: RoadmapItem;
  storeSlug: string;
  reportUrl: string;
  onClose: () => void;
}) {
  const agent = useLocalAgent();
  const [phase, setPhase] = useState<Phase>("loading");
  const [result, setResult] = useState<SuggestFixResponse | null>(null);
  const [error, setError] = useState("");

  const [prepared, setPrepared] = useState(false);
  const [prepareError, setPrepareError] = useState("");

  const [editorStatus, setEditorStatus] = useState<ActionStatus>("idle");
  const [editorError, setEditorError] = useState("");

  const [previewStatus, setPreviewStatus] = useState<ActionStatus>("idle");
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const [previewError, setPreviewError] = useState("");
  const previewPoll = useRef<ReturnType<typeof setInterval> | null>(null);

  const [pushStatus, setPushStatus] = useState<ActionStatus>("idle");
  const [pushError, setPushError] = useState("");
  const [prUrl, setPrUrl] = useState<string | null>(null);

  useEffect(() => {
    if (agent.checking) return;
    if (agent.detected && agent.token) void runSuggest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.checking, agent.detected, agent.token]);

  useEffect(() => {
    return () => {
      if (previewPoll.current) clearInterval(previewPoll.current);
      // Best-effort: if the panel closes mid-preview, tell the local agent to kill the `shopify
      // theme dev` process rather than leaving it running forever. No-op if nothing was started.
      void fetch(`http://127.0.0.1:${agent.port}/fix/stop-preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${agent.token}` },
        body: JSON.stringify({ slug: storeSlug, findingId: item.id }),
      }).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runSuggest() {
    setPhase("loading");
    setError("");
    try {
      const res = await fetch(`http://127.0.0.1:${agent.port}/suggest-fix`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${agent.token}` },
        body: JSON.stringify({
          slug: storeSlug,
          file: item.file,
          line: item.line,
          title: item.fix,
          description: item.why,
          recommendation: item.recommendation,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? "Failed to generate a suggestion.");
        setPhase("error");
        return;
      }
      setResult(data);
      setPhase("diff");
    } catch (err: any) {
      setError(err?.message ?? String(err));
      setPhase("error");
    }
  }

  async function ensurePrepared(): Promise<boolean> {
    if (prepared) return true;
    if (!result) return false;
    setPrepareError("");
    try {
      const res = await fetch(`http://127.0.0.1:${agent.port}/fix/prepare`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${agent.token}` },
        body: JSON.stringify({
          slug: storeSlug,
          file: result.file,
          newContent: result.after,
          baseContentSha256: result.baseContentSha256,
          findingId: item.id,
          title: item.fix,
          line: item.line,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const message = data?.error ?? "Failed to prepare a local branch for this fix.";
        setPrepareError(message);
        return false;
      }
      setPrepared(true);
      return true;
    } catch (err: any) {
      setPrepareError(err?.message ?? String(err));
      return false;
    }
  }

  async function openInEditor() {
    setEditorStatus("pending");
    setEditorError("");
    const ok = await ensurePrepared();
    if (!ok) {
      setEditorStatus("error");
      setEditorError(prepareError || "Failed to prepare a local branch for this fix.");
      return;
    }
    try {
      const res = await fetch(`http://127.0.0.1:${agent.port}/fix/open-editor`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${agent.token}` },
        body: JSON.stringify({ slug: storeSlug, findingId: item.id }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setEditorError(data?.error ?? "Failed to open VS Code.");
        setEditorStatus("error");
        return;
      }
      setEditorStatus("done");
    } catch (err: any) {
      setEditorError(err?.message ?? String(err));
      setEditorStatus("error");
    }
  }

  function pollPreview() {
    if (previewPoll.current) clearInterval(previewPoll.current);
    previewPoll.current = setInterval(async () => {
      try {
        const res = await fetch(
          `http://127.0.0.1:${agent.port}/fix/preview-status?slug=${encodeURIComponent(storeSlug)}&findingId=${encodeURIComponent(item.id)}`,
          { headers: { Authorization: `Bearer ${agent.token}` } },
        );
        const data = await res.json().catch(() => null);
        if (!data) return;
        if (data.status === "ready") {
          setPreviewUrls(data.previewUrls ?? []);
          setPreviewStatus("done");
          if (previewPoll.current) clearInterval(previewPoll.current);
        } else if (data.status === "error" || data.status === "stopped") {
          setPreviewError(data.log ? String(data.log).slice(-400) : "The live preview stopped unexpectedly.");
          setPreviewStatus(data.status === "stopped" ? "idle" : "error");
          if (previewPoll.current) clearInterval(previewPoll.current);
        }
      } catch {
        // transient network hiccup — keep polling
      }
    }, 1500);
  }

  async function startPreview() {
    setPreviewStatus("pending");
    setPreviewError("");
    setPreviewUrls([]);
    const ok = await ensurePrepared();
    if (!ok) {
      setPreviewStatus("error");
      setPreviewError(prepareError || "Failed to prepare a local branch for this fix.");
      return;
    }
    try {
      const res = await fetch(`http://127.0.0.1:${agent.port}/fix/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${agent.token}` },
        body: JSON.stringify({ slug: storeSlug, findingId: item.id }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setPreviewError(data?.error ?? "Failed to start a live preview.");
        setPreviewStatus("error");
        return;
      }
      pollPreview();
    } catch (err: any) {
      setPreviewError(err?.message ?? String(err));
      setPreviewStatus("error");
    }
  }

  async function stopPreviewNow() {
    if (previewPoll.current) clearInterval(previewPoll.current);
    setPreviewStatus("idle");
    setPreviewUrls([]);
    try {
      await fetch(`http://127.0.0.1:${agent.port}/fix/stop-preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${agent.token}` },
        body: JSON.stringify({ slug: storeSlug, findingId: item.id }),
      });
    } catch {
      // best-effort
    }
  }

  async function push() {
    if (!result) return;
    setPushStatus("pending");
    setPushError("");
    try {
      const res = await fetch(`http://127.0.0.1:${agent.port}/apply-fix`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${agent.token}` },
        body: JSON.stringify({
          slug: storeSlug,
          file: result.file,
          newContent: result.after,
          baseContentSha256: result.baseContentSha256,
          findingId: item.id,
          title: item.fix,
          severity: item.severity,
          category: item.category,
          description: item.why,
          recommendation: item.recommendation,
          reportUrl,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setPushError(data?.error ?? "Failed to open a pull request.");
        setPushStatus("error");
        return;
      }
      setPrUrl(data.prUrl);
      setPushStatus("done");
      if (previewPoll.current) clearInterval(previewPoll.current);
    } catch (err: any) {
      setPushError(err?.message ?? String(err));
      setPushStatus("error");
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-[720px] w-full max-h-[85vh] overflow-y-auto">
        <div className="px-5 py-4 border-b border-[#E5E5E5] flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[#1A1A1A]">Suggest fix — {item.file}</h3>
          <button onClick={onClose} className="text-[#9A9A9A] hover:text-[#1A1A1A] text-sm">
            ✕
          </button>
        </div>

        <div className="px-5 py-5">
          {!agent.checking && (!agent.detected || !agent.token) ? (
            <div className="text-sm text-[#6B6B6B]">
              <p className="mb-2">
                This needs the local CLI agent, which isn't connected yet — it needs real access to this
                store's theme checkout and GitHub repo, so there's no server-side fallback for this
                one.
              </p>
              <Link href="/run" className="text-[#2563EB] hover:underline">
                Connect it on the Run Audit page →
              </Link>
            </div>
          ) : phase === "loading" ? (
            <p className="text-sm text-[#6B6B6B]">Reading {item.file} and drafting a fix…</p>
          ) : phase === "diff" && result ? (
            <div className="space-y-4">
              <p className="text-sm text-[#1A1A1A]">{result.explanation}</p>
              {result.themeCheck.newErrorCount > 0 && (
                <div className="bg-[#D97706]/10 border border-[#D97706]/30 rounded-lg px-3 py-2 text-xs text-[#92400E]">
                  This proposal introduces {result.themeCheck.newErrorCount} new Theme Check error
                  {result.themeCheck.newErrorCount === 1 ? "" : "s"}:{" "}
                  {result.themeCheck.offenses.map((o) => o.check).join(", ")}. Review carefully before
                  approving.
                </div>
              )}
              <DiffView diff={result.diff} />

              {pushStatus === "done" && prUrl ? (
                <div className="space-y-3 bg-[#f0efed] rounded-lg px-4 py-3">
                  <p className="text-sm text-[#1A1A1A]">
                    Pull request opened — it has not been merged. Normal GitHub review still applies.
                  </p>
                  <a
                    href={prUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block text-sm font-semibold text-white bg-[#1A1A1A] hover:bg-black px-4 py-2 rounded-lg transition-colors"
                  >
                    View PR →
                  </a>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-xs font-medium text-[#6B6B6B] uppercase tracking-wide">
                    Choose how to proceed — nothing has changed yet
                  </p>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-3 border border-[#E5E5E5] rounded-lg px-3 py-2.5">
                      <div className="text-sm text-[#1A1A1A]">
                        <div className="font-medium">Open in VS Code</div>
                        <div className="text-xs text-[#6B6B6B]">
                          Edit the change yourself on a local branch before doing anything else.
                        </div>
                      </div>
                      <button
                        onClick={openInEditor}
                        disabled={editorStatus === "pending"}
                        className="text-sm font-medium text-[#1A1A1A] bg-[#f0efed] hover:bg-[#EDECE8] px-3 py-2 rounded-lg disabled:opacity-50 shrink-0"
                      >
                        {editorStatus === "pending" ? "Opening…" : editorStatus === "done" ? "Opened ✓" : "Open"}
                      </button>
                    </div>
                    {editorStatus === "error" && <p className="text-xs text-[#B91C1C]">{editorError}</p>}

                    <div className="flex items-center justify-between gap-3 border border-[#E5E5E5] rounded-lg px-3 py-2.5">
                      <div className="text-sm text-[#1A1A1A]">
                        <div className="font-medium">Test live (Shopify CLI)</div>
                        <div className="text-xs text-[#6B6B6B]">
                          Runs <code>shopify theme dev</code> locally against this branch — nothing is pushed.
                        </div>
                      </div>
                      {previewStatus === "done" ? (
                        <button
                          onClick={stopPreviewNow}
                          className="text-sm font-medium text-[#B91C1C] bg-[#B91C1C]/10 hover:bg-[#B91C1C]/20 px-3 py-2 rounded-lg shrink-0"
                        >
                          Stop
                        </button>
                      ) : (
                        <button
                          onClick={startPreview}
                          disabled={previewStatus === "pending"}
                          className="text-sm font-medium text-[#1A1A1A] bg-[#f0efed] hover:bg-[#EDECE8] px-3 py-2 rounded-lg disabled:opacity-50 shrink-0"
                        >
                          {previewStatus === "pending" ? "Starting…" : "Test live"}
                        </button>
                      )}
                    </div>
                    {previewStatus === "done" && previewUrls.length > 0 && (
                      <div className="text-xs text-[#1A1A1A] pl-1 space-y-1">
                        {previewUrls.map((u) => (
                          <div key={u}>
                            <a href={u} target="_blank" rel="noopener noreferrer" className="text-[#2563EB] hover:underline break-all">
                              {u}
                            </a>
                          </div>
                        ))}
                      </div>
                    )}
                    {previewStatus === "error" && <p className="text-xs text-[#B91C1C]">{previewError}</p>}

                    <div className="flex items-center justify-between gap-3 border border-[#E5E5E5] rounded-lg px-3 py-2.5">
                      <div className="text-sm text-[#1A1A1A]">
                        <div className="font-medium">Push branch &amp; open PR</div>
                        <div className="text-xs text-[#6B6B6B]">
                          Opens a pull request for normal GitHub review — this tool never merges it.
                        </div>
                      </div>
                      <button
                        onClick={push}
                        disabled={pushStatus === "pending"}
                        className="text-sm font-semibold text-white bg-[#1A1A1A] hover:bg-black px-4 py-2 rounded-lg transition-colors disabled:opacity-50 shrink-0"
                      >
                        {pushStatus === "pending" ? "Opening PR…" : "Push & open PR"}
                      </button>
                    </div>
                    {pushStatus === "error" && <p className="text-xs text-[#B91C1C]">{pushError}</p>}
                  </div>

                  <div>
                    <button onClick={onClose} className="text-sm font-medium text-[#6B6B6B] hover:text-[#1A1A1A] px-1 py-2">
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : phase === "error" ? (
            <div className="space-y-3">
              <p className="text-sm text-[#B91C1C]">{error}</p>
              <div className="flex items-center gap-3">
                <button
                  onClick={runSuggest}
                  className="text-sm font-medium text-[#1A1A1A] bg-[#f0efed] hover:bg-[#EDECE8] px-3 py-2 rounded-lg"
                >
                  Try again
                </button>
                <button onClick={onClose} className="text-sm font-medium text-[#6B6B6B] hover:text-[#1A1A1A]">
                  Close
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
