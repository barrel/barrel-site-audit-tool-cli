import { PageTitle, TopNav } from "@/components/TopNav";
import { RunAuditForm } from "@/components/RunAuditForm";

export const dynamic = "force-dynamic";

export default function RunAuditPage() {
  // Whether this instance can run anything itself. The audit spawns the CLI as a local process, so
  // on the deployed site it can only ever refuse — see /api/run.
  const local = !process.env.VERCEL;

  return (
    <div className="min-h-screen bg-[#f9f8f6]">
      <TopNav />
      <PageTitle title="Run Audit" />

      <main className="max-w-[900px] mx-auto px-5 lg:px-8 py-8 space-y-5">
        <div className="bg-white border border-[#E5E5E5] rounded-lg px-5 py-4">
          <h2 className="text-sm font-semibold text-[#1A1A1A]">What needs the CLI, and what doesn&apos;t</h2>
          <p className="mt-1.5 text-sm text-[#6B6B6B] leading-relaxed max-w-[80ch]">
            Checks marked{" "}
            <span className="text-[9px] font-semibold uppercase tracking-wider text-[#10B981] bg-[#10B98114] px-1.5 py-0.5 rounded align-middle">
              Online
            </span>{" "}
            read HTTP responses only — no browser, no theme code — so they can run without a machine running the CLI.
            Everything else drives a real Chrome or reads the theme from disk: Lighthouse, axe, the pixel and consent
            checks, UX, screenshots and the theme code checks all need the CLI, and an online run would simply leave
            those sections out.
          </p>
          <p className="mt-2 text-sm text-[#6B6B6B] leading-relaxed max-w-[80ch]">
            That is the trade to know before choosing: an online run is quick and needs nothing installed, but it
            cannot answer the questions that require watching a browser — whether a pixel actually stops when a
            visitor opts out, or what the site scores on mobile.
          </p>
          {!local && (
            <p className="mt-2.5 text-sm text-[#D97706] leading-relaxed max-w-[80ch]">
              This deployed instance cannot start a run of either kind yet — the audit spawns the CLI as a local
              process, so it only works against a local <code className="font-mono text-xs">pnpm dev</code>. The
              markings above describe which checks <em>could</em> run online once that path is wired up.
            </p>
          )}
        </div>

        <RunAuditForm />
      </main>
    </div>
  );
}
