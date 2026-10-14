import { sharedFixes, sortFleetRows } from "@/lib/consent-fleet";
import { formatDate } from "@/lib/format";
import {
  COMPLIANCE_BAND_LABEL,
  COMPLIANCE_BLOCKER_FACTOR,
  COMPLIANCE_MIN_CONFIRMED,
  COMPLIANCE_SEVERITY_WEIGHT,
  colorForComplianceScore,
  complianceBand,
} from "@/lib/shared";
import type { ConsentFleetReport, ConsentFleetStatus, ConsentTestResult } from "@/lib/shared";

const STATUS_STYLE: Record<ConsentFleetStatus, { label: string; color: string }> = {
  ok: { label: "Clean", color: "#10B981" },
  issues: { label: "Issues", color: "#B91C1C" },
  blocked: { label: "Blocked", color: "#6B6B6B" },
  error: { label: "Unreachable", color: "#EA580C" },
};

const SEVERITY_COLOR: Record<ConsentTestResult["severity"], string> = {
  blocker: "#B91C1C",
  error: "#EA580C",
  warning: "#D97706",
  info: "#6B6B6B",
};

const SEVERITY_MEANING: Record<ConsentTestResult["severity"], string> = {
  blocker: "Data is sent, or consent is mishandled, in a way a visitor has explicitly refused or never given. The findings that carry real legal and trust exposure.",
  error: "The consent mechanism is misconfigured or a required signal is wrong, but no refused data is confirmed leaving.",
  warning: "A weaker practice or missing surface — a link, a preference centre, a clean console.",
  info: "Worth knowing, barely moves the score.",
};

const SUITES: Array<{ id: string; label: string }> = [
  { id: "A", label: "Presence — is there a consent mechanism, and does it load?" },
  { id: "B", label: "Before consent — what fires before the visitor chooses anything" },
  { id: "C", label: "Reject — does opting out actually stop tracking?" },
  { id: "D", label: "Accept — do permitted tags come back?" },
  { id: "E", label: "Persistence — does the choice survive a reload and navigation?" },
  { id: "F", label: "Granular — analytics allowed, marketing blocked" },
  { id: "G", label: "Compliance surface — privacy link, preference centre, Global Privacy Control" },
  { id: "H", label: "Dismissal — closing the banner must not count as a yes" },
];

function SectionCard({ title, children, note }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="bg-white border border-[#E5E5E5] rounded-lg overflow-hidden break-inside-avoid-page print:border-[#D4D4D4]">
      <div className="px-5 py-3 border-b border-[#E5E5E5] bg-[#faf9f7]">
        <h2 className="text-sm font-semibold text-[#1A1A1A]">{title}</h2>
        {note && <p className="mt-0.5 text-xs text-[#6B6B6B]">{note}</p>}
      </div>
      {children}
    </section>
  );
}

/** The whole scan report, with no app chrome. Rendered by the admin page and by the password-gated
 * external link, so what a recipient sees is exactly what was reviewed internally. */
