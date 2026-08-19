import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

/** Same constraint as /api/run: this spawns the real CLI, which needs Chrome, pnpm and a checkout.
 * The deployed Vercel instance has none of those, so refuse up front rather than fail confusingly
 * deep inside a serverless function.
 *
 * The page renders a copyable command instead of a Run button when it detects the same condition,
 * so this message is a backstop rather than the normal path — but it still has to say what to do,
 * because a bare "not supported" reads as a broken feature. */
function assertLocal() {
  if (process.env.VERCEL) {
    throw new Error(
      "A scan drives a real browser, so it runs from your checkout rather than on the deployed site. " +
        "Run `pnpm barrel-audit consent-scan <urls…>` locally — results publish to this dashboard when it finishes.",
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

/** Accepts a registry slug or an http(s) URL — the same two forms the CLI takes.
 *
 * Validated before anything reaches argv. A pasted list is the most likely place for a stray
 * value that looks like a flag, and `--seed` arriving as a "URL" would rewrite sites.yml. */
function validateTarget(value: string): string {
  const trimmed = value.trim().replace(/[,;]+$/, "");
  if (!trimmed) throw new Error("Empty target.");
  if (trimmed.startsWith("-")) throw new Error(`"${trimmed}" looks like a flag, not a site.`);
  if (trimmed.includes("://")) {
    const parsed = new URL(trimmed); // throws on malformed input
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(`"${trimmed}" must be an http(s) URL.`);
    }
    return trimmed;
  }
  if (/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i.test(trimmed)) return `https://${trimmed}`;
  if (/^[a-z0-9][a-z0-9-]*$/i.test(trimmed)) return trimmed;
  throw new Error(`"${trimmed}" is neither a registry slug nor a URL.`);
}

/** One line per site, but a pasted column from a spreadsheet arrives with commas and blanks. */
function parseTargets(raw: string): string[] {
  const parts = raw
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    const target = validateTarget(part);
    const key = target.replace(/\/+$/, "").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(target);
  }
  return out;
}

interface ConsentRunBody {
  /** Newline/comma-separated slugs and URLs. Empty means "every active site in sites.yml". */
  targets?: string;
  concurrency?: number;
  inventory?: boolean;
  retry?: boolean;
}

const MAX_TARGETS = 200;

function killRunTree(child: ChildProcess) {
  const pid = child.pid;
  if (!pid) return;
  const signal = (sig: NodeJS.Signals) => {
    try {
      process.kill(-pid, sig);
    } catch {
      // Already gone, which is the outcome we wanted.
    }
  };
  signal("SIGTERM");
  const escalate = setTimeout(() => signal("SIGKILL"), 5_000);
  escalate.unref();
  child.once("close", () => clearTimeout(escalate));
}

// Single-flight, for the same reason /api/run is: concurrent scans fight over headless Chrome on
// one machine. Separate from that route's lock — they are different modules — so starting a bulk
// scan while a site audit runs is possible and would be slow but not incorrect.
let activeRun: { count: number; startedAt: number; child?: ChildProcess } | null = null;

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

  const body = (await req.json().catch(() => null)) as ConsentRunBody | null;
  if (!body) return new Response("Invalid request body.", { status: 400 });

  let targets: string[];
  try {
    targets = parseTargets(body.targets ?? "");
  } catch (err: any) {
    return new Response(err.message ?? String(err), { status: 400 });
  }
  if (targets.length > MAX_TARGETS) {
    return new Response(`${targets.length} sites is more than the ${MAX_TARGETS}-site ceiling for one scan.`, {
      status: 400,
    });
  }

  if (activeRun) {
    return new Response(
      `A bulk scan is already running (${activeRun.count} sites, started ${new Date(activeRun.startedAt).toLocaleTimeString()}).`,
      { status: 409 },
    );
  }

  let repoRoot: string;
  try {
    repoRoot = findRepoRoot();
  } catch (err: any) {
    return new Response(err.message, { status: 500 });
  }

  const args = ["barrel-audit", "consent-scan", ...targets];
  const concurrency = Number(body.concurrency);
  if (Number.isFinite(concurrency) && concurrency >= 1 && concurrency <= 12) {
    args.push("--concurrency", String(Math.floor(concurrency)));
  }
  if (body.inventory) args.push("--inventory");
  if (body.retry === false) args.push("--no-retry");

  activeRun = { count: targets.length || 0, startedAt: Date.now() };

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

      // Guarded: once the client disconnects, enqueue() throws on the dead controller. Unguarded
      // that throws out of the close handler before the lock is released, and every later scan is
      // then rejected for the life of the dev server.
      const send = (text: string) => {
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          // Nobody is listening; the child's own exit handling is what matters now.
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
      child.on("close", (code) => finish(`\n__BARREL_CONSENT_DONE__${code ?? -1}__\n`));

      req.signal.addEventListener("abort", () => killRunTree(child));
      activeChild = child;
    },
    cancel() {
      if (activeChild) killRunTree(activeChild);
    },
  });

  return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
