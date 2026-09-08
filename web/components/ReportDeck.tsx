import { ScoreBadge } from "@/components/ScoreBadge";
import { colorForScore, gradeForScore } from "@/lib/shared";
import type { DeckScore, DeckSlide, DeckTable } from "@/lib/report-deck";

/** The scored areas, as gauges rather than a table.
 *
 * One row of the deck where the number is the content, so it gets the same circular gauge the
 * report header uses — a client who has seen the report recognises it, and an arc communicates
 * "70" faster than the digits do. */
function Scorecard({ scores }: { scores: DeckScore[] }) {
  return (
    <div className="mt-7 flex flex-wrap gap-x-9 gap-y-6 content-start flex-1">
      {scores.map((score) => (
        <div key={score.label} className="flex items-center gap-3">
          <ScoreBadge score={score.score} size="md" />
          <div>
            <div className="text-[13px] font-semibold text-[#1A1A1A] leading-tight">{score.label}</div>
            <div className="text-[11.5px] font-semibold mt-0.5" style={{ color: colorForScore(score.score) }}>
              Grade {gradeForScore(score.score)}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** A slide's grid. Deliberately the same visual language as the CRO deck's table — the two decks
 * are one deliverable family and a client sees both. */
function Table({ table }: { table: DeckTable }) {
  return (
    <div>
      <table className="w-full border-collapse">
        <thead>
          <tr>
            {table.columns.map((column, i) => (
              <th
                key={column}
                className={`px-3 py-2 text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-wider border-b border-[#E5E5E5] ${
                  i === 0 || !table.numeric ? "text-left" : "text-center"
                }`}
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row) => (
            <tr key={row.label}>
              <td className="px-3 py-2 text-[14px] text-[#1A1A1A] border-b border-[#f0efed] align-top">{row.label}</td>
              {row.cells.map((cell, i) => (
                <td
                  key={i}
                  className={`px-3 py-2 text-[14px] text-[#6B6B6B] border-b border-[#f0efed] align-top ${
                    table.numeric ? "text-center tabular-nums" : "text-left"
                  }`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {table.caption && <p className="px-3 py-2 text-[11px] text-[#9A9A9A] leading-relaxed">{table.caption}</p>}
    </div>
  );
}

/** One deck page.
 *
 * 16:9 on screen via aspect-ratio so what you scroll matches what prints; in print, each one is a
 * landscape page of its own — see the `.deck` rules in globals.css, which the CRO deck shares.
 *
 * Nothing here is interactive, and nothing links anywhere: this is the artefact that gets
 * projected, and the report itself is the one for reading. Lines are larger and sparser than in
 * any report section for the same reason — pagination happens in lib/report-deck.ts precisely so
 * they can be.
 */
export function ReportDeckSlide({ slide }: { slide: DeckSlide }) {
  if (slide.cover) {
    const score = slide.scores?.[0];
    return (
      <section className="deck-slide bg-white border border-[#E5E5E5] rounded-lg print:rounded-none print:border-0">
        <div className="h-full flex flex-col justify-center px-14 py-10">
          <div className="text-[11px] font-semibold text-[#6B6B6B] uppercase tracking-[0.12em]">{slide.eyebrow}</div>
          <h2 className="mt-3 text-5xl font-semibold text-[#000000] tracking-tight leading-[1.05]">{slide.title}</h2>
          {slide.intro && <p className="mt-4 text-[15px] text-[#6B6B6B]">{slide.intro}</p>}
          {score && (
            <div className="mt-9 flex items-center gap-4">
              <ScoreBadge score={score.score} size="lg" />
              <div>
                <div className="text-[13px] font-semibold text-[#1A1A1A]">Overall score</div>
                <div className="text-[11.5px] font-semibold mt-0.5" style={{ color: colorForScore(score.score) }}>
                  Grade {gradeForScore(score.score)} · {score.score} of 100
                </div>
              </div>
            </div>
          )}
        </div>
      </section>
    );
  }

  // A page whose whole content is one paragraph — the opening standing slide. It gets its own type
  // size: 15px prose in an 80ch column on a projected slide is a paragraph nobody at the back of
  // the room reads, and there is nothing else on the page competing for the space.
  const proseOnly = slide.bullets.length === 0 && !slide.table && !slide.scores;

  return (
    <section className="deck-slide bg-white border border-[#E5E5E5] rounded-lg print:rounded-none print:border-0">
      <div className="h-full flex flex-col px-10 py-8">
        <div className="text-[11px] font-semibold text-[#6B6B6B] uppercase tracking-wider mb-2">{slide.eyebrow}</div>
        <h2 className="text-2xl font-semibold text-[#000000] tracking-tight">{slide.title}</h2>
        {slide.intro && (
          <p
            className={
              proseOnly
                ? "mt-5 flex-1 text-[17px] text-[#1A1A1A] leading-[1.7] max-w-[80ch]"
                : "mt-3 text-[15px] text-[#6B6B6B] leading-relaxed max-w-[80ch]"
            }
          >
            {slide.intro}
          </p>
        )}

        {slide.scores && slide.scores.length > 0 && <Scorecard scores={slide.scores} />}

        {slide.bullets.length > 0 && (
          <ul className="mt-6 space-y-4 flex-1">
            {slide.bullets.map((bullet, i) => (
              <li key={`${bullet.lead ?? ""}-${i}`} className="max-w-[90ch]">
                {/* Only when it changes: three consecutive lines each labelled CONSENT is noise,
                    and the label's whole job on a mixed slide is to say where the run of lines
                    under it came from. */}
                {bullet.tag && bullet.tag !== slide.bullets[i - 1]?.tag && (
                  <div className="text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-wider mb-1">
                    {bullet.tag}
                  </div>
                )}
                {/* A bullet with no lead is a whole sentence, and a column of those reads as
                    paragraphs rather than as points — so it gets the marker the report's own
                    key-findings list uses. One with a lead needs none: the bold half is the marker. */}
                <p className="text-[15px] leading-relaxed flex items-start gap-2.5">
                  {!bullet.lead && <span className="mt-[9px] w-1.5 h-1.5 rounded-full bg-[#1A1A1A]/40 shrink-0" />}
                  <span>
                    {bullet.lead && <b className="font-semibold text-[#1A1A1A]">{bullet.lead}: </b>}
                    <span className={bullet.lead ? "text-[#6B6B6B]" : "text-[#1A1A1A]"}>{bullet.text}</span>
                  </span>
                </p>
              </li>
            ))}
          </ul>
        )}

        {slide.table && (
          <div className="mt-5 flex-1 min-h-0 overflow-hidden">
            <Table table={slide.table} />
          </div>
        )}

        {slide.footnote && <p className="mt-4 text-[12.5px] text-[#9A9A9A] leading-relaxed">{slide.footnote}</p>}
      </div>
    </section>
  );
}
