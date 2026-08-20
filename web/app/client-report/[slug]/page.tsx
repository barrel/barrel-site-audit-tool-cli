import Link from "next/link";
import { notFound } from "next/navigation";
import { getManifest, getReport, groupReportsByStore } from "@/lib/data";
import { formatDate } from "@/lib/format";
import { PageTitle, TopNav } from "@/components/TopNav";
import { PrintButton } from "@/components/PrintButton";
import { ClientReport } from "@/components/ClientReport";
import { ClientReportShareButton } from "@/components/ClientReportShareButton";

export const dynamic = "force-dynamic";

export default async function ClientReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ baseline?: string; latest?: string }>;
}) {
  const { slug } = await params;
  const { baseline: baselineParam, latest: latestParam } = await searchParams;

  const manifest = await getManifest();
  const group = groupReportsByStore(manifest).find((g) => g.storeSlug === slug);
  if (!group) notFound();

  const newestFirst = [...group.reports].reverse();
  // Defaults chosen so the page is useful with no query at all: the marked baseline if there is
  // one, otherwise the oldest run, compared against the newest.
  const defaultBaseline = group.reports.find((r) => r.isBaseline)?.id ?? group.reports[0]?.id;
  const baselineId = baselineParam ?? defaultBaseline;
  const latestId = latestParam ?? newestFirst[0]?.id;
  if (!latestId) notFound();

  const [baseline, latest] = await Promise.all([
    baselineId && baselineId !== latestId ? getReport(slug, baselineId) : Promise.resolve(null),
    getReport(slug, latestId),
  ]);
  if (!latest) notFound();

  function optionHref(which: "baseline" | "latest", id: string): string {
    const p = new URLSearchParams();
    p.set("baseline", which === "baseline" ? id : (baselineId ?? ""));
    p.set("latest", which === "latest" ? id : latestId!);
    return `/client-report/${slug}?${p.toString()}`;
  }

  return (
    <div className="min-h-screen bg-[#f9f8f6] print:bg-white">
      <TopNav />
      <PageTitle title={`Client report — ${group.storeName}`}>
        <PrintButton />
        <ClientReportShareButton slug={slug} latestId={latestId} baselineId={baseline ? baselineId : undefined} />
      </PageTitle>

      <main className="max-w-[1000px] mx-auto px-6 lg:px-8 py-8 space-y-5 print:px-0 print:py-0 print:max-w-none">
        {/* ── Which two runs ─────────────────────────────────────────────────────────────── */}
        <section className="bg-white border border-[#E5E5E5] rounded-lg px-5 py-4 print:hidden">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-[#6B6B6B] mb-2">
            Compare which runs
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {(["baseline", "latest"] as const).map((which) => {
              const selected = which === "baseline" ? baselineId : latestId;
              return (
                <div key={which} className="min-w-0">
                  <div className="text-xs font-medium text-[#1A1A1A] mb-1.5 capitalize">
                    {which === "baseline" ? "Baseline" : "Latest run"}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {newestFirst.slice(0, 10).map((r) => (
                      <Link
                        key={r.id}
                        href={optionHref(which, r.id)}
                        className={`text-xs px-2 py-1 rounded border whitespace-nowrap ${
                          r.id === selected
                            ? "border-[#1A1A1A] text-[#1A1A1A] font-medium"
                            : "border-[#E5E5E5] text-[#6B6B6B] hover:border-[#B0B0B0]"
                        }`}
                      >
                        {formatDate(r.createdAt)}
                        {r.isBaseline && <span className="text-[#9A9A9A]"> · baseline</span>}
                      </Link>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          {!baseline && (
            <p className="mt-3 text-xs text-[#9A9A9A]">
              No baseline selected, so the report shows the latest run on its own. Pick an earlier run above, or mark one
              as the baseline from Baseline &amp; Reporting.
            </p>
          )}
        </section>

        <ClientReport baseline={baseline} latest={latest} />
      </main>
    </div>
  );
}
