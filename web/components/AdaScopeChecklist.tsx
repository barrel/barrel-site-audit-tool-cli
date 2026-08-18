"use client";

import { useEffect, useState } from "react";
import type { AdaScopeItem, AdaScopeSection } from "@/lib/shared";
import {
  ADA_STATUS_META,
  buildAdaClientSummary,
  buildAdaDevActions,
  stripTicks,
} from "@/lib/ada-scope-report";

const MATCHED_BY_LABEL: Record<AdaScopeItem["matchedBy"], string> = {
  catalog: "Matched to a known check",
  ai: "Matched by Claude",
  none: "No automated check matched",
};

/** Actions and evidence are written with `backticks` around selectors and code, since the same
 * strings are also copied into tickets as markdown. Render them as inline code here rather than
 * showing the backticks. */
function InlineCode({ text }: { text: string }) {
  return (
    <>
      {text.split("`").map((part, i) =>
        i % 2 === 1 ? (
          <code key={i} className="bg-[#f0efed] text-[#1A1A1A] rounded px-1 py-[1px] text-[12px] break-all">
            {part}
          </code>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

export function AdaScopeChecklist({
  section,
  storeName,
  reportDate,
  storageKey,
}: {
  section: AdaScopeSection;
  storeName: string;
  reportDate: string;
  /** Per-report key for the reader's own ticks on manual items — those are a human judgment this
   * tool can't make, so they're remembered locally rather than written into the report. */
  storageKey: string;
}) {
  const [manualChecked, setManualChecked] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState<"client" | "dev" | null>(null);
  const [showRaw, setShowRaw] = useState(false);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(storageKey);
      if (saved) setManualChecked(JSON.parse(saved));
    } catch {
      // A blocked or corrupt localStorage just means no remembered ticks.
    }
  }, [storageKey]);

  function toggleManual(id: string) {
    setManualChecked((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        // Non-fatal — the tick just won't survive a refresh.
      }
      return next;
    });
  }

  async function copy(kind: "client" | "dev") {
    const text =
      kind === "client" ? buildAdaClientSummary(section, storeName, reportDate) : buildAdaDevActions(section, storeName);
    await navigator.clipboard.writeText(stripTicks(text));
    setCopied(kind);
    setTimeout(() => setCopied(null), 2000);
  }

  const groups: Array<{ group?: string; items: AdaScopeItem[] }> = [];
  for (const item of section.items) {
    const last = groups[groups.length - 1];
    if (last && last.group === item.group) last.items.push(item);
    else groups.push({ group: item.group, items: [item] });
  }

  const openCount = section.incompleteCount + section.partialCount;

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div className="flex flex-wrap gap-2">
          {[
            { label: "Verified complete", value: section.completeCount, color: ADA_STATUS_META.complete.color },
            { label: "Partial", value: section.partialCount, color: ADA_STATUS_META.partial.color },
            { label: "Incomplete", value: section.incompleteCount, color: ADA_STATUS_META.incomplete.color },
            { label: "Manual check", value: section.manualCount, color: ADA_STATUS_META.manual.color },
            { label: "Not checked", value: section.unverifiedCount, color: ADA_STATUS_META.unverified.color },
          ]
            .filter((s) => s.value > 0)
            .map((s) => (
              <span
                key={s.label}
                className="text-xs font-semibold px-2.5 py-1 rounded-full"
                style={{ backgroundColor: `${s.color}1A`, color: s.color }}
              >
                {s.value} {s.label}
              </span>
            ))}
        </div>
        <div className="flex shrink-0 gap-2.5">
          <button
            onClick={() => copy("dev")}
            className="text-sm font-medium text-[#1A1A1A] bg-white border border-[#E5E5E5] hover:bg-[#fafafa] px-4 py-2 rounded-lg transition-colors"
          >
            {copied === "dev" ? "Copied!" : "Copy dev actions"}
          </button>
          <button
            onClick={() => copy("client")}
            className="text-sm font-medium text-white bg-[#1A1A1A] hover:bg-black px-4 py-2 rounded-lg transition-colors"
          >
            {copied === "client" ? "Copied!" : "Copy client update"}
          </button>
        </div>
      </div>

      <div className="bg-white border border-[#E5E5E5] rounded-lg overflow-hidden">
        {groups.map((g, gi) => (
          <div key={gi}>
            {g.group && (
              <div className="bg-[#fafafa] border-b border-[#E5E5E5] px-5 py-2 text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-wider">
                {g.group}
              </div>
            )}
            <div className="divide-y divide-[#E5E5E5]">
              {g.items.map((item) => {
                const meta = ADA_STATUS_META[item.status];
                const readerTicked = Boolean(manualChecked[item.id]);
                const checked = meta.checkbox === "checked" || (meta.checkbox === "reader" && readerTicked);
                return (
                  <div key={item.id} className="px-5 py-4">
                    <div className="flex items-start gap-3">
                      {meta.checkbox === "reader" ? (
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleManual(item.id)}
                          aria-label={`Mark "${item.text}" as manually verified`}
                          title="No automated check can confirm this one — tick it once you've verified it by hand."
                          className="mt-[3px] w-[15px] h-[15px] shrink-0 accent-[#1A1A1A]"
                        />
                      ) : (
                        // An automated verdict isn't the reader's to change, so it's drawn rather
                        // than rendered as a disabled input — a disabled checkbox greys out the
                        // tick, losing the pass/fail colour that makes the list scannable. The
                        // status is already conveyed in text by the pill on the right.
                        <span
                          aria-hidden="true"
                          title={`Set automatically: ${meta.label}`}
                          className="mt-[3px] w-[15px] h-[15px] shrink-0 rounded-[3px] border flex items-center justify-center text-white text-[11px] font-bold leading-none"
                          style={{
                            backgroundColor: checked ? meta.color : "transparent",
                            borderColor: checked ? meta.color : "#C9C9C9",
                          }}
                        >
                          {checked ? "✓" : ""}
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <p className="text-[14px] font-medium text-[#1A1A1A] m-0">{item.text}</p>
                          <span
                            className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full shrink-0 mt-0.5 whitespace-nowrap"
                            style={{ backgroundColor: `${meta.color}1A`, color: meta.color }}
                          >
                            {meta.label}
                          </span>
                        </div>

                        {item.evidence.length > 0 && (
                          <ul className="mt-2 mb-0 space-y-1 list-none pl-0">
                            {item.evidence.map((e, ei) => (
                              <li key={ei} className="text-[12.5px] text-[#6B6B6B] leading-relaxed">
                                <span className="font-semibold text-[#1A1A1A]">
                                  {e.source}
                                  {e.page ? ` · ${e.page}` : ""}:
                                </span>{" "}
                                <InlineCode text={e.detail} />
                                {e.selectors && e.selectors.length > 0 && (
                                  <span className="block mt-0.5 text-[#9A9A9A] break-all">
                                    {e.selectors.map((sel, si) => (
                                      <code key={si} className="bg-[#fafafa] rounded px-1 py-[1px] mr-1 text-[11.5px]">
                                        {sel}
                                      </code>
                                    ))}
                                  </span>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}

                        {item.action && (
                          <div
                            className="mt-2.5 rounded-md px-3 py-2.5 text-[13px] leading-relaxed whitespace-pre-line"
                            style={{ backgroundColor: `${meta.color}0D`, borderLeft: `3px solid ${meta.color}` }}
                          >
                            <span className="font-semibold text-[#1A1A1A]">
                              {item.status === "manual"
                                ? "Manual check: "
                                : item.status === "unverified"
                                  ? "To verify: "
                                  : "Developer action: "}
                            </span>
                            <span className="text-[#4A4A4A]">
                              <InlineCode text={item.action} />
                            </span>
                          </div>
                        )}

                        <div className="mt-2 text-[11px] text-[#9A9A9A]">
                          {MATCHED_BY_LABEL[item.matchedBy]}
                          {item.requirementIds.length > 0 && <> · {item.requirementIds.join(", ")}</>}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={() => setShowRaw((v) => !v)}
          className="text-xs font-medium text-[#9A9A9A] hover:text-[#1A1A1A]"
        >
          {showRaw ? "Hide" : "Show"} the scope as it was submitted
        </button>
        {openCount > 0 && (
          <span className="text-xs text-[#9A9A9A]">
            {openCount} item{openCount === 1 ? "" : "s"} with an open developer action — these also appear in the
            prioritized roadmap and dev to-do list.
          </span>
        )}
      </div>
      {showRaw && (
        <pre className="mt-2 bg-[#fafafa] border border-[#E5E5E5] rounded-lg p-4 text-[12px] text-[#4A4A4A] whitespace-pre-wrap overflow-auto max-h-[280px]">
          {section.rawScope}
        </pre>
      )}
    </div>
  );
}
