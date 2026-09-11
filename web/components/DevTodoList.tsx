"use client";

import { useState } from "react";
import { hasRemediation, isMeasurement, type RoadmapItem } from "@/lib/findings";
import { SuggestFixPanel } from "@/components/SuggestFixPanel";
import { MarkdownText } from "@/components/MarkdownText";

/** The backlog view: every actionable finding, shaped so it can be groomed.
 *
 * What it replaced was one flat table of 136 undifferentiated rows, ordered by a severity rank
 * that put six Lighthouse *metrics* at the top — "First Contentful Paint" is an outcome nobody can
 * be assigned, and its "how to fix" was a link to developer.chrome.com. A backlog whose first
 * eight items are unassignable is one nobody scrolls past.
 *
 * So: grouped by the part of the stack the work lives in, collapsed by default so the shape is
 * visible before the detail, measurements separated from tasks, and an item with no real
 * remediation marked as needing investigation rather than dressed up as a ticket. */

const EFFORT_COLOR: Record<RoadmapItem["effort"], string> = {
  Trivial: "#10B981",
  Small: "#3B82F6",
  Medium: "#D97706",
  Large: "#B91C1C",
};

const SEVERITY_COLOR: Record<RoadmapItem["severity"], string> = {
  critical: "#B91C1C",
  high: "#B91C1C",
  medium: "#D97706",
  low: "#3B82F6",
  good: "#10B981",
};

/** Where an item points, as short as it can be without becoming ambiguous. */
function where(item: RoadmapItem): string {
  if (item.file) return `${item.file}${item.line ? `:${item.line}` : ""}`;
  return item.scope;
}

/** A bare rule identifier: `LiquidHTMLSyntaxError`, `ImgWidthAndHeight`. */
const RULE_NAME = /^[A-Z][A-Za-z0-9]+$/;

/** What the row leads with, and the rule tag beside it.
 *
 * Theme Check names its offenses by rule and puts the human sentence in the detail, so a backlog
 * built straight from it reads as a column of `LiquidHTMLSyntaxError` — thirty-five rows that look
 * identical and say nothing about what is wrong with each file. The message is already in the
 * data; this just leads with it and keeps the rule as the tag it is.
 *
 * A trailing parenthesised path is stripped — with or without a line number, since Theme Check
 * includes one only sometimes — because the row prints the location underneath already. */
function rowTitle(item: RoadmapItem): { title: string; rule?: string } {
  if (!RULE_NAME.test(item.fix)) return { title: item.fix };
  const message = item.why.replace(/\s*\([^()]*\.(liquid|json|js|css)(:\d+)?\)\s*$/, "").trim();
  const firstSentence = message.split(/(?<=[.!?])\s/)[0] ?? message;
  return firstSentence.length > 0 ? { title: firstSentence, rule: item.fix } : { title: item.fix };
}

function groupBy(items: RoadmapItem[]): { category: string; items: RoadmapItem[] }[] {
  const groups = new Map<string, RoadmapItem[]>();
  for (const item of items) {
    const list = groups.get(item.category) ?? [];
    list.push(item);
    groups.set(item.category, list);
  }
  // Biggest group first: it is where the work is, and it is the one worth opening.
  return [...groups.entries()]
    .map(([category, items]) => ({ category, items }))
    .sort((a, b) => b.items.length - a.items.length);
}

