import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import * as chromeLauncher from "chrome-launcher";
import type { AxeImpact, AxePageResult, AxeViolation, AccessibilitySection, HealthCheckItem, HealthStatus } from "@barrel/site-audit-shared";
import { discoverJourneyPages } from "./journey.js";

// Same rationale as ux.ts: chrome-launcher's default headless UA advertises itself as
// "HeadlessChrome", an unnecessary bot signal for a legitimate audit tool to send.
const DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Same throttle as ux.ts — one browser session, pages loaded sequentially with a
 * human-plausible pause, nothing that looks like a scraper hammering the site. */
function throttleDelay(): Promise<void> {
  return sleep(2000 + Math.random() * 2000);
}

const AXE_SOURCE = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf-8");

// axe-core's own rule taxonomy (the `cat.*` tags every rule carries) — used as-is for the
// readiness checklist rather than an invented category list, so it always matches what axe
// actually checked.
const AXE_CATEGORY_LABELS: Record<string, string> = {
  "cat.aria": "ARIA usage",
  "cat.color": "Color & contrast",
  "cat.forms": "Forms",
  "cat.keyboard": "Keyboard accessibility",
  "cat.language": "Page language",
  "cat.name-role-value": "Name, role & value",
  "cat.parsing": "HTML parsing & validity",
  "cat.semantics": "Semantic markup",
  "cat.sensory-and-visual-cues": "Sensory & visual cues",
  "cat.structure": "Document structure",
  "cat.tables": "Data tables",
  "cat.text-alternatives": "Text alternatives (alt text)",
  "cat.time-and-media": "Time-based media",
};

const IMPACT_WEIGHT: Record<AxeImpact, number> = { critical: 25, serious: 15, moderate: 7, minor: 3 };
const IMPACT_RANK: Record<AxeImpact, number> = { critical: 0, serious: 1, moderate: 2, minor: 3 };

interface RawAxeNode {
  target: string[];
  html: string;
  failureSummary?: string;
}

interface RawAxeResult {
  id: string;
  impact: AxeImpact | null;
  description: string;
  help: string;
  helpUrl: string;
  tags: string[];
  nodes: RawAxeNode[];
}

async function scanPage(
  page: import("puppeteer-core").Page,
  url: string,
): Promise<{ violations: RawAxeResult[]; passCount: number; incompleteCount: number } | null> {
  const response = await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 }).catch(() => null);
  if (!response || !response.ok()) return null;

  await page.addScriptTag({ content: AXE_SOURCE });
  const results = await page.evaluate(() => {
    // axe is injected globally by AXE_SOURCE above.
    return (window as any).axe.run(document, { resultTypes: ["violations", "passes", "incomplete"] });
  });

  return {
    violations: (results.violations ?? []) as RawAxeResult[],
    passCount: (results.passes ?? []).length,
    incompleteCount: (results.incomplete ?? []).length,
  };
}

function toViolation(raw: RawAxeResult): AxeViolation {
  return {
    id: raw.id,
    impact: raw.impact,
    description: raw.description,
    help: raw.help,
    helpUrl: raw.helpUrl,
    tags: raw.tags,
    nodeCount: raw.nodes.length,
    nodes: raw.nodes.slice(0, 5).map((n) => ({
      target: n.target,
      html: n.html,
      failureSummary: n.failureSummary,
    })),
  };
}

function scoreForViolations(violations: AxeViolation[]): number {
  const penalty = violations.reduce((sum, v) => {
    const weight = v.impact ? IMPACT_WEIGHT[v.impact] : IMPACT_WEIGHT.moderate;
    return sum + weight * Math.min(v.nodeCount, 5);
  }, 0);
  return Math.max(0, 100 - penalty);
}

function buildChecklist(pages: AxePageResult[]): HealthCheckItem[] {
  const allViolations = pages.flatMap((p) => p.violations.map((v) => ({ ...v, page: p.page })));

  return Object.entries(AXE_CATEGORY_LABELS).map(([tag, label]) => {
    const matches = allViolations.filter((v) => v.tags.includes(tag));
    const id = `axe-cat-${tag.replace("cat.", "")}`;

    if (matches.length === 0) {
      return {
        id,
        label,
        status: "pass" as HealthStatus,
        detail: `No axe-detected issues in this category across ${pages.length} page(s) scanned.`,
      };
    }

    const worst = [...matches].sort((a, b) => IMPACT_RANK[a.impact ?? "moderate"] - IMPACT_RANK[b.impact ?? "moderate"])[0];
    const status: HealthStatus = worst.impact === "critical" || worst.impact === "serious" ? "fail" : "warn";
    const nodeCount = matches.reduce((sum, v) => sum + v.nodeCount, 0);

    return {
      id,
      label,
      status,
      detail: `${matches.length} rule(s), ${nodeCount} element(s) affected — e.g. "${worst.help}" on the ${worst.page} page.`,
      recommendation: `Learn more: ${worst.helpUrl}`,
    };
  });
}

/** Automated accessibility scan (axe-core) across every discovered journey page — a second,
 * independent signal alongside Lighthouse's accessibility category, since axe's rule set
 * catches issues (keyboard traps, ARIA misuse on post-load interactive widgets) that
 * Lighthouse's audit set doesn't. Throttled the same way as ux.ts: one browser session,
 * sequential loads with a randomized pause, a normal desktop UA. Returns null (never throws)
 * if not even the homepage could be scanned. */
export async function analyzeAccessibility(baseUrl: string): Promise<AccessibilitySection | null> {
  const journeyPages = await discoverJourneyPages(baseUrl);
  const chrome = await chromeLauncher.launch({
    chromeFlags: ["--headless=new", "--no-sandbox", "--disable-gpu"],
  });

  try {
    const puppeteer = (await import("puppeteer-core")).default;
    const browser = await puppeteer.connect({ browserURL: `http://localhost:${chrome.port}` });

    try {
      const page = await browser.newPage();
      await page.setUserAgent(DESKTOP_UA);
      await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });
      await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });

      const pages: AxePageResult[] = [];

      for (let i = 0; i < journeyPages.length; i++) {
        const { page: pageName, url } = journeyPages[i];
        if (i > 0) await throttleDelay();

        const result = await scanPage(page, url).catch(() => null);
        if (!result) continue;

        pages.push({
          page: pageName,
          url,
          violations: result.violations.map(toViolation),
          passCount: result.passCount,
          incompleteCount: result.incompleteCount,
        });
      }

      if (pages.length === 0) return null;

      const score = Math.round(
        pages.reduce((sum, p) => sum + scoreForViolations(p.violations), 0) / pages.length,
      );

      return { score, pages, checklist: buildChecklist(pages) };
    } finally {
      await browser.disconnect();
    }
  } catch {
    return null;
  } finally {
    await chrome.kill();
  }
}
