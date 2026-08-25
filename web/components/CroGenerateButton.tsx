"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { CroStepKey } from "@/lib/shared";

/** Runs the steps that need no browser: the analytics step from GA4, and the key-insights synthesis.
 *
 * The other half of this tool's two-mode split. A capture run drives Chrome from someone's machine;
 * this button runs on the deployed site with no CLI, no browser and no checkout involved — which is
 * why a store with a linked GA4 property can get its analytics step with no local setup at all.
 *
 * A generation is a paid model call over a whole audit, so it is never automatic and never silent
 * about what it is about to cost. */
export function CroGenerateButton({
  slug,
  croId,
  hasGa4,
  steps,
  label,
}: {
  slug: string;
  croId: string;
  hasGa4: boolean;
  steps?: CroStepKey[];
  label?: string;
}) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!hasGa4) {
    return (
      <div className="text-[12.5px] text-[#6B6B6B] max-w-[60ch]">
        No GA4 property is linked to this store, so the analytics step has nothing to read.{" "}
        <a href="/run" className="text-[#2563EB] hover:underline">
          Link one on the Run Audit page
        </a>
        , then generate.
      </div>
    );
  }

  async function generate() {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/cro-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, id: croId, ...(steps ? { steps } : {}) }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? "The generation failed.");
        return;
      }
      // The page renders server-side from the blob this just rewrote.
      router.refresh();
    } catch (err) {
      setError(`The generation failed: ${String((err as Error)?.message ?? err)}`);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="print:hidden">
      <button
        type="button"
        onClick={generate}
        disabled={running}
        className="text-sm font-semibold text-white bg-[#1A1A1A] hover:bg-black px-3.5 py-2 rounded-lg disabled:opacity-50 transition-colors"
      >
        {running ? "Generating… (up to a few minutes)" : (label ?? "Generate analytics & key insights")}
      </button>
      {running && (
        <p className="mt-2 text-[11px] text-[#9A9A9A]">
          Reading 28 days of GA4 and writing across every completed step. Keep this tab open.
        </p>
      )}
      {error && <p className="mt-2 text-[12.5px] text-[#B91C1C] leading-relaxed max-w-[70ch]">{error}</p>}
    </div>
  );
}
