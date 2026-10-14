import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { get, put } from "@vercel/blob";

/**
 * Password-gated external links to a Privacy Compliance scan report.
 *
 * A scan report is a legal-exposure record about client sites, so an external link has to be
 * stronger than the stateless signed links used for audit reports. Three independent things stand
 * between a stranger and the report: the link itself (an unguessable 192-bit id), an email that
 * must be on the allowlist the creator typed in, and a password the creator chose. Any one missing
 * and the report is not served. Every request re-reads the stored record, so revoking a link or
 * letting it expire takes effect immediately rather than when a cookie runs out.
 *
 * Node-runtime only (scrypt, node:crypto) — middleware must not import this.
 */

const RECORD_PREFIX = "consent-shares/";
const INDEX_PATH = `${RECORD_PREFIX}index.json`;

export const MIN_PASSWORD_LENGTH = 8;
const MAX_EMAILS = 25;
const SESSION_SECONDS = 60 * 60 * 8;
const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;
const LOCKOUT_ATTEMPTS = 5;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface ConsentShareRecord {
  id: string;
  scanId: string;
  emails: string[];
  salt: string;
  hash: string;
  createdAt: string;
  createdBy?: string;
  expiresAt: string;
  revokedAt?: string;
  /** Timestamps (ms) of recent failed unlocks, pruned to the lockout window. */
  failures: number[];
}

/** What the admin UI may see: everything except the credential material. */
export interface ConsentShareSummary {
  id: string;
  scanId: string;
  emails: string[];
  createdAt: string;
  createdBy?: string;
  expiresAt: string;
  revokedAt?: string;
}

function summarize(r: ConsentShareRecord): ConsentShareSummary {
  return {
    id: r.id,
    scanId: r.scanId,
    emails: r.emails,
    createdAt: r.createdAt,
    createdBy: r.createdBy,
    expiresAt: r.expiresAt,
    revokedAt: r.revokedAt,
  };
}

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET environment variable is not set.");
  return s;
}

async function readJson<T>(pathname: string): Promise<T | null> {
  try {
    // Never cached: a revoked link or a lockout counter must be seen on the very next request.
    const result = await get(pathname, { access: "private", useCache: false });
    if (!result || result.statusCode !== 200 || !result.stream) return null;
    return (await new Response(result.stream).json()) as T;
  } catch {
    return null;
  }
}

async function writeJson(pathname: string, value: unknown): Promise<void> {
  await put(pathname, JSON.stringify(value, null, 2), {
    access: "private",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
  });
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Splits a pasted list (commas, semicolons, spaces, newlines) and validates it. */
export function parseEmails(raw: string): { emails: string[]; invalid: string[] } {
  const parts = raw
    .split(/[\s,;]+/)
    .map(normalizeEmail)
    .filter(Boolean);
  const unique = [...new Set(parts)];
  return { emails: unique.filter((e) => EMAIL_RE.test(e)), invalid: unique.filter((e) => !EMAIL_RE.test(e)) };
}

function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, 64).toString("hex");
}

function passwordMatches(record: ConsentShareRecord, password: string): boolean {
  const a = Buffer.from(hashPassword(password, record.salt), "hex");
  const b = Buffer.from(record.hash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function getShare(id: string): Promise<ConsentShareRecord | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(id)) return null;
  return await readJson<ConsentShareRecord>(`${RECORD_PREFIX}${id}.json`);
}

/** Usable at all: exists, not revoked, not expired. */
export function isLive(record: ConsentShareRecord | null): record is ConsentShareRecord {
  return !!record && !record.revokedAt && new Date(record.expiresAt).getTime() > Date.now();
}

async function readIndex(): Promise<ConsentShareSummary[]> {
  return (await readJson<{ shares: ConsentShareSummary[] }>(INDEX_PATH))?.shares ?? [];
}

