import type { AdaScopeItem, AdaScopeSection, AdaScopeStatus } from "./shared";

/** Plain-text renderings of an ADA scope review: one for the client, one for the developer.
 * Kept here rather than in the component (alongside formatDevTodoMarkdown/Csv in findings.ts)
 * because they're pure text formatting — the part most worth getting right, since a PM or AM
 * pastes the client version straight into an email. */

export const ADA_STATUS_META: Record<
  AdaScopeStatus,
  {
    /** Report-facing label. */
    label: string;
    color: string;
    /** Plain-English phrasing for the client-facing copy — no tooling vocabulary. */
    clientLabel: string;
    /** Marker used in the copied plain-text summary. */
    marker: string;
    /** Whether the checkbox reflects an automated verdict, or is the reader's to tick. */
    checkbox: "checked" | "unchecked" | "reader";
  }
> = {
  complete: { label: "Complete", color: "#10B981", clientLabel: "Verified in place", marker: "[x]", checkbox: "checked" },
  partial: { label: "Partial", color: "#D97706", clientLabel: "Partly in place", marker: "[~]", checkbox: "unchecked" },
  incomplete: { label: "Incomplete", color: "#B91C1C", clientLabel: "Not yet in place", marker: "[ ]", checkbox: "unchecked" },
  manual: { label: "Manual check", color: "#3B82F6", clientLabel: "Needs a manual check", marker: "[?]", checkbox: "reader" },
  unverified: { label: "Not checked", color: "#9A9A9A", clientLabel: "Not covered by this run", marker: "[-]", checkbox: "reader" },
};

/** Actions and evidence carry `backticks` around selectors and code so the same strings work as
 * markdown in a ticket — stripped for the client-facing plain-text version. */
export function stripTicks(text: string): string {
  return text.replace(/`/g, "");
}

/** The email a PM/AM actually sends: what was scoped, what's verified, what's outstanding, in
 * plain language and with no selectors or rule IDs. */
export function buildAdaClientSummary(section: AdaScopeSection, storeName: string, reportDate: string): string {
  const lines: string[] = [];
  lines.push(`Accessibility (ADA) scope review — ${storeName}`);
  lines.push(reportDate);
  lines.push("");
  lines.push(
    `${section.completeCount} of ${section.items.length} scoped items are verified in place` +
      (section.coverage > 0 || section.completeCount > 0
        ? ` (${section.coverage}% of the items we can verify automatically).`
        : "."),
  );
  const scores: string[] = [];
  if (section.lighthouseAccessibilityScore !== undefined) {
    scores.push(`Google Lighthouse accessibility score: ${section.lighthouseAccessibilityScore}/100`);
  }
  if (section.axeScore !== undefined) scores.push(`axe automated scan: ${section.axeScore}/100`);
  if (scores.length > 0) lines.push(scores.join(" · "));
  if (section.pagesScanned.length > 0) lines.push(`Pages checked: ${section.pagesScanned.join(", ")}`);
  lines.push("");

  let lastGroup: string | undefined;
  for (const item of section.items) {
    if (item.group && item.group !== lastGroup) {
      lines.push(`${item.group}:`);
      lastGroup = item.group;
    }
    const meta = ADA_STATUS_META[item.status];
    lines.push(`${meta.marker} ${item.text} — ${meta.clientLabel}`);
  }

  const outstanding = section.items.filter((i) => i.status === "incomplete" || i.status === "partial");
  if (outstanding.length > 0) {
    lines.push("");
    lines.push("Outstanding — what we're fixing next:");
    for (const item of outstanding) {
      lines.push(`- ${item.text}${item.affectedCount ? ` (${item.affectedCount} elements affected)` : ""}`);
    }
  }

  const manual = section.items.filter((i) => i.status === "manual");
  if (manual.length > 0) {
    lines.push("");
    lines.push("Requires a manual check (no automated test can confirm these):");
    for (const item of manual) lines.push(`- ${item.text}`);
  }

  // Kept separate from the manual list on purpose: an automated check does exist for these, it
  // just didn't run in this audit. Telling a client otherwise would be wrong.
  const notCovered = section.items.filter((i) => i.status === "unverified");
  if (notCovered.length > 0) {
    lines.push("");
    lines.push("Not covered by this run — will be confirmed on the next audit:");
    for (const item of notCovered) lines.push(`- ${item.text}`);
  }

  lines.push("");
  lines.push(
    "Verified with axe-core and Google Lighthouse, plus a live keyboard/focus pass on each page above. " +
      "Automated testing covers a large share of WCAG A/AA criteria but not all of them — items marked as needing " +
      "a manual check are reviewed by hand.",
  );
  return lines.join("\n");
}

/** The developer's version: every outstanding item with its real evidence and action. */
export function buildAdaDevActions(section: AdaScopeSection, storeName: string): string {
  const lines: string[] = [`# ADA scope — outstanding items (${storeName})`, ""];
  const open = section.items.filter((i) => i.status !== "complete");
  if (open.length === 0) {
    lines.push("Every automatically-verifiable scope item passed. Nothing outstanding.");
    return lines.join("\n");
  }
  for (const item of open) {
    lines.push(`## ${item.text}`);
    lines.push(`Status: ${ADA_STATUS_META[item.status].label}${item.affectedCount ? ` · ${item.affectedCount} element(s) affected` : ""}`);
    for (const e of item.evidence) {
      lines.push(`- ${e.source}${e.page ? ` (${e.page})` : ""}: ${e.detail}`);
      if (e.selectors?.length) lines.push(`  Elements: ${e.selectors.join(", ")}`);
    }
    if (item.action) {
      lines.push("");
      lines.push(`**Action:** ${item.action}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
