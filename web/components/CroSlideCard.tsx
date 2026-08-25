"use client";

import { useState } from "react";
import { screenshotUrl } from "@/lib/screenshot";
import { CRO_PAGE_GROUP_LABELS, type CroBullet, type CroEvidenceItem, type CroSlide, type CroStepKey } from "@/lib/shared";

const IMPACT_COLOR: Record<string, string> = {
  high: "#B91C1C",
  medium: "#D97706",
  low: "#6B6B6B",
};

/** One bullet, in the house format: a short title, a colon, one sentence.
 *
 * Rendered as one line of running text rather than a title element plus a paragraph, because that
 * is what a slide shows and this page is a preview of a slide. The evidence behind it opens
 * underneath on request — the audit's whole claim is that every bullet rests on something, and a
 * claim nobody can check is a claim nobody should believe. */
function Bullet({
  bullet,
  evidence,
  edited,
  editable,
  onEdit,
}: {
  bullet: CroBullet;
  evidence: CroEvidenceItem[];
  edited: boolean;
  editable: boolean;
  onEdit?: () => void;
}) {
  const [showEvidence, setShowEvidence] = useState(false);
  const cited = evidence.filter((e) => bullet.evidenceIds.includes(e.id));

  return (
    <li className="group border-t border-[#f0efed] first:border-t-0 py-3">
      <div className="flex items-start gap-3">
        {bullet.impact && (
          <span
            className="mt-[7px] w-1.5 h-1.5 rounded-full shrink-0"
            style={{ backgroundColor: IMPACT_COLOR[bullet.impact] ?? IMPACT_COLOR.low }}
            title={`${bullet.impact} impact`}
            aria-label={`${bullet.impact} impact`}
          />
        )}
        <div className="min-w-0 flex-1">
          {bullet.tag && (
            <div className="text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-wider mb-1">{bullet.tag}</div>
          )}
          <p className="text-sm text-[#1A1A1A] leading-relaxed">
            <b className="font-semibold">{bullet.title}:</b>{" "}
            <span className="text-[#6B6B6B]">{bullet.description}</span>
          </p>
          <div className="mt-1.5 flex items-center gap-3 print:hidden">
            {cited.length > 0 && (
              <button
                type="button"
                onClick={() => setShowEvidence((v) => !v)}
                className="text-[11px] font-medium text-[#2563EB] hover:underline"
              >
                {showEvidence ? "Hide" : `Why (${cited.length})`}
              </button>
            )}
            {editable && onEdit && (
              <button
                type="button"
                onClick={onEdit}
                className="text-[11px] font-medium text-[#9A9A9A] hover:text-[#1A1A1A] opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
              >
                Edit
              </button>
            )}
            {edited && <span className="text-[10px] text-[#9A9A9A]">edited</span>}
          </div>
          {showEvidence && (
            <ul className="mt-2 bg-[#fafafa] border border-[#E5E5E5] rounded-md divide-y divide-[#E5E5E5]">
              {cited.map((item) => (
                <li key={item.id} className="px-3 py-2">
                  <p className="text-[12.5px] text-[#1A1A1A] leading-relaxed">{item.label}</p>
                  <p className="text-[10px] text-[#9A9A9A] mt-0.5">{item.source}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </li>
  );
}

function Table({ table }: { table: NonNullable<CroSlide["table"]> }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-[#fafafa]">
            {table.columns.map((column, i) => (
              <th
                key={column}
                className={`px-3 py-2 text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-wider border-b border-[#E5E5E5] ${
                  i === 0 ? "text-left" : "text-center"
                }`}
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row) => (
            <tr key={row.label} className="hover:bg-[#fafafa]">
              <td className="px-3 py-2 text-[13px] text-[#1A1A1A] border-b border-[#f0efed]">{row.label}</td>
              {row.cells.map((cell, i) => (
                <td
                  key={i}
                  className="px-3 py-2 text-[13px] text-center border-b border-[#f0efed] tabular-nums"
                >
                  {typeof cell === "boolean" ? (
                    <span className={cell ? "text-[#10B981]" : "text-[#D4D4D4]"} aria-label={cell ? "yes" : "no"}>
                      {cell ? "✓" : "—"}
                    </span>
                  ) : (
                    <span className="text-[#6B6B6B]">{cell}</span>
                  )}
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

/** The screenshots a slide was drafted from, side by side.
 *
 * Shown because a strategist presenting this slide is going to be asked "where?", and a thumbnail
 * of the page the bullet is about answers it faster than a URL does. Lazy — a page-group slide can
 * carry four full-page captures and the report opens with several slides on screen. */
function Screenshots({ paths }: { paths: string[] }) {
  return (
    <div className="flex gap-3 overflow-x-auto pb-1">
      {paths.map((path) => (
        <a
          key={path}
          href={screenshotUrl(path)}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 block w-[104px] border border-[#E5E5E5] rounded-md overflow-hidden hover:border-[#9A9A9A] transition-colors"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={screenshotUrl(path)} alt="" loading="lazy" className="w-full h-auto block" />
        </a>
      ))}
    </div>
  );
}

export function CroSlideCard({
  slide,
  step,
  evidence,
  editedIds,
  editable,
  onEdit,
}: {
  slide: CroSlide;
  step: CroStepKey;
  evidence: CroEvidenceItem[];
  editedIds: Set<string>;
  editable: boolean;
  onEdit?: (bullet: CroBullet) => void;
}) {
  const heading = slide.group ? CRO_PAGE_GROUP_LABELS[slide.group] : slide.label;

  return (
    <article className="bg-white border border-[#E5E5E5] rounded-lg break-inside-avoid">
      <header className="px-5 py-4 border-b border-[#E5E5E5]">
        <h3 className="text-lg font-semibold text-[#000000] tracking-tight">{heading}</h3>
        {slide.intro && <p className="mt-1 text-sm text-[#6B6B6B] leading-relaxed max-w-[70ch]">{slide.intro}</p>}
      </header>

      <div className="px-5 py-3">
        {slide.bullets.length > 0 ? (
          <ul>
            {slide.bullets.map((bullet) => (
              <Bullet
                key={bullet.id}
                bullet={bullet}
                evidence={evidence}
                edited={editedIds.has(bullet.id)}
                editable={editable}
                onEdit={onEdit ? () => onEdit(bullet) : undefined}
              />
            ))}
          </ul>
        ) : slide.table ? null : (
          // Said rather than left blank: an empty slide with no explanation reads as "nothing to
          // improve here", which is never what it means.
          <p className="py-3 text-sm text-[#9A9A9A]">
            Nothing was written for this slide. The step&rsquo;s notes below say why.
          </p>
        )}
      </div>

      {slide.table && (
        <div className="border-t border-[#E5E5E5]">
          <Table table={slide.table} />
        </div>
      )}

      {slide.footnote && (
        <div className="px-5 py-3 border-t border-[#E5E5E5] bg-[#fafafa] rounded-b-lg">
          <p className="text-[13px] font-semibold text-[#1A1A1A]">{slide.footnote}</p>
        </div>
      )}

      {slide.screenshots && slide.screenshots.length > 0 && (
        <div className="px-5 py-3 border-t border-[#E5E5E5] print:hidden">
          <div className="text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-wider mb-2">
            What was captured
          </div>
          <Screenshots paths={slide.screenshots} />
        </div>
      )}
    </article>
  );
}

export { Table as CroSlideTable };
