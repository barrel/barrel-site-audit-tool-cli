import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/PrintButton";
import { CopyKeyPointsButton } from "@/components/CopyKeyPointsButton";
import { ReportDeckSlide } from "@/components/ReportDeck";
import { getReport } from "@/lib/data";
import { buildReportDeck, deckMarkdown } from "@/lib/report-deck";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

/** The site diagnostic as a deck: one 16:9 page per point, print-optimised.
 *
 * A sibling of the report's `(tabs)` group rather than a tab inside it — the report chrome is a
 * reading surface (tab strip, scroll-spy nav, methodology footnote) and none of it belongs on a
 * projected slide.
 *
 * Composed from the finished report at render time, never stored: see lib/report-deck.ts for what
 * that buys, and for why a slide is dropped rather than padded when the run has nothing to fill
 * it with. A browser print rather than a server-side renderer, for the reasons PrintButton gives.
 */
export default async function ReportDeckPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const report = await getReport(slug, id);
  if (!report) notFound();

  const slides = buildReportDeck(report);
  const markdown = deckMarkdown(report, slides);

  return (
    <div className="min-h-screen bg-[#f9f8f6] print:bg-white">
      <header className="bg-white border-b border-[#E5E5E5] print:hidden">
        <div className="max-w-[1600px] mx-auto px-6 lg:px-8 h-[73px] flex items-center justify-between gap-4">
          <div className="min-w-0">
            <Link href={`/reports/${slug}/${id}`} className="text-sm text-[#6B6B6B] hover:text-[#1A1A1A]">
              ← Back to the report
            </Link>
            <p className="text-[11px] text-[#9A9A9A] mt-0.5 truncate">
              {report.storeName} · {slides.length} slide{slides.length === 1 ? "" : "s"} ·{" "}
              {formatDate(report.createdAt)}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <CopyKeyPointsButton markdown={markdown} />
            <PrintButton />
          </div>
        </div>
      </header>

      <main className="max-w-[1200px] mx-auto px-5 lg:px-8 py-8 print:max-w-none print:p-0">
        <p className="text-[12.5px] text-[#9A9A9A] leading-relaxed max-w-[80ch] mb-5 print:hidden">
          Every slide here is composed from this report — the executive summary, the client
          recommendations, the scores and the measurements — so nothing on them says anything the run
          did not find. Slides for sections this run skipped are simply absent.{" "}
          <b className="font-semibold text-[#6B6B6B]">Copy key points</b> puts the whole deck on the
          clipboard as markdown, one heading per slide, for pasting into Slides or Keynote.
        </p>

        <div className="deck space-y-6 print:space-y-0">
          {slides.map((slide) => (
            <ReportDeckSlide key={slide.id} slide={slide} />
          ))}
        </div>
      </main>
    </div>
  );
}
