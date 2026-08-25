import { NextRequest, NextResponse } from "next/server";
import { getStoreConfig, saveStoreConfig } from "@/lib/data";
import type { CroBrief, CroDataSource } from "@/lib/shared";

export const dynamic = "force-dynamic";

const MAX_COMPETITORS = 3;
const MAX_TEXT_CHARS = 4000;

const DATA_SOURCES: CroDataSource[] = [
  "ga4",
  "shopify-analytics",
  "hotjar",
  "clarity",
  "quantum-metric",
  "reviews-platform",
  "survey",
];

interface BriefBody {
  slug?: string;
  competitorUrls?: string[];
  reviewsUrl?: string;
  dataSources?: string[];
  subscription?: boolean;
  giftCards?: boolean;
  positioning?: string;
  hypotheses?: string;
}

/** A bare hostname is accepted and https:// is assumed — "glossier.com" is what someone types.
 *
 * The catch is there so a bad value is named. `new URL()` throws "Invalid URL", which tells whoever
 * typed it nothing about which of three competitor fields it came from or what was wrong with it. */
function validateUrl(value: string, label: string): string {
  const trimmed = value.trim();
  const withScheme = trimmed.includes("://") ? trimmed : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw new Error(`${label} is not a web address: "${trimmed}". A hostname like client.com is enough.`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${label} must be an http(s) address, not ${parsed.protocol.replace(":", "")}.`);
  }
  return parsed.toString().replace(/\/$/, "");
}

function text(value: unknown, label: string): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > MAX_TEXT_CHARS) {
    throw new Error(`${label} is ${trimmed.length} characters, past the ${MAX_TEXT_CHARS}-character limit.`);
  }
  return trimmed;
}

/** Saves Step 0 of the CRO audit onto the store's config.
 *
 * On the store rather than on a report because it describes the client, not one audit of them — and
 * a second CRO audit next quarter should not need the competitors re-typed. Each report copies the
 * brief it was run against, so editing this never rewrites what a past audit was based on. */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as BriefBody | null;
  const slug = typeof body?.slug === "string" ? body.slug.trim() : "";
  if (!slug) return NextResponse.json({ error: "Missing store slug." }, { status: 400 });

  const config = await getStoreConfig(slug);
  if (!config) {
    return NextResponse.json(
      {
        error: `No store "${slug}" has been synced yet. Run an audit for it once, or \`barrel-audit init-store\`, so its config exists.`,
      },
      { status: 404 },
    );
  }

  let brief: CroBrief;
  try {
    const competitors = (body?.competitorUrls ?? [])
      .filter((c): c is string => typeof c === "string" && c.trim().length > 0)
      .map((c, i) => validateUrl(c, `Competitor ${i + 1}`));
    if (competitors.length > MAX_COMPETITORS) {
      return NextResponse.json(
        {
          error: `At most ${MAX_COMPETITORS} competitors — each one is a full capture sweep of their storefront, at the same cost as the client's own.`,
        },
        { status: 400 },
      );
    }

    brief = {
      // Preserved rather than rebuilt: pageUrls is set from the CLI and has no field on this form,
      // and a save from the dashboard must not silently drop it.
      ...(config.croBrief ?? {}),
      competitorUrls: competitors.length > 0 ? competitors : undefined,
      reviewsUrl: body?.reviewsUrl?.trim() ? validateUrl(body.reviewsUrl, "The reviews URL") : undefined,
      dataSources: (body?.dataSources ?? []).filter((s): s is CroDataSource => DATA_SOURCES.includes(s as CroDataSource)),
      subscription: Boolean(body?.subscription),
      giftCards: Boolean(body?.giftCards),
      positioning: text(body?.positioning, "The positioning note"),
      hypotheses: text(body?.hypotheses, "The hypotheses note"),
    };
  } catch (err: unknown) {
    return NextResponse.json({ error: String((err as Error)?.message ?? err) }, { status: 400 });
  }

  await saveStoreConfig({ ...config, croBrief: brief });
  return NextResponse.json({ brief });
}
