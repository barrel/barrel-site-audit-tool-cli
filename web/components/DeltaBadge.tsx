import type { ScoreComparability } from "@/lib/shared";

/** Shown in place of a delta when the two runs did not measure the same set of areas.
 *
 * An overall score is an average over whichever areas produced a number, so a run made with
 * `--skip-axe` and a full run of the same store are two different quantities. Subtracting one from
 * the other reports a change in coverage as a change in the site, which is worse than reporting
 * nothing. */
function NotComparable() {
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold shrink-0 bg-[#f0efed] text-[#6B6B6B]"
      title="This run and the baseline scored different sets of areas, so the difference between their overall scores would not mean anything."
    >
      Not comparable
    </span>
  );
}

/** Colored ± delta badge for a score change vs. baseline — green improvement, red regression,
 * neutral gray for no change, consistent everywhere a report is compared against its baseline.
 *
 * `comparability` decides whether the number is shown at all. "unknown" — one side predating the
 * record of what was scored — still shows it, marked: refusing to compare the whole of the
 * existing history would overstate how little is known. */
export function DeltaBadge({ delta, comparability = "comparable" }: { delta: number; comparability?: ScoreComparability }) {
  if (comparability === "different") return <NotComparable />;
  const rounded = Math.round(delta);
  const color = rounded > 0 ? "#10B981" : rounded < 0 ? "#B91C1C" : "#6B6B6B";
  const sign = rounded > 0 ? "+" : "";
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums shrink-0"
      style={{ backgroundColor: rounded === 0 ? "#f0efed" : `${color}1A`, color }}
    >
      {sign}
      {rounded}
      {comparability === "unknown" && (
        <span
          className="ml-1 font-normal opacity-70"
          title="One of these runs predates the record of which areas it scored, so this comparison is unverified."
        >
          ?
        </span>
      )}
    </span>
  );
}