export function ConsentScanReport({
  report,
  siteHref,
}: {
  report: ConsentFleetReport;
  /** Where a site's own report lives for this audience. Omitted, the names are not links. */
  siteHref?: (slug: string) => string;
}) {
  const rows = sortFleetRows(report.rows);
  const fixes = sharedFixes(rows, 1);

  // Every test ID that appears in the table, with its title — a shared PDF has no hover tooltips,
  // so an ID like "C4" is meaningless to a reader unless the report decodes it.
  const testKey = new Map<string, ConsentTestResult>();
  for (const row of rows) for (const t of row.failedTests) if (!testKey.has(t.id)) testKey.set(t.id, t);
  const keyRows = [...testKey.values()].sort((a, b) => a.id.localeCompare(b.id));

  const w = COMPLIANCE_SEVERITY_WEIGHT;

  return (
    <>
        {/* ── Header ───────────────────────────────────────────────────────────────────── */}
        <header>
          <h1 className="text-2xl font-semibold tracking-tight text-[#1A1A1A]">Privacy Compliance scan</h1>
          <p className="mt-1 text-sm text-[#6B6B6B]">
            {formatDate(report.createdAt)} · scanned from the {report.region.toUpperCase()} region · {report.totals.sites} site
            {report.totals.sites === 1 ? "" : "s"}
          </p>
        </header>

        {/* ── How the score is made ─────────────────────────────────────────────────── */}
        <SectionCard
          title="How the score is calculated"
          note="Each site is put through a fixed set of browser tests. The score is the share of what was confirmed that passed, weighted by how serious each test is."
        >
          <div className="px-5 py-4 space-y-5 text-sm text-[#1A1A1A] leading-relaxed">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[#6B6B6B] mb-1.5">1 · What is tested</h3>
              <p className="text-[#4A4A4A]">
                A real browser loads the storefront several times: untouched, after clicking <b>Reject</b>, after clicking{" "}
                <b>Accept</b>, after closing the banner without choosing, with analytics-only consent, and as a returning visitor, plus a separate Global Privacy Control probe. Each
                time it records every cookie set and every request sent to a tracking vendor, then runs the tests below
                against what it saw.
              </p>
              <ul className="mt-2 grid sm:grid-cols-2 gap-x-6 gap-y-1 text-xs text-[#4A4A4A]">
                {SUITES.map((s) => (
                  <li key={s.id}>
                    <span className="font-mono font-semibold text-[#1A1A1A]">{s.id}</span> — {s.label}
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[#6B6B6B] mb-1.5">2 · Each test has a severity, and the severity is its weight</h3>
              <div className="border border-[#E5E5E5] rounded-md overflow-hidden">
                {(["blocker", "error", "warning", "info"] as const).map((sev) => (
                  <div key={sev} className="flex gap-3 px-3 py-2 border-b last:border-b-0 border-[#E5E5E5] text-xs">
                    <span className="w-16 shrink-0 font-semibold capitalize" style={{ color: SEVERITY_COLOR[sev] }}>
                      {sev}
                    </span>
                    <span className="w-14 shrink-0 tabular-nums font-semibold">{w[sev]} pts</span>
                    <span className="text-[#4A4A4A]">{SEVERITY_MEANING[sev]}</span>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-xs text-[#6B6B6B]">
                A blocker is worth {w.blocker / w.warning} warnings. That is deliberate: a missing &ldquo;Do Not Sell&rdquo; link
                should never move the number as far as a tracker that keeps sending data after someone opted out.
              </p>
            </div>

            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[#6B6B6B] mb-1.5">3 · The arithmetic</h3>
              <div className="bg-[#faf9f7] border border-[#E5E5E5] rounded-md px-4 py-3 text-xs font-mono leading-relaxed text-[#1A1A1A]">
                score = 100 × (points from passed tests) ÷ (points from passed + failed tests)
                <br />
                if any blocker-severity test failed: score × {COMPLIANCE_BLOCKER_FACTOR}
              </div>
              <ul className="mt-2 space-y-1.5 text-xs text-[#4A4A4A] list-disc pl-5">
                <li>
                  <b>Only confirmed results count.</b> Tests that don&apos;t apply to a site (for example, choice tests on a site whose
                  consent model shows no banner) are left out of both sides of the ratio, so a site is never marked down for a
                  question that was never asked.
                </li>
                <li>
                  <b>Untested is not half-passed.</b> Flaky and blocked results are also left out of both sides. Crediting them
                  would let a site we failed to test outrank sites we tested well.
                </li>
                <li>
                  <b>A blocker can&apos;t be hidden by good results elsewhere.</b> Any confirmed blocker failure multiplies the
                  score by {COMPLIANCE_BLOCKER_FACTOR}, which caps it below 50 — so a site that leaks data after an opt-out
                  can never read as healthy, while one blocker is still distinguishable from four.
                </li>
                <li>
                  <b>Too little tested means no score.</b> With fewer than {COMPLIANCE_MIN_CONFIRMED} confirmed results, or if the
                  site would not load at all, the site shows <b>n/s</b> (not scored). A number there would rate how much we managed
                  to test, not the site.
                </li>
              </ul>
            </div>

            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[#6B6B6B] mb-1.5">4 · A worked example</h3>
              <p className="text-xs text-[#4A4A4A]">
                A site passes 3 blocker tests, 6 error tests and 5 warning tests, and fails 1 error test and 2 warning tests.
                Passed points: 3×{w.blocker} + 6×{w.error} + 5×{w.warning} = {3 * w.blocker + 6 * w.error + 5 * w.warning}. Total
                points: that plus 1×{w.error} + 2×{w.warning} = {3 * w.blocker + 7 * w.error + 7 * w.warning}. Score ={" "}
                {Math.round((100 * (3 * w.blocker + 6 * w.error + 5 * w.warning)) / (3 * w.blocker + 7 * w.error + 7 * w.warning))}.
                Now suppose one of the blocker tests had failed instead: the raw score would be{" "}
                {Math.round((100 * (2 * w.blocker + 6 * w.error + 5 * w.warning)) / (3 * w.blocker + 7 * w.error + 7 * w.warning))},
                and with the blocker rule applied it becomes{" "}
                {Math.round(((100 * (2 * w.blocker + 6 * w.error + 5 * w.warning)) / (3 * w.blocker + 7 * w.error + 7 * w.warning)) * COMPLIANCE_BLOCKER_FACTOR)}.
              </p>
            </div>

            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[#6B6B6B] mb-1.5">5 · Reading the number</h3>
              <div className="flex flex-wrap gap-2 text-xs">
                {[
                  { b: "healthy" as const, range: "60 and above" },
                  { b: "improving" as const, range: "30 to 59" },
                  { b: "at-risk" as const, range: "below 30" },
                ].map(({ b, range }) => (
                  <span
                    key={b}
                    className="px-2.5 py-1 rounded border font-semibold"
                    style={{
                      color: colorForComplianceScore(b === "healthy" ? 80 : b === "improving" ? 40 : 10),
                      borderColor: "#E5E5E5",
                    }}
                  >
                    {COMPLIANCE_BAND_LABEL[b]} · {range}
                  </span>
                ))}
              </div>
              <p className="mt-2 text-xs text-[#6B6B6B]">
                This is its own scale, not the A–F grade used for Lighthouse scores elsewhere in Barrel reports. It is a weighted
                proportion of what could be confirmed, and full marks is not a realistic target for a live storefront running a
                marketing stack — the cutoffs are set so the bands separate real differences rather than painting everything red.
              </p>
            </div>
          </div>
        </SectionCard>

        {/* ── All sites ────────────────────────────────────────────────────────────────── */}
        <SectionCard title={`All ${rows.length} sites`} note="Worst first: sites with blocker failures, then other issues, then sites that could not be scanned or tested, then clean sites.">
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-[#faf9f7] border-b border-[#E5E5E5] text-left">
                  {["Site", "CMP", "Status", "Score", "Blockers", "Pass / fail", "Failed tests", ...(siteHref ? [""] : [])].map((h) => (
                    <th
                      key={h}
                      className={`px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-[#6B6B6B] whitespace-nowrap ${
                        ["Score", "Blockers"].includes(h) ? "text-right" : ""
                      }`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E5E5]">
                {rows.map((row) => {
                  const st = STATUS_STYLE[row.status];
                  return (
                    <tr key={row.slug} className="align-top break-inside-avoid">
                      <td className="px-3 py-2 max-w-[260px]">
                        {siteHref ? (
                          <a href={siteHref(row.slug)} className="font-semibold text-[#1A1A1A] hover:underline truncate block">
                            {row.client}
                          </a>
                        ) : (
                          <div className="font-semibold text-[#1A1A1A] truncate">{row.client}</div>
                        )}
                        <div className="text-[#6B6B6B] truncate">{row.url}</div>
                      </td>
                      <td className="px-3 py-2 font-mono text-[#6B6B6B] whitespace-nowrap">{row.cmp}</td>
                      <td className="px-3 py-2 whitespace-nowrap font-semibold" style={{ color: st.color }}>
                        {st.label}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums whitespace-nowrap">
                        {row.score === null ? (
                          <span className="text-[#9A9A9A] font-normal">n/s</span>
                        ) : (
                          <span style={{ color: colorForComplianceScore(row.score) }}>
                            {row.score} <span className="font-normal text-[10px]">{COMPLIANCE_BAND_LABEL[complianceBand(row.score)]}</span>
                          </span>
                        )}
                      </td>
                      <td
                        className="px-3 py-2 text-right font-semibold tabular-nums"
                        style={{ color: row.totals.blockers > 0 ? "#B91C1C" : "#9A9A9A" }}
                      >
                        {row.totals.blockers}
                      </td>
                      <td className="px-3 py-2 text-[#6B6B6B] whitespace-nowrap tabular-nums">
                        {row.totals.pass} / {row.totals.fail}
                        {row.totals.blocked > 0 && ` · ${row.totals.blocked} untested`}
                      </td>
                      <td className="px-3 py-2">
                        {row.error ? (
                          <span className="text-[#EA580C]">{row.error}</span>
                        ) : row.failedTests.length === 0 ? (
                          <span className="text-[#9A9A9A]">—</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {row.failedTests.map((t) => (
                              <span
                                key={t.id}
                                className="font-mono text-[10px] font-semibold px-1.5 py-0.5 rounded border"
                                style={{
                                  color: t.status === "flaky" ? "#7C3AED" : SEVERITY_COLOR[t.severity],
                                  borderColor: `${t.status === "flaky" ? "#7C3AED" : SEVERITY_COLOR[t.severity]}40`,
                                }}
                              >
                                {t.id}
                                {t.status === "flaky" ? "*" : ""}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      {siteHref && (
                        <td className="px-3 py-2 whitespace-nowrap print:hidden">
                          <a href={siteHref(row.slug)} className="font-semibold text-[#1A1A1A] hover:underline">
                            Full report →
                          </a>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="px-5 py-2.5 border-t border-[#E5E5E5] text-[11px] text-[#9A9A9A]">
            n/s = not scored (too little could be confirmed). * = flaky, did not fail consistently on re-check and is not counted.
            &ldquo;Untested&rdquo; = the scan was blocked from running the test — a gap to re-run, not a finding.
          </div>
        </SectionCard>

        {/* ── What the test IDs mean ─────────────────────────────────────────────────── */}
        {keyRows.length > 0 && (
          <SectionCard title="Failed test key" note="What each ID in the table above is checking.">
            <ul className="divide-y divide-[#E5E5E5]">
              {keyRows.map((t) => (
                <li key={t.id} className="px-5 py-2 flex items-baseline gap-3 text-xs break-inside-avoid">
                  <span className="font-mono font-semibold w-8 shrink-0" style={{ color: SEVERITY_COLOR[t.severity] }}>
                    {t.id}
                  </span>
                  <span className="text-[#1A1A1A] flex-1">{t.title}</span>
                  <span className="capitalize text-[#6B6B6B] shrink-0">{t.severity}</span>
                </li>
              ))}
            </ul>
          </SectionCard>
        )}

        {/* ── Fixes ──────────────────────────────────────────────────────────────────────── */}
        {fixes.length > 0 && (
          <SectionCard
            title="What to fix"
            note="Grouped by failure, most serious first. The same failure across several sites is usually one piece of work, not several."
          >
            <ul className="divide-y divide-[#E5E5E5]">
              {fixes.map((f) => (
                <li key={f.id} className="px-5 py-3 break-inside-avoid">
                  <div className="flex items-baseline gap-2.5 flex-wrap">
                    <span className="font-mono text-[11px] font-semibold" style={{ color: SEVERITY_COLOR[f.severity] }}>
                      {f.id}
                    </span>
                    <span className="text-sm font-medium text-[#1A1A1A]">{f.title}</span>
                    <span className="text-[11px] uppercase tracking-wider text-[#6B6B6B]">
                      {f.severity} · {f.sites.length} site{f.sites.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  {f.recommendation && <p className="mt-1 text-xs text-[#4A4A4A] leading-relaxed">{f.recommendation}</p>}
                  <p className="mt-1 text-xs text-[#6B6B6B]">{f.sites.join(", ")}</p>
                </li>
              ))}
            </ul>
          </SectionCard>
        )}

        <p className="text-xs text-[#9A9A9A] max-w-[80ch] leading-relaxed">
          This reports observed technical behaviour, not legal compliance or legal advice. Every site was scanned from the{" "}
          {report.region.toUpperCase()} region only, so behaviour for visitors elsewhere may differ. A site is only marked Clean when
          enough of it was actually confirmed to say so.
        </p>
    </>
  );
}
