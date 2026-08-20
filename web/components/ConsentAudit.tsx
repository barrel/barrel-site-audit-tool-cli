import type {
  ConsentSection,
  ConsentStateId,
  ConsentTestResult,
  ConsentTestStatus,
  ConsentTrackerHit,
  TrackerCategory,
} from "@/lib/shared";
import { screenshotUrl } from "@/lib/screenshot";

const STATE_ORDER: ConsentStateId[] = ["clean", "dismiss", "reject", "accept", "granular", "returning"];
const STATE_LABEL: Record<ConsentStateId, string> = {
  clean: "Clean",
  dismiss: "Dismissed",
  reject: "Reject",
  accept: "Accept",
  granular: "Analytics only",
  returning: "Returning",
};

const STATUS_COLOR: Record<ConsentTestStatus, string> = {
  pass: "#10B981",
  fail: "#B91C1C",
  blocked: "#6B6B6B",
  skipped: "#9A9A9A",
  flaky: "#7C3AED",
};

const SEVERITY_COLOR: Record<ConsentTestResult["severity"], string> = {
  blocker: "#B91C1C",
  error: "#EA580C",
  warning: "#D97706",
  info: "#6B6B6B",
};

const SUITE_LABEL: Record<string, string> = {
  A: "Presence",
  B: "Pre-consent",
  C: "Reject",
  D: "Accept",
  E: "Persistence",
  F: "Granular",
  G: "Compliance surface",
  H: "Dismissal",
};

/** Was this tag firing in this state the right outcome?
 *
 * The matrix is unreadable without this. "Meta Pixel fired" is neither good nor bad on its own —
 * it's correct after Accept and a blocker-severity failure after Reject, and colouring both the
 * same way would hide the only thing the grid exists to show. */
function tone(category: TrackerCategory, state: ConsentStateId, fired: boolean): { bg: string; title: string } {
  if (!fired) return { bg: "transparent", title: "Did not fire" };
  if (category === "essential") return { bg: "#C7C7C7", title: "Essential — not gated by consent" };

  const allowed =
    state === "accept" || state === "returning" || (state === "granular" && category === "analytics");
  return allowed
    ? { bg: "#10B981", title: "Fired — permitted by the visitor's choice" }
    : { bg: "#B91C1C", title: "Fired — should have been blocked in this state" };
}

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

