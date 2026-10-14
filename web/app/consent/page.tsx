import Link from "next/link";
import { AdminsOnlyScreen } from "@/components/AdminsOnly";
import { CopySiteListButton } from "@/components/CopySiteListButton";
import { isLabsAdmin } from "@/lib/labs-session";
import { PageTitle, TopNav } from "@/components/TopNav";
import { getConsentIndex, getConsentScan, getLatestConsentScan } from "@/lib/data";
import { sharedFixes, sortFleetRows } from "@/lib/consent-fleet";
import { formatDate } from "@/lib/format";
import { COMPLIANCE_BAND_LABEL, colorForComplianceScore, complianceBand } from "@/lib/shared";
import type { ConsentFleetStatus, ConsentTestResult } from "@/lib/shared";

export const dynamic = "force-dynamic";

const HISTORY_PAGE_SIZE = 10;

const STATUS_STYLE: Record<ConsentFleetStatus, { label: string; color: string; bg: string }> = {
  ok: { label: "Clean", color: "#10B981", bg: "#10B98114" },
  issues: { label: "Issues", color: "#B91C1C", bg: "#B91C1C14" },
  blocked: { label: "Blocked", color: "#6B6B6B", bg: "#6B6B6B14" },
  error: { label: "Unreachable", color: "#EA580C", bg: "#EA580C14" },
};

const SEVERITY_COLOR: Record<ConsentTestResult["severity"], string> = {
  blocker: "#B91C1C",
  error: "#EA580C",
  warning: "#D97706",
  info: "#6B6B6B",
};

function Empty() {
  return (
    <div className="bg-white border border-[#E5E5E5] rounded-lg px-6 py-10 text-center">
      <div className="text-sm font-medium text-[#1A1A1A]">No privacy scans yet</div>
      <p className="mt-2 text-sm text-[#6B6B6B] max-w-[52ch] mx-auto">
        Run <code className="font-mono text-xs bg-[#f4f4f4] px-1.5 py-0.5 rounded">barrel-audit consent-scan</code> in a
        terminal to scan every active site in <code className="font-mono text-xs">sites.yml</code>. Results appear here the
        moment it finishes.
      </p>
    </div>
  );
}

