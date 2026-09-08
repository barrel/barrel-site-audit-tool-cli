// The site-diagnostic deck: the report's argument, one page per idea.
//
// A CRO audit's deck view has slides to show because a CRO audit *is* slides — the model writes
// them in the house format and the deck view renders what it wrote. A site diagnostic has no
// slides anywhere in it: it has fourteen sections of measurements, a synthesized executive
// summary, and a client-facing recommendation set. So this file composes the deck instead, in
// code, from what the finished report already says.
//
// Composed rather than generated, deliberately, for three reasons:
//   - Every figure on a slide is one this report measured. Nothing here can invent a number,
//     which is the failure mode the CRO deck needs a whole validator to defend against.
//   - It works on every report already in the dashboard, including ones archived long before the
//     deck existed, and costs no API key and no model call.
//   - The prose that needs to be written well — the standing, the strengths, the recommendations
//     — was already written well, by the run that produced the report. Re-writing it into slide
//     copy would be a second chance to say something the evidence doesn't support.
//
// What this file therefore owns is *selection and pagination*: which of the report's claims are
// deck-worthy, in what order they tell the story, and how many fit on a 16:9 page before the page
// clips them (the slide is `overflow: hidden`, so overflow is silent — the reason the char budget
// below exists at all).

import { buildRoadmap, collectAllFindings } from "./findings";
import { formatDate } from "./format";
import { gradeForScore, type ClientRecommendation, type Report } from "./shared";

/* ── Shape ──────────────────────────────────────────────────────────────────────────────────── */

/** One line on a slide.
 *
 * `lead` is the bolded half of the CRO deck's `Short title: short description` house format, used
 * wherever the source gives a real title to lead with (a recommendation, a named check). Report
 * prose that is already a whole sentence — an executive-summary key finding — arrives with no
 * lead, because splitting a sentence at its first clause to manufacture one reads worse than the
 * sentence did. */
export interface DeckBullet {
  lead?: string;
  text: string;
  /** Small uppercase label above the line: the area a recommendation moves, how much work it is. */
  tag?: string;
}

/** A scored area, rendered as a gauge row rather than a table row — the one place in the deck
 * where the number is the content. */
export interface DeckScore {
  label: string;
  score: number;
}

export interface DeckTableRow {
  label: string;
  cells: string[];
}

/** Structurally the same as CroTable, and named separately on purpose: the deck's tables are
 * rendered by a server component with no interactivity, and pulling in the CRO slide card to
 * reuse its grid would drag a client bundle into a page that needs none. */
export interface DeckTable {
  caption?: string;
  /** Header cells. The first names the row-label column. */
  columns: string[];
  rows: DeckTableRow[];
  /** Centre every column after the first — right for a grid of measurements, wrong for one whose
   * cells are phrases. */
  numeric?: boolean;
}

export interface DeckSlide {
  id: string;
  /** The uppercase label above the title, naming which part of the audit the page came from. */
  eyebrow: string;
  title: string;
  intro?: string;
  bullets: DeckBullet[];
  scores?: DeckScore[];
  table?: DeckTable;
  footnote?: string;
  /** The title page: centred, no eyebrow rules, one number. */
  cover?: boolean;
}

/** The house format's ceiling, copied from shared/src/cro-slides.ts: more than five lines stops
 * being a slide and starts being a list nobody reads out loud. */
const MAX_BULLETS_PER_SLIDE = 5;

// The two budgets below are measured against the rendered slide, not guessed at. A 1200px-wide
// deck page is 675px tall at 16:9; the padding takes 64, the eyebrow and title about 90, leaving
// roughly 520px of body. A wrapped line of body copy is ~25px and holds ~90 characters, and each
// bullet costs a 16px gap (plus 14px more when it carries a tag). Both numbers are then rounded
// down, because a slide that clips does it silently and a slide with room to spare only looks
// calm.

/** How much prose one 16:9 page holds when the page is prose and nothing else.
 *
 * The executive summary's overview runs to a paragraph and change on a real report — 900 to 1,100
 * characters is typical, and comfortably inside this. Past it the paragraph is split at a sentence
 * boundary onto a second page rather than trimmed: an overview that stops mid-argument is worse
 * than one that takes two slides to make it. */
const SLIDE_PROSE_BUDGET = 1800;

