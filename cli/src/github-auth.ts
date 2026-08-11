import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import chalk from "chalk";

// Cached outside the repo (not per-checkout) so the same device-flow login carries across
// re-clones and multiple stores. Scoped to the OAuth App's client ID, so switching apps
// (e.g. a personal one during setup, then Barrel's shared one) re-authenticates automatically
// instead of silently reusing a token issued to the wrong app.
const TOKEN_CACHE_PATH = join(homedir(), ".config", "barrel-audit", "github-token.json");

interface CachedToken {
  clientId: string;
  token: string;
}

function readCachedToken(clientId: string): string | null {
  if (!existsSync(TOKEN_CACHE_PATH)) return null;
  try {
    const cached = JSON.parse(readFileSync(TOKEN_CACHE_PATH, "utf-8")) as CachedToken;
    return cached.clientId === clientId ? cached.token : null;
  } catch {
    return null;
  }
}

function writeCachedToken(clientId: string, token: string): void {
  mkdirSync(dirname(TOKEN_CACHE_PATH), { recursive: true });
  writeFileSync(TOKEN_CACHE_PATH, JSON.stringify({ clientId, token } satisfies CachedToken, null, 2), {
    mode: 0o600,
  });
}

/** Clears the cached GitHub token, forcing the next `getGithubToken()` call to re-run the
 * device-flow login (e.g. after switching GitHub accounts, or a revoked/expired token). */
export function clearCachedGithubToken(): void {
  rmSync(TOKEN_CACHE_PATH, { force: true });
}

function requireClientId(): string {
  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
  if (!clientId) {
    throw new Error(
      "GITHUB_OAUTH_CLIENT_ID is not set. Create a GitHub OAuth App once (Settings -> Developer settings -> " +
        "OAuth Apps -> New OAuth App at https://github.com/settings/developers), enable \"Device Flow\" on it, " +
        "and add its Client ID to .env as GITHUB_OAUTH_CLIENT_ID=... — no client secret needed, and it isn't " +
        "sensitive, so the whole team can share one app.",
    );
  }
  return clientId;
}

async function isTokenValid(token: string): Promise<boolean> {
  try {
    const { Octokit } = await import("@octokit/rest");
    await new Octokit({ auth: token }).users.getAuthenticated();
    return true;
  } catch {
    return false;
  }
}

async function deviceFlowLogin(clientId: string): Promise<string> {
  const { createOAuthDeviceAuth } = await import("@octokit/auth-oauth-device");
  const auth = createOAuthDeviceAuth({
    clientType: "oauth-app",
    clientId,
    scopes: ["repo"],
    onVerification(verification) {
      console.log();
      console.log(chalk.bold("GitHub sign-in required:"));
      console.log(`  1. Open ${chalk.cyan(verification.verification_uri)}`);
      console.log(`  2. Enter this code: ${chalk.bold(verification.user_code)}`);
      console.log(chalk.gray("  Waiting for you to authorize in the browser...\n"));
    },
  });

  const { token } = await auth({ type: "oauth" });
  return token;
}

/** Returns a valid GitHub access token for listing/cloning repos, authenticating via the
 * OAuth App device flow (a one-time code + browser approval, no pasted token) the first time,
 * or whenever the cached token has stopped working. Successful logins are cached at
 * ~/.config/barrel-audit/github-token.json so most runs need no interaction at all. */
export async function getGithubToken(): Promise<string> {
  const clientId = requireClientId();

  const cached = readCachedToken(clientId);
  if (cached && (await isTokenValid(cached))) return cached;

  const token = await deviceFlowLogin(clientId);
  writeCachedToken(clientId, token);
  return token;
}