export async function listSharesForScan(scanId: string): Promise<ConsentShareSummary[]> {
  return (await readIndex()).filter((s) => s.scanId === scanId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function createShare(input: {
  scanId: string;
  emails: string[];
  password: string;
  expiresInDays: number;
  createdBy?: string;
}): Promise<ConsentShareRecord> {
  if (input.emails.length === 0 || input.emails.length > MAX_EMAILS) {
    throw new Error(`Add between 1 and ${MAX_EMAILS} email addresses.`);
  }
  if (input.password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`The password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  const salt = randomBytes(16).toString("hex");
  const now = Date.now();
  const record: ConsentShareRecord = {
    id: randomBytes(24).toString("base64url"),
    scanId: input.scanId,
    emails: input.emails,
    salt,
    hash: hashPassword(input.password, salt),
    createdAt: new Date(now).toISOString(),
    createdBy: input.createdBy,
    expiresAt: new Date(now + input.expiresInDays * 86_400_000).toISOString(),
    failures: [],
  };
  await writeJson(`${RECORD_PREFIX}${record.id}.json`, record);
  await writeJson(INDEX_PATH, { shares: [...(await readIndex()), summarize(record)] });
  return record;
}

export async function revokeShare(id: string): Promise<boolean> {
  const record = await getShare(id);
  if (!record) return false;
  record.revokedAt = new Date().toISOString();
  await writeJson(`${RECORD_PREFIX}${id}.json`, record);
  const index = await readIndex();
  await writeJson(INDEX_PATH, { shares: index.map((s) => (s.id === id ? summarize(record) : s)) });
  return true;
}

export type UnlockResult = "ok" | "denied" | "locked" | "unavailable";

/** Checks the email and password together. A wrong email and a wrong password are
 * indistinguishable to the caller, so the form cannot be used to discover who is on the list. */
export async function attemptUnlock(id: string, email: string, password: string): Promise<UnlockResult> {
  const record = await getShare(id);
  if (!isLive(record)) return "unavailable";

  const now = Date.now();
  const recent = record.failures.filter((t) => now - t < LOCKOUT_WINDOW_MS);
  if (recent.length >= LOCKOUT_ATTEMPTS) return "locked";

  // Always run scrypt, even when the email is not on the list, so timing does not reveal it.
  const passwordOk = passwordMatches(record, password);
  const emailOk = record.emails.includes(normalizeEmail(email));
  if (passwordOk && emailOk) {
    if (recent.length !== record.failures.length || recent.length > 0) {
      record.failures = [];
      await writeJson(`${RECORD_PREFIX}${id}.json`, record);
    }
    return "ok";
  }

  record.failures = [...recent, now];
  await writeJson(`${RECORD_PREFIX}${id}.json`, record);
  return record.failures.length >= LOCKOUT_ATTEMPTS ? "locked" : "denied";
}

/* ── Unlock cookie ──────────────────────────────────────────────────────────────────────── */

export const secureReportCookieName = (id: string) => `bsr_${id.slice(0, 12)}`;

function sign(id: string, expires: number, binding: string): string {
  return createHmac("sha256", secret()).update(`secure-report:${id}:${expires}:${binding}`).digest("hex");
}

/** The cookie is bound to the password hash, so changing a link's password (by replacing it) or
 * revoking it invalidates every unlock already issued. */
export function makeUnlockCookie(record: ConsentShareRecord): { value: string; maxAge: number } {
  const expires = Math.min(Date.now() + SESSION_SECONDS * 1000, new Date(record.expiresAt).getTime());
  return {
    value: `${expires}.${sign(record.id, expires, record.hash.slice(0, 16))}`,
    maxAge: Math.max(0, Math.floor((expires - Date.now()) / 1000)),
  };
}

export function verifyUnlockCookie(record: ConsentShareRecord, value: string | undefined): boolean {
  if (!value) return false;
  const [expStr, mac] = value.split(".");
  const expires = Number(expStr);
  if (!mac || !Number.isFinite(expires) || expires < Date.now()) return false;
  const expected = Buffer.from(sign(record.id, expires, record.hash.slice(0, 16)));
  const given = Buffer.from(mac);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