/** How much bullet text a 16:9 page holds.
 *
 * Five one-line bullets and three long ones occupy very different amounts of a slide, so the count
 * alone is not enough to paginate by — a report whose recommendations all carry a three-clause
 * "why" would overflow every page while staying inside the count limit, and one whose findings are
 * a line each would waste three quarters of every page to obey it. */
const SLIDE_CHAR_BUDGET = 1250;

/** How a continuation page is titled.
 *
 * Numbered rather than a bare "(cont.)": a rich report's recommendations run to eight pages, and
 * eight consecutive slides all headed "What we recommend next (cont.)" tell a reader nothing about
 * where they are in the argument. The first page keeps the plain title, so a deck that needed only
 * one page has no numbering on it at all. */
function pageTitle(title: string, index: number, total: number): string {
  return index === 0 ? title : `${title} (${index + 1} of ${total})`;
}

/** Splits one slide's worth of intent across as many pages as its bullets actually need.
 *
 * The intro rides on the first page only (repeating it costs a continuation a third of its room)
 * and the footnote on the last, where it reads as the close it was written to be. */
function paginate(slide: Omit<DeckSlide, "bullets">, bullets: DeckBullet[]): DeckSlide[] {
  if (bullets.length === 0) return [];

  const pages: DeckBullet[][] = [];
  let current: DeckBullet[] = [];
  let chars = 0;
  for (const bullet of bullets) {
    const cost = (bullet.lead?.length ?? 0) + bullet.text.length;
    const full = current.length >= MAX_BULLETS_PER_SLIDE || chars + cost > SLIDE_CHAR_BUDGET;
    if (current.length > 0 && full) {
      pages.push(current);
      current = [];
      chars = 0;
    }
    current.push(bullet);
    chars += cost;
  }
  if (current.length > 0) pages.push(current);

  return pages.map((page, i) => ({
    ...slide,
    id: i === 0 ? slide.id : `${slide.id}-${i + 1}`,
    title: pageTitle(slide.title, i, pages.length),
    intro: i === 0 ? slide.intro : undefined,
    footnote: i === pages.length - 1 ? slide.footnote : undefined,
    bullets: page,
  }));
}

/** Splits a paragraph across pages at sentence boundaries, never mid-sentence.
 *
 * The lookahead is what keeps "converts at 1.4% on mobile." one sentence: a bare split on "." cuts
 * decimals and abbreviations in half, which on the deck's opening slide would be the first thing a
 * client noticed. */
