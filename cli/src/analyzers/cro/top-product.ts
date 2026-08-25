// Which product page the CRO audit should review.
//
// A one-question GA4 lookup, kept apart from analyzers/analytics.ts because it answers a different
// kind of question: that module produces a report section, this one makes a discovery decision
// before the browser starts.
//
// Why it is worth a network call at all: the alternative is "the first product in products.json",
// which is whatever sorts first — on a large share of stores that is a gift card, a sample, or an
// archived item nobody visits. Reviewing it produces a PDP slide about a page the client's traffic
// never sees, and that is the kind of mistake a client spots immediately and rightly distrusts the
// rest of the deck over.

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
    // web/lib/ga4.ts, for the same reason.
    return { client_email: parsed.client_email, private_key: String(parsed.private_key).replace(/\\n/g, "\n") };
  } catch {
    return null;
  }
}

/** The handle of the most-viewed product page in the last 28 days, or null.
 *
 * Never throws: no property linked, no credentials, no access, or an empty property all mean "fall
 * back to catalogue order", which is a slightly worse choice of PDP rather than a failed run. */
export async function findTopProductHandle(propertyId: string | undefined): Promise<string | null> {
  if (!propertyId) return null;
  const credentials = getCredentials();
  if (!credentials) return null;

  try {
    const { BetaAnalyticsDataClient } = await import("@google-analytics/data");
    const client = new BetaAnalyticsDataClient({ credentials });

    const [report] = await client.runReport({
      property: `properties/${propertyId}`,
      dateRanges: [{ startDate: "28daysAgo", endDate: "yesterday" }],
      dimensions: [{ name: "pagePath" }],
      metrics: [{ name: "screenPageViews" }],
      dimensionFilter: {
        filter: { fieldName: "pagePath", stringFilter: { matchType: "CONTAINS", value: "/products/" } },
      },
      orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
      limit: 10,
    });

    for (const row of report.rows ?? []) {
      const path = row.dimensionValues?.[0]?.value ?? "";
      // The handle only — a pagePath routinely carries a variant query string or a collection
      // prefix (/collections/x/products/y), and both would 404 as a handle.
      const match = /\/products\/([^/?#]+)/.exec(path);
      if (match?.[1]) return decodeURIComponent(match[1]);
    }
    return null;
  } catch {
    return null;
  }
}