function Row({ item, onSuggestFix }: { item: RoadmapItem; onSuggestFix: (item: RoadmapItem) => void }) {
  const [open, setOpen] = useState(false);
  const actionable = hasRemediation(item);
  const { title, rule } = rowTitle(item);

  return (
    <div className="px-5 py-2.5">
      <div className="flex items-start gap-3">
        <span
          className="mt-1.5 w-2 h-2 rounded-full shrink-0"
          style={{ backgroundColor: SEVERITY_COLOR[item.severity] }}
          title={`${item.severity} severity`}
        />
        <button onClick={() => setOpen((v) => !v)} className="min-w-0 flex-1 text-left">
          <span className="text-[13px] font-medium text-[#1A1A1A]">{title}</span>
          <span className="block text-xs text-[#9A9A9A] font-mono mt-0.5 truncate">
            {where(item)}
            {rule && <span className="ml-2 font-sans text-[#C5C5C5]">{rule}</span>}
          </span>
        </button>
        {!actionable && (
          <span
            className="shrink-0 mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-[#D97706]"
            title="The audit did not capture a concrete fix for this one — it needs a developer to investigate before it can be estimated."
          >
            Needs investigation
          </span>
        )}
        <span
          className="shrink-0 mt-0.5 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
          style={{ backgroundColor: `${EFFORT_COLOR[item.effort]}1A`, color: EFFORT_COLOR[item.effort] }}
        >
          {item.effort}
        </span>
      </div>

      {open && (
        <div className="mt-2.5 ml-5 pl-3 border-l-2 border-[#E5E5E5] text-[13px] text-[#6B6B6B] leading-relaxed">
          <div>
            <MarkdownText text={item.why} />
          </div>
          {item.recommendation && (
            <div className="mt-2">
              <span className="font-semibold text-[#1A1A1A]">How to fix: </span>
              <MarkdownText text={item.recommendation} />
            </div>
          )}
          {item.codeFix && (
            <pre className="mt-2 bg-[#1A1A1A] text-[#E5E5E5] rounded-md p-2.5 text-[11.5px] leading-relaxed overflow-x-auto whitespace-pre-wrap">
              <code>{item.codeFix}</code>
            </pre>
          )}
          {item.file && (
            <button
              onClick={() => onSuggestFix(item)}
              className="mt-2.5 text-xs font-semibold text-white bg-[#1A1A1A] hover:bg-black px-2.5 py-1 rounded-md transition-colors"
            >
              Suggest fix
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Group({
  category,
  items,
  defaultOpen,
  onSuggestFix,
}: {
  category: string;
  items: RoadmapItem[];
  defaultOpen: boolean;
  onSuggestFix: (item: RoadmapItem) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const withFile = items.filter((i) => i.file).length;

  return (
    <div className="bg-white border border-[#E5E5E5] rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-5 py-3 text-left hover:bg-[#fafafa] transition-colors"
      >
        <span className="text-[#6B6B6B] text-[10px] w-3 shrink-0 leading-none">{open ? "▼" : "►"}</span>
        <span className="text-sm font-semibold text-[#1A1A1A] flex-1 min-w-0">{category}</span>
        {withFile > 0 && (
          <span className="text-xs text-[#9A9A9A] shrink-0">{withFile} point at a theme file</span>
        )}
        <span className="text-xs font-semibold text-[#6B6B6B] tabular-nums shrink-0">{items.length}</span>
      </button>
      {open && (
        <div className="border-t border-[#E5E5E5] divide-y divide-[#F0EFED]">
          {items.map((item) => (
            <Row key={item.id} item={item} onSuggestFix={onSuggestFix} />
          ))}
        </div>
      )}
    </div>
  );
}

export function DevTodoList({
  items,
  markdown,
  csv,
  csvFilename,
  storeSlug,
  reportUrl,
}: {
  items: RoadmapItem[];
  markdown: string;
  csv: string;
  csvFilename: string;
  storeSlug: string;
  reportUrl: string;
}) {
  const [copied, setCopied] = useState(false);
  // The one-at-a-time selection gate — picking a new item replaces any previous selection, and
  // there is no multi-select or bulk action anywhere in this component.
  const [activeItem, setActiveItem] = useState<RoadmapItem | null>(null);

  const tasks = items.filter((i) => !isMeasurement(i));
  const measurements = items.filter(isMeasurement);
  const groups = groupBy(tasks);
  const needsInvestigation = tasks.filter((i) => !hasRemediation(i)).length;
  const grounded = tasks.filter((i) => i.file).length;

  async function handleCopy() {
    await navigator.clipboard.writeText(markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleDownloadCsv() {
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = csvFilename;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-5">
        <p className="text-sm text-[#6B6B6B] max-w-[620px]">
          Every actionable finding across this report, grouped by where the work lives and ordered by
          severity within each group. Download as CSV to import straight into Jira (Summary, Priority,
          Labels, Issue Type, Description columns), or copy as a ready-made ticket per item.
        </p>
        <div className="flex shrink-0 gap-2.5">
          <button
            onClick={handleDownloadCsv}
            className="text-sm font-medium text-[#1A1A1A] bg-white border border-[#E5E5E5] hover:bg-[#fafafa] px-4 py-2 rounded-lg transition-colors"
          >
            Export CSV (Jira)
          </button>
          <button
            onClick={handleCopy}
            className="text-sm font-medium text-white bg-[#1A1A1A] hover:bg-[#333333] px-4 py-2 rounded-lg transition-colors"
          >
            {copied ? "Copied!" : "Copy to clipboard"}
          </button>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="bg-white border border-[#E5E5E5] rounded-lg px-5 py-6 text-sm text-[#6B6B6B]">
          No outstanding issues to prioritize — nice work.
        </div>
      ) : (
        <>
          <div className="bg-[#fafafa] border border-[#E5E5E5] rounded-lg px-4 py-3 mb-4 text-xs text-[#6B6B6B] leading-relaxed">
            <strong className="text-[#1A1A1A] font-semibold">{tasks.length} items</strong> across {groups.length}{" "}
            {groups.length === 1 ? "area" : "areas"}. {grounded} point at a specific theme file.
            {needsInvestigation > 0 && (
              <>
                {" "}
                <span className="text-[#D97706] font-semibold">{needsInvestigation}</span> have no concrete fix
                recorded and need a developer to scope them before they can be estimated.
              </>
            )}
          </div>

          <div className="space-y-2.5">
            {groups.map((group, i) => (
              <Group
                key={group.category}
                category={group.category}
                items={group.items}
                // Only the largest opens on arrival: the point of the collapsed view is that the
                // shape of the work is legible before any of the detail.
                defaultOpen={i === 0}
                onSuggestFix={setActiveItem}
              />
            ))}
          </div>

          {measurements.length > 0 && (
            <div className="mt-5 bg-[#fafafa] border border-[#E5E5E5] rounded-lg px-4 py-3">
              <div className="text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-wider mb-1.5">
                Not in the backlog
              </div>
              <p className="text-xs text-[#6B6B6B] leading-relaxed">
                {measurements.length} Lighthouse {measurements.length === 1 ? "metric" : "metrics"} —{" "}
                {measurements.map((m) => m.fix).join(", ")} — are outcomes rather than work, so they are not listed
                as tickets. The changes that move them are, under Performance. The numbers themselves are on the
                Site Performance page.
              </p>
            </div>
          )}
        </>
      )}

      {activeItem && (
        <SuggestFixPanel
          item={activeItem}
          storeSlug={storeSlug}
          reportUrl={reportUrl}
          onClose={() => setActiveItem(null)}
        />
      )}
    </div>
  );
}
