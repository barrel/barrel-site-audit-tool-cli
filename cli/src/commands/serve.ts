import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import chalk from "chalk";
import { cliInvocation, dataRoot, storeFixDir } from "../paths.js";
import { buildCroArgs, buildRunArgs, buildRunEnv, type CroRunBody, type RunAuditBody } from "@barrel/site-audit-shared";
import { resolveStore, resolveThemeDir } from "../store.js";
import { suggestFix, type SuggestFixParams } from "../analyzers/ai-fix.js";
import {
  applyFixAndOpenPr,
  prepareLocalFixBranch,
  commitAndPushFix,
  cleanupLocalFixBranch,
  deriveBranchName,
  AlreadyMergedError,
  DriftError,
  type FixFinding,
  type PreparedFix,
} from "../git-pr.js";
import { applyFixLocally, DriftError as LocalDriftError } from "../local-fix.js";
import { getGithubToken, hasCachedValidGithubToken } from "../github-auth.js";

export interface ServeOptions {
  port: number;
}

/** This CLI's own entrypoint. Resolved off this module first, so it's right whether the agent
 * was launched via the global bin shim or `node cli/dist/index.js`; argv[1] covers the
 * `tsx src/index.ts` dev path, where the sibling is index.ts rather than index.js. */
const selfScript = (() => {
  const compiled = fileURLToPath(new URL("../index.js", import.meta.url));
  return existsSync(compiled) ? compiled : process.argv[1];
})();

/** Stops a spawned audit and everything it started. An audit is a tree, not a process: this CLI
 * re-invokes itself, which in turn launches headless Chrome (Lighthouse, axe, pixels, screenshots)
 * and possibly sitespeed.io. Killing only the direct child would leave those running — burning CPU
 * and holding the ports/profile dirs the next run wants — which is why the child is spawned
 * `detached` (making it a process-group leader) and the negative pid signals the whole group.
 * SIGTERM first so the CLI's own cleanup can run, then SIGKILL for anything still alive. */
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
  // Don't hold the event loop open for 5s after a clean exit.
  escalate.unref();
  child.once("close", () => clearTimeout(escalate));
}

