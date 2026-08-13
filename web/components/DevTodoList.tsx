"use client";

import { useState } from "react";
import type { RoadmapItem } from "@/lib/findings";

const EFFORT_COLOR: Record<RoadmapItem["effort"], string> = {
  Trivial: "#10B981",
  Small: "#3B82F6",
  Medium: "#D97706",
  Large: "#B91C1C",
};

const SEVERITY_COLOR: Record<RoadmapItem["severity"], string> = {
  critical: "#B91C1C",
  high: "#B91C1C",
  medium: "#D97706",
  low: "#3B82F6",
  good: "#10B981",
};

export function DevTodoList({
  items,
  markdown,
  csv,
  csvFilename,
}: {
  items: RoadmapItem[];
  markdown: string;
  csv: string;
  csvFilename: string;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleDownloadCsv() {
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = csvFilename;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-5">
        <p className="text-sm text-[#6B6B6B] max-w-[600px]">
          Every actionable finding across this report, ordered by priority. Download as CSV to import straight into
          Jira (Summary, Priority, Labels, Issue Type, Description columns), or copy as a ready-made ticket per item
          for Slack/email.
        </p>
        <div className="flex shrink-0 gap-2.5">
          <button
            onClick={handleDownloadCsv}
            className="text-sm font-medium text-[#1A1A1A] bg-white border border-[#E5E5E5] hover:bg-[#fafafa] px-4 py-2 rounded-lg transition-colors"
          >
            Export CSV (Jira)
          </button>
          <button
            onClick={handleCopy}
            className="text-sm font-medium text-white bg-[#1A1A1A] hover:bg-[#333333] px-4 py-2 rounded-lg transition-colors"
          >
            {copied ? "Copied!" : "Copy to clipboard"}
          </button>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="bg-white border border-[#E5E5E5] rounded-lg px-5 py-6 text-sm text-[#6B6B6B]">
          No outstanding issues to prioritize — nice work.
        </div>
      ) : (
        <div className="bg-white border border-[#E5E5E5] rounded-lg overflow-hidden overflow-x-auto">
          <table className="w-full text-sm" style={{ tableLayout: "fixed" }}>
            <colgroup>
              <col style={{ width: "44px" }} />
              <col style={{ width: "220px" }} />
              <col style={{ width: "150px" }} />
              <col style={{ width: "140px" }} />
              <col style={{ width: "90px" }} />
              <col />
            </colgroup>
            <thead>
              <tr className="bg-[#fafafa] text-left">
                <th className="px-5 py-2 text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-wider">
                  <span className="sr-only">Priority</span>
                </th>
                <th className="px-5 py-2 text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-wider">Fix</th>
                <th className="px-5 py-2 text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-wider">Where</th>
                <th className="px-5 py-2 text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-wider">
                  Category
                </th>
                <th className="px-5 py-2 text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-wider">
                  Effort
                </th>
                <th className="px-5 py-2 text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-wider">
                  Why &amp; how to fix
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E5E5E5]">
              {items.map((item) => (
                <tr key={item.priority} className="hover:bg-[#fafafa]">
                  <td className="px-5 py-3 align-top">
                    <span
                      className="inline-flex items-center justify-center w-[22px] h-[22px] rounded-full text-white text-[11px] font-bold"
                      style={{ backgroundColor: SEVERITY_COLOR[item.severity] }}
                    >
                      {item.priority}
                    </span>
                  </td>
                  <td className="px-5 py-3 align-top text-[13px] font-medium text-[#1A1A1A] break-words">{item.fix}</td>
                  <td className="px-5 py-3 align-top text-[13px] text-[#6B6B6B] break-words">{item.scope}</td>
                  <td className="px-5 py-3 align-top text-[13px] text-[#6B6B6B] break-words">{item.category}</td>
                  <td className="px-5 py-3 align-top">
                    <span
                      className="text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap"
                      style={{ backgroundColor: `${EFFORT_COLOR[item.effort]}1A`, color: EFFORT_COLOR[item.effort] }}
                    >
                      {item.effort}
                    </span>
                  </td>
                  <td className="px-5 py-3 align-top text-[13px] text-[#6B6B6B] leading-relaxed break-words">
                    <div>{item.why}</div>
                    {item.recommendation && (
                      <div className="mt-2">
                        <span className="font-semibold text-[#1A1A1A]">How to fix: </span>
                        {item.recommendation}
                      </div>
                    )}
                    {item.codeFix && (
                      <pre className="mt-2 bg-[#1A1A1A] text-[#E5E5E5] rounded-md p-2.5 text-[11.5px] leading-relaxed overflow-x-auto whitespace-pre-wrap">
                        <code>{item.codeFix}</code>
                      </pre>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
