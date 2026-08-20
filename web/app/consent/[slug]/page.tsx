import Link from "next/link";
import { notFound } from "next/navigation";
import { getConsentSiteDetail, getConsentScan, getLatestConsentScan } from "@/lib/data";
import { formatDate } from "@/lib/format";
import { screenshotUrl } from "@/lib/screenshot";
import { PrintButton } from "@/components/PrintButton";
import { PageTitle, TopNav } from "@/components/TopNav";
import type {
  ConsentCookie,
  ConsentSection,
  ConsentStateId,
  ConsentTestResult,
  ConsentTestStatus,
  TrackerCategory,
} from "@/lib/shared";

export const dynamic = "force-dynamic";

const STATE_ORDER: ConsentStateId[] = ["clean", "dismiss", "reject", "accept", "granular", "returning"];
const STATE_LABEL: Record<ConsentStateId, string> = {
  clean: "No choice made",
  dismiss: "Banner closed",
  reject: "Rejected all",
  accept: "Accepted all",
  granular: "Analytics only",
  returning: "Returning visitor",
};

const STATUS_LABEL: Record<ConsentTestStatus, string> = {
  pass: "Pass",
  fail: "Fail",
  blocked: "Blocked",
  skipped: "N/A",
  flaky: "Flaky",
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
  A: "Presence — is there a consent mechanism at all?",
  B: "Pre-consent — what happens before the visitor chooses",
  C: "Reject — does opting out actually stop anything?",
  D: "Accept — do the tags come back when permitted?",
  E: "Persistence — does the choice survive?",
  F: "Granular — analytics yes, marketing no",
  G: "Compliance surface — links, preference centre, GPC",
  H: "Dismissal — is closing the banner treated as a yes?",
};

/** Whether a tag firing in a given state was the right outcome.
 *
 * The whole report turns on this. "Meta Pixel fired" is neither good nor bad on its own — it is
 * correct after Accept and a blocker-severity failure after Reject. Stating the verdict in words
 * rather than colour is what makes the printed PDF answer the question a client actually asks:
 * "I opted out — did Meta stop?" */
function verdict(
  category: TrackerCategory,
  state: ConsentStateId,
  fired: boolean,
  reached: boolean,
): { label: string; color: string; note: string } {
  if (!reached) return { label: "—", color: "#C7C7C7", note: "This state could not be tested." };
  if (category === "essential") {
    return { label: fired ? "n/a" : "—", color: "#9A9A9A", note: "Essential — not gated by consent." };
  }
  const permitted =
    state === "accept" || state === "returning" || (state === "granular" && category === "analytics");

  if (fired) {
    return permitted
      ? { label: "OK", color: "#10B981", note: "Fired, and the visitor's choice permits it." }
      : { label: "FAIL", color: "#B91C1C", note: "Fired even though the visitor's choice should have blocked it." };
  }
  return permitted
    ? { label: "Silent", color: "#D97706", note: "Did not fire even though it was permitted — check attribution." }
    : { label: "OK", color: "#10B981", note: "Correctly blocked." };
}

/** Groups findings by the kind of exposure they describe.
 *
 * The suites are organised by *when* something was tested — before consent, after reject — which
 * is the right shape for running the scan and the wrong shape for reading it. Someone deciding
 * what to do needs the failures gathered by what they have in common.
 *
 * Each heading names an observed pattern and the rule family it belongs to. It deliberately stops
 * there: whether a given behaviour breaches a given statute depends on the visitors a site
 * actually has, and that is counsel's call, not a scanner's. */
