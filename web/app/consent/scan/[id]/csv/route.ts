import { getConsentScan } from "@/lib/data";
import { fleetToCsv } from "@/lib/consent-fleet";
import { isLabsAdmin } from "@/lib/labs-session";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isLabsAdmin())) return new Response("Not authorised.", { status: 403 });

  const { id } = await params;
  const report = await getConsentScan(id);
  if (!report) return new Response("No such scan.", { status: 404 });

  // BOM so Excel reads the UTF-8 correctly — see the inventory export.
  return new Response(`\ufeff${fleetToCsv(report)}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="privacy-compliance-${report.createdAt.slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
