// Builds the machine image a cloud audit runs on, and prints its snapshot id.
//
// A cloud run must not spend its first three minutes installing Chrome and the CLI, so all of
// that is done once, here, and frozen into a snapshot. Set the printed id as
// AUDIT_SANDBOX_SNAPSHOT_ID in Vercel and every later run boots straight into a machine that
// already has everything.
//
//   cd web && vercel env pull && node scripts/create-sandbox-snapshot.mjs
//
// Re-run it after publishing a new @barrel/site-audit-cli — the version is baked in, so cloud
// runs keep using the old one until the image is rebuilt. (See the publish checklist in the
// README.)
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Sandbox } from "@vercel/sandbox";

const CLI_PACKAGE = "@barrel/site-audit-cli";
/** Deleted again before the snapshot is taken — see below. */
const REGISTRY_NPMRC = "/vercel/sandbox/.npmrc-registry";
const CLI_VERSION = process.argv[2] ?? "latest";

/** The CLI is published to GitHub Packages, so installing it needs a read:packages token. Rather
 * than inventing a new secret, reuse the one this machine already authenticates with — the same
 * line that lets `pnpm publish` work here. It is written into the sandbox only long enough to
 * install, then deleted before the snapshot is taken (see below). */
function githubPackagesToken() {
  const fromEnv = process.env.GITHUB_PACKAGES_TOKEN;
  if (fromEnv) return fromEnv;
  try {
    const npmrc = readFileSync(join(homedir(), ".npmrc"), "utf-8");
    const match = npmrc.match(/^\/\/npm\.pkg\.github\.com\/:_authToken=(.+)$/m);
    if (match) return match[1].trim();
  } catch {
    // fall through to the error below
  }
  throw new Error(
    "No GitHub Packages token found. Either set GITHUB_PACKAGES_TOKEN, or add the usual " +
      "//npm.pkg.github.com/:_authToken=... line to ~/.npmrc (see the README's publishing section).",
  );
}

async function run(sandbox, label, command) {
  process.stdout.write(`\n\x1b[1m${label}\x1b[0m\n`);
  const result = await sandbox.runCommand({ cmd: "bash", args: ["-lc", command] });
  const out = (await result.stdout()).trim();
  const err = (await result.stderr()).trim();
  if (out) console.log(out.split("\n").slice(-8).join("\n"));
  if (result.exitCode !== 0) {
    throw new Error(`${label} failed (exit ${result.exitCode})\n${err || out}`);
  }
  return out;
}

const sandbox = await Sandbox.create({
  timeout: 20 * 60_000,
  resources: { vcpus: 4 },
  // Nothing here is worth resuming: this sandbox exists only to produce a snapshot.
  persistent: false,
});
console.log(`Building in sandbox ${sandbox.name}`);

try {
  // Chrome from Google's own .deb rather than a downloaded binary: apt pulls in the ~30 shared
  // libraries headless Chrome needs, which is the part that's fiddly to get right by hand.
  await run(
    sandbox,
    "Installing Google Chrome",
    "sudo apt-get update -qq && " +
      "curl -fsSL -o /tmp/chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb && " +
      "sudo apt-get install -y -qq /tmp/chrome.deb && rm /tmp/chrome.deb && google-chrome --version",
  );

  await run(sandbox, "Checking git", "git --version");

  // Not /root/.npmrc, and no sudo below: in this image npm's global prefix for the default user
  // is /vercel/.global/npm, which is already writable. `sudo npm i -g` installs somewhere else
  // entirely (/usr/local/lib/node_modules) and isn't on PATH — the install "succeeds" and the
  // binary doesn't exist.
  await sandbox.writeFiles([
    {
      path: REGISTRY_NPMRC,
      content: Buffer.from(
        `@barrel:registry=https://npm.pkg.github.com\n//npm.pkg.github.com/:_authToken=${githubPackagesToken()}\n`,
      ),
    },
  ]);

  // --allow-scripts, explicitly listed: npm now blocks install scripts by default, and several of
  // these are how the tool gets its browsers at all (sitespeed.io's chromedriver/geckodriver
  // downloads). Left blocked, `--sitespeed` fails at run time, deep inside an audit. The list is
  // exactly the one npm prints for this dependency tree — a deliberate allowlist, not a blanket
  // opt-out.
  const ALLOW_SCRIPTS = [
    "sitespeed.io",
    "protobufjs",
    "@sitespeed.io/chromedriver",
    "@sitespeed.io/geckodriver",
  ].join(",");

  await run(
    sandbox,
    `Installing ${CLI_PACKAGE}@${CLI_VERSION}`,
    `npm install -g ${CLI_PACKAGE}@${CLI_VERSION} --userconfig ${REGISTRY_NPMRC} --allow-scripts=${ALLOW_SCRIPTS}`,
  );

  // Not `barrel-audit --version`: the published CLI only grew that flag in 1.6.0, and this script
  // has to be able to build an image for whatever version is being installed.
  const installed = await run(
    sandbox,
    "Verifying the install",
    // `npm root -g` rather than a hardcoded path: the global prefix differs between the sandbox
    // image and a typical laptop, and guessing it wrong fails the build long after the expensive
    // install step.
    `cat $(npm root -g)/${CLI_PACKAGE}/package.json | grep '"version"' | head -1 && which barrel-audit && google-chrome --version`,
  );

  // Before the snapshot, always: a token baked into the image would be readable by every future
  // sandbox created from it, and those run with credentials of their own.
  await run(sandbox, "Removing the registry token", `rm -f ${REGISTRY_NPMRC} && test ! -f ${REGISTRY_NPMRC} && echo removed`);

  const snapshot = await sandbox.snapshot();
  console.log(`\n\x1b[32mSnapshot ready.\x1b[0m`);
  console.log(`  Installed:    ${installed.split("\n").join(" | ")}`);
  console.log(`  Snapshot id:  ${snapshot.snapshotId}`);
  console.log(`\nSet it as AUDIT_SANDBOX_SNAPSHOT_ID:`);
  console.log(`  vercel env add AUDIT_SANDBOX_SNAPSHOT_ID production`);
} finally {
  await sandbox.stop().catch(() => {});
}
