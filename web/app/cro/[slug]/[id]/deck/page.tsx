import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/PrintButton";
import { CroDeckSlide } from "@/components/CroDeck";
import { getCroEdits, getCroReport } from "@/lib/data";
import { composeSlides } from "@/lib/cro-slides";
import { formatDate } from "@/lib/format";
import { CRO_STEP_LABELS, type CroSlide, type CroStepKey } from "@/lib/shared";

export const dynamic = "force-dynamic";

/** Presentation order — Key Insights opens the deck, as it does in the report view. */
const PRESENTATION_ORDER: CroStepKey[] = ["insights", "analytics", "ux", "behaviour", "voc", "journey", "competitors"];

/** The deck: one 16:9 page per slide, print-optimised.
 *
 * A browser print rather than a server-side renderer, for the reasons PrintButton already gives —
 * no headless Chrome on the deployed instance, and the PDF keeps selectable text and working links.
 *
 * Only generated slides with content appear. A deck is what gets presented, so a step that has not
 * run yet has no page here — its absence is explained on the report view, which is where the person
 * assembling the deck is looking. */
export default async function CroDeckPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const [report, edits] = await Promise.all([getCroReport(slug, id), getCroEdits(slug, id)]);
  if (!report) notFound();

  const slides: Array<{ step: CroStepKey; slide: CroSlide }> = [];
  for (const key of PRESENTATION_ORDER) {
    const step = report.steps[key];
    if (!step || step.status !== "generated") continue;
    for (const slide of composeSlides(step.slides, edits?.bullets).slides) {
      if (slide.bullets.length === 0 && !slide.table) continue;
      slides.push({ step: key, slide });
    }
  }

  return (
    <div className="min-h-screen bg-[#f9f8f6] print:bg-white">
      <header className="bg-white border-b border-[#E5E5E5] print:hidden">
        <div className="max-w-[1600px] mx-auto px-6 lg:px-8 h-[73px] flex items-center justify-between gap-4">
          <div className="min-w-0">
            <Link href={`/cro/${slug}/${id}`} className="text-sm text-[#6B6B6B] hover:text-[#1A1A1A]">
              ← Back to the audit
            </Link>
            <p className="text-[11px] text-[#9A9A9A] mt-0.5 truncate">
              {report.storeName} · {slides.length} slide{slides.length === 1 ? "" : "s"} · {formatDate(report.createdAt)}
            </p>
          </div>
          <PrintButton />
        </div>
      </header>

      <main className="max-w-[1200px] mx-auto px-5 lg:px-8 py-8 print:max-w-none print:p-0">
        {slides.length === 0 ? (
          <div className="bg-white border border-[#E5E5E5] rounded-lg px-6 py-10 text-center print:hidden">
            <p className="text-sm text-[#1A1A1A] font-medium">Nothing to present yet.</p>
            <p className="mt-1.5 text-[13px] text-[#6B6B6B]">
              No step of this audit has generated slides.{" "}
              <Link href={`/cro/${slug}/${id}`} className="text-[#2563EB] hover:underline">
                Open the audit
              </Link>{" "}
              to see what it is waiting on.
            </p>
          </div>
        ) : (
          <div className="cro-deck space-y-6 print:space-y-0">
            <CroDeckSlide
              title={`CRO Audit — ${report.storeName}`}
              subtitle={`${report.storeUrl} · ${formatDate(report.createdAt)}`}
              cover
            />
            {slides.map(({ step, slide }) => (
              <CroDeckSlide
                key={`${step}-${slide.id}`}
                title={slide.label}
                eyebrow={CRO_STEP_LABELS[step]}
                slide={slide}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
