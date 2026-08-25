"use client";

import { useState } from "react";
import type { CroBrief, CroDataSource } from "@/lib/shared";

const MAX_COMPETITORS = 3;

/** What the client has, so the report can say which of its steps had no source rather than
 * appearing to have found nothing.
 *
 * The distinction matters on the page: a Voice-of-Customer section that is empty because nobody
 * looked reads identically to one that is empty because the reviews said nothing useful, and only
 * one of those is a finding. */
const DATA_SOURCES: Array<{ key: CroDataSource; label: string; detail: string }> = [
  { key: "ga4", label: "GA4", detail: "Linked separately, on the Run Audit page — this is a record of whether the client has it." },
  { key: "shopify-analytics", label: "Shopify Analytics", detail: "Platform-native sales and funnel reporting." },
  { key: "hotjar", label: "Hotjar", detail: "Heatmaps and session recordings. Read by hand — Hotjar has no usable export." },
  { key: "clarity", label: "Microsoft Clarity", detail: "Heatmaps and recordings. Has a data-export API, so this is the one that could be automated later." },
  { key: "quantum-metric", label: "Quantum Metric", detail: "Or another enterprise behaviour tool." },
  { key: "reviews-platform", label: "Reviews platform", detail: "Yotpo, Judge.me, Okendo, Amazon reviews." },
  { key: "survey", label: "Survey data", detail: "Post-purchase or on-site survey responses." },
];

