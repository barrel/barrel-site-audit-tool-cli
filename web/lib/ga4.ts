// The GA4 pull behind the Data Analysis tab.
//
// Deliberately separate from the CLI's cli/src/analyzers/analytics.ts, which produces the report's
// Traffic & Revenue *summary* — totals plus session counts by channel and device. That shape
// cannot support a conversion analysis: it has no transactions per segment, so it can say 71% of
// sessions are mobile but not that those sessions convert at a third of desktop's rate. Conversion
// problems localise, and the split is where they show up.
//
// This runs server-side in the deployed web app, using the property linked via /api/ga4 and the
// same GOOGLE_SERVICE_ACCOUNT_KEY that route verifies against. No CLI, no browser.

import { averageOrderValue, conversionRate } from "./data-analysis";
import type { ConversionDataset, ConversionSegment, ConversionTotals } from "./shared";

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
    // Vercel's env var editor stores the key with literal \n sequences; the Google client needs
    // real newlines or the JWT signature silently fails to build. Same normalisation as
    // /api/ga4's verifier, for the same reason.
    return { client_email: parsed.client_email, private_key: String(parsed.private_key).replace(/\\n/g, "\n") };
  } catch {
    return null;
  }
}

/** Every failure mode gets its own name, because they need different answers from a human: a
 * missing key is a deployment problem, a permission error is a GA4 admin problem, and an empty
 * property is neither. Collapsing them into "could not load data" sends people to the wrong
 * place. */
export type Ga4Failure =
  | { reason: "no-credentials"; message: string }
  | { reason: "no-access"; message: string }
  | { reason: "api-error"; message: string };

export type Ga4Result = { ok: true; dataset: ConversionDataset } | ({ ok: false } & Ga4Failure);

/* The window: 28 complete days, ending yesterday.
 *
 * Yesterday rather than today because today is a partial day, and a partial day drags every rate
 * in the analysis down by an amount nobody can see. Relative date strings rather than computed
 * ISO dates because GA4 resolves them in the *property's* timezone — computing them here in UTC
 * would silently shift the window for any store not reporting in UTC. The real dates measured are
 * read back off the daily rows below. */
const DATE_RANGE = { startDate: "28daysAgo", endDate: "yesterday" } as const;

