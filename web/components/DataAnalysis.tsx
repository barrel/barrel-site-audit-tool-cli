"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AnalysisEvidenceItem, ConversionSegment, DataAnalysisSection } from "@/lib/shared";

/** Every number on this page is printed from the stored analysis — the dataset GA4 returned, or an
 * evidence line this codebase wrote from it. The model's prose is rendered as prose and nothing
 * else: it never supplies a figure the page formats. That is deliberate, and it is why
 * recommendations cite evidence by id rather than carrying their own numbers. */

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex-1 min-w-[140px] px-5 py-4">
      <div className="text-xs font-medium text-[#9A9A9A] tracking-wide uppercase">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-[#000000] tracking-tight">{value}</div>
    </div>
  );
}

function SegmentTable({ title, rows, note }: { title: string; rows: ConversionSegment[]; note?: string }) {
  if (rows.length === 0) return null;
  return (
    <div className="bg-white border border-[#E5E5E5] rounded-lg overflow-hidden">
      <div className="px-5 py-2 bg-[#fafafa] text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-wider">
        {title}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wider text-[#9A9A9A]">
              <th className="text-left font-semibold px-5 py-2">Segment</th>
              <th className="text-right font-semibold px-5 py-2">Sessions</th>
              <th className="text-right font-semibold px-5 py-2">Transactions</th>
              <th className="text-right font-semibold px-5 py-2">Conv. rate</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E5E5E5]">
            {rows.map((row) => (
              <tr key={row.label}>
                <td className="px-5 py-2.5 text-[#1A1A1A] break-all">{row.label}</td>
                <td className="px-5 py-2.5 text-right text-[#6B6B6B] tabular-nums">
                  {row.sessions.toLocaleString("en-US")}
                </td>
                <td className="px-5 py-2.5 text-right text-[#6B6B6B] tabular-nums">
                  {row.transactions.toLocaleString("en-US")}
                </td>
                <td className="px-5 py-2.5 text-right text-[#1A1A1A] font-medium tabular-nums">
                  {row.conversionRate}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {note && <div className="px-5 py-2 text-[11.5px] text-[#9A9A9A] border-t border-[#E5E5E5]">{note}</div>}
    </div>
  );
}

const SOURCE_LABEL: Record<AnalysisEvidenceItem["source"], string> = {
  ga4: "GA4",
  audit: "Audit",
  // Named rather than dressed up as a measurement: these lines are this tool's own arithmetic on
  // GA4's figures, and a reader is entitled to know which is which.
  arithmetic: "Computed",
};

function EvidenceLine({ item }: { item: AnalysisEvidenceItem }) {
  return (
    <li className="flex items-start gap-2.5 text-[13px] text-[#1A1A1A] leading-relaxed">
      <span className="mt-0.5 shrink-0 text-[10px] font-semibold uppercase tracking-wider text-[#6B6B6B] bg-[#f0efed] rounded px-1.5 py-0.5">
        {SOURCE_LABEL[item.source]}
      </span>
      <span>{item.text}</span>
    </li>
  );
}

function Panel({ tone, title, children }: { tone: "neutral" | "warn"; title: string; children: React.ReactNode }) {
  const border = tone === "warn" ? "border-[#E5C07B]" : "border-[#E5E5E5]";
  const bg = tone === "warn" ? "bg-[#FDF9F0]" : "bg-white";
  return (
    <div className={`${bg} border ${border} rounded-lg px-5 py-4`}>
      <div className="text-[13px] font-semibold text-[#1A1A1A] mb-2">{title}</div>
      {children}
    </div>
  );
}

function GenerateButton({ label, onClick, busy }: { label: string; onClick: () => void; busy: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="text-sm font-semibold text-white bg-[#1A1A1A] hover:bg-[#333] disabled:opacity-60 px-4 py-2.5 rounded-lg transition-colors"
    >
      {busy ? "Analyzing…" : label}
    </button>
  );
}

export function DataAnalysis({
  slug,
  id,
  propertyId,
  initial,
}: {
  slug: string;
  id: string;
  propertyId: string;
  initial: DataAnalysisSection | null;
}) {
  const router = useRouter();
  const [analysis, setAnalysis] = useState<DataAnalysisSection | null>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/data-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, id }),
      });
      const payload = (await res.json().catch(() => null)) as { analysis?: DataAnalysisSection; error?: string } | null;
      if (!res.ok || !payload?.analysis) {
        setError(payload?.error ?? `The analysis request failed (HTTP ${res.status}).`);
        return;
      }
      setAnalysis(payload.analysis);
      // Refresh so a later navigation back to this tab reads the stored analysis rather than the
      // empty state the server rendered before it existed.
      router.refresh();
    } catch (err: unknown) {
      setError(`The analysis request could not be sent: ${String((err as Error)?.message ?? err)}`);
    } finally {
      setBusy(false);
    }
  }

  if (!analysis) {
    return (
      <div className="space-y-4">
        <div className="bg-white border border-[#E5E5E5] rounded-lg px-5 py-6 max-w-[860px]">
          <h3 className="text-[15px] font-semibold text-[#1A1A1A]">Cross this audit with the store&rsquo;s GA4 data</h3>
          <p className="mt-2 text-sm text-[#6B6B6B] leading-relaxed">
            This reads the last 28 complete days from GA4 property {propertyId} — sessions, transactions, revenue and
            conversion rate overall, and split by device, channel and landing page — and works out where conversion is
            weakest and how large each gap was over those days. It then asks Claude to rank what to do about it against
            the findings already in this report.
          </p>
          <ul className="mt-3 space-y-1.5 text-sm text-[#6B6B6B]">
            <li className="flex gap-2">
              <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-[#1A1A1A]/40 shrink-0" />
              Every figure shown comes from the GA4 response or from this report. Recommendations cite the lines they
              rest on, and any that introduces a number the data does not contain is discarded before you see it.
            </li>
            <li className="flex gap-2">
              <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-[#1A1A1A]/40 shrink-0" />
              No forecasts. Gap sizes describe the days already measured, not what a fix would earn.
            </li>
            <li className="flex gap-2">
              <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-[#1A1A1A]/40 shrink-0" />
              If the property has too little history, or no ecommerce tracking, it says so and stops.
            </li>
          </ul>
          <div className="mt-5">
            <GenerateButton label="Generate analysis" onClick={generate} busy={busy} />
          </div>
          <p className="mt-2 text-[11.5px] text-[#9A9A9A]">
            Takes a few seconds and costs a Claude call, so it runs only when you ask.
          </p>
        </div>
        {error && (
          <Panel tone="warn" title="The analysis did not run">
            <p className="text-sm text-[#1A1A1A] leading-relaxed">{error}</p>
          </Panel>
        )}
      </div>
    );
  }

  const { dataset, totals } = { dataset: analysis.dataset, totals: analysis.dataset.totals };
  const currency = dataset.currencyCode;
  const money = (n: number) => `${Math.round(n).toLocaleString("en-US")}${currency ? ` ${currency}` : ""}`;
  const evidenceById = new Map(analysis.evidence.map((e) => [e.id, e]));

  return (
    <div className="space-y-6">
      <div>
        <p className="text-[15px] text-[#1A1A1A] leading-relaxed max-w-[860px]">{analysis.headline}</p>
        <p className="mt-1.5 text-[11.5px] text-[#9A9A9A]">
          GA4 property {dataset.propertyId} · {dataset.startDate || "—"} to {dataset.endDate || "—"} ·{" "}
          {dataset.daysWithSessions} days with recorded sessions · generated{" "}
          {new Date(analysis.generatedAt).toLocaleString()}
        </p>
      </div>

      <div className="flex flex-wrap divide-x divide-[#E5E5E5] border border-[#E5E5E5] rounded-lg bg-white">
        <Stat label="Sessions" value={totals.sessions.toLocaleString("en-US")} />
        <Stat label="Transactions" value={totals.transactions.toLocaleString("en-US")} />
        <Stat label="Conversion Rate" value={`${totals.conversionRate}%`} />
        <Stat label="Avg. Order Value" value={money(totals.averageOrderValue)} />
        <Stat label="Revenue" value={money(totals.revenue)} />
      </div>

      {analysis.status === "insufficient-data" && (
        <Panel tone="warn" title="Not enough data to make conversion recommendations">
          <ul className="space-y-2">
            {analysis.limitations.map((l, i) => (
              <li key={i} className="text-sm text-[#1A1A1A] leading-relaxed">
                {l}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[12.5px] text-[#6B6B6B]">
            The figures above are shown so this conclusion can be checked rather than taken on trust. No Claude call was
            made — there is nothing here for it to analyse, and it would have produced something that read like analysis
            anyway.
          </p>
        </Panel>
      )}

      {analysis.recommendations.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-[15px] font-semibold text-[#1A1A1A]">
            Ranked by the size of the gap in the data ({analysis.recommendations.length})
          </h3>
          {analysis.recommendations.map((rec) => (
            <div key={rec.rank} className="bg-white border border-[#E5E5E5] rounded-lg overflow-hidden">
              <div className="px-5 py-4 border-b border-[#E5E5E5]">
                <div className="flex items-baseline justify-between gap-3">
                  <div className="flex items-baseline gap-2.5">
                    <span className="text-[13px] font-semibold text-[#9A9A9A] tabular-nums">
                      {String(rec.rank).padStart(2, "0")}
                    </span>
                    <h4 className="text-[15px] font-semibold text-[#1A1A1A]">{rec.title}</h4>
                  </div>
                  <span
                    className={`shrink-0 text-[10px] font-semibold uppercase tracking-wider rounded-full px-2.5 py-1 ${
                      rec.confidence === "measured" ? "bg-[#EAF2FB] text-[#2563EB]" : "bg-[#f0efed] text-[#6B6B6B]"
                    }`}
                  >
                    {rec.confidence === "measured" ? "Measured" : "Hypothesis"}
                  </span>
                </div>
                <p className="mt-2.5 text-sm text-[#1A1A1A] leading-relaxed">{rec.action}</p>
              </div>

              <div className="px-5 py-4 bg-[#fafafa] border-b border-[#E5E5E5]">
                <div className="text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-wider mb-2">
                  The numbers this rests on
                </div>
                <ul className="space-y-2">
                  {rec.evidenceIds.map((eid) => {
                    const item = evidenceById.get(eid);
                    return item ? <EvidenceLine key={eid} item={item} /> : null;
                  })}
                </ul>
              </div>

              {(rec.findingIds.length > 0 || rec.sectionIds.length > 0) && (
                <div className="px-5 py-3 border-b border-[#E5E5E5]">
                  <div className="text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-wider mb-1.5">
                    Connects to in this audit
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {rec.findingIds.map((fid) => (
                      <span
                        key={fid}
                        className="text-[11.5px] font-medium text-[#1A1A1A] bg-[#f0efed] rounded px-2 py-1 break-all"
                      >
                        {fid}
                      </span>
                    ))}
                    {rec.sectionIds.map((sid) => (
                      <span
                        key={sid}
                        className="text-[11.5px] font-medium text-[#6B6B6B] bg-[#f0efed] rounded px-2 py-1"
                      >
                        section: {sid}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="px-5 py-4 space-y-2.5">
                {rec.expectation && (
                  <div>
                    <div className="text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-wider mb-1">
                      What to expect
                    </div>
                    <p className="text-[13px] text-[#1A1A1A] leading-relaxed">{rec.expectation}</p>
                  </div>
                )}
                {rec.causalNote && (
                  <div>
                    <div className="text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-wider mb-1">
                      What else could explain this
                    </div>
                    <p className="text-[13px] text-[#6B6B6B] leading-relaxed">{rec.causalNote}</p>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {analysis.gaps.length > 0 && (
        <div className="bg-white border border-[#E5E5E5] rounded-lg overflow-hidden">
          <div className="px-5 py-2 bg-[#fafafa] text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-wider">
            Conversion gaps over the days measured
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-[#9A9A9A]">
                  <th className="text-left font-semibold px-5 py-2">Segment</th>
                  <th className="text-right font-semibold px-5 py-2">Its rate</th>
                  <th className="text-right font-semibold px-5 py-2">Benchmark</th>
                  <th className="text-right font-semibold px-5 py-2">Share of sessions</th>
                  <th className="text-right font-semibold px-5 py-2">Gap, in orders</th>
                  <th className="text-right font-semibold px-5 py-2">Gap, at observed AOV</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E5E5]">
                {analysis.gaps.map((gap, i) => (
                  <tr key={`${gap.dimension}-${gap.segment}-${i}`}>
                    <td className="px-5 py-2.5 text-[#1A1A1A] break-all">{gap.segment}</td>
                    <td className="px-5 py-2.5 text-right tabular-nums text-[#1A1A1A] font-medium">
                      {gap.segmentConversionRate}%
                    </td>
                    <td className="px-5 py-2.5 text-right tabular-nums text-[#6B6B6B]">
                      {gap.benchmarkConversionRate}% ({gap.benchmark})
                    </td>
                    <td className="px-5 py-2.5 text-right tabular-nums text-[#6B6B6B]">{gap.shareOfSessions}%</td>
                    <td className="px-5 py-2.5 text-right tabular-nums text-[#6B6B6B]">
                      {gap.transactionsAtBenchmark.toLocaleString("en-US")}
                    </td>
                    <td className="px-5 py-2.5 text-right tabular-nums text-[#6B6B6B]">
                      {money(gap.revenueAtBenchmark)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-5 py-2.5 text-[11.5px] text-[#9A9A9A] border-t border-[#E5E5E5] leading-relaxed">
            Arithmetic on the days already measured: the segment&rsquo;s own sessions at the benchmark&rsquo;s
            conversion rate, valued at the site&rsquo;s observed average order value. It is the size of a difference
            that has already happened, not a projection of what closing it would earn — and closing a gap entirely is
            not a realistic target for any change.
          </div>
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-4">
        <SegmentTable title="By device" rows={dataset.byDevice} />
        <SegmentTable title="By channel" rows={dataset.byChannel} />
      </div>
      <SegmentTable
        title="By landing page"
        rows={dataset.byLandingPage}
        note="The busiest entry points GA4 returned for the window, in traffic order."
      />

      {analysis.status === "ok" && analysis.limitations.length > 0 && (
        <Panel tone="neutral" title="What this analysis does not show">
          <ul className="space-y-2">
            {analysis.limitations.map((l, i) => (
              <li key={i} className="text-[13px] text-[#6B6B6B] leading-relaxed">
                {l}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {analysis.rejected.length > 0 && (
        <Panel tone="warn" title={`Discarded before you saw them (${analysis.rejected.length})`}>
          <p className="text-[12.5px] text-[#6B6B6B] mb-2.5 leading-relaxed">
            These were returned by the model and thrown away by the checks that every figure must come from the data
            cited. They are listed rather than dropped silently, so a filtered run cannot be mistaken for a quiet one.
          </p>
          <ul className="space-y-2">
            {analysis.rejected.map((r, i) => (
              <li key={i} className="text-[13px] text-[#1A1A1A] leading-relaxed">
                <span className="font-medium">{r.title}</span>
                <span className="text-[#6B6B6B]"> — {r.reason}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <div className="flex items-center gap-3 pt-2">
        <GenerateButton label="Re-run analysis" onClick={generate} busy={busy} />
        <span className="text-[11.5px] text-[#9A9A9A]">
          Re-reads GA4 and replaces this analysis.
          {analysis.usage &&
            ` Last run used ${analysis.usage.inputTokens.toLocaleString("en-US")} input and ${analysis.usage.outputTokens.toLocaleString("en-US")} output tokens (≈$${analysis.usage.estimatedCostUsd.toFixed(4)}) on ${analysis.usage.model}.`}
        </span>
      </div>
      {error && (
        <Panel tone="warn" title="The re-run did not complete">
          <p className="text-sm text-[#1A1A1A] leading-relaxed">{error}</p>
          <p className="mt-2 text-[12.5px] text-[#6B6B6B]">The analysis above is the previous one, unchanged.</p>
        </Panel>
      )}
    </div>
  );
}
