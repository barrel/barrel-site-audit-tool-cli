import Link from "next/link";
import { formatDate } from "@/lib/format";
import { ScoreBadge, GradePill } from "@/components/ScoreBadge";
import { SiteFavicon } from "@/components/SiteFavicon";
import type { ManifestEntry, Report } from "@/lib/shared";

export function ReportHeader({
  report,
  slug,
  history,
}: {
  report: Report;
  slug: string;
  history: ManifestEntry[];
}) {
  return (
    <div className="pt-8 pb-5">
      <div className="flex items-center gap-5">
        <ScoreBadge score={report.overallScore} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-semibold text-[#9A9A9A] uppercase tracking-wider mb-0.5">
            Site Diagnostic Report
          </div>
          <div className="flex items-start gap-2 flex-wrap">
            <SiteFavicon storeUrl={report.storeUrl} size={24} />
            <h1 className="text-2xl font-semibold text-[#1A1A1A] tracking-tight break-words">{report.storeName}</h1>
            <GradePill score={report.overallScore} />
          </div>
          <div className="text-sm text-[#6B6B6B] break-all">{report.storeUrl}</div>
          <div className="text-[10px] text-[#9A9A9A] mt-1">
            Generated {formatDate(report.createdAt)} · report {report.id}
          </div>
        </div>
      </div>

      {history.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <span className="text-[10px] font-semibold text-[#9A9A9A] uppercase tracking-wider">
            Other reports for this store
          </span>
          {history.map((r) => (
            <Link key={r.id} href={`/reports/${slug}/${r.id}`} className="text-[#2563EB] hover:underline whitespace-nowrap">
              {formatDate(r.createdAt)} ({r.overallScore})
            </Link>
          ))}
        </div>
      )}

      {!report.sections.code && (
        <div className="mt-5 flex items-start gap-2.5 bg-[#3B82F6]/[0.06] border border-[#3B82F6]/25 rounded-lg px-4 py-3 text-sm text-[#1A1A1A]">
          <span className="text-[#3B82F6] mt-px">ⓘ</span>
          <p className="m-0">
            <span className="font-semibold">No theme source code was analyzed for this report.</span> Every
            finding above comes entirely from the live storefront's client-facing code and rendered output —
            Lighthouse, site health, and pixel/consent checks — not the theme's Liquid/JSON source. Pull or copy
            the theme into <code className="bg-white px-1 py-0.5 rounded text-xs">stores/{slug}/theme/</code> and
            re-run the audit to add Theme Check findings.
          </p>
        </div>
      )}
    </div>
  );
}
