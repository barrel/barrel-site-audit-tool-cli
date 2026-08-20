import { NextRequest, NextResponse } from "next/server";
import { getDataAnalysis, getReport, getStoreConfig, saveDataAnalysis } from "@/lib/data";
import { fetchConversionDataset } from "@/lib/ga4";
import { generateDataAnalysis } from "@/lib/data-analysis";
import { collectAllFindings } from "@/lib/findings";

export const dynamic = "force-dynamic";

/** Generating is a request-time model call over a whole report and 28 days of GA4 — comfortably
 * past the default serverless ceiling on a slow run. */
export const maxDuration = 300;

interface GenerateBody {
  slug?: string;
  id?: string;
}

/** Every failure here returns a message written for the person who pressed the button, naming the
 * thing they can go and change. "Failed to generate" sends someone to the wrong place, or nowhere.
 *
 * Nothing is written to Blob on any of these paths except the insufficient-data verdict, which is
 * a real conclusion about the data rather than a failure — a partially-generated analysis in
 * storage is indistinguishable from a complete one the next time the page loads. */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as GenerateBody | null;
  const slug = typeof body?.slug === "string" ? body.slug.trim() : "";
  const id = typeof body?.id === "string" ? body.id.trim() : "";
  if (!slug || !id) return NextResponse.json({ error: "Missing store slug or report id." }, { status: 400 });

  const [report, config] = await Promise.all([getReport(slug, id), getStoreConfig(slug)]);
  if (!report) return NextResponse.json({ error: `No report ${id} for store "${slug}".` }, { status: 404 });

  const propertyId = config?.ga4PropertyId;
  if (!propertyId) {
    return NextResponse.json(
      {
        error:
          "No GA4 property is linked to this store, so there is no data to analyse. Link one from the Run Audit page first.",
      },
      { status: 400 },
    );
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "No ANTHROPIC_API_KEY is configured on this deployment, so the analysis cannot be generated." },
      { status: 500 },
    );
  }

  const ga4 = await fetchConversionDataset(propertyId);
  if (!ga4.ok) {
    // A GA4 failure is reported as itself and stops here. Falling back to "analyse the audit
    // alone" would produce a page that looks like a data analysis and contains no data.
    return NextResponse.json({ error: ga4.message, reason: ga4.reason }, { status: 502 });
  }

  try {
    const analysis = await generateDataAnalysis({
      storeSlug: slug,
      storeName: report.storeName,
      reportId: id,
      dataset: ga4.dataset,
      findings: collectAllFindings(report),
      // The section keys actually present on this report. A recommendation may only point at a
      // section the reader can go and open; one pointing at a section this run skipped is a dead
      // link dressed as a cross-reference.
      availableSections: Object.keys(report.sections),
    });
    await saveDataAnalysis(analysis);
    return NextResponse.json({ analysis });
  } catch (err: unknown) {
    const message = String((err as Error)?.message ?? err);
    return NextResponse.json({ error: `The analysis could not be generated: ${message.slice(0, 300)}` }, { status: 502 });
  }
}

/** Reading back an already-generated analysis. The tab renders server-side from the same blob, so
 * this exists for the client component to refresh itself after a generate without a full
 * navigation. */
export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("slug")?.trim() ?? "";
  const id = req.nextUrl.searchParams.get("id")?.trim() ?? "";
  if (!slug || !id) return NextResponse.json({ error: "Missing store slug or report id." }, { status: 400 });
  return NextResponse.json({ analysis: await getDataAnalysis(slug, id) });
}
