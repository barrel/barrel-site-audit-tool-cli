import { NextRequest, NextResponse } from "next/server";
import { getCroEdits, getCroReport, saveCroEdits } from "@/lib/data";
import { getLabsSession } from "@/lib/labs-session";
import type { CroBulletEdit, CroEdits } from "@/lib/shared";
import { MAX_CARD_DESCRIPTION_CHARS, MAX_TITLE_CHARS, bulletShapeProblem, INSIGHT_CARD_LIMITS } from "@/lib/cro-slides";

export const dynamic = "force-dynamic";

interface EditBody {
  slug?: string;
  id?: string;
  bulletId?: string;
  title?: string;
  description?: string;
  hidden?: boolean;
  /** Restores a bullet a previous edit had hidden, and drops any text override with it. */
  reset?: boolean;
}

/** Saves one strategist correction as an overlay entry.
 *
 * Never touches the generated report. That blob is the record of what the tool concluded, and by
 * the time anyone is editing it, it may already have been shared with a client — so the edit lands
 * beside it and the two are composed at render time. See composeSlides() in lib/cro-slides.ts.
 *
 * One bullet per request rather than a whole-report save: the report page edits in place, and a
 * whole-document PUT from two open tabs would silently discard one of them. */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as EditBody | null;
  const slug = typeof body?.slug === "string" ? body.slug.trim() : "";
  const id = typeof body?.id === "string" ? body.id.trim() : "";
  const bulletId = typeof body?.bulletId === "string" ? body.bulletId.trim() : "";
  if (!slug || !id || !bulletId) {
    return NextResponse.json({ error: "Missing store slug, audit id, or bullet id." }, { status: 400 });
  }

  // The audit has to exist before an edit against it can be stored: an overlay for a report nobody
  // can open is an orphan blob that will never be read or cleaned up.
  const report = await getCroReport(slug, id);
  if (!report) return NextResponse.json({ error: `No CRO audit ${id} for store "${slug}".` }, { status: 404 });

  const title = typeof body?.title === "string" ? body.title.trim() : undefined;
  const description = typeof body?.description === "string" ? body.description.trim() : undefined;

  // A human edit is held to the shape rules a generated bullet is, minus the evidence and figure
  // checks — a strategist is allowed to write a sentence the model could not have supported,
  // because they know something the capture did not. What they are not allowed to do is break the
  // deck's format, which is what the rest of this feature exists to guarantee. The looser card
  // limits apply throughout: which slide a bullet is on is not worth threading through for the
  // sake of holding a hand edit to a stricter line than the one it will be printed at.
  if (title !== undefined || description !== undefined) {
    const existing = findBullet(report, bulletId);
    const problem = bulletShapeProblem(
      title ?? existing?.title ?? "",
      description ?? existing?.description ?? "",
      INSIGHT_CARD_LIMITS,
    );
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });
    if ((title?.length ?? 0) > MAX_TITLE_CHARS || (description?.length ?? 0) > MAX_CARD_DESCRIPTION_CHARS) {
      return NextResponse.json({ error: "That edit is longer than a slide can hold." }, { status: 400 });
    }
  }

  const session = await getLabsSession();
  const existing = await getCroEdits(slug, id);
  const bullets = { ...(existing?.bullets ?? {}) };

  if (body?.reset) {
    delete bullets[bulletId];
  } else {
    const entry: CroBulletEdit = { updatedAt: new Date().toISOString() };
    if (title) entry.title = title;
    if (description) entry.description = description;
    if (body?.hidden !== undefined) entry.hidden = body.hidden;
    // Merged over whatever was there: hiding a bullet must not discard the wording someone had
    // already corrected, since unhiding is meant to bring it back as they left it.
    bullets[bulletId] = { ...(bullets[bulletId] ?? {}), ...entry };
  }

  const edits: CroEdits = {
    croId: id,
    storeSlug: slug,
    updatedAt: new Date().toISOString(),
    editedBy: session?.email,
    bullets,
  };
  await saveCroEdits(edits);

  return NextResponse.json({ edits });
}

function findBullet(report: Awaited<ReturnType<typeof getCroReport>>, bulletId: string) {
  for (const step of Object.values(report?.steps ?? {})) {
    for (const slide of step?.slides ?? []) {
      const found = slide.bullets.find((b) => b.id === bulletId);
      if (found) return found;
    }
  }
  return undefined;
}
