import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

// Spawns the CRO capture as a real local child process — it can only ever do anything useful on a
// machine that also has Chrome and pnpm, i.e. someone running `pnpm dev` in web/ locally. The
// deployed Vercel instance has neither, so refuse outright rather than let a spawn() fail
// confusingly deep in a serverless sandbox.
//
// Mirrors web/app/api/run/route.ts, which does the same for a site audit. The two are separate
// modules (and separate single-flight locks) because they are separate commands; the shared
// machinery that matters — killing the whole process tree, the guarded stream writes — is
// duplicated deliberately and identically, since web/ deploys standalone and cannot import from
// cli/. The local agent (cli/src/commands/serve.ts) has one copy of this for both commands and is
// the path that works from the deployed dashboard.
function assertLocal() {
  if (process.env.VERCEL) {
    throw new Error(
      "A CRO capture drives a real browser, so it runs from your machine rather than on the deployed site. " +
        "Start the local agent with `barrel-audit serve` and this page will use it, or run " +
        "`pnpm barrel-audit cro <url>` locally — the report publishes to this dashboard when it finishes.",
    );
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

// A bare slug (existing store) or any http(s) URL — the same two forms the CLI's `cro` accepts.
// Validated up front so nothing unvalidated ever reaches argv. Mirrors validateTarget() in
// shared/src/run-args.ts.
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

const CRO_PAGE_GROUPS = ["nav", "home", "plp", "pdp", "cart", "checkout", "search"];
const CRO_DEVICES = ["mobile", "desktop"];
const MAX_CRO_COMPETITORS = 3;

// Mirrors CroRunBody in shared/src/cro-run-args.ts — see shared/test/mirror-drift.test.ts, which
// compares the two builders field by field and flag by flag.
interface CroRunBody {
  target: string;
  skipUx?: boolean;
  skipCompetitors?: boolean;
  captureOnly?: boolean;
  checkout?: boolean;
  groups?: string[];
  devices?: string[];
  competitorUrls?: string[];
}

function validateList(values: string[], allowed: string[], label: string): string[] {
  const out: string[] = [];
  for (const raw of values) {
    const value = raw.trim().toLowerCase();
    if (!value) continue;
    if (!allowed.includes(value)) throw new Error(`"${raw}" is not a ${label}. Expected one of: ${allowed.join(", ")}.`);
    if (!out.includes(value)) out.push(value);
  }
  return out;
}

function buildArgs(body: CroRunBody): string[] {
  const target = validateTarget(body.target, "URL/slug");
  const args = ["barrel-audit", "cro", target];

  if (body.skipUx) args.push("--skip-ux");
  if (body.skipCompetitors) args.push("--skip-competitors");
  if (body.captureOnly) args.push("--capture-only");
  if (body.checkout) args.push("--checkout");

  const groups = validateList(body.groups ?? [], CRO_PAGE_GROUPS, "page group");
  if (groups.length > 0) args.push("--groups", groups.join(","));

  const devices = validateList(body.devices ?? [], CRO_DEVICES, "device");
  if (devices.length > 0) args.push("--devices", devices.join(","));

  const competitors = (body.competitorUrls ?? []).map((c) => c.trim()).filter(Boolean);
  if (competitors.length > MAX_CRO_COMPETITORS) {
    throw new Error(`At most ${MAX_CRO_COMPETITORS} competitor URLs are supported.`);
  }
  for (const c of competitors) {
    args.push("--competitor", validateTarget(c, "Competitor URL"));
  }

  return args;
}

/** Stops a spawned capture and everything it started. A capture is a tree, not a process: `pnpm`
 * execs the CLI, which launches headless Chrome. Killing only the direct child would leave that
 * running, and with `pnpm` in the middle it would not even stop the capture. So the child is
 * spawned `detached` (making it a process-group leader) and the negative pid signals the whole
 * group: SIGTERM first so the CLI's own cleanup can run, then SIGKILL for anything still alive.
 * Mirrors killRunTree() in web/app/api/run/route.ts and cli/src/commands/serve.ts. */
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

// Single-flight — two concurrent captures would fight over the same headless-Chrome resources on
// one machine. Module-scoped state is fine here: this route only makes sense against a single local
// dev server process, never a scaled/serverless deployment. Separate from /api/run's lock because
// they are separate modules; starting a capture during a site audit would be slow but not incorrect.
let activeRun: { target: string; startedAt: number; child?: ChildProcess } | null = null;

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

  const body = (await req.json().catch(() => null)) as CroRunBody | null;
  if (!body) return new Response("Invalid request body.", { status: 400 });

  let args: string[];
  try {
    args = buildArgs(body);
  } catch (err: any) {
    return new Response(err.message ?? String(err), { status: 400 });
  }

  if (activeRun) {
    return new Response(
      `A CRO capture is already running (${activeRun.target}, started ${new Date(activeRun.startedAt).toLocaleTimeString()}). Wait for it to finish before starting another.`,
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
      const child = spawn("pnpm", args, {
        cwd: repoRoot,
        env: { ...process.env, FORCE_COLOR: "0" },
        stdio: ["ignore", "pipe", "pipe"],
        detached: true,
      });
      if (activeRun) activeRun.child = child;

      // Guarded: once the client has disconnected — which is what Stop does — enqueue() throws on
      // the dead controller, and unguarded that throws out of the close handler before the
      // single-flight lock is released, rejecting every later run for the life of the dev server.
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
        activeRun = null;
        send(trailer);
        try {
          controller.close();
        } catch {
          // Already closed by the client's cancellation.
        }
      };

      child.on("error", (err) => finish(`\nFailed to start: ${err.message}\n`));
      child.on("close", (code) => finish(`\n__BARREL_CRO_DONE__${code ?? -1}__\n`));

      req.signal.addEventListener("abort", () => killRunTree(child));
      activeChild = child;
    },
    cancel() {
      if (activeChild) killRunTree(activeChild);
    },
  });

  return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
