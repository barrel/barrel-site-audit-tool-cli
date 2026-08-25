import Link from "next/link";
import { notFound } from "next/navigation";
import { PageTitle, TopNav } from "@/components/TopNav";
import { CroBriefForm } from "@/components/CroBriefForm";
import { getCroIndex, getStoreConfig } from "@/lib/data";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

/** Step 0 of the CRO audit process — the intake.
 *
 * A page rather than a set of fields on the run form, because it is answered once per client and
 * reused by every audit after that. Putting it on the run form would mean re-typing three
 * competitors and a positioning note every quarter, which is exactly the sort of friction that ends
 * with the benchmark step being skipped. */
export default async function CroBriefPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [config, index] = await Promise.all([getStoreConfig(slug), getCroIndex()]);
  if (!config) notFound();

  const audits = index.filter((e) => e.storeSlug === slug && !e.archived);

  return (
    <div className="min-h-screen bg-[#f9f8f6]">
      <TopNav />
      <PageTitle title={`CRO brief — ${config.name}`}>
        <Link href="/cro" className="text-sm text-[#6B6B6B] hover:text-[#1A1A1A]">
          ← All CRO audits
        </Link>
      </PageTitle>

      <main className="max-w-[820px] mx-auto px-5 lg:px-8 py-8">
        <p className="text-sm text-[#6B6B6B] leading-relaxed mb-6">
          What this client&rsquo;s CRO audits are run against. Saved on the store, so every future
          audit reuses it — and each audit keeps a copy of the brief it was actually run with, so
          editing this never changes what a past deck was based on.
        </p>

        <CroBriefForm slug={slug} brief={config.croBrief ?? {}} ga4Linked={Boolean(config.ga4PropertyId)} />

        {audits.length > 0 && (
          <section className="mt-8">
            <h2 className="text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-wider mb-2">
              Audits run for this store
            </h2>
            <ul className="bg-white border border-[#E5E5E5] rounded-lg divide-y divide-[#f0efed]">
              {audits.map((entry) => (
                <li key={entry.id}>
                  <Link
                    href={`/cro/${slug}/${entry.id}`}
                    className="flex items-center justify-between px-5 py-3 hover:bg-[#fafafa] transition-colors"
                  >
                    <span className="text-sm text-[#1A1A1A]">{formatDate(entry.createdAt)}</span>
                    <span className="text-[11px] text-[#9A9A9A] tabular-nums">
                      {entry.stepsGenerated.length} step{entry.stepsGenerated.length === 1 ? "" : "s"} generated
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}
