export function ReportSection({
  id,
  number,
  title,
  action,
  children,
}: {
  id: string;
  number: string;
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="pt-16 first:pt-8 border-t border-[#E5E5E5] first:border-t-0 scroll-mt-24">
      <div className="flex items-baseline justify-between gap-3 mb-6">
        <div className="flex items-baseline gap-2.5">
          <span className="text-[13px] font-semibold text-[#9A9A9A] tabular-nums">{number}</span>
          <h2 className="text-lg font-semibold text-[#000000] tracking-tight">{title}</h2>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