// Lets the dashboard trigger real local audits from anywhere it's viewed — including the
// deployed Vercel site — since the browser talks directly to this port on the same machine it's
// running on, never through Vercel. Bound to loopback only (never the network), and every run
// request must present the token printed below: CORS alone isn't a real access boundary (any
// page can send a "simple" cross-origin request), so the token is what actually gates this.
export async function serveCommand(opts: ServeOptions): Promise<void> {
  // dataRoot(), not findRepoRoot(): the agent works just as well from a globally-installed CLI
  // run anywhere (stores live under ~/.barrel-audit then), which is the normal case when you're
  // sitting in a client theme repo rather than a barrel-site-audit checkout. mkdir because it's
  // the spawn cwd below, and ~/.barrel-audit may not exist yet on a fresh global install.
  const root = dataRoot();
  mkdirSync(root, { recursive: true });
  const token = randomBytes(24).toString("hex");

  // Carries the child process too, so Ctrl+C here (and an explicit Stop from the dashboard) can
  // take the whole audit down with it rather than orphaning a detached process group.
  let activeRun: { target: string; startedAt: number; child: ChildProcess } | null = null;
  // Independent from activeRun on purpose: a fix operation never touches stores/<slug>/theme/
  // (all git/GitHub work happens in its own disposable clone), so there's no correctness reason
  // to block it behind an unrelated multi-minute audit. This only needs to stop *duplicate*
  // concurrent requests for the *same* fix, which could otherwise race to push the same branch —
  // two different findings, even for the same store, touch different branches/temp dirs and are
  // fine to run at once.
  const activeFixes = new Set<string>();
  function fixLockKey(slug: string, findingId: string): string {
    return `${slug}:${findingId}`;
  }

  // Populated by /fix/prepare, consumed by /fix/open-editor, /fix/preview, and (if present) by
  // /apply-fix, which reuses the same clone instead of starting a fresh disposable one.
  interface FixEntry {
    prepared: PreparedFix;
    line?: number;
  }
  const preparedFixes = new Map<string, FixEntry>();

  interface PreviewEntry {
    child: ChildProcess;
    status: "starting" | "ready" | "error";
    urls: string[];
    log: string;
  }
  const activePreviews = new Map<string, PreviewEntry>();

  function stopPreview(lockKey: string): void {
    const preview = activePreviews.get(lockKey);
    if (preview) {
      preview.child.kill();
      activePreviews.delete(lockKey);
    }
  }

  process.on("SIGINT", () => {
    for (const key of [...activePreviews.keys()]) stopPreview(key);
    // `detached` puts the run in its own process group, so it no longer receives the terminal's
    // Ctrl+C on its own — this is what stops it from outliving the agent that started it.
    if (activeRun) killRunTree(activeRun.child);
    process.exit(0);
  });

  function cors(req: IncomingMessage, res: ServerResponse) {
    const origin = req.headers.origin;
    if (origin) res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Max-Age", "600");
    res.setHeader("Vary", "Origin");
  }

  function readJsonBody(req: IncomingMessage): Promise<any> {
    return new Promise((resolve, reject) => {
      let raw = "";
      req.on("data", (chunk) => (raw += chunk));
      req.on("end", () => {
        try {
          resolve(raw ? JSON.parse(raw) : {});
        } catch {
          reject(new Error("Invalid JSON body"));
        }
      });
      req.on("error", reject);
    });
  }

  /** Spawns one CLI subcommand and streams its output back to the dashboard.
   *
   * Shared by /run and /cro because everything hard about it is identical: the single-flight lock
   * over headless Chrome, re-invoking this exact build rather than `pnpm barrel-audit`, the
   * detached process group so a Stop can take the browsers down too, and the guarded writes that
   * keep a dropped socket from stranding the lock. The only thing that differs is the argv and the
   * done-marker the dashboard parses. */
  async function streamCommand(
    req: IncomingMessage,
    res: ServerResponse,
    options: { target: string; args: string[]; env: Record<string, string>; doneMarker: string },
  ): Promise<void> {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });

    // Re-invoke this exact CLI build rather than `pnpm barrel-audit`, which only resolves
    // inside the monorepo (and would pick the checkout's build over the global one).
    // execArgv carries any loader flags (e.g. tsx's --import) so a TS-source dev run re-spawns
    // itself the same way it was started. detached: true so the run is its own process group and
    // killRunTree() can stop Chrome and friends along with it — see there for why.
    const child = spawn(process.execPath, [...process.execArgv, selfScript, ...options.args], {
      cwd: root,
      env: { ...process.env, ...options.env },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    activeRun = { target: options.target, startedAt: Date.now(), child };

    // Guarded because a stopped run means the response socket is already gone, and writing to a
    // destroyed response emits an error rather than returning quietly.
    const send = (chunk: string | Buffer) => {
      if (!res.writableEnded && !res.destroyed) res.write(chunk);
    };
    const forward = (chunk: Buffer) => send(chunk);
    child.stdout.on("data", forward);
    child.stderr.on("data", forward);

    let settled = false;
    const finish = (trailer: string) => {
      if (settled) return;
      settled = true;
      // First, so a dead socket can't strand the single-flight lock and lock out every later run.
      activeRun = null;
      send(trailer);
      if (!res.writableEnded) res.end();
    };

    child.on("error", (err) => finish(`\nFailed to start: ${err.message}\n`));
    child.on("close", (code) => finish(`\n${options.doneMarker}${code ?? -1}__\n`));

    // The dashboard's "Stop" button aborts its fetch, which lands here. Anything else that drops
    // the connection (closed tab, lost network) means nobody is watching the output, so the run
    // stops for that too rather than continuing invisibly to completion.
    //
    // On `res`, not `req`: readJsonBody() above consumes the request stream to its end, and Node
    // closes a fully-consumed readable right away — so a listener added afterwards never hears
    // req's "close" and the stop silently did nothing. res emits "close" when the response
    // finishes *or* the connection is destroyed, and writableEnded tells the two apart.
    res.on("close", () => {
      if (!res.writableEnded) killRunTree(child);
    });
  }


  const server = createServer(async (req, res) => {
    cors(req, res);

    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return;
    }

    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.method === "POST" && (req.url === "/run" || req.url === "/cro")) {
      const auth = req.headers.authorization;
      if (auth !== `Bearer ${token}`) {
        res.writeHead(401, { "Content-Type": "text/plain" }).end("Invalid or missing token.");
        return;
      }

      // One lock across both, not one each: a CRO capture and a site audit on the same machine
      // would fight over headless Chrome exactly as two audits would.
      if (activeRun) {
        res
          .writeHead(409, { "Content-Type": "text/plain" })
          .end(
            `A run is already in progress (${activeRun.target}, started ${new Date(activeRun.startedAt).toLocaleTimeString()}).`,
          );
        return;
      }

      const isCro = req.url === "/cro";
      let target: string;
      let args: string[];
      let runEnv: Record<string, string>;
      try {
        const body = await readJsonBody(req);
        if (isCro) {
          const croBody = body as unknown as CroRunBody;
          target = croBody.target;
          args = buildCroArgs(croBody);
          runEnv = {};
        } else {
          const runBody = body as RunAuditBody;
          target = runBody.target;
          args = buildRunArgs(runBody);
          runEnv = buildRunEnv(runBody);
        }
      } catch (err: any) {
        res.writeHead(400, { "Content-Type": "text/plain" }).end(err?.message ?? String(err));
        return;
      }

      await streamCommand(req, res, {
        target,
        args,
        env: runEnv,
        doneMarker: isCro ? "__BARREL_CRO_DONE__" : "__BARREL_AUDIT_DONE__",
      });
      return;
    }

    if (req.method === "POST" && req.url === "/suggest-fix") {
      const auth = req.headers.authorization;
      if (auth !== `Bearer ${token}`) {
        res.writeHead(401, { "Content-Type": "text/plain" }).end("Invalid or missing token.");
        return;
      }

      let body: { slug: string } & SuggestFixParams;
      try {
        body = await readJsonBody(req);
        if (!body?.slug || !body?.file || !body?.title) throw new Error("Missing slug, file, or title.");
      } catch (err: any) {
        res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: err?.message ?? String(err) }));
        return;
      }

      try {
        const config = resolveStore(body.slug);
        const result = await suggestFix(resolveThemeDir(config), {
          file: body.file,
          line: body.line,
          title: body.title,
          description: body.description,
          recommendation: body.recommendation,
        });
        res
          .writeHead(200, { "Content-Type": "application/json" })
          .end(JSON.stringify({ ...result, isLocalRepo: Boolean(config.localThemeDir) }));
      } catch (err: any) {
        res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: err?.message ?? String(err) }));
      }
      return;
    }

    if (req.method === "POST" && req.url === "/apply-fix") {
      const auth = req.headers.authorization;
      if (auth !== `Bearer ${token}`) {
        res.writeHead(401, { "Content-Type": "text/plain" }).end("Invalid or missing token.");
        return;
      }

      let body: {
        slug: string;
        file: string;
        newContent: string;
        baseContentSha256: string;
        findingId: string;
        title: string;
        severity: string;
        category: string;
        description?: string;
        recommendation?: string;
        reportUrl?: string;
      };
      try {
        body = await readJsonBody(req);
        if (!body?.slug || !body?.file || !body?.newContent || !body?.baseContentSha256 || !body?.findingId) {
          throw new Error("Missing required fields.");
        }
      } catch (err: any) {
        res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: err?.message ?? String(err) }));
        return;
      }

      let config: ReturnType<typeof resolveStore>;
      try {
        config = resolveStore(body.slug);
      } catch (err: any) {
        res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: err?.message ?? String(err) }));
        return;
      }

      if (config.localThemeDir) {
        const localLockKey = fixLockKey(body.slug, body.findingId);
        if (activeFixes.has(localLockKey)) {
          res.writeHead(409, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "A fix for this finding is already being applied." }));
          return;
        }
        activeFixes.add(localLockKey);
        try {
          const path = applyFixLocally(config.localThemeDir, body.file, body.newContent, body.baseContentSha256);
          res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ appliedLocally: true, path }));
        } catch (err: any) {
          const status = err instanceof LocalDriftError ? 400 : 500;
          res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify({ error: err?.message ?? String(err) }));
        } finally {
          activeFixes.delete(localLockKey);
        }
        return;
      }

      if (!config.githubRepo) {
        res
          .writeHead(400, { "Content-Type": "application/json" })
          .end(JSON.stringify({ error: `No GitHub repo linked for "${config.slug}" — run "${cliInvocation()} link-repo ${config.slug}" first.` }));
        return;
      }
      if (!(await hasCachedValidGithubToken())) {
        res
          .writeHead(400, { "Content-Type": "application/json" })
          .end(JSON.stringify({ error: `GitHub sign-in has expired — run "${cliInvocation()} link-repo ${config.slug}" in your terminal to re-authenticate, then try again.` }));
        return;
      }

      const lockKey = fixLockKey(body.slug, body.findingId);
      if (activeFixes.has(lockKey)) {
        res.writeHead(409, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "A fix for this finding is already being applied." }));
        return;
      }

      activeFixes.add(lockKey);
      try {
        const [owner, repo] = config.githubRepo.split("/");
        const finding: FixFinding = {
          id: body.findingId,
          title: body.title,
          severity: body.severity,
          category: body.category,
          description: body.description ?? "",
          recommendation: body.recommendation,
        };

        const entry = preparedFixes.get(lockKey);
        const result = entry
          ? await commitAndPushFix({
              prepared: entry.prepared,
              owner,
              repo,
              finding,
              reportUrl: body.reportUrl,
              token: await getGithubToken(),
            })
          : await applyFixAndOpenPr({
              owner,
              repo,
              baseBranch: config.githubBranch,
              filePath: body.file,
              newContent: body.newContent,
              baseContentSha256: body.baseContentSha256,
              finding,
              reportUrl: body.reportUrl,
              token: await getGithubToken(),
            });

        if (entry) {
          stopPreview(lockKey);
          cleanupLocalFixBranch(entry.prepared.cloneDir);
          preparedFixes.delete(lockKey);
        }

        res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(result));
      } catch (err: any) {
        const status = err instanceof DriftError ? 400 : err instanceof AlreadyMergedError ? 409 : 500;
        res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify({ error: err?.message ?? String(err) }));
      } finally {
        activeFixes.delete(lockKey);
      }
      return;
    }

    if (req.method === "POST" && req.url === "/fix/prepare") {
      const auth = req.headers.authorization;
      if (auth !== `Bearer ${token}`) {
        res.writeHead(401, { "Content-Type": "text/plain" }).end("Invalid or missing token.");
        return;
      }

      let body: {
        slug: string;
        file: string;
        newContent: string;
        baseContentSha256: string;
        findingId: string;
        title: string;
        line?: number;
      };
      try {
        body = await readJsonBody(req);
        if (!body?.slug || !body?.file || !body?.newContent || !body?.baseContentSha256 || !body?.findingId || !body?.title) {
          throw new Error("Missing required fields.");
        }
      } catch (err: any) {
        res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: err?.message ?? String(err) }));
        return;
      }

      let config: ReturnType<typeof resolveStore>;
      try {
        config = resolveStore(body.slug);
      } catch (err: any) {
        res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: err?.message ?? String(err) }));
        return;
      }
      if (!config.githubRepo) {
        res
          .writeHead(400, { "Content-Type": "application/json" })
          .end(JSON.stringify({ error: `No GitHub repo linked for "${config.slug}" — run "${cliInvocation()} link-repo ${config.slug}" first.` }));
        return;
      }
      if (!(await hasCachedValidGithubToken())) {
        res
          .writeHead(400, { "Content-Type": "application/json" })
          .end(JSON.stringify({ error: `GitHub sign-in has expired — run "${cliInvocation()} link-repo ${config.slug}" in your terminal to re-authenticate, then try again.` }));
        return;
      }

      try {
        const [owner, repo] = config.githubRepo.split("/");
        const branch = deriveBranchName(body.findingId, body.title);
        const workDir = storeFixDir(config.slug, branch, root);
        const prepared = await prepareLocalFixBranch({
          owner,
          repo,
          baseBranch: config.githubBranch,
          filePath: body.file,
          newContent: body.newContent,
          baseContentSha256: body.baseContentSha256,
          findingId: body.findingId,
          findingTitle: body.title,
          token: await getGithubToken(),
          workDir,
        });
        preparedFixes.set(fixLockKey(body.slug, body.findingId), { prepared, line: body.line });
        res
          .writeHead(200, { "Content-Type": "application/json" })
          .end(JSON.stringify({ branch: prepared.branch, cloneDir: prepared.cloneDir }));
      } catch (err: any) {
        const status = err instanceof DriftError ? 400 : 500;
        res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify({ error: err?.message ?? String(err) }));
      }
      return;
    }

    if (req.method === "POST" && req.url === "/fix/open-editor") {
      const auth = req.headers.authorization;
      if (auth !== `Bearer ${token}`) {
        res.writeHead(401, { "Content-Type": "text/plain" }).end("Invalid or missing token.");
        return;
      }

      let body: { slug: string; findingId: string };
      try {
        body = await readJsonBody(req);
        if (!body?.slug || !body?.findingId) throw new Error("Missing slug or findingId.");
      } catch (err: any) {
        res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: err?.message ?? String(err) }));
        return;
      }

      const entry = preparedFixes.get(fixLockKey(body.slug, body.findingId));
      if (!entry) {
        res
          .writeHead(400, { "Content-Type": "application/json" })
          .end(JSON.stringify({ error: "This fix hasn't been prepared locally yet — try again." }));
        return;
      }

      const target = entry.line
        ? `${entry.prepared.cloneDir}/${entry.prepared.filePath}:${entry.line}`
        : `${entry.prepared.cloneDir}/${entry.prepared.filePath}`;
      const child = spawn("code", ["--goto", target, entry.prepared.cloneDir], { detached: true, stdio: "ignore" });
      const opened = await new Promise<boolean>((resolveSpawn) => {
        child.once("spawn", () => resolveSpawn(true));
        child.once("error", () => resolveSpawn(false));
      });
      child.unref();

      if (!opened) {
        res
          .writeHead(400, { "Content-Type": "application/json" })
          .end(
            JSON.stringify({
              error:
                'Could not launch VS Code — the "code" command wasn\'t found. In VS Code, open the Command Palette and run "Shell Command: Install \'code\' command in PATH", then try again.',
            }),
          );
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ opened: true }));
      return;
    }

    if (req.method === "POST" && req.url === "/fix/preview") {
      const auth = req.headers.authorization;
      if (auth !== `Bearer ${token}`) {
        res.writeHead(401, { "Content-Type": "text/plain" }).end("Invalid or missing token.");
        return;
      }

      let body: { slug: string; findingId: string };
      try {
        body = await readJsonBody(req);
        if (!body?.slug || !body?.findingId) throw new Error("Missing slug or findingId.");
      } catch (err: any) {
        res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: err?.message ?? String(err) }));
        return;
      }

      const lockKey = fixLockKey(body.slug, body.findingId);
      const entry = preparedFixes.get(lockKey);
      if (!entry) {
        res
          .writeHead(400, { "Content-Type": "application/json" })
          .end(JSON.stringify({ error: "This fix hasn't been prepared locally yet — try again." }));
        return;
      }

      const already = activePreviews.get(lockKey);
      if (already) {
        res
          .writeHead(200, { "Content-Type": "application/json" })
          .end(JSON.stringify({ status: already.status, previewUrls: already.urls }));
        return;
      }

      // No --json output from `shopify theme dev` — the preview/local URLs are parsed out of its
      // normal stdout instead. Requires `shopify auth login` to have been run previously in a real
      // terminal (or a Theme Access password configured); if not, the CLI's own auth prompt shows
      // up in `log` below rather than a URL, which the UI surfaces back to the user verbatim.
      const child = spawn("shopify", ["theme", "dev", "--path", entry.prepared.cloneDir], {
        cwd: entry.prepared.cloneDir,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const preview: PreviewEntry = { child, status: "starting", urls: [], log: "" };
      activePreviews.set(lockKey, preview);

      const onData = (chunk: Buffer) => {
        preview.log = (preview.log + chunk.toString()).slice(-20_000);
        const found = preview.log.match(/https?:\/\/[^\s"']+/g);
        if (found) {
          preview.urls = [...new Set(found)];
          if (preview.status === "starting") preview.status = "ready";
        }
      };
      child.stdout.on("data", onData);
      child.stderr.on("data", onData);
      child.on("error", (err) => {
        preview.status = "error";
        preview.log += `\nFailed to start: ${err.message}`;
      });
      child.on("exit", (code) => {
        if (preview.status !== "ready" || code !== 0) {
          preview.status = "error";
          preview.log += `\nshopify theme dev exited (${code ?? "signal"}).`;
        }
        activePreviews.delete(lockKey);
      });

      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ status: "starting", previewUrls: [] }));
      return;
    }

    if (req.method === "GET" && req.url?.startsWith("/fix/preview-status")) {
      const auth = req.headers.authorization;
      if (auth !== `Bearer ${token}`) {
        res.writeHead(401, { "Content-Type": "text/plain" }).end("Invalid or missing token.");
        return;
      }
      const url = new URL(req.url, "http://127.0.0.1");
      const slug = url.searchParams.get("slug") ?? "";
      const findingId = url.searchParams.get("findingId") ?? "";
      const preview = activePreviews.get(fixLockKey(slug, findingId));
      if (!preview) {
        res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ status: "stopped", previewUrls: [] }));
        return;
      }
      res
        .writeHead(200, { "Content-Type": "application/json" })
        .end(JSON.stringify({ status: preview.status, previewUrls: preview.urls, log: preview.log.slice(-2000) }));
      return;
    }

    if (req.method === "POST" && req.url === "/fix/stop-preview") {
      const auth = req.headers.authorization;
      if (auth !== `Bearer ${token}`) {
        res.writeHead(401, { "Content-Type": "text/plain" }).end("Invalid or missing token.");
        return;
      }
      let body: { slug: string; findingId: string };
      try {
        body = await readJsonBody(req);
        if (!body?.slug || !body?.findingId) throw new Error("Missing slug or findingId.");
      } catch (err: any) {
        res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: err?.message ?? String(err) }));
        return;
      }
      stopPreview(fixLockKey(body.slug, body.findingId));
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ stopped: true }));
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found.");
  });

  // Without this, a busy port surfaces as an unhandled 'error' event — a Node stack trace for
  // what is really a one-line, self-explanatory situation (usually an agent you already left
  // running in another terminal tab).
  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(
        chalk.red(`\nPort ${opts.port} is already in use.`) +
          chalk.gray(
            `\n\nAnother barrel-audit agent is probably already running — check your other terminal tabs` +
              `\nand reuse the token it printed. Otherwise pick a different port:\n\n` +
              `  ${cliInvocation()} serve --port ${opts.port + 1}\n\n` +
              `To see what's holding it:  lsof -nP -iTCP:${opts.port} -sTCP:LISTEN\n`,
          ),
      );
    } else {
      console.error(chalk.red(`\n${err.message}\n`));
    }
    process.exitCode = 1;
  });

  server.listen(opts.port, "127.0.0.1", () => {
    console.log(chalk.bold(`\nbarrel-audit local agent listening on http://127.0.0.1:${opts.port}\n`));
    console.log(`Paste this token into the "Run Audit" page's local-agent setup:\n`);
    console.log(chalk.green.bold(`  ${token}\n`));
    console.log(chalk.gray("Bound to 127.0.0.1 only — not reachable from your network. Ctrl+C to stop.\n"));
  });
}
