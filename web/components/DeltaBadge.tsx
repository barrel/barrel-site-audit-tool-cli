/** Colored ± delta badge for a score change vs. baseline — green improvement, red regression,
 * neutral gray for no change, consistent everywhere a report is compared against its baseline. */
export function DeltaBadge({ delta }: { delta: number }) {
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
    </span>
  );
}
