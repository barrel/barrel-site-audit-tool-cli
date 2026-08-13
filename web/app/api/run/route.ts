import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

// This spawns the CLI as a real local child process — it can only ever do anything useful on
// the machine that also has Chrome, pnpm, and stores/*/theme available, i.e. someone running
// `pnpm dev` in web/ locally. The deployed Vercel instance has none of that, so refuse outright
// rather than let a spawn() fail confusingly deep in a serverless sandbox.
function assertLocal() {
  if (process.env.VERCEL) {
    throw new Error("Running an audit only works locally (pnpm dev in web/) — not on the deployed site.");
  }
}

function findRepoRoot(startDir = process.cwd()): string {
  let dir = startDir;
  for (let i = 0; i < 20; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("Could not find the repo root (no pnpm-workspace.yaml in any parent directory).");
}

// A bare slug (existing store) or any http(s) URL — same two forms the CLI's `run` accepts.
// Validated up front so nothing unvalidated ever reaches argv, and so a typo/flag-looking value
// fails fast with a clear message instead of confusing commander deep in the child process.
function validateTarget(value: string, label: string): string {
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

interface RunAuditBody {
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

function buildArgs(body: RunAuditBody): string[] {
  const target = validateTarget(body.target, "URL/slug");
  const args = ["barrel-audit", "run", target];

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
  // Always — this process's stdin isn't a TTY anyway, but a hung confirm() prompt with nothing
  // able to answer it would otherwise wedge the request forever.
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

// Single-flight — two concurrent CLI runs would fight over the same headless-Chrome resources
// on one machine. Module-scoped state is fine here: this route only makes sense against a
// single local dev server process, never a scaled/serverless deployment.
let activeRun: { target: string; startedAt: number } | null = null;

export async function POST(req: NextRequest) {
  try {
    assertLocal();
  } catch (err: any) {
    return new Response(err.message, { status: 501 });
  }

  const body = (await req.json().catch(() => null)) as RunAuditBody | null;
  if (!body) return new Response("Invalid request body.", { status: 400 });

  let args: string[];
  try {
    args = buildArgs(body);
  } catch (err: any) {
    return new Response(err.message ?? String(err), { status: 400 });
  }

  if (activeRun) {
    return new Response(
      `An audit is already running (${activeRun.target}, started ${new Date(activeRun.startedAt).toLocaleTimeString()}). Wait for it to finish before starting another.`,
      { status: 409 },
    );
  }

  let repoRoot: string;
  try {
    repoRoot = findRepoRoot();
  } catch (err: any) {
    return new Response(err.message, { status: 500 });
  }

  activeRun = { target: body.target, startedAt: Date.now() };

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const child = spawn("pnpm", args, { cwd: repoRoot, env: process.env, stdio: ["ignore", "pipe", "pipe"] });

      const forward = (chunk: Buffer) => controller.enqueue(encoder.encode(chunk.toString("utf-8")));
      child.stdout.on("data", forward);
      child.stderr.on("data", forward);

      child.on("error", (err) => {
        controller.enqueue(encoder.encode(`\nFailed to start: ${err.message}\n`));
        activeRun = null;
        controller.close();
      });

      child.on("close", (code) => {
        controller.enqueue(encoder.encode(`\n__BARREL_AUDIT_DONE__${code ?? -1}__\n`));
        activeRun = null;
        controller.close();
      });

      req.signal.addEventListener("abort", () => {
        child.kill();
      });
    },
  });

  return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
