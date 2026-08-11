import type { LighthouseCategoryResult } from "@/lib/shared";
import { stripMarkdownLinks } from "@/lib/format";

export function AuditList({ category }: { category: LighthouseCategoryResult }) {
  if (category.audits.length === 0) {
    return <div className="px-5 py-6 text-sm text-[#6B6B6B]">No notable issues — all checks passed.</div>;
  }

  return (
    <div className="divide-y divide-[#E5E5E5]">
      {category.audits.map((audit) => (
        <div key={audit.id} className="px-5 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-medium text-[#1A1A1A]">{audit.title}</div>
            {audit.displayValue && (
              <div className="text-xs text-[#6B6B6B] shrink-0">{audit.displayValue}</div>
            )}
          </div>
          <div className="mt-0.5 text-sm text-[#6B6B6B]">{stripMarkdownLinks(audit.description)}</div>
        </div>
      ))}
    </div>
  );
}
