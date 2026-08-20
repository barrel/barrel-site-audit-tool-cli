import { screenshotUrl } from "@/lib/screenshot";
import { formatDate } from "@/lib/format";
import type { Report } from "@/lib/shared";

/** The scored areas a client actually recognises, in the order they care about them. */
const AREAS: Array<{ key: string; label: string; of: (r: Report) => number | null | undefined }> = [
  { key: "performance", label: "Speed", of: (r) => r.sections.performance?.performance.score },
  { key: "accessibility", label: "Accessibility", of: (r) => r.sections.accessibility?.score },
  { key: "seo", label: "SEO", of: (r) => r.sections.geoSeo?.seo.score },
  { key: "health", label: "Site health", of: (r) => r.sections.health?.score },
  { key: "trust", label: "Trust & privacy", of: (r) => r.sections.pixels?.score },
  { key: "consent", label: "Privacy compliance", of: (r) => r.sections.consent?.score },
];

interface Movement {
  label: string;
  before: number;
  after: number;
  delta: number;
}

function movements(baseline: Report, latest: Report): Movement[] {
  const out: Movement[] = [];
  for (const area of AREAS) {
    const before = area.of(baseline);
    const after = area.of(latest);
    // Both ends have to exist. An area that was not measured at baseline has not improved or
    // regressed — treating a missing score as zero would invent a dramatic gain from nothing.
    if (typeof before !== "number" || typeof after !== "number") continue;
    out.push({ label: area.label, before, after, delta: after - before });
  }
  return out;
}

/** The handful of things worth a client's attention, worst first.
 *
 * Capped deliberately. A list of forty findings is a document nobody acts on; three or four is a
 * conversation. The full detail stays one click away in the audit itself. */
function criticalIssues(latest: Report): Array<{ title: string; detail: string }> {
  const out: Array<{ title: string; detail: string }> = [];
  const s = latest.sections;

  const consentBlockers = s.consent?.tests.filter((t) => t.severity === "blocker" && t.status === "fail") ?? [];
  if (consentBlockers.length > 0) {
    out.push({
      title: "Marketing tags are running before visitors agree to them",
      detail: `${consentBlockers.length} consent check${consentBlockers.length === 1 ? "" : "s"} failed, including ${consentBlockers[0].title.toLowerCase()}. This is the area with the clearest regulatory exposure, and it is usually a configuration fix rather than a rebuild.`,
    });
  }

  const perf = s.performance?.performance.score;
  if (typeof perf === "number" && perf < 50) {
    out.push({
      title: "Page speed is holding back conversion",
      detail: `The homepage scores ${perf} on mobile. Speed correlates directly with bounce rate on product pages, so this is one of the few fixes that pays back in revenue rather than only in scores.`,
    });
  }

  const a11y = s.accessibility?.score;
  if (typeof a11y === "number" && a11y < 80) {
    const violations = s.accessibility?.pages.reduce((n, p) => n + p.violations.length, 0) ?? 0;
    out.push({
      title: "Accessibility gaps are excluding customers",
      detail: `${violations} issue${violations === 1 ? "" : "s"} found across the pages tested. Beyond the legal exposure, these are the same barriers that make a site harder to use for everyone on a phone in bright sunlight.`,
    });
  }

  const seoOpps = s.geoSeo?.seo.opportunities.filter((o) => o.impact === "high") ?? [];
  if (seoOpps.length > 0) {
    out.push({
      title: "High-impact SEO opportunities are unclaimed",
      detail: `${seoOpps.length} high-impact opportunit${seoOpps.length === 1 ? "y" : "ies"}, starting with ${seoOpps[0].title.toLowerCase()}. These are additive — they win traffic that is currently going elsewhere.`,
    });
  }

  return out.slice(0, 4);
}

function Delta({ value }: { value: number }) {
  const better = value > 0;
  const flat = value === 0;
  return (
    <span
      className="text-xs font-semibold tabular-nums"
      style={{ color: flat ? "#9A9A9A" : better ? "#10B981" : "#B91C1C" }}
    >
      {flat ? "no change" : `${better ? "+" : ""}${value}`}
    </span>
  );
}

function Shot({ report, caption }: { report: Report; caption: string }) {
  const path = report.sections.performance?.screenshotPath;
  return (
    <figure className="min-w-0">
      <figcaption className="text-[10px] font-semibold uppercase tracking-wider text-[#6B6B6B] mb-1.5">
        {caption} · {formatDate(report.createdAt)}
      </figcaption>
      {path ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={screenshotUrl(path)}
          alt={`${caption} homepage`}
          className="w-full rounded-lg border border-[#E5E5E5] bg-white"
          // Tall mobile screenshots are cropped to the fold rather than scaled down: a
          // thumbnail of a full-page capture is an unreadable strip, and the fold is the part
          // anyone is actually comparing.
          style={{ maxHeight: 340, objectFit: "cover", objectPosition: "top" }}
        />
      ) : (
        <div className="w-full h-[200px] rounded-lg border border-dashed border-[#E5E5E5] bg-white flex items-center justify-center text-xs text-[#9A9A9A]">
          No screenshot captured
        </div>
      )}
    </figure>
  );
}