function proseSlides(slide: Omit<DeckSlide, "bullets">, text: string): DeckSlide[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.length <= SLIDE_PROSE_BUDGET) return [{ ...slide, intro: trimmed, bullets: [] }];

  const sentences = trimmed.split(/(?<=[.!?])\s+(?=[A-Z(“"'])/);
  const pages: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if (current && `${current} ${sentence}`.length > SLIDE_PROSE_BUDGET) {
      pages.push(current);
      current = sentence;
      continue;
    }
    current = current ? `${current} ${sentence}` : sentence;
  }
  if (current) pages.push(current);

  return pages.map((page, i) => ({
    ...slide,
    id: i === 0 ? slide.id : `${slide.id}-${i + 1}`,
    title: pageTitle(slide.title, i, pages.length),
    intro: page,
    bullets: [],
    footnote: i === pages.length - 1 ? slide.footnote : undefined,
  }));
}

/* ── The scorecard ──────────────────────────────────────────────────────────────────────────── */

/** Every area this run actually scored, in the order a client recognises them.
 *
 * Exported and consumed by build-report-sections.tsx as well, which is where this list used to
 * live: the Overview page's stat tiles and the deck's scorecard slide are the same claim about the
 * same run, and two copies of it would eventually disagree about whether a null security score
 * counts. */
export function reportScorecard(report: Report): DeckScore[] {
  const { sections } = report;
  const scores: DeckScore[] = [{ label: "Overall Score", score: report.overallScore }];
  if (sections.performance) scores.push({ label: "Performance", score: sections.performance.performance.score });
  if (sections.health) scores.push({ label: "Site Health", score: sections.health.score });
  if (sections.geoSeo) scores.push({ label: "SEO & GEO Health", score: sections.geoSeo.healthRating });
  if (sections.pixels) scores.push({ label: "Trust & Privacy", score: sections.pixels.score });
  // Only when there is a real number: a null score means too little was confirmed to rank, and a
  // stat tile has nowhere to say that.
  if (sections.security && sections.security.score !== null) {
    scores.push({ label: "Security", score: sections.security.score });
  }
  if (sections.themeStructure) scores.push({ label: "Theme Structure", score: sections.themeStructure.score });
  if (sections.code) scores.push({ label: "Theme Code", score: sections.code.score });
  return scores;
}

/* ── Slide builders ─────────────────────────────────────────────────────────────────────────── */

function coverSlide(report: Report): DeckSlide {
  return {
    id: "cover",
    eyebrow: "Site Diagnostic",
    title: report.storeName,
    intro: `${report.storeUrl} · ${formatDate(report.createdAt)}`,
    bullets: [],
    scores: [{ label: "Overall Score", score: report.overallScore }],
    cover: true,
  };
}

/** Where the storefront stands, in the report's own words.
 *
 * The prose is the recommendation set's headline where the run produced one — it is the only text
 * in the report written to open a client conversation — and the executive summary's overview
 * otherwise. With neither, a sentence stating what the audit measured, so the deck still opens on
 * something rather than jumping from the cover to a grid of numbers.
 *
 * Its own slide, separate from the scorecard it used to share: a real overview runs to a paragraph
 * and change, seven gauges take two rows, and a 16:9 page holds one of those two. */
function standingSlides(report: Report): DeckSlide[] {
  const areas = reportScorecard(report).length - 1;
  const prose =
    report.sections.recommendations?.headline ??
    report.sections.summary?.overview ??
    `This audit scored ${report.storeName} ${report.overallScore} out of 100 overall, across the ${areas} area${areas === 1 ? "" : "s"} it measured.`;

  return proseSlides({ id: "standing", eyebrow: "Where things stand", title: "The storefront today" }, prose);
}

/** Every score the run produced, as gauges.
 *
 * The evidence for the slide before it, and the one page in the deck a client is most likely to
 * photograph. */
function scorecardSlide(report: Report): DeckSlide {
  return {
    id: "scorecard",
    eyebrow: "Where things stand",
    title: "How the storefront scores",
    bullets: [],
    scores: reportScorecard(report),
    footnote: "Graded A to F on a 100-point scale: A is 90 and above, C is 70, anything under 50 is an F.",
  };
}

/** What the site already gets right.
 *
 * First slide after the standing on purpose: it is the one a client is least expecting and the
 * reason the rest of the deck lands as work to do rather than as a list of faults.
 *
 * The named strengths come from the recommendation set, which cites real figures for them. The
 * fallback is deliberately narrow — an area that scored an A, stated as the score it got — because
 * the alternative to a specific compliment is a generic one, and a generic one is worth less than
 * nothing in a client meeting. A run with neither has no slide here at all. */
function strengthsSlide(report: Report): DeckSlide[] {
  const strengths = report.sections.recommendations?.strengths ?? [];
  const bullets: DeckBullet[] =
    strengths.length > 0
      ? strengths.map((text) => ({ text }))
      : reportScorecard(report)
          .filter((s) => s.label !== "Overall Score" && s.score >= 90)
          .map((s) => ({ lead: s.label, text: `Scored ${s.score} out of 100 — an A on this audit's scale.` }));

  return paginate(
    { id: "strengths", eyebrow: "Credit where it is due", title: "What's already working" },
    bullets,
  );
}

/** The executive summary's key findings, verbatim.
 *
 * Verbatim because they were written as the handful of things worth saying about the run, which is
 * exactly what this slide is for. Nothing is re-ordered: the summary put them in the order it
 * meant them to be read. */
function keyFindingsSlide(report: Report): DeckSlide[] {
  const findings = report.sections.summary?.keyFindings ?? [];
  return paginate(
    { id: "key-findings", eyebrow: "What the audit found", title: "Key findings" },
    findings.map((text) => ({ text })),
  );
}

/** How fast the storefront is, in the four figures a client can hold in their head.
 *
 * Lab data, and the footnote says so — a Lighthouse number presented as what shoppers experience
 * is the single easiest way to lose an audience that has their own field data. */
function performanceSlide(report: Report): DeckSlide | null {
  const perf = report.sections.performance;
  if (!perf) return null;

  const rows: DeckTableRow[] = [
    { label: "Lighthouse performance (mobile)", cells: [`${perf.performance.score}/100`] },
  ];
  const vitals = perf.vitals;
  if (vitals?.lcp) rows.push({ label: "Largest Contentful Paint", cells: [vitals.lcp.displayValue] });
  if (vitals?.cls) rows.push({ label: "Cumulative Layout Shift", cells: [vitals.cls.displayValue] });
  if (vitals?.tbt) rows.push({ label: "Total Blocking Time", cells: [vitals.tbt.displayValue] });
  if (vitals?.speedIndex) rows.push({ label: "Speed Index", cells: [vitals.speedIndex.displayValue] });
  if (report.sections.accessibility) {
    rows.push({ label: "Accessibility (axe-core)", cells: [`${report.sections.accessibility.score}/100`] });
  }

  const journeyPages = [...new Set((perf.pages ?? []).map((p) => p.page))];

  return {
    id: "performance",
    eyebrow: "The numbers",
    title: "How the storefront performs",
    bullets: [],
    table: {
      columns: ["Measure", "Result"],
      rows,
      numeric: true,
      caption:
        journeyPages.length > 1
          ? `Measured across the ${journeyPages.length} pages carrying the shopping journey: ${journeyPages.join(", ")}.`
          : `Measured against ${perf.finalUrl}.`,
    },
    footnote: "A single mobile Lighthouse run against the live storefront — lab data, not field data.",
  };
}

/** The store's own GA4 numbers, when it has a property linked.
 *
 * In the deck because it is the only slide that says what the storefront is currently worth, which
 * is the frame every recommendation after it is judged against. */
function trafficSlide(report: Report): DeckSlide | null {
  const analytics = report.sections.analytics;
  if (!analytics) return null;

  const currency = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const topChannel = analytics.channels[0];
  const topDevice = analytics.devices[0];

  const rows: DeckTableRow[] = [
    { label: "Sessions", cells: [analytics.sessions.toLocaleString()] },
    { label: "Conversion rate", cells: [`${analytics.conversionRate}%`] },
    { label: "Transactions", cells: [analytics.transactions.toLocaleString()] },
    { label: "Average order value", cells: [currency(analytics.averageOrderValue)] },
    { label: "Revenue", cells: [currency(analytics.revenue)] },
  ];
  if (topChannel) {
    rows.push({
      label: "Largest channel",
      cells: [`${topChannel.label} · ${topChannel.sessions.toLocaleString()} sessions`],
    });
  }
  if (topDevice) {
    rows.push({
      label: "Largest device",
      cells: [`${topDevice.label} · ${topDevice.sessions.toLocaleString()} sessions`],
    });
  }

  return {
    id: "traffic",
    eyebrow: "The numbers",
    title: "Traffic and revenue today",
    bullets: [],
    table: {
      columns: ["Measure", "Result"],
      rows,
      numeric: true,
      caption: `Google Analytics 4, ${analytics.dateRangeLabel.toLowerCase()} · property ${analytics.propertyId}.`,
    },
  };
}

/** Consent and security exposure, and nothing else.
 *
 * Kept to the findings a client's legal or leadership side would want to hear about directly —
 * a marketing tag firing before a visitor agreed to it, a failing critical security control — and
 * capped hard. Everything else technical is on the dev-fix slide, and putting it here instead
 * would turn the one slide with regulatory weight into another list of lint. */
function exposureSlide(report: Report): DeckSlide[] {
  const bullets: DeckBullet[] = [];
  const { consent, security } = report.sections;

  const blockers = consent?.tests.filter((t) => t.severity === "blocker" && t.status === "fail") ?? [];
  for (const test of blockers.slice(0, 3)) {
    // No lead: a consent test's title states the behaviour the site was *supposed* to have ("No
    // marketing cookies before any interaction"), so bolding it in front of the failure produces a
    // line that contradicts itself. The scanner's own detail sentence is already self-contained.
    bullets.push({ text: test.detail, tag: "Consent" });
  }

  const criticalChecks = (security?.checks ?? [])
    .filter((c) => c.status === "fail" && (c.severity === "critical" || c.severity === "high"))
    .slice(0, 3);
  for (const check of criticalChecks) {
    // A security check's title is the control's name — a topic, not a verdict — so it leads.
    bullets.push({ lead: check.title, text: check.detail, tag: "Security" });
  }

  // The count, not the individual violations: the specific elements belong to the ADA tab, and a
  // client-facing slide that lists CSS selectors has changed audience mid-deck.
  const axeCritical = (report.sections.accessibility?.pages ?? []).reduce(
    (total, page) => total + page.violations.filter((v) => v.impact === "critical").length,
    0,
  );
  if (axeCritical > 0) {
    const pages = report.sections.accessibility?.pages.length ?? 0;
    bullets.push({
      lead: "Accessibility violations at critical impact",
      text: `${axeCritical} distinct critical-impact violation${axeCritical === 1 ? "" : "s"} across the ${pages} page${pages === 1 ? "" : "s"} scanned by axe-core, which is the class of issue that carries legal exposure as well as lost customers.`,
      tag: "Accessibility",
    });
  }

  return paginate(
    {
      id: "exposure",
      eyebrow: "Risk",
      title: "Where the exposure is",
      intro:
        consent && blockers.length > 0
          ? `The consent scan drove the storefront through its banner in five browser states. These are the failures at blocker severity — the ones where a tag ran despite the visitor's choice.`
          : undefined,
    },
    bullets,
  );
}

/** The recommendation set, one bullet per action: what to do, and why it matters commercially.
 *
 * `why` rather than `what` for the body. The deck's job at this point is to get agreement that the
 * work is worth doing; how it gets done is the next conversation, and it is on the report's own
 * Recommendations tab in full. */
function recommendationSlides(recommendations: ClientRecommendation[]): DeckSlide[] {
  return paginate(
    {
      id: "recommendations",
      eyebrow: "Recommendations",
      title: "What we recommend next",
      intro: `${recommendations.length} action${recommendations.length === 1 ? "" : "s"}, ordered by how much each should move conversion rather than by how severe it is technically.`,
      footnote: undefined,
    },
    recommendations.map((rec) => ({
      lead: rec.title,
      text: rec.why,
      tag: `${rec.area} · ${rec.effort}`,
    })),
  );
}

/** The quick wins, described as the work itself.
 *
 * The one slide where `what` beats `why`: a client agreeing to start somewhere wants to know what
 * is about to happen, and these are the items where the answer is short enough to say on a slide. */
function quickWinSlides(recommendations: ClientRecommendation[]): DeckSlide[] {
  const quick = recommendations.filter((rec) => rec.effort === "quick win");
  return paginate(
    {
      id: "quick-wins",
      eyebrow: "Where to start",
      title: "The quick wins",
      intro: "Small, self-contained changes — the ones worth doing before anything that needs a project around it.",
    },
    quick.map((rec) => ({ lead: rec.title, text: rec.what, tag: rec.area })),
  );
}

const EFFORT_PHASES: Array<{ effort: ClientRecommendation["effort"]; label: string }> = [
  { effort: "quick win", label: "Quick wins" },
  { effort: "moderate", label: "Moderate" },
  { effort: "larger project", label: "Larger projects" },
];

/** The same recommendations again, bucketed by how much work each is.
 *
 * Not a schedule, and it does not claim to be one: no dates, no sequence within a bucket, no
 * estimates. It answers the question that always follows the recommendation slides — "so what
 * would we actually take on first?" — with the only honest answer this report can give, which is
 * which items are small and which are not. */
function sequencingSlide(recommendations: ClientRecommendation[]): DeckSlide | null {
  const rows: DeckTableRow[] = [];
  for (const phase of EFFORT_PHASES) {
    const inPhase = recommendations.filter((rec) => rec.effort === phase.effort);
    if (inPhase.length === 0) continue;
    rows.push({
      label: `${phase.label} (${inPhase.length})`,
      cells: [inPhase.map((rec) => rec.title).join(" · ")],
    });
  }
  // One bucket holding everything is not a sequence, and a table saying so is a slide that adds
  // nothing to the recommendation list it follows.
  if (rows.length < 2) return null;

  return {
    id: "sequencing",
    eyebrow: "Where to start",
    title: "How the work splits up",
    bullets: [],
    table: { columns: ["Effort", "Actions"], rows },
    footnote: "Effort is our own estimate of scope, not a quote — and not an order of importance.",
  };
}

/** How long a fix title may run before it stops fitting one row of the dev-fix table. */
const MAX_FIX_CHARS = 68;

/** The prioritised technical list, for the developers in the room.
 *
 * Last in the deck because it is the only slide addressed to someone other than the client's
 * decision-maker, and short because the full list — with the remediation instructions, the file
 * and the line — is what the Dev To-Do tab exists for. */
function devFixSlide(report: Report): DeckSlide | null {
  const roadmap = buildRoadmap(collectAllFindings(report), 8);
  if (roadmap.length === 0) return null;

  return {
    id: "dev-fixes",
    eyebrow: "For the build team",
    title: "Top fixes, in priority order",
    bullets: [],
    table: {
      columns: ["Fix", "Where", "Severity", "Effort"],
      rows: roadmap.map((item) => ({
        label: `${item.priority}. ${item.fix.length > MAX_FIX_CHARS ? `${item.fix.slice(0, MAX_FIX_CHARS - 1).trimEnd()}…` : item.fix}`,
        // Severity is a lower-case token in the roadmap's own vocabulary; on a slide it is a word
        // in a column of words.
        cells: [item.scope, `${item.severity[0].toUpperCase()}${item.severity.slice(1)}`, item.effort],
      })),
    },
    footnote: "The full list, with the fix for each one, is on the report's Dev To-Do tab.",
  };
}

/* ── The deck ───────────────────────────────────────────────────────────────────────────────── */

/** Builds the whole deck, in presentation order.
 *
 * Every slide is conditional on the report actually carrying what it would say. A run made with
 * `--skip-summary --skip-recommendations` has no prose to present and gets a deck of scores,
 * measurements and fixes; a run with no theme code has no theme score on the scorecard. Nothing
 * is padded to keep the shape — a deck that invents a slide to look complete is worse than a
 * short one, because the short one is true. */
export function buildReportDeck(report: Report): DeckSlide[] {
  const recommendations = report.sections.recommendations?.recommendations ?? [];

  return [
    coverSlide(report),
    ...standingSlides(report),
    scorecardSlide(report),
    ...strengthsSlide(report),
    ...keyFindingsSlide(report),
    ...[performanceSlide(report), trafficSlide(report)].filter((s): s is DeckSlide => s !== null),
    ...exposureSlide(report),
    ...(recommendations.length > 0 ? recommendationSlides(recommendations) : []),
    ...(recommendations.length > 0 ? quickWinSlides(recommendations) : []),
    ...(recommendations.length > 0 ? [sequencingSlide(recommendations)].filter((s): s is DeckSlide => s !== null) : []),
    ...[devFixSlide(report)].filter((s): s is DeckSlide => s !== null),
  ];
}

/* ── The clipboard form ─────────────────────────────────────────────────────────────────────── */

function markdownTable(table: DeckTable): string[] {
  const header = `| ${table.columns.join(" | ")} |`;
  const rule = `| ${table.columns.map(() => "---").join(" | ")} |`;
  const rows = table.rows.map((row) => `| ${[row.label, ...row.cells].join(" | ")} |`);
  return [header, rule, ...rows, ...(table.caption ? ["", `_${table.caption}_`] : [])];
}

/** The deck as markdown, one heading per slide — what "drop it into a deck" actually means when
 * the deck lives in Google Slides or Keynote rather than in a browser.
 *
 * Identical in content to what the deck view renders, for the reason the CRO recommendation
 * clipboard gives: a slide built from the paste and a slide built from the page must not be able
 * to say different things. */
export function deckMarkdown(report: Report, slides: DeckSlide[]): string {
  const lines: string[] = [];

  for (const slide of slides) {
    if (slide.cover) {
      lines.push(`# ${slide.eyebrow} — ${slide.title}`, "");
      if (slide.intro) lines.push(slide.intro, "");
      lines.push(`Overall score: ${report.overallScore}/100 (${gradeForScore(report.overallScore)})`, "");
      continue;
    }

    lines.push(`## ${slide.title}`, "");
    if (slide.intro) lines.push(slide.intro, "");
    if (slide.scores) {
      for (const score of slide.scores) {
        lines.push(`- **${score.label}:** ${score.score}/100 (${gradeForScore(score.score)})`);
      }
      lines.push("");
    }
    for (const bullet of slide.bullets) {
      const tag = bullet.tag ? `[${bullet.tag}] ` : "";
      lines.push(bullet.lead ? `- ${tag}**${bullet.lead}:** ${bullet.text}` : `- ${tag}${bullet.text}`);
    }
    if (slide.bullets.length > 0) lines.push("");
    if (slide.table) lines.push(...markdownTable(slide.table), "");
    if (slide.footnote) lines.push(`_${slide.footnote}_`, "");
  }

  return lines.join("\n").trimEnd();
}
