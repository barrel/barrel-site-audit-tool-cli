"use client";

import { useCallback, useMemo, useState } from "react";
import { CroSlideCard } from "@/components/CroSlideCard";
import { CroBulletEditor } from "@/components/CroBulletEditor";
import { composeSlides } from "@/lib/cro-slides";
import { CRO_STEP_LABELS, type CroBullet, type CroBulletEdit, type CroStep as CroStepData } from "@/lib/shared";

const STATUS_STYLE: Record<CroStepData["status"], { label: string; className: string }> = {
  generated: { label: "Generated", className: "text-[#10B981]" },
  pending: { label: "Not generated yet", className: "text-[#D97706]" },
  insufficient: { label: "Not enough to conclude", className: "text-[#D97706]" },
  skipped: { label: "Not part of this audit", className: "text-[#9A9A9A]" },
};

const SOURCE_LABEL: Record<CroStepData["source"], string> = {
  capture: "Drafted from a browser capture of the live site",
  app: "Generated in this dashboard from the store's own data",
  uploaded: "Built from material supplied by hand",
  manual: "Written by a strategist",
};

/** One step of the audit: its slides, its provenance, and everything it could not establish.
 *
 * The limitations block is not an error display and is shown for a successful step too. A CRO deck
 * that quietly omits what it could not see is a deck whose reader will assume it saw everything —
 * and the first time that assumption breaks in front of a client is expensive.
 *
 * Client component because the bullets are editable in place. The edits are held here and applied
 * over the generated slides on render, never written back into them. */
export function CroStepSection({
  step,
  slug,
  croId,
  edits: initialEdits,
  editable,
}: {
  step: CroStepData;
  slug: string;
  croId: string;
  edits: Record<string, CroBulletEdit>;
  editable: boolean;
}) {
  const [edits, setEdits] = useState(initialEdits);
  const [editing, setEditing] = useState<CroBullet | null>(null);

  const composed = useMemo(() => composeSlides(step.slides, edits), [step.slides, edits]);
  const editedIds = useMemo(
    () => new Set(Object.entries(edits).filter(([, e]) => e.title || e.description).map(([id]) => id)),
    [edits],
  );

  const onSaved = useCallback((bullets: Record<string, CroBulletEdit>) => {
    setEdits(bullets);
    setEditing(null);
  }, []);

  const status = STATUS_STYLE[step.status];
  const hidden = Object.entries(edits).filter(([, e]) => e.hidden).length;

  return (
    <section id={`step-${step.key}`} className="scroll-mt-24">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 mb-4">
        <h2 className="text-lg font-semibold text-[#000000] tracking-tight">{CRO_STEP_LABELS[step.key]}</h2>
        <div className="flex items-center gap-3">
          <span className={`text-[11px] font-semibold ${status.className}`}>{status.label}</span>
          <span className="text-[10px] text-[#9A9A9A]">{SOURCE_LABEL[step.source]}</span>
        </div>
      </div>

      {composed.slides.length > 0 && (
        <div className="grid gap-5">
          {composed.slides.map((slide) => (
            <CroSlideCard
              key={slide.id}
              slide={slide}
              step={step.key}
              evidence={step.evidence}
              editedIds={editedIds}
              editable={editable}
              onEdit={setEditing}
            />
          ))}
        </div>
      )}

      {(step.limitations.length > 0 ||
        composed.orphanedEditIds.length > 0 ||
        hidden > 0 ||
        (step.rejected?.length ?? 0) > 0) && (
        <div className="mt-4 bg-white border border-[#E5E5E5] rounded-lg divide-y divide-[#E5E5E5] print:break-inside-avoid">
          {step.limitations.length > 0 && (
            <div className="px-5 py-4">
              <div className="text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-wider mb-2">
                What this step could not establish
              </div>
              <ul className="space-y-2">
                {step.limitations.map((limitation, i) => (
                  <li key={i} className="text-[13px] text-[#6B6B6B] leading-relaxed max-w-[80ch]">
                    {limitation}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {(step.rejected?.length ?? 0) > 0 && (
            <details className="px-5 py-4 print:hidden">
              <summary className="text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-wider cursor-pointer">
                {step.rejected!.length} discarded by the format and evidence checks
              </summary>
              {/* Shown rather than dropped silently: a slide that quietly lost two of its five
                  bullets looks like a thin finding instead of a caught mistake. */}
              <ul className="mt-3 space-y-3">
                {step.rejected!.map((item, i) => (
                  <li key={i} className="text-[12.5px] leading-relaxed">
                    <span className="text-[#1A1A1A]">
                      {item.title}
                      {item.description ? `: ${item.description}` : ""}
                    </span>
                    <span className="block text-[#B91C1C] mt-0.5">{item.reason}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}

          {hidden > 0 && (
            <div className="px-5 py-3 print:hidden">
              <p className="text-[12.5px] text-[#6B6B6B]">
                {hidden} bullet{hidden === 1 ? "" : "s"} hidden by hand. Hidden rather than deleted, so it can be
                brought back.
              </p>
            </div>
          )}

          {composed.orphanedEditIds.length > 0 && (
            <div className="px-5 py-3 print:hidden">
              {/* The edit is kept in storage. Silently discarding someone's typed corrections
                  because a re-draft reworded the bullet is the failure mode worth avoiding. */}
              <p className="text-[12.5px] text-[#D97706]">
                {composed.orphanedEditIds.length} hand edit{composed.orphanedEditIds.length === 1 ? "" : "s"} from an
                earlier draft no longer match any bullet in this step — this step was regenerated after they were made.
                They are still stored, and can be re-made against the new wording.
              </p>
            </div>
          )}
        </div>
      )}

      {editing && (
        <CroBulletEditor
          bullet={editing}
          slug={slug}
          croId={croId}
          edit={edits[editing.id]}
          onClose={() => setEditing(null)}
          onSaved={onSaved}
        />
      )}
    </section>
  );
}
