import { NextRequest, NextResponse } from "next/server";
import { croIndexEntry, getCroReport, getStoreConfig, saveCroIndexEntry, saveCroReport } from "@/lib/data";
import { fetchCroDataset } from "@/lib/ga4";
import { generateCroAnalytics } from "@/lib/cro-analytics";
import { generateCroInsights } from "@/lib/cro-insights";
import { getLabsSession } from "@/lib/labs-session";
import type { AiUsage, CroReport, CroStepKey } from "@/lib/shared";

export const dynamic = "force-dynamic";

/** Two model calls over a whole audit plus nine GA4 queries — comfortably past the default
 * serverless ceiling on a slow run. Same ceiling as the Data Analysis route, for the same reason. */
export const maxDuration = 300;

/** The steps this route can produce: the ones that need no browser.
 *
 * That division is the whole shape of this feature. A capture run (the CLI, locally or through the
 * local agent) does everything that needs Chrome; this route does everything that needs an API and
 * a model. Anyone with a linked GA4 property can get the analytics step with no CLI at all. */
const APP_STEPS: CroStepKey[] = ["analytics", "insights"];

interface GenerateBody {
  slug?: string;
  id?: string;
  /** Which steps to (re)generate. Defaults to both. */
  steps?: CroStepKey[];
}

function addUsage(a: AiUsage | undefined, b: AiUsage | undefined): AiUsage | undefined {
  if (!a) return b;
  if (!b) return a;
  const inputTokens = a.inputTokens + b.inputTokens;
  const outputTokens = a.outputTokens + b.outputTokens;
  return {
    model: a.model,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    estimatedCostUsd: a.estimatedCostUsd + b.estimatedCostUsd,
  };
}

/** Every failure here returns a message written for the person who pressed the button, naming the
 * thing they can go and change. "Failed to generate" sends someone to the wrong place, or nowhere.
 *
 * Nothing is written unless a step actually produced something — including the insufficient-data
 * verdict, which is a real conclusion about the data rather than a failure. A half-written step in
 * storage is indistinguishable from a complete one the next time the page loads. */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as GenerateBody | null;
  const slug = typeof body?.slug === "string" ? body.slug.trim() : "";
  const id = typeof body?.id === "string" ? body.id.trim() : "";
  if (!slug || !id) return NextResponse.json({ error: "Missing store slug or CRO audit id." }, { status: 400 });

  const requested = (Array.isArray(body?.steps) ? body.steps : APP_STEPS).filter((s): s is CroStepKey =>
    APP_STEPS.includes(s as CroStepKey),
  );
  if (requested.length === 0) {
    return NextResponse.json(
      {
        error:
          "Only the analytics and key-insights steps can be generated here — the rest need a browser, so they come from a capture run.",
      },
      { status: 400 },
    );
  }

  const [report, config] = await Promise.all([getCroReport(slug, id), getStoreConfig(slug)]);
  if (!report) return NextResponse.json({ error: `No CRO audit ${id} for store "${slug}".` }, { status: 404 });

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "No ANTHROPIC_API_KEY is configured on this deployment, so nothing can be written." },
      { status: 500 },
    );
  }

  const next: CroReport = { ...report, steps: { ...report.steps } };
  let usage: AiUsage | undefined = report.aiUsage;

  if (requested.includes("analytics")) {
    const propertyId = config?.ga4PropertyId;
    if (!propertyId) {
      return NextResponse.json(
        {
          error:
            "No GA4 property is linked to this store, so there is no traffic data to analyse. Link one from the Run Audit page first.",
        },
        { status: 400 },
      );
    }

    const ga4 = await fetchCroDataset(propertyId);
    if (!ga4.ok) {
      // Reported as itself and stopped here. Falling back to "write the step from the audit alone"
      // would produce a page that looks like an analytics section and contains no analytics.
      return NextResponse.json({ error: ga4.message, reason: ga4.reason }, { status: 502 });
    }

    try {
      const step = await generateCroAnalytics({ dataset: ga4.dataset, storeName: report.storeName });
      next.steps.analytics = step;
      usage = addUsage(usage, step.aiUsage);
    } catch (err: unknown) {
      return NextResponse.json({ error: String((err as Error)?.message ?? err).slice(0, 300) }, { status: 502 });
    }
  }

  // Always after analytics, and always over the report as it now stands rather than the one that
  // was loaded: Key Insights is a synthesis, and synthesising over a stale copy would silently
  // exclude the step generated a second earlier in this same request.
  if (requested.includes("insights")) {
    try {
      const step = await generateCroInsights({ report: next });
      next.steps.insights = step;
      usage = addUsage(usage, step.aiUsage);
    } catch (err: unknown) {
      return NextResponse.json({ error: String((err as Error)?.message ?? err).slice(0, 300) }, { status: 502 });
    }
  }

  next.aiUsage = usage;

  const session = await getLabsSession();
  if (session?.email) next.generatedBy = session.email;

  await saveCroReport(next);
  // The list page reads completeness off the index, so it has to be rewritten too — otherwise a
  // report shows as capture-only forever after its analytics step was generated.
  await saveCroIndexEntry(croIndexEntry(next));

  return NextResponse.json({ report: next });
}