export function ClientReport({ baseline, latest }: { baseline: Report | null; latest: Report }) {
  const moves = baseline ? movements(baseline, latest) : [];
  const improved = moves.filter((m) => m.delta > 0).sort((a, b) => b.delta - a.delta);
  const declined = moves.filter((m) => m.delta < 0).sort((a, b) => a.delta - b.delta);
  const overallDelta = baseline ? latest.overallScore - baseline.overallScore : null;
  const issues = criticalIssues(latest);

  return (
    <div className="space-y-5">
      {/* ── Headline ─────────────────────────────────────────────────────────────────────── */}
      <section className="bg-white border border-[#E5E5E5] rounded-lg px-6 py-5 break-inside-avoid">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-[#6B6B6B]">Site health summary</div>
        <h1 className="mt-1 text-2xl font-semibold text-[#1A1A1A] tracking-tight">{latest.storeName}</h1>
        <div className="text-sm text-[#6B6B6B] break-all">{latest.storeUrl}</div>

        <div className="mt-4 flex items-end gap-8 flex-wrap">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-[#6B6B6B]">Overall score</div>
            <div className="mt-0.5 flex items-baseline gap-2">
              <span className="text-4xl font-semibold text-[#000000] tracking-tight tabular-nums">
                {latest.overallScore}
              </span>
              {overallDelta !== null && (
                <span
                  className="text-sm font-semibold tabular-nums"
                  style={{ color: overallDelta > 0 ? "#10B981" : overallDelta < 0 ? "#B91C1C" : "#9A9A9A" }}
                >
                  {overallDelta > 0 ? `+${overallDelta} since baseline` : overallDelta < 0 ? `${overallDelta} since baseline` : "level with baseline"}
                </span>
              )}
            </div>
          </div>
          {baseline && (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[#6B6B6B]">Baseline</div>
              <div className="mt-0.5 text-4xl font-semibold text-[#9A9A9A] tracking-tight tabular-nums">
                {baseline.overallScore}
              </div>
            </div>
          )}
        </div>

        <p className="mt-4 text-sm text-[#6B6B6B] leading-relaxed max-w-[80ch]">
          {baseline
            ? overallDelta !== null && overallDelta > 0
              ? `Measured against the baseline taken on ${formatDate(baseline.createdAt)}, the site has moved forward on ${improved.length} of ${moves.length} tracked areas. The work below is what would move it furthest next.`
              : `Measured against the baseline taken on ${formatDate(baseline.createdAt)}. The areas below are where the next round of work would have the most effect.`
            : "This is the first measurement for this site — it becomes the baseline that later runs are compared against."}
        </p>
      </section>

      {/* ── Then and now ─────────────────────────────────────────────────────────────────── */}
      {baseline && (
        <section className="bg-white border border-[#E5E5E5] rounded-lg px-6 py-5 break-inside-avoid">
          <h2 className="text-lg font-semibold text-[#000000] tracking-tight">The homepage, then and now</h2>
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-5">
            <Shot report={baseline} caption="Baseline" />
            <Shot report={latest} caption="Latest run" />
          </div>
        </section>
      )}

      {/* ── What moved ───────────────────────────────────────────────────────────────────── */}
      {moves.length > 0 && (
        <section className="bg-white border border-[#E5E5E5] rounded-lg overflow-hidden break-inside-avoid">
          <div className="px-6 py-3 border-b border-[#E5E5E5] bg-[#faf9f7]">
            <h2 className="text-lg font-semibold text-[#000000] tracking-tight">What has changed</h2>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left">
                {["Area", "Baseline", "Latest", "Change"].map((h) => (
                  <th key={h} className="px-6 py-2 text-[10px] font-semibold uppercase tracking-wider text-[#6B6B6B]">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E5E5E5]">
              {[...improved, ...moves.filter((m) => m.delta === 0), ...declined].map((m) => (
                <tr key={m.label}>
                  <td className="px-6 py-2.5 text-[#1A1A1A]">{m.label}</td>
                  <td className="px-6 py-2.5 tabular-nums text-[#9A9A9A]">{m.before}</td>
                  <td className="px-6 py-2.5 tabular-nums font-semibold text-[#1A1A1A]">{m.after}</td>
                  <td className="px-6 py-2.5">
                    <Delta value={m.delta} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {improved.length > 0 && (
            <div className="px-6 py-3 border-t border-[#E5E5E5] text-sm text-[#6B6B6B] leading-relaxed">
              <strong className="text-[#1A1A1A]">Biggest gain:</strong> {improved[0].label}, up {improved[0].delta}{" "}
              points since the baseline.
            </div>
          )}
        </section>
      )}

      {/* ── What to do next ──────────────────────────────────────────────────────────────── */}
      {issues.length > 0 && (
        <section className="bg-white border border-[#E5E5E5] rounded-lg overflow-hidden break-inside-avoid">
          <div className="px-6 py-3 border-b border-[#E5E5E5] bg-[#faf9f7]">
            <h2 className="text-lg font-semibold text-[#000000] tracking-tight">Where to focus next</h2>
            <p className="mt-0.5 text-xs text-[#6B6B6B]">
              The few items with the most impact, not an exhaustive list — the full audit carries the detail.
            </p>
          </div>
          <ol className="divide-y divide-[#E5E5E5]">
            {issues.map((issue, i) => (
              <li key={issue.title} className="px-6 py-4 flex gap-4 break-inside-avoid">
                <span className="text-2xl font-semibold text-[#D4D4D4] tabular-nums leading-none shrink-0">
                  {i + 1}
                </span>
                <div>
                  <div className="text-sm font-semibold text-[#1A1A1A]">{issue.title}</div>
                  <p className="mt-1 text-sm text-[#6B6B6B] leading-relaxed max-w-[85ch]">{issue.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      <p className="text-xs text-[#9A9A9A] leading-relaxed max-w-[80ch]">
        Scores are measured with Google Lighthouse and automated accessibility, SEO and privacy testing against the live
        site. Privacy findings describe observed technical behaviour, not a legal opinion.
      </p>
    </div>
  );
}