function metric(row: any, index: number): number {
  const value = Number(row?.metricValues?.[index]?.value ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function dimension(row: any, index = 0): string {
  return row?.dimensionValues?.[index]?.value || "(not set)";
}

function toSegments(rows: any[] | null | undefined): ConversionSegment[] {
  return (rows ?? []).map((row) => {
    const sessions = metric(row, 0);
    const transactions = metric(row, 1);
    return {
      label: dimension(row),
      sessions,
      transactions,
      revenue: metric(row, 2),
      conversionRate: conversionRate(transactions, sessions),
    };
  });
}

/** How many landing pages and channels to carry.
 *
 * Capped because the whole dataset is handed to a model, and a long tail of pages with four
 * sessions each is noise that costs tokens and invites the model to treat a rounding error as a
 * finding. The caps are generous enough that the pages carrying real traffic are all present. */
const MAX_CHANNELS = 12;
const MAX_LANDING_PAGES = 20;

/** Pulls the conversion dataset for one GA4 property.
 *
 * Never throws: every failure comes back as a named reason the caller renders as its own state.
 * An analysis that silently proceeds on a failed fetch is exactly the outcome this feature exists
 * to avoid. */
export async function fetchConversionDataset(propertyId: string): Promise<Ga4Result> {
  const credentials = getCredentials();
  if (!credentials) {
    return {
      ok: false,
      reason: "no-credentials",
      message:
        "No GOOGLE_SERVICE_ACCOUNT_KEY is configured on this deployment, so GA4 cannot be read. " +
        "Set it to the service-account JSON, then generate again.",
    };
  }

  let responses: any[];
  try {
    const { BetaAnalyticsDataClient } = await import("@google-analytics/data");
    const client = new BetaAnalyticsDataClient({ credentials });
    const property = `properties/${propertyId}`;
    const dateRanges = [DATE_RANGE];

    // Five queries, run together. The metric order inside each is load-bearing — metric(row, n)
    // reads by position — so sessions/transactions/revenue stay in that order everywhere.
    responses = await Promise.all([
      // 1. Totals. totalUsers comes along because "how many people" is the first question anyone
      //    asks of a conversion rate, and it costs nothing to fetch alongside.
      client.runReport({
        property,
        dateRanges,
        metrics: [{ name: "sessions" }, { name: "transactions" }, { name: "purchaseRevenue" }, { name: "totalUsers" }],
      }),
      // 2. One row per day. Not shown anywhere — it exists solely to answer "how much history
      //    does this property actually have?", which is the gate on whether any of the rest may
      //    be reasoned from. A property connected a fortnight ago returns a perfectly healthy
      //    28-day total and 14 days of rows.
      client.runReport({
        property,
        dateRanges,
        dimensions: [{ name: "date" }],
        metrics: [{ name: "sessions" }],
        orderBys: [{ dimension: { dimensionName: "date" } }],
        limit: 60,
      }),
      // 3. By device. The split that localises conversion problems most often, and the one the
      //    audit's mobile-only Lighthouse run can actually speak to.
      client.runReport({
        property,
        dateRanges,
        dimensions: [{ name: "deviceCategory" }],
        metrics: [{ name: "sessions" }, { name: "transactions" }, { name: "purchaseRevenue" }],
        orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      }),
      // 4. By channel. Included for context on who the traffic is rather than for gap arithmetic
      //    — paid and organic converting differently is a media fact, not a site defect.
      client.runReport({
        property,
        dateRanges,
        dimensions: [{ name: "sessionDefaultChannelGroup" }],
        metrics: [{ name: "sessions" }, { name: "transactions" }, { name: "purchaseRevenue" }],
        orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
        limit: MAX_CHANNELS,
      }),
      // 5. By landing page. Where a specific template's problem becomes visible as a number.
      client.runReport({
        property,
        dateRanges,
        dimensions: [{ name: "landingPagePlusQueryString" }],
        metrics: [{ name: "sessions" }, { name: "transactions" }, { name: "purchaseRevenue" }],
        orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
        limit: MAX_LANDING_PAGES,
      }),
    ]);
  } catch (err: unknown) {
    const message = String((err as Error)?.message ?? err);
    if (/PERMISSION_DENIED|403/i.test(message)) {
      return {
        ok: false,
        reason: "no-access",
        message: `The service account is not a Viewer on GA4 property ${propertyId}. Add it in GA4 → Admin → Property access management, then generate again.`,
      };
    }
    if (/NOT_FOUND|404/i.test(message)) {
      return {
        ok: false,
        reason: "no-access",
        message: `GA4 has no property ${propertyId}. Check Admin → Property Settings for the numeric Property ID.`,
      };
    }
    return { ok: false, reason: "api-error", message: `The GA4 API rejected the request: ${message.slice(0, 300)}` };
  }

  const [totalsReport, dailyReport, deviceReport, channelReport, landingReport] = responses.map((r) => r[0]);

  const totalsRow = totalsReport.rows?.[0];
  const sessions = metric(totalsRow, 0);
  const transactions = metric(totalsRow, 1);
  const revenue = metric(totalsRow, 2);
  const totals: ConversionTotals = {
    sessions,
    transactions,
    revenue,
    totalUsers: metric(totalsRow, 3),
    conversionRate: conversionRate(transactions, sessions),
    averageOrderValue: averageOrderValue(revenue, transactions),
  };

  // GA4 returns dates as YYYYMMDD. Only days that recorded a session count — a zero-session day
  // inside the window is a day the property has no history for, whatever the calendar says.
  const dayRows = (dailyReport.rows ?? []).filter((row: any) => metric(row, 0) > 0);
  const days = dayRows.map((row: any) => dimension(row)).sort();
  const asIso = (compact: string | undefined) =>
    compact && /^\d{8}$/.test(compact) ? `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}` : "";

  return {
    ok: true,
    dataset: {
      propertyId,
      currencyCode: totalsReport.metadata?.currencyCode ?? "",
      startDate: asIso(days[0]),
      endDate: asIso(days[days.length - 1]),
      daysWithSessions: days.length,
      totals,
      byDevice: toSegments(deviceReport.rows),
      byChannel: toSegments(channelReport.rows),
      byLandingPage: toSegments(landingReport.rows),
    },
  };
}
