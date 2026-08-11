// Not sticky — CategoryNav (Overview/Site Vitals/.../All) owns the persistent sticky nav role
// above this; ReportNav is just a jump-to-anchor list for the sections on the current page.
export function ReportNav({ sections }: { sections: { id: string; label: string }[] }) {
  return (
    <nav aria-label="Report sections" className="bg-[#f9f8f6] pt-1 pb-5">
      <div className="bg-white border border-[#E5E5E5] rounded-lg p-1 flex gap-0.5 overflow-x-auto">
        {sections.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            className="shrink-0 px-3.5 py-2 rounded-md text-[13px] font-semibold text-[#6B6B6B] hover:bg-[#f0efed] hover:text-[#1A1A1A] whitespace-nowrap transition-colors"
          >
            {s.label}
          </a>
        ))}
      </div>
    </nav>
  );
}
