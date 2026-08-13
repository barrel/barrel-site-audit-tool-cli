import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import chalk from "chalk";
import { findRepoRoot, storeThemeDir } from "../paths.js";
import { buildRunArgs, type RunAuditBody } from "../run-args.js";
import { resolveStore } from "../store.js";
import { suggestFix, type SuggestFixParams } from "../analyzers/ai-fix.js";
import { applyFixAndOpenPr, AlreadyMergedError, DriftError, type FixFinding } from "../git-pr.js";
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
        const result = await applyFixAndOpenPr({
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
        res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(result));
      } catch (err: any) {
        const status = err instanceof DriftError ? 400 : err instanceof AlreadyMergedError ? 409 : 500;
        res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify({ error: err?.message ?? String(err) }));
      } finally {
        activeFixes.delete(lockKey);
      }
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
