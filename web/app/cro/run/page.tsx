import Link from "next/link";
import { PageTitle, TopNav } from "@/components/TopNav";
import { CroRunForm } from "@/components/CroRunForm";
import { getStoreConfig, getStores } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function CroRunPage() {
  const stores = await getStores();
  // The brief and the GA4 link both change what a capture will do, so they are read here rather
  // than discovered after the run: which product page gets reviewed, and whether there is a
  // benchmark at all, are decisions worth showing before someone spends ten minutes on it.
  const configs = await Promise.all(stores.map((s) => getStoreConfig(s.slug)));

  return (
    <div className="min-h-screen bg-[#f9f8f6]">
      <TopNav />
      <PageTitle title="New CRO audit">
        <Link href="/cro" className="text-sm text-[#6B6B6B] hover:text-[#1A1A1A]">
          ← All CRO audits
        </Link>
      </PageTitle>

      <main className="max-w-[900px] mx-auto px-5 lg:px-8 py-8">
        <p className="text-sm text-[#6B6B6B] leading-relaxed max-w-[80ch] mb-6">
          A CRO audit runs in two passes. This page does the first: a real browser walks each page
          type at each device width, screenshots it, and records the DOM signals and fold
          measurements behind every finding — then writes the UX and competitive-benchmark slides
          from them. The second pass is a button on the finished audit, and runs here on the server:
          the analytics step from the store&rsquo;s GA4 property, and the key insights across
          everything.
        </p>

        <CroRunForm
          stores={stores.map((store, i) => ({
            slug: store.slug,
            name: store.name,
            url: store.url,
            brief: configs[i]?.croBrief,
            ga4: Boolean(configs[i]?.ga4PropertyId),
          }))}
          deployed={Boolean(process.env.VERCEL)}
        />
      </main>
    </div>
  );
}
