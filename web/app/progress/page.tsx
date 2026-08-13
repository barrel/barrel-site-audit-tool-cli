import Link from "next/link";
import { getManifest, groupReportsByStore } from "@/lib/data";
import { formatDate } from "@/lib/format";
import { SiteFavicon } from "@/components/SiteFavicon";
import { ScoreSparkline } from "@/components/ScoreSparkline";
import { DeltaBadge } from "@/components/DeltaBadge";
import { GradePill } from "@/components/ScoreBadge";

export const dynamic = "force-dynamic";

export default async function ProgressPage() {
  const manifest = await getManifest();
  const groups = groupReportsByStore(manifest);

  return (
    <div className="min-h-screen bg-[#f9f8f6]">
      <header className="bg-white h-[73px] border-b border-[#E5E5E5] flex items-center px-6 lg:px-8">
        <div className="max-w-[1600px] w-full mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            <Link href="/" className="text-sm text-[#6B6B6B] hover:text-[#1A1A1A]">
              ← All reports
            </Link>
            <h1 className="text-2xl font-semibold text-[#1A1A1A] tracking-tight">Baseline & Reporting</h1>
          </div>
          <Link
            href="/instructions"
            className="text-sm font-medium text-[#1A1A1A] bg-[#f0efed] hover:bg-[#EDECE8] px-3.5 py-2 rounded-lg transition-colors"
          >
            CLI Instructions
          </Link>
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto px-5 lg:px-8 py-8">
        <p className="text-sm text-[#6B6B6B] max-w-[720px] mb-5">
          Every store with more than one audit, tracked against a baseline report — mark any run as the
          baseline from its history page below, and every later run compares against it. With no baseline
          set, the earliest report stands in for one.
        </p>

        {groups.length === 0 ? (
          <div className="bg-white border border-[#E5E5E5] rounded-lg px-6 py-10 text-center">
            <p className="text-sm text-[#6B6B6B]">No reports yet.</p>
          </div>
        ) : (
          <div className="bg-white border border-[#E5E5E5] rounded-lg overflow-hidden divide-y divide-[#E5E5E5]">
            {groups.map((g) => {
              const latest = g.reports[g.reports.length - 1];
              const delta = latest.overallScore - g.baseline.overallScore;
              const hasExplicitBaseline = g.reports.some((r) => r.isBaseline);
              return (
                <Link
                  key={g.storeSlug}
                  href={`/progress/${g.storeSlug}`}
                  className="flex items-center gap-4 px-5 py-3 hover:bg-[#fafafa] transition-colors"
                >
                  <SiteFavicon storeUrl={g.storeUrl} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-[#000000] break-words">{g.storeName}</div>
                    <div className="text-[11px] text-[#9A9A9A]">
                      {g.reports.length} report{g.reports.length === 1 ? "" : "s"} · latest {formatDate(latest.createdAt)}
                    </div>
                  </div>

                  {g.reports.length > 1 && <ScoreSparkline scores={g.reports.map((r) => r.overallScore)} />}

                  <div className="text-right shrink-0 w-24">
                    <div className="text-[10px] text-[#9A9A9A] uppercase tracking-wider">
                      {hasExplicitBaseline ? "Baseline" : "Earliest"}
                    </div>
                    <div className="text-sm font-semibold text-[#1A1A1A] tabular-nums">{g.baseline.overallScore}</div>
                  </div>

                  <div className="text-right shrink-0 w-16">
                    <div className="text-[10px] text-[#9A9A9A] uppercase tracking-wider">Latest</div>
                    <div className="text-sm font-semibold text-[#1A1A1A] tabular-nums">{latest.overallScore}</div>
                  </div>

                  <GradePill score={latest.overallScore} />
                  {g.reports.length > 1 && <DeltaBadge delta={delta} />}
                </Link>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
