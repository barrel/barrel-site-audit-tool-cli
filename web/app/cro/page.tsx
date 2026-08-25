import Link from "next/link";
import { PageTitle, TopNav } from "@/components/TopNav";
import { getCroIndex, getStores, groupCroByStore } from "@/lib/data";
import { formatDate } from "@/lib/format";
import { CRO_STEP_KEYS, CRO_STEP_LABELS, type CroStepKey } from "@/lib/shared";

export const dynamic = "force-dynamic";

/** How complete an audit is, as a row of step markers.
 *
 * A CRO audit is finished in two passes — a capture run from someone's machine, then Generate here —
 * so "which steps does this one actually have" is the question this list exists to answer. A single
 * date tells you nothing about whether the deck is ready to present. */
function StepDots({ generated }: { generated: CroStepKey[] }) {
  return (
    <div className="flex items-center gap-1">
      {CRO_STEP_KEYS.map((key) => {
        const done = generated.includes(key);
        return (
          <span
            key={key}
            title={`${CRO_STEP_LABELS[key]} — ${done ? "generated" : "not generated"}`}
            className={`w-2 h-2 rounded-full ${done ? "bg-[#10B981]" : "bg-[#E5E5E5]"}`}
          />
        );
      })}
      <span className="ml-1.5 text-[11px] text-[#9A9A9A] tabular-nums">
        {generated.length}/{CRO_STEP_KEYS.length}
      </span>
    </div>
  );
}

export default async function CroIndexPage() {
  const [entries, stores] = await Promise.all([getCroIndex(), getStores()]);
  const groups = groupCroByStore(entries);

  return (
    <div className="min-h-screen bg-[#f9f8f6]">
      <TopNav />
      <PageTitle title="CRO Audits">
        <Link
          href="/cro/run"
          className="text-sm font-semibold text-white bg-[#1A1A1A] hover:bg-black px-3.5 py-2 rounded-lg transition-colors"
        >
          + New CRO audit
        </Link>
      </PageTitle>

      <main className="max-w-[1600px] mx-auto px-6 lg:px-8 py-8">
        <p className="text-sm text-[#6B6B6B] leading-relaxed max-w-[80ch] mb-8">
          A CRO audit is a separate deliverable from a site audit: it reviews the storefront by page
          type at mobile and desktop widths, crosses that with the store&rsquo;s own GA4 data, and
          produces the slides of a client deck rather than a scored report. It runs in two passes — a
          capture from a machine with a browser, then the analytics and key-insights steps from here.
        </p>

        {groups.length === 0 ? (
          <div className="bg-white border border-[#E5E5E5] rounded-lg px-6 py-10 text-center">
            <p className="text-sm text-[#1A1A1A] font-medium">No CRO audits yet.</p>
            <p className="mt-1.5 text-[13px] text-[#6B6B6B] max-w-[60ch] mx-auto leading-relaxed">
              Start one from{" "}
              <Link href="/cro/run" className="text-[#2563EB] hover:underline">
                New CRO audit
              </Link>
              , or run <code className="text-[12px]">pnpm barrel-audit cro &lt;url&gt;</code> in a checkout.
              {stores.length > 0 && ` ${stores.length} store${stores.length === 1 ? "" : "s"} are already set up.`}
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {groups.map((group) => (
              <section key={group.storeSlug} className="bg-white border border-[#E5E5E5] rounded-lg">
                <header className="px-5 py-4 border-b border-[#E5E5E5] flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <div>
                    <h2 className="text-lg font-semibold text-[#000000] tracking-tight">{group.storeName}</h2>
                    <p className="text-[11px] text-[#9A9A9A]">{group.storeUrl}</p>
                  </div>
                  <Link href={`/cro/${group.storeSlug}/brief`} className="text-[13px] text-[#2563EB] hover:underline">
                    CRO brief
                  </Link>
                </header>
                <ul className="divide-y divide-[#f0efed]">
                  {group.reports.map((entry) => (
                    <li key={entry.id}>
                      <Link
                        href={`/cro/${entry.storeSlug}/${entry.id}`}
                        className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-3 hover:bg-[#fafafa] transition-colors"
                      >
                        <span className="text-sm text-[#1A1A1A]">{formatDate(entry.createdAt)}</span>
                        <StepDots generated={entry.stepsGenerated} />
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
