#!/usr/bin/env node
/**
 * Does this audit produce the same answers from a cloud VM as it does from a laptop?
 *
 * That is the one question standing between the current CLI-only tool and running audits from the
 * web interface, and it is not answerable by reasoning — it depends on how fast a shared vCPU is
 * and on how a client's bot protection treats a datacenter IP. So this measures it: it provisions
 * one Vercel Sandbox with real Google Chrome and *this working tree's* CLI, audits the storefronts
 * you name, and writes each report to a local file. `compare.mjs` then diffs those against
 * reports produced locally for the same sites.
 *
 * Nothing it does is published. Every run uses `barrel-audit run --output`, which writes the
 * report to a file and skips the report blob, the manifest and the store's history entirely —
 * because the thing being measured here is a client's baseline, and appending probe runs to it
 * would corrupt the very history the comparison exists to protect.
 *
 * Usage:
 *   node tools/sandbox-probe/probe.mjs https://store-a.com https://store-b.com
 *   node tools/sandbox-probe/probe.mjs --vcpus 8 --out ./probe-out https://store-a.com
 *   node tools/sandbox-probe/probe.mjs --local https://store-a.com     # the laptop half
 *
 * Needs: VERCEL_TOKEN + VERCEL_TEAM_ID + VERCEL_PROJECT_ID (or a linked project's
 * VERCEL_OIDC_TOKEN, which `vercel env pull` puts in web/.env.local and expires every 12 hours).
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));

/** Real Google Chrome, not Ubuntu's snap-packaged chromium.
 *
 * Two reasons, both about the measurement being meaningful. Chromium-on-Ubuntu is a snap, and
 * snaps do not run in a container without a working snapd — it fails in a way that looks like a
 * Lighthouse bug. And the auditors' laptops run Chrome, so a probe comparing Chrome against
 * Chromium would be measuring the browser difference on top of the machine difference, which is
 * exactly the confound this is supposed to remove. */
const CHROME_DEB_URL = "https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb";
const CHROME_PATH = "/usr/bin/google-chrome";

const SANDBOX_WORKDIR = "/vercel/sandbox/probe";

/** The flags the probe runs with, and why each one is off.
 *
 * Everything skipped here is either impossible in a sandbox (theme code — a bare URL has no repo
 * connected) or cannot vary by runner (the AI sections are one Claude call against text the run
 * already produced, so including them would spend money to compare two identical answers).
 * Everything that CAN vary by runner is left on: Lighthouse, axe, consent, pixels, UX, security,
 * SEO/GEO, agent readiness. */
const PROBE_FLAGS = [
  "--skip-code",
  "--skip-analytics",
  "--skip-summary",
  "--skip-ai-suggestions",
  "--skip-recommendations",
  "--skip-theme-architecture",
  "--skip-github",
];

function parseArgs(argv) {
  const opts = { vcpus: 4, out: join(REPO_ROOT, "probe-out"), local: false, keepAlive: false, targets: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--vcpus") opts.vcpus = Number.parseInt(argv[++i], 10);
    else if (arg === "--out") opts.out = resolve(argv[++i]);
    else if (arg === "--local") opts.local = true;
    else if (arg === "--keep-alive") opts.keepAlive = true;
    else if (arg.startsWith("-")) throw new Error(`Unknown flag ${arg}`);
    else opts.targets.push(arg);
  }
  if (opts.targets.length === 0) {
    throw new Error(
      "Name at least one storefront URL to audit.\n" +
        "  node tools/sandbox-probe/probe.mjs https://store-a.com https://store-b.com",
    );
  }
  return opts;
}

function slugFor(target) {
  return target
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .toLowerCase();
}

/* ── The laptop half ─────────────────────────────────────────────────────────────────────────
 *
 * Deliberately the same script, so the two halves cannot drift in which flags they pass — the
 * single most likely way to produce a difference that looks like a runner difference and isn't.
 */
function runLocal(opts) {
  mkdirSync(opts.out, { recursive: true });
  for (const target of opts.targets) {
    const outFile = join(opts.out, `local-${slugFor(target)}.json`);
    console.log(`\n=== local: ${target} -> ${outFile}`);
    const result = spawnSync(
      process.execPath,
      [join(REPO_ROOT, "cli/dist/index.js"), "run", target, "--output", outFile, ...PROBE_FLAGS],
      { stdio: "inherit", cwd: REPO_ROOT },
    );
    if (result.status !== 0) console.error(`  local run for ${target} exited ${result.status}`);
  }
  console.log(`\nLocal reports in ${opts.out}. Now run the sandbox half, then compare.mjs.`);
}

/* ── The sandbox half ───────────────────────────────────────────────────────────────────────── */