export default async function PrivacyCompliancePage({ searchParams }: { searchParams: Promise<{ scan?: string; page?: string }> }) {
  // Belt as well as braces: middleware already rewrites this route for a non-admin, but a
  // Privacy Compliance page must not depend on the matcher staying correct to stay closed.
  if (!(await isLabsAdmin())) return <AdminsOnlyScreen what="Privacy Compliance" />;

  const { scan: scanId, page: pageParam } = await searchParams;
  const [report, index] = await Promise.all([
    scanId ? getConsentScan(scanId) : getLatestConsentScan(),
    getConsentIndex(),
  ]);

  const rows = report ? sortFleetRows(report.rows) : [];
  const totalBlockers = rows.reduce((sum, r) => sum + r.totals.blockers, 0);
  const fixes = sharedFixes(rows);
  const siteList = rows.map((r) => `${r.client}\t${r.url}`).join("\n");

  // The index keeps the last 200 scans; page through them rather than truncating to the newest few.
  const history = [...index].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const pageCount = Math.max(1, Math.ceil(history.length / HISTORY_PAGE_SIZE));
  const page = Math.min(pageCount, Math.max(1, Number.parseInt(pageParam ?? "", 10) || 1));
  const pageScans = history.slice((page - 1) * HISTORY_PAGE_SIZE, page * HISTORY_PAGE_SIZE);
  const pageHref = (n: number) => `/consent?${new URLSearchParams({ ...(scanId ? { scan: scanId } : {}), page: String(n) })}`;

  return (
    <div className="min-h-screen bg-[#f9f8f6]">
      <TopNav />
      <PageTitle title="Privacy Compliance">
        <Link
          href="/consent/run"
          className="text-sm font-semibold text-white bg-[#1A1A1A] hover:bg-black px-3.5 py-2 rounded-lg transition-colors"
        >
          Bulk scan
        </Link>
      </PageTitle>

      <main className="max-w-[1600px] mx-auto px-6 lg:px-8 py-8 space-y-6">
        {!report ? (
          <Empty />
        ) : (
          <>
            <div className="flex items-end justify-between gap-4 flex-wrap">
              <div>
                <div className="text-sm text-[#6B6B6B]">
                  {formatDate(report.createdAt)} · region {report.region.toUpperCase()} · {report.totals.sites} site
                  {report.totals.sites === 1 ? "" : "s"} · {Math.round(report.durationMs / 1000)}s
                </div>
                {totalBlockers > 0 && (
                  <div className="mt-1 text-sm font-semibold text-[#B91C1C]">
                    {totalBlockers} blocker-severity failure{totalBlockers === 1 ? "" : "s"} across the fleet
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Link
                  href={`/consent/scan/${report.id}`}
                  className="shrink-0 text-xs font-semibold text-white bg-[#1A1A1A] hover:bg-black px-3 py-1.5 rounded-lg transition-colors"
                >
                  Shareable report
                </Link>
                <CopySiteListButton text={siteList} count={rows.length} />
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-[#E5E5E5] border border-[#E5E5E5] rounded-lg overflow-hidden">
              {[
                { label: "Clean", value: report.totals.ok, color: "#10B981" },
                { label: "With issues", value: report.totals.issues, color: report.totals.issues ? "#B91C1C" : undefined },
                { label: "Blocked", value: report.totals.blocked, color: undefined },
                { label: "Unreachable", value: report.totals.errored, color: report.totals.errored ? "#EA580C" : undefined },
              ].map((s) => (
                <div key={s.label} className="bg-white px-4 py-3">
                  <div className="text-2xl font-semibold tabular-nums" style={{ color: s.color ?? "#1A1A1A" }}>
                    {s.value}
                  </div>
                  <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-[#6B6B6B]">{s.label}</div>
                </div>
              ))}
            </div>

            {/* ── Fleet table ─────────────────────────────────────────────────────────────── */}
            <div className="bg-white border border-[#E5E5E5] rounded-lg overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-[#faf9f7] border-b border-[#E5E5E5] text-left">
                      {["Site", "CMP", "Status", "Score", "Blockers", "Results", "Report", "Findings"].map((h) => (
                        <th
                          key={h}
                          className={`px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-[#6B6B6B] whitespace-nowrap ${
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
                      const style = STATUS_STYLE[row.status];
                      return (
                        <tr key={row.slug} className="align-top hover:bg-[#faf9f7]">
                          <td className="px-4 py-3 max-w-[280px]">
                            <Link
                              href={`/consent/${row.slug}?scan=${report.id}`}
                              className="font-semibold text-[#1A1A1A] hover:underline truncate block"
                            >
                              {row.client}
                            </Link>
                            <a
                              href={row.url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-xs text-[#6B6B6B] hover:text-[#1A1A1A] truncate block"
                            >
                              {row.url}
                            </a>
                          </td>
                          <td className="px-4 py-3 text-[11px] font-mono text-[#6B6B6B] whitespace-nowrap">{row.cmp}</td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span
                              className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded"
                              style={{ color: style.color, backgroundColor: style.bg }}
                            >
                              {style.label}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right font-semibold tabular-nums">
                            {row.score === null ? (
                              <span
                                className="text-[#9A9A9A] font-normal text-xs"
                                title="Too little was confirmed to score — a number here would rate the site rather than the coverage."
                              >
                                n/s
                              </span>
                            ) : (
                              <span
                                style={{ color: colorForComplianceScore(row.score) }}
                                title={`${COMPLIANCE_BAND_LABEL[complianceBand(row.score)]} — 60+ healthy, 30+ improving`}
                              >
                                {row.score}
                              </span>
                            )}
                          </td>
                          <td
                            className="px-4 py-3 text-right font-semibold tabular-nums"
                            style={{ color: row.totals.blockers > 0 ? "#B91C1C" : "#9A9A9A" }}
                          >
                            {row.totals.blockers}
                          </td>
                          <td className="px-4 py-3 text-xs text-[#6B6B6B] whitespace-nowrap tabular-nums">
                            {row.totals.pass} pass · {row.totals.fail} fail
                            {row.totals.skipped > 0 && ` · ${row.totals.skipped} n/a`}
                            {/* Blocked is called out separately and never folded into "fail" — it means
                                the site could not be tested, which is a re-run, not a finding. */}
                            {row.totals.blocked > 0 && (
                              <span className="text-[#9A9A9A]"> · {row.totals.blocked} blocked</span>
                            )}
                            {row.totals.flaky > 0 && <span className="text-[#7C3AED]"> · {row.totals.flaky} flaky</span>}
                          </td>
                          <td className="px-4 py-3">
                            <Link
                              href={`/consent/${row.slug}?scan=${report.id}`}
                              className="text-xs font-semibold text-[#1A1A1A] hover:underline whitespace-nowrap"
                            >
                              Full report →
                            </Link>
                          </td>
                          <td className="px-4 py-3">
                            {row.error ? (
                              <span className="text-xs text-[#EA580C]">{row.error}</span>
                            ) : row.failedTests.length === 0 ? (
                              <span className="text-xs text-[#9A9A9A]">—</span>
                            ) : (
                              <div className="flex flex-wrap gap-1">
                                {row.failedTests.map((t) => (
                                  <span
                                    key={t.id}
                                    title={`${t.title} — ${t.detail}`}
                                    className="font-mono text-[10px] font-semibold px-1.5 py-0.5 rounded border cursor-help"
                                    style={{
                                      color: t.status === "flaky" ? "#7C3AED" : SEVERITY_COLOR[t.severity],
                                      borderColor: `${t.status === "flaky" ? "#7C3AED" : SEVERITY_COLOR[t.severity]}40`,
                                    }}
                                  >
                                    {t.id}
                                  </span>
                                ))}
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* ── Scan history ────────────────────────────────────────────────────────────── */}
            {history.length > 1 && (
              <div className="bg-white border border-[#E5E5E5] rounded-lg overflow-hidden">
                <div className="px-5 py-3 border-b border-[#E5E5E5] bg-[#faf9f7] flex items-center justify-between gap-3 flex-wrap">
                  <h2 className="text-sm font-semibold text-[#1A1A1A]">Scan history</h2>
                  <span className="text-xs text-[#6B6B6B]">
                    {history.length} scans · open one to see and copy its site list
                  </span>
                </div>
                <ul className="divide-y divide-[#E5E5E5]">
                  {pageScans.map((s) => (
                    <li key={s.id}>
                      <Link
                        href={`/consent?scan=${s.id}&page=${page}`}
                        className={`flex items-center justify-between gap-4 px-5 py-2.5 text-sm hover:bg-[#faf9f7] ${
                          s.id === report.id ? "bg-[#faf9f7] font-semibold text-[#1A1A1A]" : "text-[#1A1A1A]"
                        }`}
                      >
                        <span>{formatDate(s.createdAt)}</span>
                        <span className="text-xs font-normal text-[#6B6B6B] tabular-nums">
                          {s.region.toUpperCase()} · {s.totals.sites} site{s.totals.sites === 1 ? "" : "s"} ·{" "}
                          {s.totals.issues} with issues
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
                {pageCount > 1 && (
                  <div className="px-5 py-2.5 border-t border-[#E5E5E5] flex items-center justify-between text-xs text-[#6B6B6B]">
                    {page > 1 ? (
                      <Link href={pageHref(page - 1)} className="font-semibold text-[#1A1A1A] hover:underline">
                        ← Newer
                      </Link>
                    ) : (
                      <span />
                    )}
                    <span>
                      Page {page} of {pageCount}
                    </span>
                    {page < pageCount ? (
                      <Link href={pageHref(page + 1)} className="font-semibold text-[#1A1A1A] hover:underline">
                        Older →
                      </Link>
                    ) : (
                      <span />
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ── Shared fixes ────────────────────────────────────────────────────────────── */}
            {fixes.length > 0 && (
              <div className="bg-white border border-[#E5E5E5] rounded-lg overflow-hidden">
                <div className="px-5 py-3 border-b border-[#E5E5E5] bg-[#faf9f7]">
                  <h2 className="text-sm font-semibold text-[#1A1A1A]">Fixes that span more than one site</h2>
                  <p className="mt-0.5 text-xs text-[#6B6B6B]">
                    The same failure on several sites is usually one piece of work, not several.
                  </p>
                </div>
                <ul className="divide-y divide-[#E5E5E5]">
                  {fixes.map((f) => (
                    <li key={f.id} className="px-5 py-3.5">
                      <div className="flex items-baseline gap-2.5 flex-wrap">
                        <span
                          className="font-mono text-[11px] font-semibold shrink-0"
                          style={{ color: SEVERITY_COLOR[f.severity] }}
                        >
                          {f.id}
                        </span>
                        <span className="text-sm font-medium text-[#1A1A1A]">{f.title}</span>
                        <span className="text-xs text-[#6B6B6B]">
                          {f.sites.length} sites — {f.sites.join(", ")}
                        </span>
                      </div>
                      {f.recommendation && (
                        <p className="mt-1 text-xs text-[#6B6B6B] leading-relaxed max-w-[90ch]">{f.recommendation}</p>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <p className="text-xs text-[#9A9A9A] max-w-[70ch] leading-relaxed">
              Reports observed technical behaviour, not legal compliance. Scanned from the{" "}
              {report.region.toUpperCase()} region only. A <strong>blocked</strong> site was not proven either way — it is a
              gap in coverage to re-run, not a finding. A site is only marked <strong>Clean</strong> when enough of it
              was actually confirmed to say so — one that could barely be tested is reported as blocked rather than
              given the benefit of the doubt. Scores band at <strong>60+ healthy</strong>, <strong>30+ improving</strong>,
              below 30 at risk — a deliberately different scale from the Lighthouse-derived numbers elsewhere, because a
              confirmed blocker caps a site below 50 by design and full marks is not a realistic target for a live
              storefront running a marketing stack. Results marked <strong>n/a</strong> are tests the site&apos;s consent
              model makes inapplicable. A score of <strong>n/s</strong> means too little was confirmed to score at all.
              Scores are a weighted proportion of the tests that applied and were confirmed, so a site with a confirmed
              blocker-severity failure always falls below 50.
            </p>
          </>
        )}
      </main>
    </div>
  );
}
