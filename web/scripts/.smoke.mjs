import { readFileSync } from "node:fs";
import { Sandbox } from "@vercel/sandbox";

const env = Object.fromEntries(
  readFileSync("/Users/nickmeyer/Documents/GitHub/barrel/barrel-site-audit/.env", "utf-8")
    .split("\n").filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^['"]|['"]$/g, "")]),
);

const sandbox = await Sandbox.create({
  name: "audit-smoke-1",
  source: { type: "snapshot", snapshotId: "snap_olQo6iI4pmrPXiXSCzudOwWGQpLL" },
  resources: { vcpus: 4 },
  timeout: 40 * 60_000,
  persistent: false,
});
console.log("sandbox:", sandbox.name);

const cmd = await sandbox.runCommand({
  cmd: "bash",
  args: ["-lc",
    "barrel-audit run https://wamsutta.com --skip-code --skip-summary --skip-ai-suggestions " +
    "--skip-theme-architecture --skip-ux --skip-analytics --skip-github 2>&1 | tee /vercel/sandbox/run.log"],
  env: {
    BLOB_READ_WRITE_TOKEN: env.BLOB_READ_WRITE_TOKEN,
    CHROME_PATH: "/usr/bin/google-chrome",
    BARREL_RUN_ID: "smoke-cloud-1",
    BARREL_RUNNER: "cloud",
    BARREL_RUNNER_REGION: "iad1",
    BARREL_RUNNER_VCPUS: "4",
  },
  detached: true,
});
console.log("cmdId:", cmd.cmdId);
for await (const log of cmd.logs()) process.stdout.write(log.data);
const done = await cmd.wait();
console.log("\nexit:", done.exitCode);
await sandbox.stop().catch(() => {});