const EXPOSURE_GROUPS: Array<{ key: string; title: string; blurb: string; tests: string[] }> = [
  {
    key: "pre-consent",
    title: "Tracking before consent",
    blurb:
      "Third-party tags that ran, or data that left the browser, before the visitor made any choice — including closing the banner without answering it, which is not agreement.",
    tests: ["B1", "B2", "B3", "B4", "B5", "A5", "H1", "H2"],
  },
  {
    key: "opt-out",
    title: "Opt-out effectiveness",
    blurb:
      "What actually happened after the visitor declined, and whether that decision was recorded, respected downstream and offered as prominently as accepting.",
    tests: ["C1", "C2", "C3", "C4", "C5", "F1", "F2", "A3", "G2"],
  },
  {
    key: "signals",
    title: "Browser opt-out signals",
    blurb: "How the site responded to a Global Privacy Control signal, and whether it told the visitor it had.",
    tests: ["G4", "G5"],
  },
  {
    key: "disclosure",
    title: "Notice and reachability",
    blurb: "Whether the required notices and opt-out controls exist and can be reached from anywhere on the site.",
    tests: ["A1", "A2", "G1", "G3", "E1", "E2", "E3", "E4"],
  },
  {
    key: "attribution",
    title: "Tags not firing when permitted",
    blurb:
      "The opposite failure, and the reason a scan cannot only look for over-firing: tags that stayed down after the visitor agreed cost measurement rather than compliance.",
    tests: ["D1", "D2", "D3"],
  },
];

