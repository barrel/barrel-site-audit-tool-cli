import Link from "next/link";
import { RunAuditForm } from "@/components/RunAuditForm";

export const dynamic = "force-dynamic";

export default function RunAuditPage() {
  return (
    <div className="min-h-screen bg-[#f9f8f6]">
      <header className="bg-white h-[73px] border-b border-[#E5E5E5] flex items-center px-6 lg:px-8">
        <div className="max-w-[1600px] w-full mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            <Link href="/" className="text-sm text-[#6B6B6B] hover:text-[#1A1A1A]">
              ← All reports
            </Link>
            <h1 className="text-2xl font-semibold text-[#1A1A1A] tracking-tight">Run Audit</h1>
          </div>
          <Link
            href="/instructions"
            className="text-sm font-medium text-[#1A1A1A] bg-[#f0efed] hover:bg-[#EDECE8] px-3.5 py-2 rounded-lg transition-colors"
          >
            CLI Instructions
          </Link>
        </div>
      </header>

      <main className="max-w-[900px] mx-auto px-5 lg:px-8 py-8">
        <RunAuditForm />
      </main>
    </div>
  );
}
