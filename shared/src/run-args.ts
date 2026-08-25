// Turns a dashboard-submitted run request into the exact argv `run` itself expects, validated up
// front so nothing unvalidated reaches a spawned child process's argv. Lives in shared/ because
// three separate callers need to agree on it exactly: the `serve` local agent, the local-dev
// /api/run route, and the cloud runner that assembles the same command inside a sandbox.

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
  skipRecommendations?: boolean;
  competitorUrls?: string[];
  /** The client's ADA scope, pasted verbatim — verified item by item during the run. */
  adaScope?: string;
  /** Absolute path to a theme checkout to read code from, i.e. `run --local-repo <path>`. The
   * dashboard needs this because `run`'s "audit the theme I'm standing in" auto-detection works off
   * the process's cwd, and a dashboard-triggered run is spawned in the data root — never in the
   * repo the user is actually working on. */
  localRepo?: string;
}

const MAX_COMPETITORS = 5;
const MAX_ADA_SCOPE_CHARS = 20_000;

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

/** Absolute only: a relative path would resolve against the spawned process's cwd (the data root),
 * not the directory the person filling in the dashboard has in mind. The leading-dash check keeps a
 * path from being read as the next flag — argv here is an array, never a shell string, so this is
 * about commander's parsing rather than injection. */
export function validateLocalRepo(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith("/")) {
    throw new Error(
      `The theme code path must be absolute — e.g. /Users/you/code/client-theme — not "${trimmed}".`,
    );
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
  if (body.skipRecommendations) args.push("--skip-recommendations");
  // Always — stdin isn't a TTY when spawned this way anyway, but a hung confirm() prompt with
  // nothing able to answer it would otherwise wedge the request forever.
  args.push("--skip-github");

  if (body.localRepo?.trim()) args.push("--local-repo", validateLocalRepo(body.localRepo));

  const competitors = (body.competitorUrls ?? []).map((c) => c.trim()).filter(Boolean);
  if (competitors.length > MAX_COMPETITORS) {
    throw new Error(`At most ${MAX_COMPETITORS} competitor URLs are supported.`);
  }
  for (const c of competitors) {
    args.push("--competitor", validateTarget(c, "Competitor URL"));
  }

  return args;
}

/** Environment for the spawned `run` process. The pasted ADA scope travels here rather than in
 * argv: it's multi-line, and a scope pasted with "- " bullets starts with a dash, which commander
 * would read as the next flag instead of an option value. */
export function buildRunEnv(body: RunAuditBody): Record<string, string> {
  const scope = body.adaScope?.trim();
  if (!scope) return {};
  if (scope.length > MAX_ADA_SCOPE_CHARS) {
    throw new Error(`The ADA scope is too long (${scope.length} characters, max ${MAX_ADA_SCOPE_CHARS}).`);
  }
  return { BARREL_ADA_SCOPE: scope };
}
