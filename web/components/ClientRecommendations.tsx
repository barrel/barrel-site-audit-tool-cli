"use client";

import { useState } from "react";
import type { ClientRecommendation, RecommendationEffort, RecommendationsSection } from "@/lib/shared";

const EFFORT_STYLES: Record<RecommendationEffort, string> = {
  "quick win": "bg-[#ECFDF5] text-[#065F46] border-[#A7F3D0]",
  moderate: "bg-[#EFF6FF] text-[#1E40AF] border-[#BFDBFE]",
  "larger project": "bg-[#FFFBEB] text-[#92400E] border-[#FDE68A]",
};

/** The deck-ready text for one recommendation. Kept identical to what's on screen so a slide built
 * from the clipboard and a slide built from the page can't say different things. */
function recommendationMarkdown(rec: ClientRecommendation, index: number): string {
  return [
    `### ${index + 1}. ${rec.title}`,
    `**Area:** ${rec.area}  ·  **Effort:** ${rec.effort}`,
    "",
    `**Why it matters.** ${rec.why}`,
    "",
    `**What we'd do.** ${rec.what}`,
    "",
    `**What to expect.** ${rec.expectedImpact}`,
    "",
    rec.evidence.length > 0 ? `**From the audit:** ${rec.evidence.join(" · ")}` : "",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

export function recommendationsMarkdown(section: RecommendationsSection, storeName: string): string {
  return [
    `# Recommendations — ${storeName}`,
    "",
    section.headline,
    "",
    section.strengths.length > 0 ? "## What's already working" : "",
    ...section.strengths.map((s) => `- ${s}`),
    "",
    "## What we recommend next",
    "",
    ...section.recommendations.map((rec, i) => `${recommendationMarkdown(rec, i)}\n`),
  ]
    .filter((line) => line !== "")
    .join("\n");
}

function RecommendationCard({ rec, index }: { rec: ClientRecommendation; index: number }) {
  return (
    <div className="bg-white border border-[#E5E5E5] rounded-lg overflow-hidden">
      <div className="px-5 py-4 border-b border-[#E5E5E5] flex items-start gap-4">
        <div className="shrink-0 w-7 h-7 rounded-full bg-[#1A1A1A] text-white text-[13px] font-semibold flex items-center justify-center">
          {index + 1}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold text-[#1A1A1A] leading-snug">{rec.title}</h3>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center rounded-full border border-[#E5E5E5] bg-[#F5F5F4] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[#6B6B6B]">
              {rec.area}
            </span>
            <span
              className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${EFFORT_STYLES[rec.effort]}`}
            >
              {rec.effort}
            </span>
          </div>
        </div>
      </div>

      <div className="px-5 py-4 space-y-3.5">
        <div>
          <div className="text-[10px] font-semibold text-[#9A9A9A] uppercase tracking-wider mb-1">Why it matters</div>
          <p className="text-sm text-[#1A1A1A] leading-relaxed">{rec.why}</p>
        </div>
        <div>
          <div className="text-[10px] font-semibold text-[#9A9A9A] uppercase tracking-wider mb-1">What we&apos;d do</div>
          <p className="text-sm text-[#1A1A1A] leading-relaxed">{rec.what}</p>
        </div>
        <div>
          <div className="text-[10px] font-semibold text-[#9A9A9A] uppercase tracking-wider mb-1">What to expect</div>
          <p className="text-sm text-[#1A1A1A] leading-relaxed">{rec.expectedImpact}</p>
        </div>
        {rec.evidence.length > 0 && (
          <div className="pt-1">
            <div className="text-[10px] font-semibold text-[#9A9A9A] uppercase tracking-wider mb-1.5">
              From the audit
            </div>
            <div className="flex flex-wrap gap-1.5">
              {rec.evidence.map((e, i) => (
                <span
                  key={i}
                  className="inline-flex items-center rounded-md border border-[#E5E5E5] bg-[#fafafa] px-2 py-1 text-[11.5px] text-[#6B6B6B]"
                >
                  {e}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function ClientRecommendations({
  section,
  storeName,
}: {
  section: RecommendationsSection;
  storeName: string;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(recommendationsMarkdown(section, storeName));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-5">
        <p className="text-sm text-[#6B6B6B] max-w-[620px]">
          The {section.recommendations.length} highest-impact things to do next, read across every section of this
          report and ordered by how much each should move conversion — written to be presented to a client as-is.
        </p>
        <button
          onClick={handleCopy}
          className="shrink-0 text-sm font-medium text-white bg-[#1A1A1A] hover:bg-[#333333] px-4 py-2 rounded-lg transition-colors"
        >
          {copied ? "Copied!" : "Copy for deck"}
        </button>
      </div>

      <div className="bg-white border border-[#E5E5E5] rounded-lg p-5 mb-5">
        <p className="text-[15px] text-[#1A1A1A] leading-relaxed">{section.headline}</p>
        {section.strengths.length > 0 && (
          <div className="mt-4 pt-4 border-t border-[#E5E5E5]">
            <div className="text-[10px] font-semibold text-[#065F46] uppercase tracking-wider mb-2.5">
              What&apos;s already working
            </div>
            <ul className="space-y-2">
              {section.strengths.map((s, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 bg-[#10B981]" />
                  <span className="text-sm text-[#1A1A1A] leading-relaxed">{s}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-wider mb-3">
        What We Recommend Next
      </div>
      <div className="space-y-4">
        {section.recommendations.map((rec, i) => (
          <RecommendationCard key={`${i}-${rec.title}`} rec={rec} index={i} />
        ))}
      </div>
    </div>
  );
}
