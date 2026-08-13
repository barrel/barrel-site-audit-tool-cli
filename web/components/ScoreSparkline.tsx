import { colorForScore } from "@/lib/shared";

/** Tiny inline trend line for a store's overallScore history, oldest -> newest. Single series,
 * so no legend/axis — the color alone (matching the app's existing score-band palette) plus the
 * end dot is enough context inside a table row; the exact numbers sit in the adjacent cells. */
export function ScoreSparkline({ scores, width = 88, height = 28 }: { scores: number[]; width?: number; height?: number }) {
  if (scores.length < 2) {
    return <div style={{ width, height }} className="flex items-center text-xs text-[#9A9A9A]">Only 1 run</div>;
  }

  const pad = 4;
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const range = Math.max(1, max - min);
  const points = scores.map((s, i) => {
    const x = pad + (i / (scores.length - 1)) * (width - pad * 2);
    const y = pad + (1 - (s - min) / range) * (height - pad * 2);
    return [x, y] as const;
  });
  const path = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const [lastX, lastY] = points[points.length - 1];
  const color = colorForScore(scores[scores.length - 1]);

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="shrink-0" aria-hidden="true">
      <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lastX} cy={lastY} r={2.5} fill={color} />
    </svg>
  );
}
