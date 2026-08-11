import type { HealthCheckItem, HealthStatus } from "@/lib/shared";

const STATUS_COLOR: Record<HealthStatus, string> = {
  pass: "#10B981",
  warn: "#D97706",
  fail: "#B91C1C",
};

const STATUS_LABEL: Record<HealthStatus, string> = {
  pass: "Pass",
  warn: "Warning",
  fail: "Fail",
};

export function HealthChecklist({ checks }: { checks: HealthCheckItem[] }) {
  return (
    <div className="divide-y divide-[#E5E5E5]">
      {checks.map((c) => (
        <div key={c.id} className="flex items-start gap-3 px-5 py-3">
          <span
            className="mt-1 w-2 h-2 rounded-full shrink-0"
            style={{ backgroundColor: STATUS_COLOR[c.status] }}
            title={STATUS_LABEL[c.status]}
          />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-[#1A1A1A]">{c.label}</div>
            <div className="text-sm text-[#6B6B6B] truncate">{c.detail}</div>
          </div>
          <span
            className="text-[10px] font-semibold uppercase tracking-wider shrink-0 mt-1.5"
            style={{ color: STATUS_COLOR[c.status] }}
          >
            {STATUS_LABEL[c.status]}
          </span>
        </div>
      ))}
    </div>
  );
}
