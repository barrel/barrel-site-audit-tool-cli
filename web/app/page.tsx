import Link from "next/link";
import { getManifest, searchAndPaginate } from "@/lib/data";
import { formatDate } from "@/lib/format";
import { ScoreBadge, GradePill } from "@/components/ScoreBadge";
import { SiteFavicon } from "@/components/SiteFavicon";

export const dynamic = "force-dynamic";

function pageHref(q: string | undefined, page: number): string {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs ? `/?${qs}` : "/";
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const { q, page } = await searchParams;
  const manifest = await getManifest();
  const result = searchAndPaginate(manifest, q, Number(page) || 1);

  return (
    <div className="min-h-screen bg-[#f9f8f6]">
      <header className="bg-white h-[73px] border-b border-[#E5E5E5] flex items-center px-6 lg:px-8">
        <div className="max-w-[1600px] w-full mx-auto flex items-center justify-between">
          <h1 className="text-2xl font-semibold text-[#1A1A1A] tracking-tight">Barrel Site Audit</h1>
          <div className="flex items-center gap-4">
            <Link href="/progress" className="text-sm font-medium text-[#1A1A1A] hover:text-[#6B6B6B]">
              Progress
            </Link>
            <Link
              href="/run"
              className="text-sm font-semibold text-white bg-[#1A1A1A] hover:bg-black px-3.5 py-2 rounded-lg transition-colors"
            >
              + Run Audit
            </Link>
            <Link
              href="/instructions"
              className="text-sm font-medium text-[#1A1A1A] bg-[#f0efed] hover:bg-[#EDECE8] px-3.5 py-2 rounded-lg transition-colors"
            >
              CLI Instructions
            </Link>
            <form action="/api/logout" method="POST">
              <button type="submit" className="text-sm text-[#6B6B6B] hover:text-[#1A1A1A]">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto px-5 lg:px-8 py-8">
        <form action="/" method="GET" className="mb-5">
          <input
            type="search"
            name="q"
            defaultValue={q ?? ""}
            placeholder="Search reports by store name or URL…"
            className="w-full max-w-md rounded-lg border border-[#E5E5E5] bg-white px-3 py-2 text-sm text-[#1A1A1A] placeholder:text-[#9A9A9A] focus:outline-none focus:ring-2 focus:ring-[#1A1A1A]/10 focus:border-[#1A1A1A]"
          />
        </form>

        {result.total === 0 ? (
          <div className="bg-white border border-[#E5E5E5] rounded-lg px-6 py-10 text-center">
            <p className="text-sm text-[#6B6B6B]">
              {q ? (
                <>No reports match "{q}".</>
              ) : (
                <>
                  No reports yet. Run{" "}
                  <code className="bg-[#fafafa] px-1.5 py-0.5 rounded text-[#1A1A1A]">
                    pnpm barrel-audit run &lt;store-slug-or-url&gt;
                  </code>{" "}
                  from the CLI — new reports appear here immediately, no redeploy needed.
                </>
              )}
            </p>
          </div>
        ) : (
          <>
            <div className="bg-white border border-[#E5E5E5] rounded-lg overflow-hidden divide-y divide-[#E5E5E5]">
              {result.items.map((r) => (
                <Link
                  key={r.id}
                  href={`/reports/${r.storeSlug}/${r.id}`}
                  className="flex items-center gap-4 px-5 py-3 hover:bg-[#fafafa] transition-colors"
                >
                  <ScoreBadge score={r.overallScore} size="sm" />
                  <SiteFavicon storeUrl={r.storeUrl} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-[#000000] break-words">{r.storeName}</div>
                    <div className="text-sm text-[#6B6B6B] break-all">{r.storeUrl}</div>
                  </div>
                  <div className="text-[10px] text-[#9A9A9A] shrink-0 tabular-nums">{formatDate(r.createdAt)}</div>
                  <GradePill score={r.overallScore} />
                </Link>
              ))}
            </div>

            <div className="flex items-center justify-between mt-4 text-sm">
              <span className="text-[#6B6B6B]">
                Page {result.page} of {result.totalPages} · {result.total} report{result.total === 1 ? "" : "s"}
              </span>
              <div className="flex items-center gap-2">
                {result.page > 1 ? (
                  <Link
                    href={pageHref(q, result.page - 1)}
                    className="px-3 py-1.5 rounded-lg border border-[#E5E5E5] bg-white text-[#1A1A1A] hover:bg-[#fafafa]"
                  >
                    Prev
                  </Link>
                ) : (
                  <span className="px-3 py-1.5 rounded-lg border border-[#E5E5E5] text-[#D4D4D4]">Prev</span>
                )}
                {result.page < result.totalPages ? (
                  <Link
                    href={pageHref(q, result.page + 1)}
                    className="px-3 py-1.5 rounded-lg border border-[#E5E5E5] bg-white text-[#1A1A1A] hover:bg-[#fafafa]"
                  >
                    Next
                  </Link>
                ) : (
                  <span className="px-3 py-1.5 rounded-lg border border-[#E5E5E5] text-[#D4D4D4]">Next</span>
                )}
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
