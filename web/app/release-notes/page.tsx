import Link from "next/link";
import { RELEASE_NOTES } from "@/lib/release-notes";

export const dynamic = "force-dynamic";

export default function ReleaseNotesPage() {
  return (
    <div className="min-h-screen bg-[#f9f8f6]">
      <header className="bg-white h-[73px] border-b border-[#E5E5E5] flex items-center px-6 lg:px-8">
        <div className="max-w-[900px] w-full mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/" className="text-sm text-[#6B6B6B] hover:text-[#1A1A1A]">
              ← All reports
            </Link>
            <h1 className="text-2xl font-semibold text-[#1A1A1A] tracking-tight">Release Notes</h1>
          </div>
        </div>
      </header>

      <main className="max-w-[900px] mx-auto px-5 lg:px-8 py-8">
        <p className="text-sm text-[#6B6B6B] max-w-[640px] mb-8">
          What's changed in Barrel Site Audit, newest first.
        </p>

        <div className="space-y-6">
          {RELEASE_NOTES.map((r) => (
            <div key={r.version} className="bg-white border border-[#E5E5E5] rounded-lg px-6 py-5">
              <div className="flex items-baseline gap-3 mb-3">
                <span className="text-sm font-semibold text-white bg-[#1A1A1A] rounded-full px-2.5 py-0.5 tabular-nums">
                  v{r.version}
                </span>
                <h2 className="text-base font-semibold text-[#1A1A1A]">{r.title}</h2>
                <span className="text-xs text-[#9A9A9A] ml-auto tabular-nums">{r.date}</span>
              </div>
              <ul className="space-y-1.5 text-sm text-[#6B6B6B] list-disc pl-5">
                {r.notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
