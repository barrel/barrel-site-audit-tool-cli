import Link from "next/link";
import { PageTitle, TopNav } from "@/components/TopNav";
import { notFound } from "next/navigation";
import { getManifest, groupReportsByStore } from "@/lib/data";
import { formatDate } from "@/lib/format";
import { SiteFavicon } from "@/components/SiteFavicon";
import { ScoreSparkline } from "@/components/ScoreSparkline";
import { DeltaBadge } from "@/components/DeltaBadge";
import { GradePill } from "@/components/ScoreBadge";
import { BaselineButton } from "@/components/BaselineButton";

export const dynamic = "force-dynamic";

export default async function StoreProgressPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const manifest = await getManifest();
  const group = groupReportsByStore(manifest).find((g) => g.storeSlug === slug);
  if (!group) notFound();

  const newestFirst = [...group.reports].reverse();

  return (
    <div className="min-h-screen bg-[#f9f8f6]">
      <TopNav />
      <PageTitle title={group.storeName}>
        <Link
          href={`/client-report/${slug}`}
          className="text-sm font-semibold text-white bg-[#1A1A1A] hover:bg-black px-3.5 py-2 rounded-lg transition-colors"
        >
          Client report
        </Link>
      </PageTitle>

      <main className="max-w-[1600px] mx-auto px-5 lg:px-8 py-8">
        <div className="flex items-center gap-3 mb-1">
          <SiteFavicon storeUrl={group.storeUrl} size={32} />
          <h1 className="text-2xl font-semibold text-[#1A1A1A] tracking-tight">{group.storeName}</h1>
        </div>
        <div className="text-sm text-[#6B6B6B] break-all mb-5">{group.storeUrl}</div>

        <div className="bg-white border border-[#E5E5E5] rounded-lg px-5 py-4 mb-5 flex items-center gap-5">
          <ScoreSparkline scores={group.reports.map((r) => r.overallScore)} width={160} height={40} />
          <p className="text-sm text-[#6B6B6B] max-w-[560px]">
            {group.reports.some((r) => r.isBaseline) ? (
              <>Baseline is explicitly set below. Delta on every row is measured against it.</>
            ) : (
              <>
                No explicit baseline set — the earliest report ({formatDate(group.reports[0].createdAt)}) is standing in.
                Click "Set baseline" on any row to pin the comparison point.
              </>
            )}
          </p>
        </div>

        <div className="bg-white border border-[#E5E5E5] rounded-lg overflow-hidden divide-y divide-[#E5E5E5]">
          {newestFirst.map((r) => {
            const delta = r.overallScore - group.baseline.overallScore;
            const isBaselineRow = r.id === group.baseline.id;
            return (
              <div key={r.id} className="flex items-center gap-4 px-5 py-3">
                <div className="text-[11px] text-[#9A9A9A] shrink-0 tabular-nums w-40">{formatDate(r.createdAt)}</div>
                <div className="text-sm font-semibold text-[#1A1A1A] tabular-nums shrink-0 w-10">{r.overallScore}</div>
                <GradePill score={r.overallScore} />
                <div className="min-w-0 flex-1">
                  {isBaselineRow ? (
                    <span className="text-[11px] font-semibold text-[#9A9A9A] uppercase tracking-wider">
                      Baseline
                    </span>
                  ) : (
                    <DeltaBadge delta={delta} />
                  )}
                </div>
                <BaselineButton slug={slug} id={r.id} isBaseline={Boolean(r.isBaseline)} />
                <Link
                  href={`/reports/${slug}/${r.id}`}
                  className="text-sm font-medium text-[#2563EB] hover:underline shrink-0"
                >
                  View report →
                </Link>
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}
