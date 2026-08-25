import { CroSlideTable } from "@/components/CroSlideCard";
import type { CroSlide } from "@/lib/shared";

/** One deck page.
 *
 * 16:9 on screen via aspect-ratio so what you scroll matches what prints; in print, each one is a
 * landscape page of its own. The bullets are deliberately larger and sparser than in the report
 * view — this is the artefact that gets projected, and the report view is the one for reading.
 *
 * Nothing here is interactive: no evidence toggles, no edit affordances, no screenshots. A slide
 * with a thumbnail strip along the bottom looks like a dashboard, and the deck's whole job is to
 * carry one idea per page.
 */
export function CroDeckSlide({
  title,
  subtitle,
  eyebrow,
  slide,
  cover,
}: {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  slide?: CroSlide;
  cover?: boolean;
}) {
  return (
    <section className="cro-deck-slide bg-white border border-[#E5E5E5] rounded-lg print:rounded-none print:border-0">
      <div className={`h-full flex flex-col px-10 py-8 ${cover ? "justify-center" : ""}`}>
        {eyebrow && (
          <div className="text-[11px] font-semibold text-[#6B6B6B] uppercase tracking-wider mb-2">{eyebrow}</div>
        )}
        <h2
          className={`font-semibold text-[#000000] tracking-tight ${cover ? "text-4xl" : "text-2xl"}`}
        >
          {title}
        </h2>
        {subtitle && <p className="mt-2 text-sm text-[#6B6B6B]">{subtitle}</p>}
        {slide?.intro && <p className="mt-3 text-[15px] text-[#6B6B6B] leading-relaxed max-w-[80ch]">{slide.intro}</p>}

        {slide && slide.bullets.length > 0 && (
          <ul className="mt-6 space-y-4 flex-1">
            {slide.bullets.map((bullet) => (
              <li key={bullet.id} className="max-w-[90ch]">
                {bullet.tag && (
                  <div className="text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-wider mb-1">
                    {bullet.tag}
                  </div>
                )}
                <p className="text-[15px] leading-relaxed">
                  <b className="font-semibold text-[#1A1A1A]">{bullet.title}:</b>{" "}
                  <span className="text-[#6B6B6B]">{bullet.description}</span>
                </p>
              </li>
            ))}
          </ul>
        )}

        {slide?.table && (
          <div className="mt-5 flex-1 min-h-0 overflow-auto">
            <CroSlideTable table={slide.table} />
          </div>
        )}

        {slide?.footnote && (
          <p className="mt-4 text-[15px] font-semibold text-[#1A1A1A]">{slide.footnote}</p>
        )}
      </div>
    </section>
  );
}