export function CroBriefForm({ slug, brief, ga4Linked }: { slug: string; brief: CroBrief; ga4Linked: boolean }) {
  const [competitors, setCompetitors] = useState<string[]>(() => {
    const existing = brief.competitorUrls ?? [];
    return [...existing, ...Array(Math.max(0, MAX_COMPETITORS - existing.length)).fill("")].slice(0, MAX_COMPETITORS);
  });
  const [reviewsUrl, setReviewsUrl] = useState(brief.reviewsUrl ?? "");
  const [sources, setSources] = useState<CroDataSource[]>(brief.dataSources ?? (ga4Linked ? ["ga4"] : []));
  const [subscription, setSubscription] = useState(Boolean(brief.subscription));
  const [giftCards, setGiftCards] = useState(Boolean(brief.giftCards));
  const [positioning, setPositioning] = useState(brief.positioning ?? "");
  const [hypotheses, setHypotheses] = useState(brief.hypotheses ?? "");

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleSource(key: CroDataSource) {
    setSources((prev) => (prev.includes(key) ? prev.filter((s) => s !== key) : [...prev, key]));
    setSaved(false);
  }

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/cro-brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          competitorUrls: competitors.map((c) => c.trim()).filter(Boolean),
          reviewsUrl,
          dataSources: sources,
          subscription,
          giftCards,
          positioning,
          hypotheses,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? "The brief could not be saved.");
        return;
      }
      setSaved(true);
    } catch (err) {
      setError(`The brief could not be saved: ${String((err as Error)?.message ?? err)}`);
    } finally {
      setSaving(false);
    }
  }

  const label = "text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-wider";
  const input =
    "mt-1 w-full border border-[#E5E5E5] rounded-md px-3 py-2 text-sm text-[#1A1A1A] focus:outline-none focus:border-[#9A9A9A]";

  return (
    <div className="space-y-5">
      <section className="bg-white border border-[#E5E5E5] rounded-lg px-5 py-4">
        <h2 className="text-sm font-semibold text-[#1A1A1A]">Competitors</h2>
        <p className="mt-0.5 text-[12.5px] text-[#6B6B6B] leading-relaxed">
          The three the client considers most relevant. Each one is a full capture sweep of their
          storefront at the same cost as the client&rsquo;s own, which is why three is the ceiling.
        </p>
        <div className="mt-3 space-y-2">
          {competitors.map((value, i) => (
            <input
              key={i}
              value={value}
              placeholder={`competitor-${i + 1}.com`}
              onChange={(e) => {
                const next = [...competitors];
                next[i] = e.target.value;
                setCompetitors(next);
                setSaved(false);
              }}
              className={input}
            />
          ))}
        </div>
      </section>

      <section className="bg-white border border-[#E5E5E5] rounded-lg px-5 py-4">
        <h2 className="text-sm font-semibold text-[#1A1A1A]">Data available</h2>
        <p className="mt-0.5 text-[12.5px] text-[#6B6B6B] leading-relaxed">
          Ticking a box does not connect anything — it records what exists, so a step with no source
          says so on the page instead of looking like a step that found nothing.
        </p>
        <ul className="mt-3 space-y-2">
          {DATA_SOURCES.map((source) => (
            <li key={source.key}>
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={sources.includes(source.key)}
                  onChange={() => toggleSource(source.key)}
                  className="mt-0.5 accent-[#1A1A1A]"
                />
                <span className="min-w-0">
                  <span className="text-[13px] font-medium text-[#1A1A1A]">{source.label}</span>
                  <span className="block text-[11.5px] text-[#9A9A9A] leading-relaxed">{source.detail}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
        <label className="block mt-4">
          <span className={label}>Reviews URL</span>
          <input
            value={reviewsUrl}
            placeholder="https://client.com/pages/reviews"
            onChange={(e) => {
              setReviewsUrl(e.target.value);
              setSaved(false);
            }}
            className={input}
          />
        </label>
      </section>

      <section className="bg-white border border-[#E5E5E5] rounded-lg px-5 py-4">
        <h2 className="text-sm font-semibold text-[#1A1A1A]">Business model</h2>
        <p className="mt-0.5 text-[12.5px] text-[#6B6B6B] leading-relaxed">
          Changes which decisions a shopper is actually making — a subscription store asks for a
          delivery frequency before checkout, and reviewing it as a one-off purchase misses the step
          where most of the hesitation is.
        </p>
        <div className="mt-3 space-y-2">
          <label className="flex items-center gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={subscription}
              onChange={(e) => {
                setSubscription(e.target.checked);
                setSaved(false);
              }}
              className="accent-[#1A1A1A]"
            />
            <span className="text-[13px] text-[#1A1A1A]">Sells subscriptions</span>
          </label>
          <label className="flex items-center gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={giftCards}
              onChange={(e) => {
                setGiftCards(e.target.checked);
                setSaved(false);
              }}
              className="accent-[#1A1A1A]"
            />
            <span className="text-[13px] text-[#1A1A1A]">Sells gift cards</span>
          </label>
        </div>
      </section>

      <section className="bg-white border border-[#E5E5E5] rounded-lg px-5 py-4 space-y-4">
        <h2 className="text-sm font-semibold text-[#1A1A1A]">In the client&rsquo;s words</h2>
        <label className="block">
          <span className={label}>Brand positioning</span>
          <textarea
            value={positioning}
            rows={3}
            placeholder="Paste from their brand guidelines or positioning doc."
            onChange={(e) => {
              setPositioning(e.target.value);
              setSaved(false);
            }}
            className={`${input} leading-relaxed`}
          />
          <span className="text-[11px] text-[#9A9A9A]">
            Given to the drafting prompts so a recommendation does not fight the brand it is for.
          </span>
        </label>
        <label className="block">
          <span className={label}>Known pain points &amp; hypotheses</span>
          <textarea
            value={hypotheses}
            rows={4}
            placeholder="What they already believe is costing them conversion."
            onChange={(e) => {
              setHypotheses(e.target.value);
              setSaved(false);
            }}
            className={`${input} leading-relaxed`}
          />
          <span className="text-[11px] text-[#9A9A9A]">
            The audit engages with these where the evidence speaks to them, rather than talking past
            them — and never repeats one back as a finding unless the capture supports it.
          </span>
        </label>
      </section>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="text-sm font-semibold text-white bg-[#1A1A1A] hover:bg-black px-3.5 py-2 rounded-lg disabled:opacity-50 transition-colors"
        >
          {saving ? "Saving…" : "Save brief"}
        </button>
        {saved && <span className="text-[12.5px] text-[#10B981]">Saved.</span>}
        {error && <span className="text-[12.5px] text-[#B91C1C]">{error}</span>}
      </div>
    </div>
  );
}
