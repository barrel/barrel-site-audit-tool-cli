import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
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
  /** The client's ADA scope, pasted verbatim — verified item by item during the run. Passed to
   * the child through the environment rather than argv (see buildEnv below). */
  adaScope?: string;
  /** Absolute path to a theme checkout to read code from, i.e. `run --local-repo <path>`. Needed
   * because `run`'s "audit the theme I'm standing in" auto-detection works off the process's cwd,
   * which for a dashboard-triggered run is the repo root — never the client theme being worked on.
   * Mirrors validateLocalRepo() in cli/src/run-args.ts. */
  localRepo?: string;
}

const MAX_COMPETITORS = 5;
const MAX_ADA_SCOPE_CHARS = 20_000;

// The pasted ADA scope is multi-line, and one pasted with "- " bullets starts with a dash, which
// commander would read as the next flag rather than an option value — so it travels in the
// environment instead. Mirrors buildRunEnv() in cli/src/run-args.ts, which the local agent uses.
function buildEnv(body: RunAuditBody): Record<string, string> {
  const scope = body.adaScope?.trim();
  if (!scope) return {};
  if (scope.length > MAX_ADA_SCOPE_CHARS) {
    throw new Error(`The ADA scope is too long (${scope.length} characters, max ${MAX_ADA_SCOPE_CHARS}).`);
  }
  return { BARREL_ADA_SCOPE: scope };
}

// Absolute only: a relative path would resolve against the spawned process's cwd, not the directory
// the person filling in the dashboard has in mind. Mirrors validateLocalRepo() in
// cli/src/run-args.ts, which the local agent uses — web/ deploys standalone and can't import it.
function validateLocalRepo(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith("/")) {
    throw new Error(`The theme code path must be absolute — e.g. /Users/you/code/client-theme — not "${trimmed}".`);
  }
  return trimmed;
}

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

/** Stops a spawned audit and everything it started. An audit is a tree, not a process: `pnpm`
 * execs the CLI, which launches headless Chrome (Lighthouse, axe, pixels, screenshots) and
 * possibly sitespeed.io. Killing only the direct child would leave every one of those running —
 * burning CPU and holding the profile dirs the next run wants — and with `pnpm` in the middle it
 * wouldn't even stop the audit itself. So the child is spawned `detached` (making it a
 * process-group leader) and the negative pid signals the whole group: SIGTERM first so the CLI's
 * own cleanup can run, then SIGKILL for anything still alive.
 * Mirrored in killRunTree() in cli/src/commands/serve.ts, which does the same for agent-run
 * audits — web/ deploys standalone and can't import from cli/. */
function killRunTree(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  const pid = child.pid;
  const signal = (sig: NodeJS.Signals) => {
    try {
      process.kill(-pid, sig);
    } catch {
      // ESRCH — the group is already gone, which is the outcome we wanted anyway.
    }
  };
  signal("SIGTERM");
  const escalate = setTimeout(() => signal("SIGKILL"), 5_000);
  escalate.unref();
  child.once("close", () => clearTimeout(escalate));
}

// Single-flight — two concurrent CLI runs would fight over the same headless-Chrome resources
// on one machine. Module-scoped state is fine here: this route only makes sense against a
// single local dev server process, never a scaled/serverless deployment. The child is held on to
// so a stop request — and the dev server's own shutdown — can take the whole tree down.
let activeRun: { target: string; startedAt: number; child?: ChildProcess } | null = null;

// `detached` means the run no longer shares the dev server's process group, so Ctrl+C in the
// terminal running `pnpm dev` stops reaching it. Without this, restarting the dev server would
// leave a multi-minute audit (and its Chrome instances) running with nothing watching it.
// Hooked on "exit" rather than SIGINT/SIGTERM deliberately: registering a signal listener
// suppresses Node's default terminate-on-signal behaviour, and whether Ctrl+C still stopped the
// dev server would then depend on Next's own handler running after ours. "exit" runs on the way
// out either way, and the SIGTERM half of killRunTree is synchronous, which is all an exit handler
// is allowed to be.
if (!process.env.VERCEL) {
  process.once("exit", () => {
    if (activeRun?.child) killRunTree(activeRun.child);
  });
}

export async function POST(req: NextRequest) {
  try {
    assertLocal();
  } catch (err: any) {
    return new Response(err.message, { status: 501 });
  }

  const body = (await req.json().catch(() => null)) as RunAuditBody | null;
  if (!body) return new Response("Invalid request body.", { status: 400 });

  let args: string[];
  let runEnv: Record<string, string>;
  try {
    args = buildArgs(body);
    runEnv = buildEnv(body);
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
  let activeChild: ChildProcess | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // detached: true so the run is its own process group and killRunTree() can stop Chrome and
      // friends along with it — see there for why.
      const child = spawn("pnpm", args, {
        cwd: repoRoot,
        env: { ...process.env, ...runEnv },
        stdio: ["ignore", "pipe", "pipe"],
        detached: true,
      });
      if (activeRun) activeRun.child = child;

      // Every write to the stream goes through here because once the client has disconnected —
      // which is exactly what Stop does — enqueue() throws on the dead controller. Unguarded, that
      // threw out of the close handler before `activeRun = null` ever ran, and the single-flight
      // lock below then rejected every later run for the life of the dev server.
      const send = (text: string) => {
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          // Nobody is listening any more; the child's own exit handling is what matters now.
        }
      };
      const forward = (chunk: Buffer) => send(chunk.toString("utf-8"));
      child.stdout.on("data", forward);
      child.stderr.on("data", forward);

      let settled = false;
      const finish = (trailer: string) => {
        if (settled) return;
        settled = true;
        // First, so it happens whatever the stream does.
        activeRun = null;
        send(trailer);
        try {
          controller.close();
        } catch {
          // Already closed by the client's cancellation.
        }
      };

      child.on("error", (err) => finish(`\nFailed to start: ${err.message}\n`));
      child.on("close", (code) => finish(`\n__BARREL_AUDIT_DONE__${code ?? -1}__\n`));

      // The dashboard's "Stop audit" button aborts its fetch, which lands here. Anything else that
      // drops the connection (closed tab, lost network) means nobody is watching the output, so the
      // run stops for that too rather than continuing invisibly to completion.
      req.signal.addEventListener("abort", () => {
        killRunTree(child);
      });
      activeChild = child;
    },
    // Fires when the consumer of the response body goes away, which is the most direct signal that
    // the dashboard's Stop button (or a closed tab) ended the run — req.signal covers the same
    // ground, and either one alone is enough; killRunTree is idempotent.
    cancel() {
      if (activeChild) killRunTree(activeChild);
    },
  });

  return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
