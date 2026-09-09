import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import ora from "ora";
import { confirm, input, password } from "@inquirer/prompts";
import { list } from "@vercel/blob";
import { dataRoot, storesDir, usingGlobalDataRoot } from "../paths.js";
import { cliVersion } from "../version.js";

export interface SetupArgs {
  blobToken?: string;
  anthropicKey?: string;
  githubClientId?: string;
  /** Verify what's already configured and print it — never prompts, never writes. */
  check?: boolean;
}

/** Keys this command manages. Anything else already in the file is left exactly as it was. */
const MANAGED_KEYS = ["BLOB_READ_WRITE_TOKEN", "ANTHROPIC_API_KEY", "GITHUB_OAUTH_CLIENT_ID"] as const;

function envPath(): string {
  return join(dataRoot(), ".env");
}

/** Reads the existing .env into a map. Exported for tests. Deliberately tolerant: a hand-edited file with comments,
 * blank lines and quoted values is the normal case, and setup must not be the thing that
 * rejects it. */
export function readEnvFile(path: string): Map<string, string> {
  const values = new Map<string, string>();
  if (!existsSync(path)) return values;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    values.set(match[1], match[2].trim().replace(/^["']|["']$/g, ""));
  }
  return values;
}

/** Writes `updates` into the .env at `path`. Exported for tests. rewriting the lines for keys that are already there
 * and appending the rest — rather than regenerating the file, which would throw away the
 * comments and any extra key someone put there by hand. */
export function writeEnvFile(path: string, updates: Map<string, string>): void {
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  const lines = existing ? existing.replace(/\n$/, "").split("\n") : [];
  const remaining = new Map(updates);

  const rewritten = lines.map((line) => {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    if (!match || !remaining.has(match[1])) return line;
    const key = match[1];
    const value = remaining.get(key)!;
    remaining.delete(key);
    return `${key}=${value}`;
  });

  if (remaining.size > 0) {
    if (rewritten.length > 0 && rewritten[rewritten.length - 1] !== "") rewritten.push("");
    if (!existing) {
      rewritten.push("# Written by `barrel-audit setup`. Safe to edit by hand.");
      rewritten.push("");
    }
    for (const [key, value] of remaining) rewritten.push(`${key}=${value}`);
  }

  writeFileSync(path, `${rewritten.join("\n")}\n`);
  // The Blob token can write to every client report in the store, so the file holding it should
  // not be world-readable on a shared or backed-up machine.
  try {
    chmodSync(path, 0o600);
  } catch {
    /* best effort — a filesystem that doesn't do modes is not a reason to fail setup */
  }
}

function mask(value: string): string {
  if (value.length <= 12) return `${value.slice(0, 3)}…`;
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
}

/** Proves the token can actually reach the Blob store, which is the only thing that makes a
 * "you're set up" message worth printing. A read (not a write) is enough and leaves nothing
 * behind. Returns null on success or the reason it failed. */
async function verifyBlobToken(token: string): Promise<string | null> {
  try {
    await list({ limit: 1, token });
    return null;
  } catch (err: any) {
    return String(err?.message ?? err);
  }
}

export async function setupCommand(args: SetupArgs = {}): Promise<void> {
  const root = dataRoot();
  const path = envPath();
  const existing = readEnvFile(path);
  const interactive = Boolean(process.stdin.isTTY) && !args.check;

  console.log(chalk.bold(`\nbarrel-audit ${cliVersion()} — setup\n`));
  console.log(`Config and audit data live in ${chalk.cyan(root)}`);
  console.log(
    chalk.gray(
      usingGlobalDataRoot()
        ? "  (a global install, so nothing is written into whatever repo you're standing in)"
        : "  (you're inside a barrel-site-audit checkout, so the repo root is used instead)",
    ),
  );
  console.log("");

  if (args.check) {
    const token = args.blobToken ?? existing.get("BLOB_READ_WRITE_TOKEN") ?? process.env.BLOB_READ_WRITE_TOKEN ?? "";
    if (!token) {
      console.log(chalk.red("BLOB_READ_WRITE_TOKEN is not set."));
      console.log(chalk.gray(`  Run ${chalk.white("barrel-audit setup")} to add it.\n`));
      process.exitCode = 1;
      return;
    }
    const spinner = ora("Checking the Blob token…").start();
    const failure = await verifyBlobToken(token);
    if (failure) {
      spinner.fail(`Blob token rejected: ${failure}`);
      console.log(chalk.gray(`  Fix it with ${chalk.white("barrel-audit setup")}.\n`));
      process.exitCode = 1;
      return;
    }
    spinner.succeed(`Blob storage reachable (${mask(token)})`);
    for (const key of ["ANTHROPIC_API_KEY", "GITHUB_OAUTH_CLIENT_ID"] as const) {
      const value = existing.get(key) ?? process.env[key] ?? "";
      console.log(value ? chalk.green(`✔ ${key} set (${mask(value)})`) : chalk.gray(`· ${key} not set — optional`));
    }
    console.log(chalk.gray(`\nEnv file: ${path}\n`));
    return;
  }

  const updates = new Map<string, string>();

  // ── Required: the Blob token ────────────────────────────────────────────────────────────────
  let blobToken = args.blobToken ?? "";
  const currentBlob = existing.get("BLOB_READ_WRITE_TOKEN") ?? "";
  if (!blobToken && currentBlob && interactive) {
    const keep = await confirm({
      message: `Keep the Blob token already in ${path} (${mask(currentBlob)})?`,
      default: true,
    });
    if (keep) blobToken = currentBlob;
  } else if (!blobToken && currentBlob) {
    blobToken = currentBlob;
  }

  if (!blobToken) {
    if (!interactive) {
      throw new Error(
        "BLOB_READ_WRITE_TOKEN is not set and there's no terminal to ask on.\n" +
          "Pass it directly: barrel-audit setup --blob-token vercel_blob_rw_...",
      );
    }
    console.log(chalk.bold("Blob read/write token"));
    console.log(
      chalk.gray(
        "  This is what lets your runs publish reports to the dashboard. Get it from the Vercel\n" +
          "  dashboard → the barrel-site-audit project → Storage → the Blob store → .env.local tab,\n" +
          "  or ask in #barrel for it. It's the only credential the CLI needs.",
      ),
    );
    blobToken = (await password({ message: "Paste BLOB_READ_WRITE_TOKEN:", mask: true })).trim();
    if (!blobToken) throw new Error("No token entered — nothing was written.");
  }

  if (!blobToken.startsWith("vercel_blob_rw_")) {
    console.log(
      chalk.yellow(`\nThat doesn't look like a Blob read/write token (they start with vercel_blob_rw_).`),
    );
    console.log(chalk.gray("  Checking it anyway.\n"));
  }

  const spinner = ora("Checking the Blob token…").start();
  const failure = await verifyBlobToken(blobToken);
  if (failure) {
    spinner.fail("Blob storage rejected that token.");
    console.log(chalk.gray(`  ${failure}`));
    // Nothing is written on a bad token: a saved-but-broken .env is worse than no .env, because
    // the next command fails several minutes into an audit instead of here.
    throw new Error("Nothing was written. Get a fresh token and run barrel-audit setup again.");
  }
  spinner.succeed("Blob storage reachable.");
  updates.set("BLOB_READ_WRITE_TOKEN", blobToken);

  // ── Optional: the AI key ────────────────────────────────────────────────────────────────────
  let anthropicKey = args.anthropicKey ?? existing.get("ANTHROPIC_API_KEY") ?? "";
  if (args.anthropicKey === undefined && !anthropicKey && interactive) {
    console.log(chalk.bold("\nAnthropic API key (optional)"));
    console.log(
      chalk.gray(
        "  Turns on the executive summary, the client-ready recommendations, the AI fix suggestions\n" +
          "  and the theme architecture read. Audits run fine without it — those sections are skipped.\n" +
          "  Press Enter to skip.",
      ),
    );
    anthropicKey = (await password({ message: "Paste ANTHROPIC_API_KEY (or Enter to skip):", mask: true })).trim();
  }
  if (anthropicKey) updates.set("ANTHROPIC_API_KEY", anthropicKey);

  // ── Optional: the GitHub OAuth app ──────────────────────────────────────────────────────────
  let githubClientId = args.githubClientId ?? existing.get("GITHUB_OAUTH_CLIENT_ID") ?? "";
  if (args.githubClientId === undefined && !githubClientId && interactive) {
    console.log(chalk.bold("\nGitHub OAuth Client ID (optional)"));
    console.log(
      chalk.gray(
        "  Turns on `barrel-audit link-repo`, which clones a store's theme straight from GitHub for\n" +
          "  the code-quality sections. Not a secret — it's the Client ID of Barrel's shared OAuth app,\n" +
          "  and you still approve each sign-in in the browser. Press Enter to skip.",
      ),
    );
    githubClientId = (await input({ message: "Paste GITHUB_OAUTH_CLIENT_ID (or Enter to skip):" })).trim();
  }
  if (githubClientId) updates.set("GITHUB_OAUTH_CLIENT_ID", githubClientId);

  // ── Write it ────────────────────────────────────────────────────────────────────────────────
  mkdirSync(root, { recursive: true });
  mkdirSync(storesDir(root), { recursive: true });
  writeEnvFile(path, updates);

  console.log(chalk.green(`\n✔ Saved ${path}`));
  for (const key of MANAGED_KEYS) {
    const value = updates.get(key);
    console.log(value ? chalk.gray(`    ${key}=${mask(value)}`) : chalk.gray(`    ${key} — not set (optional)`));
  }

  console.log(chalk.bold("\nYou're set up. Two ways to run a report:\n"));
  console.log(`  ${chalk.white("From here:")}      barrel-audit run https://client-store.com`);
  console.log(chalk.gray(`                  works from any folder — nothing to clone or cd into\n`));
  console.log(`  ${chalk.white("From the site:")}  barrel-audit serve`);
  console.log(
    chalk.gray(
      `                  leave it running, then open https://barrel-site-audit.vercel.app/run\n` +
        `                  and paste the token it prints\n`,
    ),
  );
  console.log(chalk.gray(`Re-run ${chalk.white("barrel-audit setup")} any time to change a key, or `) +
    chalk.gray(`${chalk.white("barrel-audit setup --check")} to test one.\n`));
}
