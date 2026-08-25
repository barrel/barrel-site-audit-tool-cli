"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CATEGORY_LABELS } from "@/lib/build-report-sections";

/** `gated` tabs appear only when the report can actually fill them. Everything else is always
 * present: a category with nothing in it still renders a page explaining which flag skipped it,
 * which is useful. Data Analysis is different — with no GA4 property linked there is no data,
 * no page worth opening, and a permanently-empty tab would read as a broken feature rather than
 * an unconfigured one. */
const TABS: Array<{ slug: string; label: string; gated?: "ga4" }> = [
  { slug: "", label: CATEGORY_LABELS.overview },
  { slug: "recommendations", label: CATEGORY_LABELS.recommendations },
  { slug: "vitals", label: CATEGORY_LABELS.vitals },
  { slug: "theme", label: CATEGORY_LABELS.theme },
  { slug: "ux", label: CATEGORY_LABELS.ux },
  { slug: "seo-geo", label: CATEGORY_LABELS["seo-geo"] },
  { slug: "ada", label: CATEGORY_LABELS.ada },
  { slug: "data", label: CATEGORY_LABELS.data, gated: "ga4" },
  { slug: "all", label: "All" },
  { slug: "dev-todo", label: "Dev To-Do" },
];

/** Cross-page tabs (Overview / Recommendations / Site Vitals / Theme Check / UX / SEO/GEO / ADA /
 * Data Analysis / All) — distinct from ReportNav, which jumps to anchors within whichever of those pages is
 * currently open. */
export function CategoryNav({ slug, id, hasGa4 }: { slug: string; id: string; hasGa4: boolean }) {
  const pathname = usePathname();
  const base = `/reports/${slug}/${id}`;
  const tabs = TABS.filter((tab) => tab.gated !== "ga4" || hasGa4);

  return (
    <nav aria-label="Report pages" className="sticky top-0 z-20 bg-[#f9f8f6] pt-4 pb-3">
      <div className="bg-white border border-[#E5E5E5] rounded-lg p-1 flex gap-0.5 overflow-x-auto">
        {tabs.map((tab) => {
          const href = tab.slug ? `${base}/${tab.slug}` : base;
          const isActive = pathname === href;
          return (
            <Link
              key={tab.slug || "overview"}
              href={href}
              aria-current={isActive ? "page" : undefined}
              className={`shrink-0 px-3.5 py-2 rounded-md text-[13px] font-semibold whitespace-nowrap transition-colors ${
                isActive ? "bg-[#1A1A1A] text-white" : "text-[#6B6B6B] hover:bg-[#f0efed] hover:text-[#1A1A1A]"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
