import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import chalk from "chalk";
import { findRepoRoot } from "../paths.js";
import { buildRunArgs, type RunAuditBody } from "../run-args.js";

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

    res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found.");
  });

  server.listen(opts.port, "127.0.0.1", () => {
    console.log(chalk.bold(`\nbarrel-audit local agent listening on http://127.0.0.1:${opts.port}\n`));
    console.log(`Paste this token into the "Run Audit" page's local-agent setup:\n`);
    console.log(chalk.green.bold(`  ${token}\n`));
    console.log(chalk.gray("Bound to 127.0.0.1 only — not reachable from your network. Ctrl+C to stop.\n"));
  });
}
