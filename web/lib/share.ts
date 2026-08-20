import { timingSafeEqualStr } from "@/lib/session";

export const SHARE_SCOPE_COOKIE_NAME = "barrel_audit_share_scope";
const SHARE_TOKEN_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

function getSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error(
      "SESSION_SECRET environment variable is not set. Set it to any long random string.",
    );
  }
  return secret;
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function toBase64Url(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(input: string): string {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

// Signed with the same secret as login session tokens, but domain-separated with a fixed
// prefix so a share token can never be replayed as (or confused with) a session token.
async function hmac(data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(getSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`share:${data}`));
  return toHex(signature);
}

export interface ShareTokenPayload {
  slug: string;
  id: string;
  expires: number;
  /** The baseline this report is being compared against, for a client-facing progress report.
   * Optional so every link minted before this existed still verifies. */
  compareId?: string;
  /** "client" renders the shareable summary rather than the full audit. Absent means the full
   * report, which is what every existing link means. */
  kind?: "client";
}

// Stateless, signed link scoped to exactly one report — no server-side revocation list to
// manage. Anyone holding the token can view that single report (and nothing else) until
// `expires`.
export async function createShareToken(
  slug: string,
  id: string,
  options: { compareId?: string; kind?: "client" } = {},
): Promise<string> {
  const expires = Date.now() + SHARE_TOKEN_MAX_AGE_SECONDS * 1000;
  const payload: ShareTokenPayload = { slug, id, expires };
  // Omitted rather than set to undefined: these end up in the signed blob, and a link that
  // carries "kind": null reads as deliberate to whoever debugs it next.
  if (options.compareId) payload.compareId = options.compareId;
  if (options.kind) payload.kind = options.kind;
  const encoded = toBase64Url(JSON.stringify(payload));
  const signature = await hmac(encoded);
  return `${encoded}.${signature}`;
}

/** Every report a token authorises. A client report shows two, and the screenshot scope has to
 * cover both or the baseline image 404s inside an otherwise working page. */
export function tokenScope(payload: ShareTokenPayload): string {
  const ids = payload.compareId ? [payload.id, payload.compareId] : [payload.id];
  return ids.map((id) => `${payload.slug}/${id}`).join(",");
}

export async function verifyShareToken(token: string | undefined | null): Promise<ShareTokenPayload | null> {
  if (!token) return null;
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;

  const expected = await hmac(encoded);
  if (!timingSafeEqualStr(expected, signature)) return null;

  try {
    const payload = JSON.parse(fromBase64Url(encoded)) as ShareTokenPayload;
    if (!payload.slug || !payload.id || !Number.isFinite(payload.expires)) return null;
    if (Date.now() > payload.expires) return null;
    return payload;
  } catch {
    return null;
  }
}
