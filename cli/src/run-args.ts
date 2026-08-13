// Shared by the `serve` HTTP agent (and reusable by any future in-process caller) for turning a
// dashboard-submitted run request into the exact argv `run` itself expects — validated up front
// so nothing unvalidated reaches a spawned child process's argv.

export interface RunAuditBody {
  target: string;
  skipCode?: boolean;
  skipPerformance?: boolean;
  skipAxe?: boolean;
  skipThemeArchitecture?: boolean;
  sitespeed?: boolean;
  skipHealth?: boolean;
  skipPixels?: boolean;
  skipGeoSeo?: boolean;
  skipAgentReadiness?: boolean;
  skipUx?: boolean;
  skipAnalytics?: boolean;
  skipScreenshots?: boolean;
  skipAiSuggestions?: boolean;
  skipSummary?: boolean;
  competitorUrls?: string[];
}

const MAX_COMPETITORS = 5;

// A bare slug (existing store) or any http(s) URL — same two forms the CLI's `run` accepts.
export function validateTarget(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label} is required.`);
  if (trimmed.includes("://")) {
    const parsed = new URL(trimmed); // throws on malformed input
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(`${label} must be an http(s) URL.`);
    }
    return trimmed;
  }
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(trimmed)) {
    throw new Error(`${label} must be a store slug (letters/numbers/hyphens) or a full https:// URL.`);
  }
  return trimmed;
}

export function buildRunArgs(body: RunAuditBody): string[] {
  const target = validateTarget(body.target, "URL/slug");
  const args = ["run", target];

  if (body.skipCode) args.push("--skip-code");
  if (body.skipPerformance) args.push("--skip-performance");
  if (body.skipAxe) args.push("--skip-axe");
  if (body.skipThemeArchitecture) args.push("--skip-theme-architecture");
  if (body.sitespeed) args.push("--sitespeed");
  if (body.skipHealth) args.push("--skip-health");
  if (body.skipPixels) args.push("--skip-pixels");
  if (body.skipGeoSeo) args.push("--skip-geo-seo");
  if (body.skipAgentReadiness) args.push("--skip-agent-readiness");
  if (body.skipUx) args.push("--skip-ux");
  if (body.skipAnalytics) args.push("--skip-analytics");
  if (body.skipScreenshots) args.push("--skip-screenshots");
  if (body.skipAiSuggestions) args.push("--skip-ai-suggestions");
  if (body.skipSummary) args.push("--skip-summary");
  // Always — stdin isn't a TTY when spawned this way anyway, but a hung confirm() prompt with
  // nothing able to answer it would otherwise wedge the request forever.
  args.push("--skip-github");

  const competitors = (body.competitorUrls ?? []).map((c) => c.trim()).filter(Boolean);
  if (competitors.length > MAX_COMPETITORS) {
    throw new Error(`At most ${MAX_COMPETITORS} competitor URLs are supported.`);
  }
  for (const c of competitors) {
    args.push("--competitor", validateTarget(c, "Competitor URL"));
  }

  return args;
}
