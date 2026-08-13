"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLocalAgent } from "@/lib/use-local-agent";
import type { RoadmapItem } from "@/lib/findings";

type Phase = "loading" | "diff" | "applying" | "done" | "error";

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
  const [prUrl, setPrUrl] = useState<string | null>(null);

  useEffect(() => {
    if (agent.checking) return;
    if (agent.detected && agent.token) void runSuggest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.checking, agent.detected, agent.token]);

  async function runSuggest() {
    setPhase("loading");
    setError("");
    try {
      const res = await fetch(`http://127.0.0.1:${agent.port}/suggest-fix`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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

  async function approve() {
    if (!result) return;
    setPhase("applying");
    setError("");
    try {
      const res = await fetch(`http://127.0.0.1:${agent.port}/apply-fix`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
        setError(data?.error ?? "Failed to open a pull request.");
        setPhase("error");
        return;
      }
      setPrUrl(data.prUrl);
      setPhase("done");
    } catch (err: any) {
      setError(err?.message ?? String(err));
      setPhase("error");
    }
  }

  const agentReady = !agent.checking && agent.detected && agent.token;

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
              <div className="flex items-center gap-3">
                <button
                  onClick={onClose}
                  className="text-sm font-medium text-[#6B6B6B] hover:text-[#1A1A1A] px-3 py-2"
                >
                  Cancel
                </button>
                <button
                  onClick={approve}
                  className="text-sm font-semibold text-white bg-[#1A1A1A] hover:bg-black px-4 py-2 rounded-lg transition-colors"
                >
                  Approve & open PR
                </button>
              </div>
            </div>
          ) : phase === "applying" ? (
            <p className="text-sm text-[#6B6B6B]">Opening pull request…</p>
          ) : phase === "done" && prUrl ? (
            <div className="space-y-3">
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
              <div>
                <button onClick={onClose} className="text-sm font-medium text-[#6B6B6B] hover:text-[#1A1A1A]">
                  Close
                </button>
              </div>
            </div>
          ) : phase === "error" ? (
            <div className="space-y-3">
              <p className="text-sm text-[#B91C1C]">{error}</p>
              <div className="flex items-center gap-3">
                {result ? (
                  <button
                    onClick={() => setPhase("diff")}
                    className="text-sm font-medium text-[#1A1A1A] bg-[#f0efed] hover:bg-[#EDECE8] px-3 py-2 rounded-lg"
                  >
                    Back to diff
                  </button>
                ) : (
                  <button
                    onClick={runSuggest}
                    className="text-sm font-medium text-[#1A1A1A] bg-[#f0efed] hover:bg-[#EDECE8] px-3 py-2 rounded-lg"
                  >
                    Try again
                  </button>
                )}
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
