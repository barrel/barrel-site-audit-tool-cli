import type { PixelFinding, PixelPlatformResult, PixelStatus } from "@/lib/shared";

const STATUS_COLOR: Record<PixelStatus, string> = {
  firing: "#10B981",
  configured: "#D97706",
  "not-found": "#9A9A9A",
};

const STATUS_LABEL: Record<PixelStatus, string> = {
  firing: "Firing",
  configured: "Configured, not firing",
  "not-found": "Not found",
};

const SEVERITY_COLOR: Record<PixelFinding["severity"], string> = {
  error: "#B91C1C",
  warning: "#D97706",
  info: "#6B6B6B",
};

export function PixelAudit({
  platforms,
  consentMechanismDetected,
  findings,
  hideFindings,
}: {
  platforms: PixelPlatformResult[];
  consentMechanismDetected: boolean;
  findings: PixelFinding[];
  hideFindings?: boolean;
}) {
  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 divide-x divide-y md:divide-y-0 divide-[#E5E5E5] border-b border-[#E5E5E5]">
        {platforms.map((p) => (
          <div key={p.id} className="px-4 py-4">
            <div className="text-sm font-semibold text-[#1A1A1A]">{p.name}</div>
            <div
              className="mt-1 text-[10px] font-semibold uppercase tracking-wider"
              style={{ color: STATUS_COLOR[p.status] }}
            >
              {STATUS_LABEL[p.status]}
            </div>
            <div className="mt-1 text-xs text-[#6B6B6B] leading-snug">{p.detail}</div>
          </div>
        ))}
      </div>

      <div className="px-5 py-3 border-b border-[#E5E5E5] bg-[#fafafa] flex items-center gap-2">
        <span
          className="w-2 h-2 rounded-full shrink-0"
          style={{ backgroundColor: consentMechanismDetected ? "#10B981" : "#B91C1C" }}
        />
        <span className="text-sm text-[#1A1A1A]">
          {consentMechanismDetected
            ? "A cookie-consent mechanism was detected on the page."
            : "No cookie-consent mechanism was detected on the page."}
        </span>
      </div>

      {hideFindings ? null : findings.length === 0 ? (
        <div className="px-5 py-6 text-sm text-[#6B6B6B]">No pixel or consent issues found.</div>
      ) : (
        <div className="divide-y divide-[#E5E5E5]">
          {findings.map((f, i) => (
            <div key={i} className="px-5 py-3 border-l-4" style={{ borderColor: SEVERITY_COLOR[f.severity] }}>
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-medium text-[#1A1A1A]">{f.title}</div>
                <span
                  className="text-[10px] font-semibold uppercase tracking-wider shrink-0"
                  style={{ color: SEVERITY_COLOR[f.severity] }}
                >
                  {f.severity}
                </span>
              </div>
              <div className="mt-0.5 text-sm text-[#6B6B6B]">{f.detail}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
