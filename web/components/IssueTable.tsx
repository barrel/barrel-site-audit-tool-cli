"use client";

import { useState } from "react";
import type { CodeIssue, Severity } from "@/lib/shared";

const SEVERITY_COLOR: Record<Severity, string> = {
  error: "#B91C1C",
  warning: "#D97706",
  info: "#6B6B6B",
};

const PAGE_SIZE = 25;

export function IssueTable({ issues }: { issues: CodeIssue[] }) {
  const [page, setPage] = useState(1);

  if (issues.length === 0) {
    return <div className="px-5 py-6 text-sm text-[#6B6B6B]">No issues found.</div>;
  }

  const totalPages = Math.max(1, Math.ceil(issues.length / PAGE_SIZE));
  const clampedPage = Math.min(page, totalPages);
  const start = (clampedPage - 1) * PAGE_SIZE;
  const pageIssues = issues.slice(start, start + PAGE_SIZE);

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm" style={{ tableLayout: "fixed" }}>
          <colgroup>
            <col style={{ width: "80px" }} />
            <col style={{ width: "160px" }} />
            <col />
            <col style={{ width: "260px" }} />
          </colgroup>
          <thead>
            <tr className="bg-[#fafafa] text-left">
              <th className="px-5 py-2 text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-wider">Severity</th>
              <th className="px-5 py-2 text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-wider">Check</th>
              <th className="px-5 py-2 text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-wider">Message</th>
              <th className="px-5 py-2 text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-wider">File</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E5E5E5]">
            {pageIssues.map((issue, i) => (
              <tr key={start + i} className="hover:bg-[#fafafa]">
                <td className="px-5 py-3 align-top">
                  <span
                    className="text-[10px] font-semibold uppercase tracking-wider"
                    style={{ color: SEVERITY_COLOR[issue.severity] }}
                  >
                    {issue.severity}
                  </span>
                </td>
                <td className="px-5 py-3 align-top text-[12.5px] text-[#1A1A1A] font-medium break-words">{issue.check}</td>
                <td className="px-5 py-3 align-top text-[12.5px] text-[#6B6B6B] leading-relaxed break-words">{issue.message}</td>
                <td className="px-5 py-3 align-top text-[11.5px] text-[#9A9A9A] font-mono leading-relaxed break-all">
                  {issue.file}
                  {issue.line ? `:${issue.line}` : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between px-5 py-3 border-t border-[#E5E5E5] text-sm">
          <span className="text-[#6B6B6B]">
            Showing {start + 1}–{Math.min(start + PAGE_SIZE, issues.length)} of {issues.length} issues
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={clampedPage <= 1}
              className="px-3 py-1.5 rounded-lg border border-[#E5E5E5] bg-white text-[#1A1A1A] hover:bg-[#fafafa] disabled:text-[#D4D4D4] disabled:hover:bg-white disabled:cursor-not-allowed"
            >
              Prev
            </button>
            <span className="text-[#9A9A9A] text-xs px-1">
              Page {clampedPage} of {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={clampedPage >= totalPages}
              className="px-3 py-1.5 rounded-lg border border-[#E5E5E5] bg-white text-[#1A1A1A] hover:bg-[#fafafa] disabled:text-[#D4D4D4] disabled:hover:bg-white disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
