import { CroSlideTable } from "@/components/CroSlideCard";
import { composeSlides } from "@/lib/cro-slides";
import { formatDate } from "@/lib/format";
import { CRO_STEP_LABELS, type CroBulletEdit, type CroReport, type CroStepKey } from "@/lib/shared";

/** The client-facing view of a CRO audit.
 *
 * Deliberately not the internal report component. What a client should see is the argument: the
 * slides, in presentation order, with the strategist's edits applied. What they should not see is
 * the machinery around it — the discarded bullets, the evidence toggles, the edit affordances, the
 * capture screenshots, the note about which hand edits were orphaned by a regeneration. Those exist
 * so the team can trust the output; showing them to a client is showing the workings of a document
 * that is meant to read as finished.
 *
 * One thing does carry over, and deliberately: each step's limitations. A deck that quietly omits
 * what it could not see invites the reader to assume it saw everything. */
const PRESENTATION_ORDER: CroStepKey[] = ["insights", "analytics", "ux", "behaviour", "voc", "journey", "competitors"];

export function SharedCroReport({
  report,
  edits,
}: {
  report: CroReport;
  edits: Record<string, CroBulletEdit>;
}) {
  const steps = PRESENTATION_ORDER.flatMap((key) => {
    const step = report.steps[key];
    return step && step.status === "generated" ? [step] : [];
  });

  return (
    <div>
      <header className="mb-8">
        <h1 className="text-2xl font-semibold text-[#1A1A1A] tracking-tight">
          Conversion audit — {report.storeName}
        </h1>
        <p className="mt-1 text-sm text-[#6B6B6B]">
          {report.storeUrl} · {formatDate(report.createdAt)}
        </p>
      </header>

      {steps.length === 0 && (
        <div className="bg-white border border-[#E5E5E5] rounded-lg px-6 py-10 text-center">
          <p className="text-sm text-[#6B6B6B]">This audit has no completed sections yet.</p>
        </div>
      )}

      <div className="space-y-12">
        {steps.map((step) => {
          const composed = composeSlides(step.slides, edits);
          return (
            <section key={step.key}>
              <h2 className="text-lg font-semibold text-[#000000] tracking-tight mb-4">
                {CRO_STEP_LABELS[step.key]}
              </h2>
              <div className="space-y-5">
                {composed.slides.map((slide) => (
                  <article
                    key={slide.id}
                    className="bg-white border border-[#E5E5E5] rounded-lg break-inside-avoid print:break-inside-avoid"
                  >
                    <div className="px-5 py-4 border-b border-[#E5E5E5]">
                      <h3 className="text-base font-semibold text-[#1A1A1A]">{slide.label}</h3>
                      {slide.intro && (
                        <p className="mt-1 text-sm text-[#6B6B6B] leading-relaxed max-w-[75ch]">{slide.intro}</p>
                      )}
                    </div>
                    {slide.bullets.length > 0 && (
                      <ul className="px-5 py-2 divide-y divide-[#f0efed]">
                        {slide.bullets.map((bullet) => (
                          <li key={bullet.id} className="py-3">
                            {bullet.tag && (
                              <div className="text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-wider mb-1">
                                {bullet.tag}
                              </div>
                            )}
                            <p className="text-sm leading-relaxed">
                              <b className="font-semibold text-[#1A1A1A]">{bullet.title}:</b>{" "}
                              <span className="text-[#6B6B6B]">{bullet.description}</span>
                            </p>
                          </li>
                        ))}
                      </ul>
                    )}
                    {slide.table && (
                      <div className="border-t border-[#E5E5E5]">
                        <CroSlideTable table={slide.table} />
                      </div>
                    )}
                    {slide.footnote && (
                      <div className="px-5 py-3 border-t border-[#E5E5E5] bg-[#fafafa] rounded-b-lg">
                        <p className="text-[13px] font-semibold text-[#1A1A1A]">{slide.footnote}</p>
                      </div>
                    )}
                  </article>
                ))}
              </div>
              {step.limitations.length > 0 && (
                <ul className="mt-3 space-y-1.5">
                  {step.limitations.map((limitation, i) => (
                    <li key={i} className="text-[11.5px] text-[#9A9A9A] leading-relaxed max-w-[85ch]">
                      {limitation}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      <footer className="mt-12 pt-5 border-t border-[#E5E5E5] text-[11.5px] text-[#9A9A9A] leading-relaxed">
        <b className="text-[#6B6B6B]">Methodology.</b> Each page type was loaded in a real browser at mobile and
        desktop widths and measured after its lazy-loaded sections had rendered. Fold and scroll figures describe what
        a visitor would have to scroll past, not what any individual visitor did. Feature comparisons are detected from
        markup: a tick means the feature was found on the site, not that it is implemented well. Analytics figures are
        from the store&rsquo;s own Google Analytics 4 property over 28 complete days.
      </footer>
    </div>
  );
}
