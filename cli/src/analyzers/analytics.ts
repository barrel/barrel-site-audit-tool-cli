import type { AnalyticsBreakdownRow, AnalyticsSection } from "@barrel/site-audit-shared";

interface ServiceAccountCredentials {
  client_email: string;
  private_key: string;
}

function getCredentials(): ServiceAccountCredentials | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed.client_email || !parsed.private_key) return null;
    return { client_email: parsed.client_email, private_key: parsed.private_key };
  } catch {
    return null;
  }
}

function metricValue(row: any, index: number): number {
  return Number(row?.metricValues?.[index]?.value ?? 0);
}

function toBreakdown(rows: any[] | null | undefined): AnalyticsBreakdownRow[] {
  return (rows ?? []).map((r) => ({
    label: r.dimensionValues?.[0]?.value || "Unknown",
    sessions: metricValue(r, 0),
  }));
}

/** Pulls a 28-day traffic/revenue snapshot from GA4. Returns null (never throws) if no
 * property ID is configured, no service account credentials are set, or the API call fails
 * for any reason (wrong property access, disabled API, etc.) — the report just omits this
 * section rather than failing the whole audit. See docs/ga4-setup.md. */
export async function analyzeAnalytics(propertyId: string | undefined): Promise<AnalyticsSection | null> {
  if (!propertyId) return null;

  const credentials = getCredentials();
  if (!credentials) return null;

  try {
    const { BetaAnalyticsDataClient } = await import("@google-analytics/data");
    const client = new BetaAnalyticsDataClient({ credentials });

    const property = `properties/${propertyId}`;
    const dateRanges = [{ startDate: "28daysAgo", endDate: "today" }];

    const [overview] = await client.runReport({
      property,
      dateRanges,
      metrics: [
        { name: "sessions" },
        { name: "totalUsers" },
        { name: "transactions" },
        { name: "purchaseRevenue" },
        { name: "averagePurchaseRevenue" },
      ],
    });

    const row = overview.rows?.[0];
    const sessions = metricValue(row, 0);
    const totalUsers = metricValue(row, 1);
    const transactions = metricValue(row, 2);
    const revenue = metricValue(row, 3);
    const averageOrderValue = metricValue(row, 4);
    const conversionRate = sessions > 0 ? Math.round((transactions / sessions) * 10000) / 100 : 0;

    const [channelReport] = await client.runReport({
      property,
      dateRanges,
      dimensions: [{ name: "sessionDefaultChannelGroup" }],
      metrics: [{ name: "sessions" }],
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      limit: 8,
    });

    const [deviceReport] = await client.runReport({
      property,
      dateRanges,
      dimensions: [{ name: "deviceCategory" }],
      metrics: [{ name: "sessions" }],
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
    });

    return {
      propertyId,
      dateRangeLabel: "Last 28 days",
      sessions,
      totalUsers,
      transactions,
      conversionRate,
      revenue,
      averageOrderValue,
      channels: toBreakdown(channelReport.rows),
      devices: toBreakdown(deviceReport.rows),
    };
  } catch {
    return null;
  }
}
