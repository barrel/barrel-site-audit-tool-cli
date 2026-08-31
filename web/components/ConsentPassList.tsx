import { buildConsentPassList, type ConsentPassListInput } from "@/lib/consent-pass-list";

/** The pass list, which is the half of a Privacy Compliance report a client actually asks for.
 *
 * Everything else in this report is organised around what went wrong: the exposure summary lists
 * only failures, and the per-suite detail interleaves passes with failures under a lettered
 * heading that means nothing outside the runbook. So "what is this site already doing right?" —
 * the first question in the room when the report is presented — had to be reconstructed by the
 * reader from a green pill and a wall of rows. This card answers it directly, from the same
 * verdicts, deriving nothing new.
 *
 * Shared by the audit report's Privacy Compliance section and the standalone per-site report, so
 * a client reading either is reading the same list. */
export function ConsentPassList({ section }: { section: ConsentPassListInput }) {
  const list = buildConsentPassList(section);
  if (list.groups.length === 0) return null;

  return (
    <div className="bg-white border border-[#E5E5E5] rounded-lg overflow-hidden break-inside-avoid">
      <div className="px-5 py-3 border-b border-[#E5E5E5] flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold text-[#1A1A1A]">What&apos;s working</h2>
          <p className="mt-0.5 text-xs text-[#6B6B6B] leading-relaxed max-w-[95ch]">
            Every check this scan confirmed is behaving correctly, grouped by what it means for a visitor rather
            than by test number. Each line is behaviour that was observed, not an absence of evidence.
          </p>
        </div>
        <div className="text-xs text-[#6B6B6B] shrink-0">
          {/* Against verdicts rather than against every check, so a site whose states were mostly
              unreachable cannot present as a clean sweep. */}
          <span className="text-lg font-semibold tabular-nums" style={{ color: "#10B981" }}>
            {list.passed}
          </span>{" "}
          of {list.verdicts} confirmed checks passed
        </div>
      </div>

      <ul className="divide-y divide-[#E5E5E5]">
        {list.groups.map((group) => (
          <li key={group.suite} className="px-5 py-3.5 break-inside-avoid">
            <div className="text-sm font-semibold text-[#1A1A1A]">{group.title}</div>
            <p className="mt-0.5 text-xs text-[#6B6B6B] leading-relaxed max-w-[95ch]">{group.meaning}</p>
            <ul className="mt-2 space-y-1">
              {group.passes.map((item) => (
                <li key={item.id} className="flex items-baseline gap-2 text-sm text-[#1A1A1A]">
                  <span className="shrink-0 font-semibold" style={{ color: "#10B981" }} aria-hidden>
                    &#10003;
                  </span>
                  <span className="min-w-0 leading-relaxed">
                    {item.statement}{" "}
                    <span className="font-mono text-[10px] font-semibold text-[#9A9A9A]">{item.id}</span>
                  </span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>

      {list.heldBack.length > 0 && (
        <div className="px-5 py-3 border-t border-[#E5E5E5] bg-[#fafafa]">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-[#6B6B6B]">
            Tags that obey the choice
          </div>
          <p className="mt-1 text-sm text-[#1A1A1A] leading-relaxed max-w-[95ch]">
            <strong>{list.heldBack.join(", ")}</strong> fired once the visitor accepted and stayed silent when they
            rejected — the behaviour the tag × state grid is testing for.
          </p>
        </div>
      )}
    </div>
  );
}