function TrackerMatrix({ trackers, states }: { trackers: ConsentTrackerHit[]; states: ConsentSection["states"] }) {
  const reached = new Set(states.filter((s) => s.reached).map((s) => s.state));

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-[#fafafa] border-b border-[#E5E5E5]">
            <th className="text-left px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-[#6B6B6B]">Tag</th>
            <th className="text-left px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-[#6B6B6B]">Category</th>
            {STATE_ORDER.map((s) => (
              <th key={s} className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-[#6B6B6B] whitespace-nowrap">
                {STATE_LABEL[s]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {trackers.map((t) => (
            <tr key={t.id} className="border-b border-[#E5E5E5] last:border-b-0">
              <td className="px-4 py-2 text-[#1A1A1A] whitespace-nowrap">{t.name}</td>
              <td className="px-3 py-2 text-xs text-[#6B6B6B] capitalize">{t.category}</td>
              {STATE_ORDER.map((s) => {
                const fired = t.firedIn.includes(s);
                const { bg, title } = tone(t.category, s, fired);
                const wasReached = reached.has(s);
                return (
                  <td key={s} className="px-3 py-2 text-center">
                    {!wasReached ? (
                      <span className="text-[#C7C7C7] text-xs" title="State not reached">
                        —
                      </span>
                    ) : fired ? (
                      <span className="inline-block w-2.5 h-2.5 rounded-full align-middle" style={{ backgroundColor: bg }} title={title} />
                    ) : (
                      <span className="inline-block w-2.5 h-2.5 rounded-full align-middle border border-[#D8D8D8]" title={title} />
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TestRow({ test }: { test: ConsentTestResult }) {
  const isProblem = test.status === "fail" || test.status === "flaky";
  const accent = isProblem ? SEVERITY_COLOR[test.severity] : STATUS_COLOR[test.status];
  const ev = test.evidence;

  return (
    <div className="px-5 py-3 border-l-4" style={{ borderColor: accent }}>
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="text-xs font-semibold text-[#9A9A9A] tabular-nums shrink-0">{test.id}</span>
          <span className="text-sm font-medium text-[#1A1A1A]">{test.title}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isProblem && (
            <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: SEVERITY_COLOR[test.severity] }}>
              {test.severity}
            </span>
          )}
          <span
            className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded"
            style={{ color: STATUS_COLOR[test.status], backgroundColor: `${STATUS_COLOR[test.status]}14` }}
          >
            {test.status}
          </span>
        </div>
      </div>

      <div className="mt-1 text-sm text-[#6B6B6B]">{test.detail}</div>

      {test.recommendation && isProblem && (
        <div className="mt-2 text-sm text-[#1A1A1A] bg-[#fafafa] border border-[#E5E5E5] rounded px-3 py-2">
          {test.recommendation}
        </div>
      )}

      {isProblem && ev && (ev.requests?.length || ev.cookies?.length || ev.notes?.length || ev.screenshotPath) && (
        <div className="mt-2 space-y-1.5">
          {ev.cookies && ev.cookies.length > 0 && (
            <div className="text-xs text-[#6B6B6B]">
              <span className="font-semibold uppercase tracking-wider text-[10px] text-[#9A9A9A]">Cookies</span>
              <div className="mt-0.5 font-mono break-all">
                {ev.cookies.map((c) => `${c.name} · ${c.domain} · ${c.expires === "session" ? "session" : c.expires.slice(0, 10)}`).join("  |  ")}
              </div>
            </div>
          )}
          {ev.requests && ev.requests.length > 0 && (
            <div className="text-xs text-[#6B6B6B]">
              <span className="font-semibold uppercase tracking-wider text-[10px] text-[#9A9A9A]">Requests</span>
              <ul className="mt-0.5 font-mono space-y-0.5">
                {ev.requests.map((u) => (
                  <li key={u} className="truncate" title={u}>
                    {u}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {ev.notes && ev.notes.length > 0 && (
            <div className="text-xs text-[#6B6B6B] font-mono break-all">{ev.notes.join(" · ")}</div>
          )}
          {ev.screenshotPath && (
            <a
              href={screenshotUrl(ev.screenshotPath)}
              target="_blank"
              rel="noreferrer"
              className="inline-block text-xs font-medium text-[#1A1A1A] underline underline-offset-2"
            >
              View the banner as it appeared →
            </a>
          )}
        </div>
      )}
    </div>
  );
}

export function ConsentAudit({ section }: { section: ConsentSection }) {
  const t = section.totals;
  const bySuite = new Map<string, ConsentTestResult[]>();
  for (const test of section.tests) {
    const list = bySuite.get(test.suite) ?? [];
    list.push(test);
    bySuite.set(test.suite, list);
  }
  const unreached = section.states.filter((s) => !s.reached);

  return (
    <div className="space-y-5">
      <div className="bg-white border border-[#E5E5E5] rounded-lg overflow-hidden">
        <div className="px-5 py-3 border-b border-[#E5E5E5] flex items-center justify-between gap-3 flex-wrap">
          <div className="text-sm text-[#1A1A1A]">
            <span className="font-semibold">{section.cmpDetail}</span>
            <span className="text-[#6B6B6B]"> · scanned from {section.region.toUpperCase()}</span>
          </div>
          <div className="text-xs text-[#6B6B6B]">Consent is driven for real across five browser states.</div>
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-6 divide-x divide-y sm:divide-y-0 divide-[#E5E5E5]">
          <Stat label="Pass" value={t.pass} color="#10B981" />
          <Stat label="Fail" value={t.fail} color={t.fail > 0 ? "#B91C1C" : undefined} />
          <Stat label="Blockers" value={t.blockers} color={t.blockers > 0 ? "#B91C1C" : undefined} />
          <Stat label="Blocked" value={t.blocked} />
          <Stat label="Skipped" value={t.skipped} />
          <Stat label="Flaky" value={t.flaky} color={t.flaky > 0 ? "#7C3AED" : undefined} />
        </div>
      </div>

      {section.impliedConsent && (
        <div className="bg-white border border-[#E5E5E5] rounded-lg px-5 py-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-[#6B6B6B] mb-1.5">
            This site does not ask
          </div>
          <p className="text-sm text-[#1A1A1A] leading-relaxed max-w-[90ch]">{section.impliedConsent}</p>
          <div className="mt-2 text-xs text-[#9A9A9A] max-w-[90ch] leading-relaxed">
            The accept, reject and analytics-only suites are reported as not applicable rather than failed — there is no
            choice to drive. Whether an implied-consent model is the right posture for this site&apos;s traffic is a
            question for counsel, not something this scan can answer.
          </div>
        </div>
      )}

      {unreached.length > 0 && (
        <div className="bg-white border border-[#E5E5E5] rounded-lg px-5 py-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-[#6B6B6B] mb-1.5">
            States that could not be reached
          </div>
          <ul className="text-sm text-[#6B6B6B] space-y-0.5">
            {unreached.map((s) => (
              <li key={s.state}>
                <span className="text-[#1A1A1A] font-medium">{STATE_LABEL[s.state]}</span> — {s.blockedReason}
              </li>
            ))}
          </ul>
          <div className="mt-2 text-xs text-[#9A9A9A]">
            Tests depending on these are reported as blocked or not-applicable, never as failed — they were not proven
            either way.
          </div>
        </div>
      )}

      {section.trackers.length > 0 && (
        <div className="bg-white border border-[#E5E5E5] rounded-lg overflow-hidden">
          <div className="px-5 py-2 bg-[#fafafa] text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-wider border-b border-[#E5E5E5]">
            What fired in each state
          </div>
          <TrackerMatrix trackers={section.trackers} states={section.states} />
          <div className="px-4 py-2 border-t border-[#E5E5E5] flex items-center gap-4 text-[11px] text-[#6B6B6B] flex-wrap">
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-[#10B981]" /> Permitted
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-[#B91C1C]" /> Should have been blocked
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-[#C7C7C7]" /> Essential
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-2.5 h-2.5 rounded-full border border-[#D8D8D8]" /> Did not fire
            </span>
          </div>
        </div>
      )}

      <div className="bg-white border border-[#E5E5E5] rounded-lg overflow-hidden">
        {[...bySuite.entries()].map(([suite, tests]) => (
          <div key={suite}>
            <div className="px-5 py-2 bg-[#fafafa] text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-wider border-y border-[#E5E5E5]">
              Suite {suite} · {SUITE_LABEL[suite] ?? ""}
            </div>
            <div className="divide-y divide-[#E5E5E5]">
              {tests.map((test) => (
                <TestRow key={test.id} test={test} />
              ))}
            </div>
          </div>
        ))}
      </div>

      <p className="text-xs text-[#9A9A9A] leading-relaxed max-w-[70ch]">
        This section reports observed technical behaviour, not legal compliance. Whether a given finding
        violates a particular statute in a particular jurisdiction is a question for counsel. Scanned from
        the {section.region.toUpperCase()} region only — GDPR opt-in behaviour for EU visitors is not covered.
      </p>
    </div>
  );
}