/** Packs this working tree rather than installing the published CLI.
 *
 * The point of the probe is to measure the code that is about to ship, and `--output` (which is
 * what keeps the probe from writing into client history) only exists here yet. `pnpm pack`
 * rewrites the `workspace:*` dependency to a real version on the way out, so npm can install the
 * two tarballs together. */
function packCli() {
  const dest = join(REPO_ROOT, "probe-out", ".pack");
  mkdirSync(dest, { recursive: true });
  console.log("Building and packing the CLI from this working tree...");
  execFileSync("pnpm", ["--filter", "@barrel/site-audit-shared", "build"], { cwd: REPO_ROOT, stdio: "inherit" });
  execFileSync("pnpm", ["--filter", "@barrel/site-audit-cli", "build"], { cwd: REPO_ROOT, stdio: "inherit" });
  const packed = {};
  for (const [key, filter] of [
    ["shared", "@barrel/site-audit-shared"],
    ["cli", "@barrel/site-audit-cli"],
  ]) {
    const out = execFileSync("pnpm", ["--filter", filter, "pack", "--pack-destination", dest], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    const tgz = out.trim().split("\n").filter((l) => l.endsWith(".tgz")).pop();
    if (!tgz || !existsSync(tgz)) throw new Error(`pnpm pack for ${filter} produced no tarball (got: ${out.trim()})`);
    packed[key] = tgz;
  }
  return packed;
}

function credentials() {
  const { VERCEL_TOKEN, VERCEL_TEAM_ID, VERCEL_PROJECT_ID } = process.env;
  if (VERCEL_TOKEN && VERCEL_TEAM_ID && VERCEL_PROJECT_ID) {
    return { token: VERCEL_TOKEN, teamId: VERCEL_TEAM_ID, projectId: VERCEL_PROJECT_ID };
  }
  if (process.env.VERCEL_OIDC_TOKEN) return {};
  throw new Error(
    "No Vercel credentials. Either set VERCEL_TOKEN + VERCEL_TEAM_ID + VERCEL_PROJECT_ID, or run\n" +
      "  cd web && vercel env pull\n" +
      "to get a VERCEL_OIDC_TOKEN (it expires every 12 hours), then re-run with it in the environment.",
  );
}

/** Runs a command in the sandbox, echoing its output, and fails loudly.
 *
 * Loudly matters: a silent `apt-get` failure surfaces two minutes later as "Chrome not found",
 * which reads as a Lighthouse problem rather than a provisioning one. */
async function run(sandbox, label, command, args, { allowFailure = false, env } = {}) {
  console.log(`  → ${label}`);
  const result = await sandbox.runCommand({ cmd: command, args, env, stderr: true, stdout: true });
  const code = result.exitCode ?? 0;
  if (code !== 0) {
    const stderr = await result.stderr().catch(() => "");
    const stdout = await result.stdout().catch(() => "");
    const detail = `${stdout}\n${stderr}`.trim().slice(-2000);
    if (!allowFailure) throw new Error(`${label} failed (exit ${code}):\n${detail}`);
    console.warn(`    (exit ${code}, continuing) ${detail.slice(-400)}`);
  }
  return result;
}

async function runSandbox(opts) {
  const { Sandbox } = await import("@vercel/sandbox");
  // Credentials first: packing rebuilds two packages, and finding out afterwards that there is no
  // token to create a sandbox with wastes the wait for no reason.
  const creds = credentials();
  const packed = packCli();
  mkdirSync(opts.out, { recursive: true });

  // Long enough for provisioning plus several full audits back to back, and short enough that a
  // hung run cannot quietly bill for hours. Pro allows up to 24h; nothing here should need it.
  const timeout = 45 * 60 * 1000;

  console.log(`\nCreating sandbox (${opts.vcpus} vCPU, ${opts.vcpus * 2} GB)...`);
  const sandbox = await Sandbox.create({
    ...creds,
    image: "vercel/sandbox/node:24",
    resources: { vcpus: opts.vcpus },
    timeout,
    tags: { purpose: "site-audit-probe" },
    env: {
      // chrome-launcher honours this, so every analyzer finds the same browser without a search
      // path that differs between the two halves of the comparison.
      CHROME_PATH,
      // The audit runs as root in the sandbox, and Chrome refuses to run as root without this.
      // Safe here in a way it never is on a workstation: the microVM *is* the sandbox.
      CHROME_FLAGS: "--no-sandbox",
    },
  });

  console.log(`Sandbox ${sandbox.sandboxId ?? "(unnamed)"} in region ${sandbox.region ?? "(project default)"}\n`);
  const summary = { sandboxId: sandbox.sandboxId, region: sandbox.region, vcpus: opts.vcpus, results: [] };

  try {
    await run(sandbox, "apt-get update", "sudo", ["apt-get", "update", "-qq"]);
    await run(sandbox, "install wget + fonts", "sudo", [
      "apt-get", "install", "-y", "-qq", "wget", "ca-certificates", "fonts-liberation",
    ]);
    await run(sandbox, "download Google Chrome", "wget", [
      "-q", "-O", "/tmp/chrome.deb", CHROME_DEB_URL,
    ]);
    // apt-get install of a local .deb pulls its dependency tree itself, which is why this is not
    // a hand-maintained list of shared libraries that goes stale with every Chrome release.
    await run(sandbox, "install Chrome + dependencies", "sudo", [
      "apt-get", "install", "-y", "-qq", "/tmp/chrome.deb",
    ]);
    const version = await run(sandbox, "check Chrome version", CHROME_PATH, ["--version"]);
    const chromeVersion = (await version.stdout()).trim();
    summary.chromeVersion = chromeVersion;
    console.log(`  ${chromeVersion}`);

    await sandbox.mkDir(SANDBOX_WORKDIR);
    await sandbox.writeFiles([
      {
        path: `${SANDBOX_WORKDIR}/package.json`,
        content: Buffer.from(
          JSON.stringify(
            {
              name: "barrel-audit-probe",
              private: true,
              type: "module",
              dependencies: {
                "@barrel/site-audit-shared": `file:./${basename(packed.shared)}`,
                "@barrel/site-audit-cli": `file:./${basename(packed.cli)}`,
              },
            },
            null,
            2,
          ),
        ),
      },
      { path: `${SANDBOX_WORKDIR}/${basename(packed.shared)}`, content: readFileSync(packed.shared) },
      { path: `${SANDBOX_WORKDIR}/${basename(packed.cli)}`, content: readFileSync(packed.cli) },
    ]);

    await run(sandbox, "npm install the CLI (this is the slow step)", "npm", ["install", "--no-audit", "--no-fund"], {
      env: { npm_config_prefix: SANDBOX_WORKDIR },
    });

    for (const target of opts.targets) {
      const name = `sandbox-${slugFor(target)}.json`;
      const remote = `${SANDBOX_WORKDIR}/out/${name}`;
      console.log(`\n=== sandbox: ${target}`);
      const started = Date.now();

      // allowFailure: a storefront that blocks a datacenter IP outright is a *result*, not a
      // broken probe. Record it and keep going to the next site.
      const result = await run(
        sandbox,
        `audit ${target}`,
        "node",
        [`${SANDBOX_WORKDIR}/node_modules/@barrel/site-audit-cli/dist/index.js`, "run", target, "--output", remote, ...PROBE_FLAGS],
        { allowFailure: true },
      );
      const elapsedMs = Date.now() - started;
      const exitCode = result.exitCode ?? 0;
      const log = `${await result.stdout().catch(() => "")}\n${await result.stderr().catch(() => "")}`;
      writeFileSync(join(opts.out, `sandbox-${slugFor(target)}.log`), log);

      let saved = null;
      if (exitCode === 0) {
        try {
          const stream = await sandbox.readFile({ path: remote });
          const json = await new Response(stream).text();
          saved = join(opts.out, name);
          writeFileSync(saved, json);
          console.log(`  report -> ${saved} (${(elapsedMs / 1000).toFixed(0)}s)`);
        } catch (err) {
          console.error(`  could not read the report back: ${err.message}`);
        }
      } else {
        console.error(`  audit exited ${exitCode} — see the log; this is itself a finding`);
      }

      summary.results.push({ target, exitCode, elapsedMs, report: saved });
    }
  } finally {
    if (opts.keepAlive) {
      console.log(`\nLeaving sandbox ${sandbox.sandboxId} running (--keep-alive). Stop it in the dashboard.`);
    } else {
      console.log("\nStopping sandbox...");
      await sandbox.stop().catch((err) => console.error(`  stop failed: ${err.message}`));
    }
  }

  writeFileSync(join(opts.out, "sandbox-summary.json"), JSON.stringify(summary, null, 2));
  console.log(`\nSummary -> ${join(opts.out, "sandbox-summary.json")}`);
  console.log(`Next: node tools/sandbox-probe/compare.mjs ${opts.out}`);
}

// A thrown stack trace is the wrong shape for "you forgot a URL" or "your OIDC token expired",
// which are the two most likely ways to arrive here.
try {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.local) runLocal(opts);
  else await runSandbox(opts);
} catch (err) {
  console.error(`\n${err?.message ?? err}\n`);
  process.exit(1);
}
