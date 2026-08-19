import Link from "next/link";
import { BulkConsentForm } from "@/components/BulkConsentForm";

export const dynamic = "force-dynamic";

export default function BulkConsentRunPage() {
  // Bulk scanning drives a real headless Chrome, which only exists on the machine running
  // `pnpm dev`. Rather than render a button whose only possible outcome on the deployed site is
  // an error, the form becomes a command builder there — you still paste the list, you just get
  // a command to run instead of a run.
  const local = !process.env.VERCEL;

  return (
    <div className="min-h-screen bg-[#f9f8f6]">
      <header className="bg-white h-[73px] border-b border-[#E5E5E5] flex items-center px-6 lg:px-8">
        <div className="max-w-[1100px] w-full mx-auto flex items-center justify-between">
          <h1 className="text-2xl font-semibold text-[#1A1A1A] tracking-tight">Bulk privacy scan</h1>
          <Link href="/consent" className="text-sm font-medium text-[#1A1A1A] hover:text-[#6B6B6B]">
            All sites
          </Link>
        </div>
      </header>

      <main className="max-w-[1100px] mx-auto px-6 lg:px-8 py-8 space-y-5">
        <p className="text-sm text-[#6B6B6B] max-w-[80ch] leading-relaxed">
          Scans any set of sites for consent behaviour, independently of the per-store audit. Each site is driven
          through five browser states — no choice, reject, accept, analytics-only and returning visitor — in its own
          fresh incognito browser. Results publish to the{" "}
          <Link href="/consent" className="text-[#1A1A1A] font-medium hover:underline">
            Privacy Compliance
          </Link>{" "}
          dashboard the moment the scan finishes, and every site gets its own printable report.
        </p>

        <BulkConsentForm local={local} />

        <p className="text-xs text-[#9A9A9A] max-w-[80ch] leading-relaxed">
          Sites are scanned concurrently; raising concurrency past what the machine can comfortably run means several
          headless Chromes competing for the same cores, which makes every site slower rather than the batch faster.
          Results publish to Blob as soon as the scan finishes, so they appear on the deployed dashboard too — it is
          only the <em>running</em> that has to happen locally.
        </p>
      </main>
    </div>
  );
}
