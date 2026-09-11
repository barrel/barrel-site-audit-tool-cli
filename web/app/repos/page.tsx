import { PageTitle, TopNav } from "@/components/TopNav";
import { GithubRepoPicker, type PickerStore } from "@/components/GithubRepoPicker";
import { getStoreConfig, getStores } from "@/lib/data";

export const dynamic = "force-dynamic";

/** The GitHub connector.
 *
 * Reads each store's config so the picker can show what is already connected before anyone
 * changes it — and never cached, because connecting a repo is supposed to change this page on the
 * next load. Capped at the same 60 stores the Run Audit form reads, for the same reason: one Blob
 * read per store. */
export default async function ReposPage() {
  const stores = await getStores();
  const withConfig: PickerStore[] = await Promise.all(
    stores.slice(0, 60).map(async (st) => {
      const config = await getStoreConfig(st.slug);
      return {
        slug: st.slug,
        name: st.name,
        url: st.url,
        githubRepo: config?.githubRepo,
        githubBranch: config?.githubBranch,
        githubMode: config?.githubMode,
        themeSubdir: config?.themeSubdir,
        githubConnectedAt: config?.githubConnectedAt,
        githubConnectedBy: config?.githubConnectedBy,
      };
    }),
  );

  const connected = withConfig.filter((s) => s.githubRepo);

  return (
    <div className="min-h-screen bg-[#f9f8f6]">
      <TopNav />
      <PageTitle title="Theme Repos" />

      <main className="max-w-[900px] mx-auto px-5 lg:px-8 py-8 space-y-5">
        <div className="bg-white border border-[#E5E5E5] rounded-lg px-5 py-4">
          <h2 className="text-sm font-semibold text-[#1A1A1A]">What this does</h2>
          <p className="mt-1.5 text-sm text-[#6B6B6B] leading-relaxed max-w-[80ch]">
            Points a store&apos;s audit at the repository its theme code actually lives in, so the Theme Code,
            Theme Structure and Theme Architecture sections of a report have something to read. It is the
            alternative to pulling the live theme out of Shopify — and the better one when the client&apos;s
            code is in GitHub, because it can read the branch that is about to ship rather than the one that
            already has.
          </p>
          <p className="mt-2 text-sm text-[#6B6B6B] leading-relaxed max-w-[80ch]">
            Two ways to read it. <strong className="font-semibold text-[#1A1A1A]">Read from GitHub each run</strong>{" "}
            keeps nothing: the audit downloads the branch, reads it, deletes it — so every report reflects the
            code as it is today, and no client code sits on anyone&apos;s laptop. <strong className="font-semibold text-[#1A1A1A]">Pull a copy</strong>{" "}
            clones once into your own <code className="bg-[#fafafa] px-1 rounded font-mono text-xs">stores/</code> folder,
            which is what you want if you plan to read the code yourself or audit offline.
          </p>
          <p className="mt-2 text-sm text-[#6B6B6B] leading-relaxed max-w-[80ch]">
            Either way this is read access. Nothing here commits, pushes, branches or opens anything on
            GitHub. The one thing in this tool that writes to a repo is the &ldquo;Suggest fix&rdquo; pull request on a
            report&apos;s Dev To-Do, which runs from your own machine and asks for confirmation at every step.
          </p>
        </div>

        <GithubRepoPicker stores={withConfig} />

        {connected.length > 0 && (
          <div className="bg-white border border-[#E5E5E5] rounded-lg overflow-hidden">
            <div className="px-5 py-3 border-b border-[#E5E5E5]">
              <h2 className="text-sm font-semibold text-[#1A1A1A]">
                Connected stores <span className="text-[#9A9A9A] font-normal">({connected.length})</span>
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-[#fafafa]">
                  <tr className="text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-wider">
                    <th className="text-left px-5 py-2">Store</th>
                    <th className="text-left px-5 py-2">Repository</th>
                    <th className="text-left px-5 py-2">Branch</th>
                    <th className="text-left px-5 py-2">Mode</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5E5E5]">
                  {connected.map((s) => (
                    <tr key={s.slug} className="hover:bg-[#fafafa]">
                      <td className="px-5 py-2.5 text-[#1A1A1A]">{s.name}</td>
                      <td className="px-5 py-2.5">
                        <a
                          href={`https://github.com/${s.githubRepo}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[#2563EB] hover:underline"
                        >
                          {s.githubRepo}
                        </a>
                        {s.themeSubdir && <span className="text-[10px] text-[#9A9A9A]"> · {s.themeSubdir}/</span>}
                      </td>
                      <td className="px-5 py-2.5 text-[#6B6B6B] font-mono text-xs">{s.githubBranch ?? "default"}</td>
                      <td className="px-5 py-2.5 text-[#6B6B6B]">
                        {s.githubMode === "pull" ? "Pulled to disk" : "Read each run"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
