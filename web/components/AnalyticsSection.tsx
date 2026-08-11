import type { AnalyticsBreakdownRow, AnalyticsSection as AnalyticsSectionData } from "@/lib/shared";

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex-1 min-w-[140px] px-5 py-4">
      <div className="text-xs font-medium text-[#9A9A9A] tracking-wide uppercase">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-[#000000] tracking-tight">{value}</div>
    </div>
  );
}

function BreakdownList({ title, rows, total }: { title: string; rows: AnalyticsBreakdownRow[]; total: number }) {
  return (
    <div>
      <div className="px-5 py-2 bg-[#fafafa] text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-wider">
        {title}
      </div>
      <div className="divide-y divide-[#E5E5E5]">
        {rows.length === 0 ? (
          <div className="px-5 py-4 text-sm text-[#9A9A9A]">No data</div>
        ) : (
          rows.map((r) => {
            const pct = total > 0 ? Math.round((r.sessions / total) * 100) : 0;
            return (
              <div key={r.label} className="px-5 py-3">
                <div className="flex items-center justify-between text-sm mb-1.5">
                  <span className="text-[#1A1A1A] font-medium capitalize">{r.label}</span>
                  <span className="text-[#6B6B6B] tabular-nums">
                    {r.sessions.toLocaleString()} · {pct}%
                  </span>
                </div>
                <div className="h-1.5 bg-[#E5E5E5] rounded-full overflow-hidden">
                  <div className="h-full rounded-full bg-[#3B82F6]" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export function AnalyticsSection({ analytics }: { analytics: AnalyticsSectionData }) {
  const currency = (n: number) =>
    n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });

  return (
    <div>
      <div className="flex flex-wrap divide-x divide-[#E5E5E5] border border-[#E5E5E5] rounded-t-lg bg-white">
        <StatCard label="Sessions" value={analytics.sessions.toLocaleString()} />
        <StatCard label="Conversion Rate" value={`${analytics.conversionRate}%`} />
        <StatCard label="Avg. Order Value" value={currency(analytics.averageOrderValue)} />
        <StatCard label="Revenue" value={currency(analytics.revenue)} />
      </div>
      <div className="grid md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-[#E5E5E5] border border-t-0 border-[#E5E5E5] rounded-b-lg bg-white overflow-hidden">
        <BreakdownList title="Traffic by channel" rows={analytics.channels} total={analytics.sessions} />
        <BreakdownList title="Traffic by device" rows={analytics.devices} total={analytics.sessions} />
      </div>
      <p className="text-xs text-[#9A9A9A] mt-2">
        Source: Google Analytics 4, {analytics.dateRangeLabel.toLowerCase()} · {analytics.totalUsers.toLocaleString()}{" "}
        total users · {analytics.transactions.toLocaleString()} transactions
      </p>
    </div>
  );
}
