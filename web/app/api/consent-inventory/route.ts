import { NextRequest } from "next/server";

import { getConsentSiteDetail } from "@/lib/data";
import { isLabsAdmin } from "@/lib/labs-session";
import { toCsv } from "@/lib/consent-inventory-csv";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!(await isLabsAdmin())) {
    return new Response("Not authorised.", { status: 403 });
  }

  const scanId = request.nextUrl.searchParams.get("scan");
  const slug = request.nextUrl.searchParams.get("slug");
  if (!scanId || !slug) {
    return new Response("Both `scan` and `slug` are required.", { status: 400 });
  }

  const section = await getConsentSiteDetail(scanId, slug);
  if (!section) {
    return new Response("No stored detail for that scan and site.", { status: 404 });
  }
  if (!section.inventory) {
    return new Response(
      "That scan has no vendor inventory. Scans archived before the inventory existed, and runs made with --no-tag-inventory, don't carry one — re-scan the site to produce it.",
      { status: 404 },
    );
  }

  const label = request.nextUrl.searchParams.get("label") ?? slug;
  const csv = toCsv(section.inventory, label, scanId);

  // The BOM is what makes Excel open a UTF-8 CSV correctly; without it the em-dashes and arrows
  // this report uses in its own prose arrive mangled, which reads as a broken export.
  return new Response(`\ufeff${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${slug}-cookie-inventory.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
