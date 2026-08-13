import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import chalk from "chalk";
import { findRepoRoot, storeThemeDir, storeFixDir } from "../paths.js";
import { buildRunArgs, type RunAuditBody } from "../run-args.js";
import { resolveStore } from "../store.js";
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
import { getGithubToken, hasCachedValidGithubToken } from "../github-auth.js";

export interface ServeOptions {
  port: number;
}

// Lets the dashboard trigger real local audits from anywhere it's viewed — including the
// deployed Vercel site — since the browser talks directly to this port on the same machine it's
// running on, never through Vercel. Bound to loopback only (never the network), and every run
// request must present the token printed below: CORS alone isn't a real access boundary (any
// page can send a "simple" cross-origin request), so the token is what actually gates this.
export async function serveCommand(opts: ServeOptions): Promise<void> {
  const repoRoot = findRepoRoot();
  const token = randomBytes(24).toString("hex");

  let activeRun: { target: string; startedAt: number } | null = null;
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

    if (req.method === "POST" && req.url === "/run") {
      const auth = req.headers.authorization;
      if (auth !== `Bearer ${token}`) {
        res.writeHead(401, { "Content-Type": "text/plain" }).end("Invalid or missing token.");
        return;
      }

      if (activeRun) {
        res
          .writeHead(409, { "Content-Type": "text/plain" })
          .end(
            `An audit is already running (${activeRun.target}, started ${new Date(activeRun.startedAt).toLocaleTimeString()}).`,
          );
        return;
      }

      let body: RunAuditBody;
      let args: string[];
      try {
        body = await readJsonBody(req);
        args = buildRunArgs(body);
      } catch (err: any) {
        res.writeHead(400, { "Content-Type": "text/plain" }).end(err?.message ?? String(err));
        return;
      }

      activeRun = { target: body.target, startedAt: Date.now() };
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });

      const child = spawn("pnpm", ["barrel-audit", ...args], {
        cwd: repoRoot,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });

      const forward = (chunk: Buffer) => res.write(chunk);
      child.stdout.on("data", forward);
      child.stderr.on("data", forward);

      child.on("error", (err) => {
        res.write(`\nFailed to start: ${err.message}\n`);
        activeRun = null;
        res.end();
      });

      child.on("close", (code) => {
        res.write(`\n__BARREL_AUDIT_DONE__${code ?? -1}__\n`);
        activeRun = null;
        res.end();
      });

      req.on("close", () => {
        if (!res.writableEnded) child.kill();
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
        const result = await suggestFix(storeThemeDir(config.slug), {
          file: body.file,
          line: body.line,
          title: body.title,
          description: body.description,
          recommendation: body.recommendation,
        });
        res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(result));
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
      if (!config.githubRepo) {
        res
          .writeHead(400, { "Content-Type": "application/json" })
          .end(JSON.stringify({ error: `No GitHub repo linked for "${config.slug}" — run "pnpm barrel-audit link-repo ${config.slug}" first.` }));
        return;
      }
      if (!(await hasCachedValidGithubToken())) {
        res
          .writeHead(400, { "Content-Type": "application/json" })
          .end(JSON.stringify({ error: `GitHub sign-in has expired — run "pnpm barrel-audit link-repo ${config.slug}" in your terminal to re-authenticate, then try again.` }));
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
          .end(JSON.stringify({ error: `No GitHub repo linked for "${config.slug}" — run "pnpm barrel-audit link-repo ${config.slug}" first.` }));
        return;
      }
      if (!(await hasCachedValidGithubToken())) {
        res
          .writeHead(400, { "Content-Type": "application/json" })
          .end(JSON.stringify({ error: `GitHub sign-in has expired — run "pnpm barrel-audit link-repo ${config.slug}" in your terminal to re-authenticate, then try again.` }));
        return;
      }

      try {
        const [owner, repo] = config.githubRepo.split("/");
        const branch = deriveBranchName(body.findingId, body.title);
        const workDir = storeFixDir(config.slug, branch, repoRoot);
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

  server.listen(opts.port, "127.0.0.1", () => {
    console.log(chalk.bold(`\nbarrel-audit local agent listening on http://127.0.0.1:${opts.port}\n`));
    console.log(`Paste this token into the "Run Audit" page's local-agent setup:\n`);
    console.log(chalk.green.bold(`  ${token}\n`));
    console.log(chalk.gray("Bound to 127.0.0.1 only — not reachable from your network. Ctrl+C to stop.\n"));
  });
}
