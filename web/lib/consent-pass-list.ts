// App-side copy of shared/src/consent-pass-list.ts.
//
// web/ deploys to Vercel as a self-contained directory and cannot import the shared workspace
// package — the same boundary web/lib/shared.ts exists for. The report section renders from here;
// the CLI prints the same list after a single-site scan from the original.
//
// shared/test/consent-pass-list.test.ts runs both implementations over the same section and asserts
// they agree, which is a stronger guard than comparing their source text.
//
// Every passing check already carries a plain-English confirmation in its `detail` — "No marketing
// cookies were set before a consent choice." The problem this solves is purely one of shape: those
// sentences are scattered through eight lettered suites, interleaved with the failures, so a reader
// asking "what is this site doing right?" has to reconstruct the answer. Nothing here re-derives a
// verdict; it regroups verdicts the scanner already reached.
//
// Derived at render time from a stored ConsentSection rather than written into the scan output, so
// archived reports gain the section without being re-scanned.

import type { ConsentSection, ConsentSuiteId, ConsentTestResult } from "./shared";

export interface ConsentPassItem {
  /** The originating test ID, kept so a pass is traceable back to the detailed list and the runbook. */
  id: string;
  /** The scanner's own confirmation sentence. */
  statement: string;
}

export interface ConsentPassGroup {
  suite: ConsentSuiteId;
  /** Client-facing heading. Suite letters mean nothing to the reader this section is for. */
  title: string;
  /** What this group is about. Deliberately a topic and not a verdict: a group can hold one
   * pass beside three failures listed elsewhere in the report, and an affirmative line here would
   * read as a claim about the site that its own passes do not support. */
  meaning: string;
  passes: ConsentPassItem[];
}

export interface ConsentPassList {
  passed: number;
  /** Checks that actually reached a verdict. Blocked and not-applicable checks are excluded so the
   * ratio reads as "of what we could test", never as a score inflated by untested checks. */
  verdicts: number;
  groups: ConsentPassGroup[];
  /** Non-essential tags seen firing after Accept and staying silent after Reject — the matrix's
   * positive finding, which the grid shows but never states. */
  heldBack: string[];
}

const GROUPS: Record<ConsentSuiteId, { title: string; meaning: string }> = {
  A: {
    title: "The banner and the choice it offers",
    meaning: "The consent platform, the banner a visitor actually sees, and whether refusing is as easy as agreeing.",
  },
  B: {
    title: "Before the visitor chooses",
    meaning: "What does and does not run before a choice has been made.",
  },
  C: {
    title: "When the visitor rejects",
    meaning: "Whether a refusal is honoured — tags kept off, and anything already set cleaned up.",
  },
  D: {
    title: "When the visitor accepts",
    meaning: "Whether acceptance reaches the tags, so the marketing data this site does have consent for still arrives.",
  },
  E: {
    title: "After the choice is made",
    meaning: "Whether the decision is remembered rather than the visitor being asked again.",
  },
  F: {
    title: "Analytics-only consent",
    meaning: "How a visitor who allows measurement but not advertising is treated.",
  },
  G: {
    title: "Controls the visitor can reach",
    meaning: "The disclosures and opt-out controls a visitor is entitled to find anywhere on the site.",
  },
  H: {
    title: "Closing the banner",
    meaning: "How walking away from the banner without answering it is treated.",
  },
};

const SUITE_ORDER: ConsentSuiteId[] = ["A", "B", "C", "D", "E", "F", "G", "H"];

/** A check that produced a verdict about the site, either way. `blocked` (we couldn't get far
 * enough to say) and `skipped` (not applicable here) are neither passes nor failures. */
function isVerdict(test: ConsentTestResult): boolean {
  return test.status === "pass" || test.status === "fail" || test.status === "flaky";
}

/** Takes the three fields it reads rather than a whole section, because the per-site page can
 * only offer those — it falls back to the fleet row's tests when the detail blob is missing. */
export type ConsentPassListInput = Pick<ConsentSection, "tests" | "states" | "trackers">;

export function buildConsentPassList(section: ConsentPassListInput): ConsentPassList {
  const passes = section.tests.filter((t) => t.status === "pass");

  const groups: ConsentPassGroup[] = [];
  for (const suite of SUITE_ORDER) {
    const inSuite = passes.filter((t) => t.suite === suite);
    if (inSuite.length === 0) continue;
    groups.push({
      suite,
      title: GROUPS[suite].title,
      meaning: GROUPS[suite].meaning,
      passes: inSuite.map((t) => ({ id: t.id, statement: t.detail })),
    });
  }

  return {
    passed: passes.length,
    verdicts: section.tests.filter(isVerdict).length,
    groups,
    heldBack: heldBackTrackers(section),
  };
}

/** Tags that demonstrably obey the visitor: they fired once consent was given, and did not fire
 * when it was refused. Asserted only when both states were actually driven — a tag that never
 * fired anywhere is a tag that isn't installed, which is not a compliance win. */
function heldBackTrackers(section: ConsentPassListInput): string[] {
  const reached = new Set(section.states.filter((s) => s.reached).map((s) => s.state));
  if (!reached.has("reject") || !reached.has("accept")) return [];

  return section.trackers
    .filter(
      (t) =>
        t.category !== "essential" &&
        t.firedIn.includes("accept") &&
        !t.firedIn.includes("reject") &&
        !t.firedIn.includes("clean"),
    )
    .map((t) => t.name);
}