function Chip({ status }: { status: ConsentTestStatus }) {
  return (
    <span
      className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded whitespace-nowrap"
      style={{ color: STATUS_COLOR[status], backgroundColor: `${STATUS_COLOR[status]}14` }}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="bg-white border border-[#E5E5E5] rounded-lg overflow-hidden break-inside-avoid">
      <div className="px-5 py-3 border-b border-[#E5E5E5] bg-[#faf9f7]">
        <h2 className="text-sm font-semibold text-[#1A1A1A]">{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs text-[#6B6B6B] max-w-[95ch] leading-relaxed">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

function CookieTable({ cookies }: { cookies: ConsentCookie[] }) {
  return (
    <table className="w-full text-xs border-collapse">
      <thead>
        <tr className="text-left text-[#6B6B6B]">
          <th className="py-1 pr-3 font-semibold">Cookie</th>
          <th className="py-1 pr-3 font-semibold">Domain</th>
          <th className="py-1 font-semibold">Category</th>
        </tr>
      </thead>
      <tbody>
        {cookies.map((c, i) => (
          <tr key={`${c.name}-${c.domain}-${i}`} className="border-t border-[#F0F0F0]">
            <td className="py-1 pr-3 font-mono text-[#1A1A1A]">{c.name}</td>
            <td className="py-1 pr-3 text-[#6B6B6B]">{c.domain}</td>
            <td className="py-1 capitalize" style={{ color: c.category === "marketing" ? "#B91C1C" : "#6B6B6B" }}>
              {c.category}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default async function ConsentSiteReport({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ scan?: string }>;
}) {
  const { slug } = await params;
  const { scan: scanId } = await searchParams;

  const report = scanId ? await getConsentScan(scanId) : await getLatestConsentScan();
  if (!report) notFound();
  const row = report.rows.find((r) => r.slug === slug);
  if (!row) notFound();

  const detail: ConsentSection | null = await getConsentSiteDetail(report.id, slug);
  const tests: ConsentTestResult[] = detail?.tests ?? row.tests ?? row.failedTests;
  const states = detail?.states ?? [];
  const reached = new Set(states.filter((s) => s.reached).map((s) => s.state));
  const trackers = detail?.trackers ?? [];

  const bySuite = new Map<string, ConsentTestResult[]>();
  for (const t of tests) {
    const list = bySuite.get(t.suite) ?? [];
    list.push(t);
    bySuite.set(t.suite, list);
  }

  const leaks = trackers.filter(
    (t) => t.category !== "essential" && (t.firedIn.includes("reject") || t.firedIn.includes("clean")),
  );

  return (
    <div className="min-h-screen bg-[#f9f8f6] print:bg-white">
      <TopNav />
      <PageTitle title={row.client}>
        <PrintButton />
        <Link href="/consent" className="text-sm font-medium text-[#1A1A1A] hover:text-[#6B6B6B]">
          All sites
        </Link>
      </PageTitle>

      <main className="max-w-[1200px] mx-auto px-6 lg:px-8 py-8 space-y-5 print:px-0 print:py-0 print:max-w-none">
        {/* ── Cover ──────────────────────────────────────────────────────────────────────── */}
        <div className="bg-white border border-[#E5E5E5] rounded-lg px-6 py-5 break-inside-avoid">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-[#6B6B6B]">
            Privacy Compliance report
          </div>
          <h1 className="mt-1 text-2xl font-semibold text-[#1A1A1A] tracking-tight">{row.client}</h1>
          <a href={row.url} target="_blank" rel="noreferrer" className="text-sm text-[#6B6B6B] hover:text-[#1A1A1A]">
            {row.url}
          </a>
          <dl className="mt-4 grid grid-cols-2 sm:grid-cols-5 gap-4 text-sm">
            {[
              ["Consent platform", detail?.cmpDetail ?? row.cmp],
              ["Region", report.region.toUpperCase()],
              ["Scanned", formatDate(report.createdAt)],
              ["Score", row.score === null ? "Not scored" : String(row.score)],
              ["Blockers", String(row.totals.blockers)],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-[10px] font-semibold uppercase tracking-wider text-[#6B6B6B]">{label}</dt>
                <dd
                  className="mt-0.5 font-semibold text-[#1A1A1A]"
                  style={label === "Blockers" && row.totals.blockers > 0 ? { color: "#B91C1C" } : undefined}
                >
                  {value}
                </dd>
              </div>
            ))}
          </dl>
          <div className="mt-4 flex flex-wrap gap-3 text-xs text-[#6B6B6B]">
            {(["pass", "fail", "skipped", "blocked", "flaky"] as ConsentTestStatus[]).map((s) => (
              <span key={s} className="flex items-center gap-1.5">
                <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: STATUS_COLOR[s] }} />
                {STATUS_LABEL[s]}{" "}
                <strong className="text-[#1A1A1A] tabular-nums">
                  {s === "skipped" ? row.totals.skipped : row.totals[s as keyof typeof row.totals]}
                </strong>
              </span>
            ))}
          </div>
        </div>

        {detail?.impliedConsent && (
          <div className="bg-white border border-[#E5E5E5] rounded-lg px-6 py-4 break-inside-avoid">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-[#6B6B6B]">This site does not ask</div>
            <p className="mt-1 text-sm text-[#1A1A1A] leading-relaxed max-w-[95ch]">{detail.impliedConsent}</p>
          </div>
        )}

        {/* ── The headline: did opting out actually stop the pixels? ─────────────────────── */}
        <Card
          title="What each tag did, under each consent choice"
          subtitle="Every state was driven in its own fresh browser. OK means the tag behaved as the visitor's choice requires; FAIL means it fired when that choice should have stopped it; Silent means it stayed down when it was allowed to run, which costs attribution rather than compliance."
        >
          {trackers.length === 0 ? (
            <p className="px-5 py-4 text-sm text-[#6B6B6B]">
              No recognised third-party tags were observed on this site.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-[#fafafa] border-b border-[#E5E5E5] text-left">
                    <th className="px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-[#6B6B6B]">Tag</th>
                    <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-[#6B6B6B]">Category</th>
                    {STATE_ORDER.map((s) => (
                      <th
                        key={s}
                        className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-[#6B6B6B] text-center whitespace-nowrap"
                      >
                        {STATE_LABEL[s]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5E5E5]">
                  {trackers.map((t) => (
                    <tr key={t.id} className="break-inside-avoid">
                      <td className="px-4 py-2 text-[#1A1A1A] whitespace-nowrap font-medium">{t.name}</td>
                      <td className="px-3 py-2 text-xs text-[#6B6B6B] capitalize">{t.category}</td>
                      {STATE_ORDER.map((s) => {
                        const v = verdict(t.category, s, t.firedIn.includes(s), reached.has(s));
                        return (
                          <td key={s} className="px-3 py-2 text-center">
                            <span
                              className="text-[11px] font-semibold tracking-wide"
                              style={{ color: v.color }}
                              title={v.note}
                            >
                              {v.label}
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {leaks.length > 0 && (
            <div className="px-5 py-3 border-t border-[#E5E5E5] text-xs text-[#B91C1C] leading-relaxed">
              <strong>{leaks.map((t) => t.name).join(", ")}</strong> ran without the visitor&apos;s permission — either
              before any choice was made, or after an explicit rejection.
            </div>
          )}
        </Card>

        {/* ── Exposure summary ───────────────────────────────────────────────────────────── */}
        <Card
          title="What this adds up to"
          subtitle="The same findings grouped by the kind of exposure they describe rather than by when they were tested. Observed behaviour only — whether any of it breaches a given statute depends on who visits this site, and is a question for counsel."
        >
          <ul className="divide-y divide-[#E5E5E5]">
            {EXPOSURE_GROUPS.map((g) => {
              const inGroup = tests.filter((t) => g.tests.includes(t.id));
              const failed = inGroup.filter((t) => t.status === "fail");
              const unproven = inGroup.filter((t) => t.status === "flaky" || t.status === "blocked");
              const confirmed = inGroup.filter((t) => t.status === "pass" || t.status === "fail");
              if (confirmed.length === 0 && unproven.length === 0) return null;
              const worst = failed.some((t) => t.severity === "blocker");
              return (
                <li key={g.key} className="px-5 py-3.5 break-inside-avoid">
                  <div className="flex items-baseline gap-2.5 flex-wrap">
                    <span className="text-sm font-semibold text-[#1A1A1A]">{g.title}</span>
                    <span
                      className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded"
                      style={
                        failed.length === 0
                          ? { color: "#10B981", backgroundColor: "#10B98114" }
                          : { color: worst ? "#B91C1C" : "#EA580C", backgroundColor: worst ? "#B91C1C14" : "#EA580C14" }
                      }
                    >
                      {failed.length === 0 ? "Nothing observed" : `${failed.length} finding${failed.length === 1 ? "" : "s"}`}
                    </span>
                    {unproven.length > 0 && (
                      <span className="text-xs text-[#9A9A9A]">{unproven.length} unproven</span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-[#6B6B6B] leading-relaxed max-w-[95ch]">{g.blurb}</p>
                  {failed.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {failed.map((t) => (
                        <li key={t.id} className="text-sm text-[#1A1A1A] flex gap-2">
                          <span
                            className="font-mono text-[11px] font-semibold shrink-0 mt-0.5"
                            style={{ color: SEVERITY_COLOR[t.severity] }}
                          >
                            {t.id}
                          </span>
                          <span className="text-[#6B6B6B]">{t.detail}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>

        {/* ── Every test ─────────────────────────────────────────────────────────────────── */}
        {[...bySuite.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([suite, list]) => (
            <Card key={suite} title={`Suite ${suite} — ${SUITE_LABEL[suite] ?? ""}`}>
              <ul className="divide-y divide-[#E5E5E5]">
                {list.map((t) => (
                  <li key={t.id} className="px-5 py-3.5 break-inside-avoid">
                    <div className="flex items-baseline gap-2.5 flex-wrap">
                      <span className="font-mono text-[11px] font-semibold" style={{ color: SEVERITY_COLOR[t.severity] }}>
                        {t.id}
                      </span>
                      <span className="text-sm font-medium text-[#1A1A1A]">{t.title}</span>
                      <Chip status={t.status} />
                      <span className="text-[10px] uppercase tracking-wider text-[#9A9A9A]">{t.severity}</span>
                    </div>
                    {t.detail && <p className="mt-1 text-sm text-[#6B6B6B] leading-relaxed max-w-[95ch]">{t.detail}</p>}
                    {t.recommendation && t.status !== "pass" && (
                      <p className="mt-1.5 text-xs text-[#1A1A1A] leading-relaxed max-w-[95ch]">
                        <span className="font-semibold">Fix: </span>
                        {t.recommendation}
                      </p>
                    )}
                    {t.evidence?.cookies && t.evidence.cookies.length > 0 && (
                      <div className="mt-2 max-w-[95ch]">
                        <CookieTable cookies={t.evidence.cookies} />
                      </div>
                    )}
                    {t.evidence?.requests && t.evidence.requests.length > 0 && (
                      <ul className="mt-2 space-y-0.5">
                        {t.evidence.requests.map((u, i) => (
                          <li key={i} className="font-mono text-[10px] text-[#6B6B6B] break-all leading-relaxed">
                            {u}
                          </li>
                        ))}
                      </ul>
                    )}
                    {t.evidence?.notes && t.evidence.notes.length > 0 && (
                      <ul className="mt-2 space-y-0.5">
                        {t.evidence.notes.map((n, i) => (
                          <li key={i} className="font-mono text-[10px] text-[#6B6B6B] break-all">
                            {n}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          ))}

        {/* ── State-by-state detail ──────────────────────────────────────────────────────── */}
        {states.length > 0 && (
          <Card
            title="State-by-state detail"
            subtitle="Each state ran in its own fresh incognito browser, so nothing carries over between them."
          >
            <ul className="divide-y divide-[#E5E5E5]">
              {STATE_ORDER.map((id) => {
                const s = states.find((x) => x.state === id);
                if (!s) return null;
                const marketing = s.cookies.filter((c) => c.category === "marketing");
                return (
                  <li key={id} className="px-5 py-4 break-inside-avoid">
                    <div className="flex items-baseline gap-3 flex-wrap">
                      <span className="text-sm font-semibold text-[#1A1A1A]">{STATE_LABEL[id]}</span>
                      {!s.reached && <Chip status="blocked" />}
                      <span className="text-xs text-[#6B6B6B]">
                        {s.requestCount} requests · {s.cookies.length} cookies
                        {marketing.length > 0 && (
                          <span className="text-[#B91C1C] font-semibold"> · {marketing.length} marketing</span>
                        )}
                      </span>
                    </div>
                    {!s.reached && s.blockedReason && (
                      <p className="mt-1 text-sm text-[#6B6B6B]">{s.blockedReason}</p>
                    )}
                    {s.marketingInterstitial && (
                      <p className="mt-1 text-sm text-[#D97706]">
                        A {s.marketingInterstitial} marketing interstitial was covering the page in this state. It can
                        sit over the consent banner, and its own vendor&apos;s tags load with it — read the rest of this
                        state with that in mind.
                      </p>
                    )}
                    {s.consentMode && (
                      <p className="mt-1.5 font-mono text-[10px] text-[#6B6B6B] break-all">
                        Consent Mode — default: {JSON.stringify(s.consentMode.default ?? null)} · update:{" "}
                        {JSON.stringify(s.consentMode.update ?? null)}
                      </p>
                    )}
                    {s.shopifyConsent && (
                      <p className="mt-1 font-mono text-[10px] text-[#6B6B6B] break-all">
                        Shopify Customer Privacy — {JSON.stringify(s.shopifyConsent)}
                      </p>
                    )}
                    {s.cookies.length > 0 && (
                      <div className="mt-2 max-w-[95ch]">
                        <CookieTable cookies={s.cookies} />
                      </div>
                    )}
                    {s.screenshotPath && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={screenshotUrl(s.screenshotPath)}
                        alt={`${STATE_LABEL[id]} state`}
                        className="mt-3 max-w-[560px] w-full rounded border border-[#E5E5E5]"
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>
        )}

        {!detail && (
          <p className="text-xs text-[#9A9A9A] leading-relaxed max-w-[80ch]">
            The full per-site detail blob was not found for this scan, so the tag matrix and state detail are
            unavailable — this scan predates them. Re-run the scan to populate them.
          </p>
        )}

        <p className="text-xs text-[#9A9A9A] max-w-[80ch] leading-relaxed">
          This report describes observed technical behaviour, not legal compliance. Scanned from the{" "}
          {report.region.toUpperCase()} region only. <strong>Blocked</strong> means the state could not be tested and was
          not proven either way; <strong>N/A</strong> means the site&apos;s consent model makes the test inapplicable;{" "}
          <strong>Flaky</strong> means two runs disagreed and the result is unconfirmed. Whether any behaviour here
          satisfies a given statute is a question for counsel.
        </p>
      </main>
    </div>
  );
}
