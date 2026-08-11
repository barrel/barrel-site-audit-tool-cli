import type { StructureFlag, ThemeStructureSection } from "@/lib/shared";

function FlagList({ flags, color }: { flags: StructureFlag[]; color: string }) {
  if (flags.length === 0) {
    return <div className="text-sm text-[#9A9A9A]">None</div>;
  }
  return (
    <ul className="space-y-2">
      {flags.map((f, i) => (
        <li key={i} className="flex items-start gap-2">
          <span className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
          <div>
            <div className="text-sm font-medium text-[#1A1A1A]">{f.label}</div>
            <div className="text-sm text-[#6B6B6B]">{f.detail}</div>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function ThemeStructure({ section }: { section: ThemeStructureSection }) {
  return (
    <div>
      <div className="flex flex-wrap divide-x divide-[#E5E5E5] border-b border-[#E5E5E5]">
        <div className="flex-1 min-w-[140px] px-5 py-4">
          <div className="text-xs font-medium text-[#9A9A9A] tracking-wide uppercase">Templates</div>
          <div className="mt-1 text-2xl font-semibold text-[#000000] tracking-tight">
            {section.templates.total}
          </div>
          <div className="text-[10px] text-[#9A9A9A] mt-0.5">
            {section.templates.json} JSON / {section.templates.liquid} Liquid
          </div>
        </div>
        <div className="flex-1 min-w-[140px] px-5 py-4">
          <div className="text-xs font-medium text-[#9A9A9A] tracking-wide uppercase">Sections</div>
          <div className="mt-1 text-2xl font-semibold text-[#000000] tracking-tight">{section.sectionsCount}</div>
        </div>
        <div className="flex-1 min-w-[140px] px-5 py-4">
          <div className="text-xs font-medium text-[#9A9A9A] tracking-wide uppercase">Snippets</div>
          <div className="mt-1 text-2xl font-semibold text-[#000000] tracking-tight">{section.snippetsCount}</div>
        </div>
        <div className="flex-1 min-w-[140px] px-5 py-4">
          <div className="text-xs font-medium text-[#9A9A9A] tracking-wide uppercase">Page-builder apps</div>
          <div className="mt-1 text-2xl font-semibold text-[#000000] tracking-tight">
            {section.pageBuilderApps.length}
          </div>
          <div className="text-[10px] text-[#9A9A9A] mt-0.5 truncate">
            {section.pageBuilderApps.join(", ") || "None detected"}
          </div>
        </div>
      </div>

      <div className="grid md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-[#E5E5E5]">
        <div className="px-5 py-4">
          <div className="text-[10px] font-semibold text-[#B91C1C] uppercase tracking-wider mb-3">Red flags</div>
          <FlagList flags={section.redFlags} color="#B91C1C" />
        </div>
        <div className="px-5 py-4">
          <div className="text-[10px] font-semibold text-[#10B981] uppercase tracking-wider mb-3">Green flags</div>
          <FlagList flags={section.greenFlags} color="#10B981" />
        </div>
      </div>
    </div>
  );
}
