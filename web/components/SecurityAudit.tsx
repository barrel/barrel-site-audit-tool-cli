import type { SecurityCheck, SecurityCheckCategory, SecurityCheckStatus, SecuritySection, SecuritySeverity } from "@/lib/shared";

const STATUS_COLOR: Record<SecurityCheckStatus, string> = {
  pass: "#10B981",
  warn: "#D97706",
  fail: "#B91C1C",
  "not-tested": "#9A9A9A",
};

const STATUS_LABEL: Record<SecurityCheckStatus, string> = {
  pass: "pass",
  warn: "warn",
  fail: "fail",
  "not-tested": "not tested",
};

const SEVERITY_COLOR: Record<SecuritySeverity, string> = {
  critical: "#B91C1C",
  high: "#EA580C",
  medium: "#D97706",
  low: "#6B6B6B",
};

const CATEGORY_ORDER: SecurityCheckCategory[] = ["transport", "headers", "cookies", "exposure", "supply-chain"];

const CATEGORY_LABEL: Record<SecurityCheckCategory, string> = {
  transport: "Transport & TLS",
  headers: "Security headers",
  cookies: "Cookie flags",
  exposure: "Exposed surface",
  "supply-chain": "Script supply chain",
};

function Stat({ label, value, color }: { label: string; value: number | string; color?: string }) {
  return (
    <div className="px-4 py-3">
      <div className="text-lg font-semibold tabular-nums" style={{ color: color ?? "#1A1A1A" }}>
        {value}
      </div>
      <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-[#6B6B6B]">{label}</div>
    </div>
  );
}

function CheckRow({ check }: { check: SecurityCheck }) {
  const isProblem = check.status === "fail" || check.status === "warn";
  // A not-tested row is deliberately greyed rather than coloured by severity: its severity says how
  // much the control matters, and painting an untested critical check red would read as a finding.
  const accent = isProblem ? SEVERITY_COLOR[check.severity] : STATUS_COLOR[check.status];
  const ev = check.evidence;
  const hasEvidence = Boolean(ev?.observed?.length || ev?.urls?.length || ev?.notes?.length);

  return (
    <div className="px-5 py-3 border-l-4" style={{ borderColor: accent }}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium text-[#1A1A1A]">{check.title}</span>
        <div className="flex items-center gap-2 shrink-0">
          {isProblem && (
            <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: SEVERITY_COLOR[check.severity] }}>
              {check.severity}
            </span>
          )}
          <span
            className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded whitespace-nowrap"
            style={{ color: STATUS_COLOR[check.status], backgroundColor: `${STATUS_COLOR[check.status]}14` }}
          >
            {STATUS_LABEL[check.status]}
          </span>
        </div>
      </div>

      <div className="mt-1 text-sm text-[#6B6B6B] max-w-[95ch]">{check.detail}</div>

      {check.recommendation && (
        <div className="mt-2 text-sm text-[#1A1A1A] bg-[#fafafa] border border-[#E5E5E5] rounded px-3 py-2 max-w-[95ch]">
          {check.recommendation}
        </div>
      )}

      {/* Shown on passes too, not only on problems: a security pass is a claim, and the reader
          should be able to re-check the header value we read it from without trusting us. */}
      {hasEvidence && (
        <div className="mt-2 space-y-1.5">
          {ev?.observed && ev.observed.length > 0 && (
            <div className="text-xs text-[#6B6B6B]">
              <span className="font-semibold uppercase tracking-wider text-[10px] text-[#9A9A9A]">Observed</span>
              <ul className="mt-0.5 font-mono space-y-0.5 break-all">
                {ev.observed.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          )}
          {ev?.urls && ev.urls.length > 0 && (
            <div className="text-xs text-[#6B6B6B]">
              <span className="font-semibold uppercase tracking-wider text-[10px] text-[#9A9A9A]">URLs checked</span>
              <ul className="mt-0.5 font-mono space-y-0.5">
                {ev.urls.map((u) => (
                  <li key={u} className="truncate" title={u}>
                    {u}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {ev?.notes && ev.notes.length > 0 && <div className="text-xs text-[#9A9A9A] max-w-[90ch]">{ev.notes.join(" · ")}</div>}
        </div>
      )}
    </div>
  );
}

export function SecurityAudit({ section }: { section: SecuritySection }) {
  const t = section.totals;
  const byCategory = CATEGORY_ORDER.map((category) => ({
    category,
    checks: section.checks.filter((c) => c.category === category),
  })).filter((group) => group.checks.length > 0);

  return (
    <div className="space-y-5">
      <div className="bg-white border border-[#E5E5E5] rounded-lg overflow-hidden">
        <div className="px-5 py-3 border-b border-[#E5E5E5] flex items-center justify-between gap-3 flex-wrap">
          <div className="text-sm text-[#1A1A1A] min-w-0">
            <span className="font-semibold break-all">{section.scannedUrl}</span>
          </div>
          <div className="text-xs text-[#6B6B6B]">Read from HTTP responses, the delivered HTML and a TLS handshake.</div>
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-5 divide-x divide-y sm:divide-y-0 divide-[#E5E5E5]">
          <Stat label="Pass" value={t.pass} color="#10B981" />
          <Stat label="Warn" value={t.warn} color={t.warn > 0 ? "#D97706" : undefined} />
          <Stat label="Fail" value={t.fail} color={t.fail > 0 ? "#B91C1C" : undefined} />
          <Stat label="Critical" value={t.critical} color={t.critical > 0 ? "#B91C1C" : undefined} />
          <Stat label="Not tested" value={t.notTested} />
        </div>
      </div>

      {section.fatalError && (
        <div className="bg-white border border-[#E5E5E5] rounded-lg px-5 py-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-[#6B6B6B] mb-1.5">The site could not be read</div>
          <p className="text-sm text-[#1A1A1A] leading-relaxed max-w-[90ch]">{section.fatalError}</p>
          <div className="mt-2 text-xs text-[#9A9A9A] max-w-[90ch] leading-relaxed">
            Nothing below is reported as a failure on that account — an unreadable site is a coverage gap, not a verdict.
          </div>
        </div>
      )}

      {t.notTested > 0 && !section.fatalError && (
        <div className="bg-white border border-[#E5E5E5] rounded-lg px-5 py-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-[#6B6B6B] mb-1.5">
            {t.notTested} check{t.notTested === 1 ? "" : "s"} could not be run
          </div>
          <p className="text-sm text-[#6B6B6B] leading-relaxed max-w-[90ch]">
            These are listed below with the reason. They are excluded from the score entirely rather than counted as
            passes or failures — a control we could not observe is not evidence either way.
          </p>
        </div>
      )}

      <div className="bg-white border border-[#E5E5E5] rounded-lg overflow-hidden">
        {byCategory.map(({ category, checks }) => (
          <div key={category}>
            <div className="px-5 py-2 bg-[#fafafa] text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-wider border-y border-[#E5E5E5]">
              {CATEGORY_LABEL[category]}
            </div>
            <div className="divide-y divide-[#E5E5E5]">
              {checks.map((check) => (
                <CheckRow key={check.id} check={check} />
              ))}
            </div>
          </div>
        ))}
      </div>

      <p className="text-xs text-[#9A9A9A] leading-relaxed max-w-[70ch]">
        This section reports what a single unauthenticated request to the storefront&apos;s homepage could observe. It is
        not a penetration test: nothing here probes the checkout, the admin, an authenticated session, or any code path
        reached only by interacting with the page. A clean result means these specific controls were checked and held,
        not that the site is secure.
      </p>
    </div>
  );
}
