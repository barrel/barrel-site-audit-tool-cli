import Link from "next/link";
import type { ClientRecommendation, RecommendationEffort } from "@/lib/shared";

/** The prioritized action list, in the row format the checklist sections use.
 *
 * Overview's job is to answer "what do we do about this, and in what order" before any of the
 * measurement that produced the answer. The full argument for each action — why it matters
 * commercially, what to expect, which findings support it — is a page of its own; this is the list
 * you read first and the one that goes in a ticket.
 *
 * Priority is the order the model returned, which RecommendationsSection defines as highest
 * conversion impact first. It is stated as a rank rather than a score because it is a ranking: the
 * gap between first and second is not a quantity anything here measured. */

const EFFORT_STYLES: Record<RecommendationEffort, string> = {
  "quick win": "bg-[#ECFDF5] text-[#065F46] border-[#A7F3D0]",
  moderate: "bg-[#EFF6FF] text-[#1E40AF] border-[#BFDBFE]",
  "larger project": "bg-[#FFFBEB] text-[#92400E] border-[#FDE68A]",
};

export function RecommendationList({
  recommendations,
  href,
}: {
  recommendations: ClientRecommendation[];
  href: string;
}) {
  if (recommendations.length === 0) return null;

  return (
    <div>
      <div className="bg-white border border-[#E5E5E5] rounded-lg overflow-hidden divide-y divide-[#E5E5E5]">
        {recommendations.map((rec, i) => (
          <div key={`${rec.title}-${i}`} className="flex items-start gap-3.5 px-5 py-3.5">
            <span className="text-xs font-semibold text-[#9A9A9A] tabular-nums shrink-0 mt-0.5 w-6">
              {String(i + 1).padStart(2, "0")}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-[#1A1A1A]">{rec.title}</div>
              <div className="text-sm text-[#6B6B6B] break-words mt-0.5">{rec.what}</div>
              <div className="text-xs text-[#9A9A9A] mt-1.5">{rec.area}</div>
            </div>
            <span
              className={`shrink-0 mt-0.5 inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${EFFORT_STYLES[rec.effort]}`}
            >
              {rec.effort}
            </span>
          </div>
        ))}
      </div>
      <Link href={href} className="inline-block mt-3 text-sm font-medium text-[#2563EB] hover:underline">
        The case for each of these →
      </Link>
    </div>
  );
}
