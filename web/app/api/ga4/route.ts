import { NextRequest, NextResponse } from "next/server";
import { getStoreConfig, saveStoreConfig } from "@/lib/data";

export const dynamic = "force-dynamic";

/** GA4 property IDs are numeric. People routinely paste the measurement ID (`G-XXXXXXX`) or the
 * stream ID instead, and both would be saved happily and then silently produce nothing — so the
 * shape is checked here and the error says which value to go and find. */
const PROPERTY_ID = /^\d{6,12}$/;

interface LinkBody {
  slug?: string;
  /** Empty string unlinks — the same form does both, so there is one place to reason about. */
  propertyId?: string;
}

function credentials(): { client_email: string; private_key: string } | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed.client_email || !parsed.private_key) return null;
    return { client_email: parsed.client_email, private_key: String(parsed.private_key).replace(/\\n/g, "\n") };
  } catch {
    return null;
  }
}

/** Confirms the service account can actually read this property.
 *
 * The check that matters. A property ID that is well-formed but not shared with the service
 * account saves without complaint and then produces an empty Traffic & Revenue section on every
 * later run — which reads as "this store has no traffic", not as "nobody granted us access". One
 * real query now turns that into an error at the moment someone can fix it.
 *
 * Returns null when it worked, or a human-readable reason when it did not. */
async function verifyAccess(propertyId: string): Promise<string | null> {
  const creds = credentials();
  if (!creds) return "unverified: no GOOGLE_SERVICE_ACCOUNT_KEY is configured on this deployment";

  try {
    const { BetaAnalyticsDataClient } = await import("@google-analytics/data");
    const client = new BetaAnalyticsDataClient({ credentials: creds });
    await client.runReport({
      property: `properties/${propertyId}`,
      dateRanges: [{ startDate: "7daysAgo", endDate: "today" }],
      metrics: [{ name: "sessions" }],
      limit: 1,
    });
    return null;
  } catch (err: unknown) {
    const message = String((err as Error)?.message ?? err);
    if (/PERMISSION_DENIED|403/i.test(message)) {
      return `the service account (${creds.client_email}) is not a Viewer on property ${propertyId}. Add it in GA4 → Admin → Property access management, then try again.`;
    }
    if (/NOT_FOUND|404/i.test(message)) {
      return `GA4 has no property ${propertyId}. Check Admin → Property Settings for the numeric Property ID.`;
    }
    return `the GA4 API rejected the request: ${message.slice(0, 200)}`;
  }
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as LinkBody | null;
  const slug = typeof body?.slug === "string" ? body.slug.trim() : "";
  const propertyId = typeof body?.propertyId === "string" ? body.propertyId.trim() : "";

  if (!slug) return NextResponse.json({ error: "Missing store slug." }, { status: 400 });

  const config = await getStoreConfig(slug);
  if (!config) {
    return NextResponse.json(
      { error: `No store "${slug}" has been synced yet. Run an audit for it once, or \`barrel-audit init-store\`, so its config exists.` },
      { status: 404 },
    );
  }

  // Unlink.
  if (!propertyId) {
    const { ga4PropertyId: _removed, ...rest } = config;
    await saveStoreConfig(rest);
    return NextResponse.json({ linked: false });
  }

  if (!PROPERTY_ID.test(propertyId)) {
    return NextResponse.json(
      {
        error: propertyId.startsWith("G-")
          ? `"${propertyId}" is a measurement ID, not a property ID. The one needed here is the number in GA4 → Admin → Property Settings.`
          : `"${propertyId}" is not a GA4 property ID — expected 6-12 digits.`,
      },
      { status: 400 },
    );
  }

  const problem = await verifyAccess(propertyId);
  // An unverifiable *credential* is not a bad property ID, so it saves with a warning rather than
  // being rejected: refusing here would make the form unusable wherever the key is not deployed.
  if (problem && !problem.startsWith("unverified:")) {
    return NextResponse.json({ error: `Could not read that property — ${problem}` }, { status: 400 });
  }

  await saveStoreConfig({ ...config, ga4PropertyId: propertyId });
  return NextResponse.json({
    linked: true,
    propertyId,
    warning: problem ? `Saved, but ${problem.replace(/^unverified: /, "")}. It will be exercised on the next run.` : undefined,
  });
}
