import Link from "next/link";

import { TopNav } from "@/components/TopNav";

/** What a signed-in member sees where an admin would see Privacy Compliance.
 *
 * Deliberately not a 404. The person is a colleague with a valid Barrel Labs session who followed a
 * real link; telling them the page does not exist would send them to debug a broken tool. Naming
 * the gate and who lifts it is the shorter path to whatever they actually needed. */
export function AdminsOnlyScreen({ what = "This page" }: { what?: string }) {
  return (
    <div className="min-h-screen bg-[#f9f8f6]">
      <TopNav />
      <AdminsOnly what={what} />
    </div>
  );
}

function AdminsOnly({ what }: { what: string }) {
  return (
    <div className="max-w-[1100px] mx-auto px-6 lg:px-8 py-12">
      <div className="bg-white border border-[#E5E5E5] rounded-lg p-8 max-w-[70ch]">
        <div className="text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-wider">
          Admins only
        </div>
        <h2 className="mt-2 text-lg font-semibold text-[#000000] tracking-tight">
          {what} is limited to Barrel Labs admins.
        </h2>
        <p className="mt-3 text-sm text-[#6B6B6B] leading-relaxed">
          Privacy Compliance is a standing record of where client sites are, today, setting tracking
          cookies before a visitor has consented. That is a live legal exposure list covering people
          who are our clients, so it is kept to the group who would be handling it.
        </p>
        <p className="mt-3 text-sm text-[#6B6B6B] leading-relaxed">
          If you need it, ask a Barrel Labs admin in <span className="font-medium text-[#1A1A1A]">#barrel</span> —
          the fix is an admin grant in Barrel Labs, not a change to this tool. Everything else here,
          including every store&apos;s audit report, is already open to you.
        </p>
        <div className="mt-6 flex items-center gap-3">
          <Link
            href="/"
            className="text-sm font-semibold text-white bg-[#1A1A1A] hover:bg-black px-3.5 py-2 rounded-lg transition-colors"
          >
            Back to reports
          </Link>
          <Link href="/instructions" className="text-sm text-[#6B6B6B] hover:text-[#1A1A1A]">
            CLI Instructions
          </Link>
        </div>
      </div>
    </div>
  );
}
