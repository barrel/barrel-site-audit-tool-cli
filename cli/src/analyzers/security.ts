import { connect as tlsConnect } from "node:tls";
import * as cheerio from "cheerio";
import type {
  SecurityCheck,
  SecurityCheckCategory,
  SecurityCheckStatus,
  SecurityEvidence,
  SecuritySection,
  SecuritySeverity,
  SecurityTotals,
} from "@barrel/site-audit-shared";

/** Every request this analyzer makes is a single round trip to a public endpoint, so a long tail
 * here buys nothing — a storefront that hasn't answered in twelve seconds is a coverage gap to
 * report, not a slow success to wait for. */
const TIMEOUT_MS = 12_000;

/** A real browser UA. Not to disguise the scan, but because a bare Node fetch UA is a common
 * WAF-block trigger, and a 403 from the edge would be recorded as "no security headers" — a
 * false finding about the site rather than a true one about our own request. */
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/** jQuery 3.5.0 is the release that fixed the htmlPrefilter cross-site-scripting issues published
 * as CVE-2020-11022 and CVE-2020-11023, which affect every earlier 1.x, 2.x and 3.x. This is the
 * only version boundary this analyzer asserts, precisely because it is the only one it can state
 * without hedging — a general "your library is old" claim tied to a guessed advisory is exactly
 * the kind of finding that costs a report its credibility. */
const JQUERY_XSS_FIXED_IN = [3, 5, 0] as const;

/** Above this many distinct cross-origin script hosts the supply-chain surface is worth raising,
 * on the plain arithmetic that every one of them can ship new code to the storefront tomorrow
 * without anyone here approving it. Not a security failure on its own — hence warn, never fail. */
const THIRD_PARTY_ORIGIN_BUDGET = 5;

/** Six months. Short enough that a site rolling HSTS out cautiously still clears it, long enough
 * that the header is doing the job it exists for; browsers refresh the max-age on every visit, so
 * anything under a few months lapses for a visitor who was away for a while. */
const HSTS_MIN_MAX_AGE = 15_552_000;

/** How many first-party bundles to open when hunting for published source maps. A sample, stated
 * as a sample in the finding — walking every script on a storefront would turn a cheap section
 * into a crawl. */
const SOURCE_MAP_SAMPLE = 4;

/** Scoring weight per severity, doubling as the ordering used in the UI. The spread is narrower
 * than the consent suite's (10:1) because security has two `critical` checks that pass on almost
 * every site — TLS validity and exposed secrets — and at a 10:1 spread those two free passes
 * would carry a site with no security headers at all into the seventies. */
const WEIGHT: Record<SecuritySeverity, number> = { critical: 8, high: 4, medium: 2, low: 1 };

/** Below this many confirmed results the number would be describing our own coverage rather than
 * the site, and a reader has no way to tell those two apart from a score alone. */
const MIN_CONFIRMED = 6;

export interface AnalyzeSecurityOptions {
  onStage?: (stage: string) => void;
}

/* ── plumbing ────────────────────────────────────────────────────────────────────────────── */

interface Fetched {
  res: Response;
  body: string;
}

/** The last transport-level failure `get` swallowed, kept so the fatal path can say *why* the
 * storefront could not be read. "TLS handshake failed: certificate has expired" and "connection
 * refused" send a reader to completely different places, and collapsing both into "unreachable"
 * throws away the more useful half of the finding. */
let lastFetchError: string | null = null;

async function get(url: string, init: RequestInit = {}): Promise<Response | null> {
  try {
    return await fetch(url, {
      redirect: "follow",
      headers: { "user-agent": UA, accept: "*/*", ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      ...init,
    });
  } catch (err: any) {
    lastFetchError = String(err?.cause?.message ?? err?.message ?? err);
    return null;
  }
}

async function getWithBody(url: string, init: RequestInit = {}): Promise<Fetched | null> {
  const res = await get(url, init);
  if (!res) return null;
  const body = await res.text().catch(() => "");
  return { res, body };
}

function check(
  id: string,
  category: SecurityCheckCategory,
  title: string,
  severity: SecuritySeverity,
  status: SecurityCheckStatus,
  detail: string,
  recommendation?: string,
  evidence?: SecurityEvidence,
): SecurityCheck {
  // A recommendation on a pass is noise, and a recommendation on a not-tested result prescribes a
  // change we have no evidence is needed — both are dropped here rather than at each call site.
  const keepRecommendation = status === "fail" || status === "warn";
  return {
    id,
    category,
    title,
    severity,
    status,
    detail,
    recommendation: keepRecommendation ? recommendation : undefined,
    evidence,
  };
}

/** Splits one CSP into its directives. Returns null — not an empty list — when the directive is
 * absent, because "script-src with no sources" and "no script-src at all" mean opposite things:
 * the first blocks every script, the second falls back to default-src or to nothing. */
function cspDirective(policy: string, name: string): string[] | null {
  for (const part of policy.split(";")) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;
    if (tokens[0].toLowerCase() === name) return tokens.slice(1);
  }
  return null;
}

function originOf(value: string, base: string): string | null {
  try {
    return new URL(value, base).origin;
  } catch {
    return null;
  }
}

/* ── headers ─────────────────────────────────────────────────────────────────────────────── */

interface CspContext {
  /** The enforced policy, from either the header or a <meta http-equiv> — browsers honour both. */
  enforced: string | null;
  /** Where the enforced policy came from, so the finding can name a header or a tag by name. */
  source: string | null;
  reportOnly: string | null;
}

function readCsp(res: Response, $: cheerio.CheerioAPI): CspContext {
  const header = res.headers.get("content-security-policy");
  // Case-insensitively, because http-equiv is matched case-insensitively by browsers and a theme
  // that writes `Content-Security-policy` would otherwise look like it had no policy at all.
  let meta: string | null = null;
  $("meta[http-equiv]").each((_, el) => {
    if (meta) return;
    if (($(el).attr("http-equiv") ?? "").toLowerCase() !== "content-security-policy") return;
    meta = $(el).attr("content")?.trim() ?? null;
  });

  return {
    enforced: header ?? meta,
    source: header ? "the Content-Security-Policy response header" : meta ? "a <meta http-equiv> tag in the page" : null,
    reportOnly: res.headers.get("content-security-policy-report-only"),
  };
}

function cspCheck(csp: CspContext): SecurityCheck {
  const id = "csp";
  const cat: SecurityCheckCategory = "headers";
  const title = "Content-Security-Policy";
  const sev: SecuritySeverity = "high";
  const fix =
    "Ship a Content-Security-Policy response header from the edge (Shopify does not set one for you — add it at " +
    "the CDN/proxy in front of the storefront, or via a Cloudflare/Fastly response-header rule). Start in " +
    "Content-Security-Policy-Report-Only with a script-src that nonces or hashes your own inline scripts and " +
    "enumerates each app's script host, watch the violation reports for a week, then flip the same policy to enforcing.";

  if (!csp.enforced) {
    if (csp.reportOnly) {
      return check(
        id,
        cat,
        title,
        sev,
        "warn",
        "A Content-Security-Policy-Report-Only header is present but no enforcing policy is. Report-Only tells the " +
          "browser to report violations and allow them anyway, so this policy blocks nothing today.",
        "Once the violation reports are clean, send the same policy in the enforcing Content-Security-Policy header. " +
          "A Report-Only policy left in place indefinitely is monitoring, not a control.",
        { observed: [`content-security-policy-report-only: ${csp.reportOnly}`] },
      );
    }
    return check(id, cat, title, sev, "fail", "No Content-Security-Policy is sent, in a header or in a <meta> tag.", fix);
  }

  const scriptSrc = cspDirective(csp.enforced, "script-src") ?? cspDirective(csp.enforced, "default-src");
  const observed: string[] = [`${csp.source}: ${csp.enforced.slice(0, 600)}`];

  if (!scriptSrc) {
    return check(
      id,
      cat,
      title,
      sev,
      "warn",
      `A policy is delivered via ${csp.source}, but it sets neither script-src nor default-src, so script loading and ` +
        "execution are left unrestricted by it.",
      "Add a script-src (or a default-src that script-src can inherit from) naming your own origin, each app's script " +
        "host, and a nonce or hash for inline scripts. Without one the rest of the policy governs everything except " +
        "the thing most worth governing.",
      { observed },
    );
  }

  const tokens = scriptSrc.map((t) => t.toLowerCase());
  const unsafeInline = tokens.includes("'unsafe-inline'");
  const unsafeEval = tokens.includes("'unsafe-eval'");
  const wildcard = tokens.includes("*") || tokens.includes("http:") || tokens.includes("https:");
  // A nonce or hash makes 'unsafe-inline' inert in every browser that understands either, so a
  // policy carrying both is strict in practice — flagging it would be reporting the fallback token
  // as if it were the effective policy.
  const nonceOrHash = tokens.some((t) => t.startsWith("'nonce-") || t.startsWith("'sha256-") || t.startsWith("'sha384-") || t.startsWith("'sha512-"));

  const weaknesses: string[] = [];
  if (wildcard) weaknesses.push("it allows scripts from any origin (`*`, `https:` or `http:`)");
  if (unsafeInline && !nonceOrHash) weaknesses.push("it allows `'unsafe-inline'` with no nonce or hash to override it, so any injected inline <script> runs");
  if (unsafeEval) weaknesses.push("it allows `'unsafe-eval'`, so eval() and Function() stay available to injected code");

  if (weaknesses.length === 0) {
    return check(
      id,
      cat,
      title,
      sev,
      "pass",
      `An enforcing policy is delivered via ${csp.source}, and its script-src restricts scripts to named origins ` +
        `without 'unsafe-inline' (unescaped) or 'unsafe-eval'.`,
      undefined,
      { observed },
    );
  }

  return check(
    id,
    cat,
    title,
    sev,
    "warn",
    `An enforcing policy is delivered via ${csp.source}, but ${weaknesses.join("; and ")}. A policy this permissive ` +
      "still constrains where scripts load from in some cases, but it does not stop the injected-script attacks CSP " +
      "exists to stop.",
    "Tighten script-src: replace `'unsafe-inline'` with a per-request nonce (or hashes for a fixed set of inline " +
      "scripts), drop `'unsafe-eval'` unless a named dependency demonstrably needs it, and replace any wildcard with " +
      "the explicit list of app script hosts already loading on the page.",
    { observed },
  );
}

function frameAncestorsCheck(res: Response, csp: CspContext): SecurityCheck {
  const frameAncestors = csp.enforced ? cspDirective(csp.enforced, "frame-ancestors") : null;
  const xfo = res.headers.get("x-frame-options");
  const observed = [
    ...(frameAncestors ? [`frame-ancestors ${frameAncestors.join(" ")}`] : []),
    ...(xfo ? [`x-frame-options: ${xfo}`] : []),
  ];
  const fix =
    "Add `frame-ancestors 'self'` to the Content-Security-Policy (and, for older browsers, " +
    "`X-Frame-Options: SAMEORIGIN`) at the edge in front of the storefront. If a partner genuinely embeds the store, " +
    "name their origin in frame-ancestors rather than leaving it open.";

  if (frameAncestors && !frameAncestors.includes("*")) {
    return check(
      "frame-ancestors",
      "headers",
      "Clickjacking protection (frame-ancestors / X-Frame-Options)",
      "medium",
      "pass",
      `The CSP restricts framing to ${frameAncestors.join(", ")}.`,
      undefined,
      { observed },
    );
  }

  const xfoValue = (xfo ?? "").trim().toLowerCase();
  if (xfoValue === "deny" || xfoValue === "sameorigin") {
    return check(
      "frame-ancestors",
      "headers",
      "Clickjacking protection (frame-ancestors / X-Frame-Options)",
      "medium",
      "pass",
      `X-Frame-Options is set to ${xfo}, so the page cannot be framed by another site.`,
      undefined,
      { observed },
    );
  }

  return check(
    "frame-ancestors",
    "headers",
    "Clickjacking protection (frame-ancestors / X-Frame-Options)",
    "medium",
    "fail",
    frameAncestors || xfo
      ? `Framing is not restricted: ${observed.join("; ")}. Any site can load this storefront in an invisible iframe ` +
          "and overlay it, which is how clickjacking gets a real customer to click a control they cannot see."
      : "Neither a CSP frame-ancestors directive nor an X-Frame-Options header is sent, so any site can load this " +
          "storefront in an invisible iframe and overlay it.",
    fix,
    observed.length > 0 ? { observed } : undefined,
  );
}

function hstsCheck(res: Response, isHttps: boolean): SecurityCheck {
  const id = "hsts";
  const cat: SecurityCheckCategory = "headers";
  const title = "Strict-Transport-Security";
  const sev: SecuritySeverity = "high";

  if (!isHttps) {
    // HSTS delivered over plaintext is ignored by browsers by design, so there is nothing here to
    // pass or fail — the finding that matters is the HTTP→HTTPS one, reported separately.
    return check(id, cat, title, sev, "not-tested", "The page was served over plaintext HTTP, where browsers ignore this header by specification.");
  }

  const value = res.headers.get("strict-transport-security");
  const fix =
    "Send `Strict-Transport-Security: max-age=31536000; includeSubDomains` on every HTTPS response from the edge in " +
    "front of the storefront. Roll it out with a short max-age first and raise it once you are confident every " +
    "subdomain in scope serves HTTPS, because the header is sticky in the browser for its full duration.";

  if (!value) {
    return check(
      id,
      cat,
      title,
      sev,
      "fail",
      "No Strict-Transport-Security header is sent, so a visitor typing the bare domain makes one plaintext request " +
        "before any redirect — the request an on-path attacker needs.",
      fix,
    );
  }

  const maxAge = Number(/max-age\s*=\s*"?(\d+)/i.exec(value)?.[1] ?? NaN);
  const observed = [`strict-transport-security: ${value}`];
  const includesSubdomains = /includesubdomains/i.test(value);

  if (!Number.isFinite(maxAge) || maxAge === 0) {
    return check(
      id,
      cat,
      title,
      sev,
      "fail",
      `The header is present but carries ${Number.isFinite(maxAge) ? "max-age=0" : "no readable max-age"}, which ` +
        "instructs browsers to forget the HTTPS-only rule rather than to apply it.",
      fix,
      { observed },
    );
  }

  if (maxAge < HSTS_MIN_MAX_AGE) {
    return check(
      id,
      cat,
      title,
      sev,
      "warn",
      `max-age is ${maxAge} seconds (about ${Math.round(maxAge / 86_400)} days). The rule is enforced, but it lapses ` +
        "for any visitor who does not return within that window — which is most of a storefront's traffic.",
      fix,
      { observed },
    );
  }

  return check(
    id,
    cat,
    title,
    sev,
    "pass",
    `max-age is ${maxAge} seconds (about ${Math.round(maxAge / 86_400)} days)${includesSubdomains ? ", and includeSubDomains is set" : ", scoped to this host only"}.`,
    undefined,
    { observed },
  );
}

function nosniffCheck(res: Response): SecurityCheck {
  const value = res.headers.get("x-content-type-options");
  const ok = (value ?? "").trim().toLowerCase() === "nosniff";
  return check(
    "x-content-type-options",
    "headers",
    "X-Content-Type-Options: nosniff",
    "medium",
    ok ? "pass" : "fail",
    ok
      ? "The header is set to nosniff, so browsers honour the declared Content-Type instead of guessing at it."
      : value
        ? `The header is present but reads "${value}" rather than "nosniff", which browsers do not act on.`
        : "The header is not sent, so a browser may MIME-sniff a response and execute as script something the server " +
          "labelled as data — the classic route from an uploaded file to code execution in a visitor's browser.",
    "Send `X-Content-Type-Options: nosniff` on every response from the edge in front of the storefront. It has no " +
      "compatibility cost and is a one-line rule at the CDN.",
    value ? { observed: [`x-content-type-options: ${value}`] } : undefined,
  );
}

/** Values that make the browser send more referrer information than its own default would. */
const LEAKY_REFERRER_POLICIES = new Set(["unsafe-url", "no-referrer-when-downgrade", "origin-when-cross-origin"]);

function referrerPolicyCheck(res: Response): SecurityCheck {
  const value = res.headers.get("referrer-policy");
  const id = "referrer-policy";
  const cat: SecurityCheckCategory = "headers";
  const title = "Referrer-Policy";
  const sev: SecuritySeverity = "low";
  const fix =
    "Send `Referrer-Policy: strict-origin-when-cross-origin` (or `same-origin` if no third party needs the referrer) " +
    "from the edge, so the policy is pinned rather than inherited from whatever the visitor's browser happens to default to.";

  if (!value) {
    // Current Chrome, Firefox and Safari all default to strict-origin-when-cross-origin, so the
    // absence of this header is a hardening gap rather than a leak — and calling an unset header a
    // data leak when browsers already behave correctly is the kind of overreach that gets a whole
    // security section discounted by the client's own engineers.
    return check(
      id,
      cat,
      title,
      sev,
      "warn",
      "No Referrer-Policy header is sent. Current browsers default to strict-origin-when-cross-origin, which is safe, " +
        "but the site is relying on that default rather than stating a policy.",
      fix,
    );
  }

  // Browsers take the last token they understand, which is how a `no-referrer-when-downgrade,
  // strict-origin-when-cross-origin` fallback pair is meant to be read.
  const tokens = value
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  const effective = tokens[tokens.length - 1] ?? "";
  const observed = [`referrer-policy: ${value}`];

  if (LEAKY_REFERRER_POLICIES.has(effective)) {
    return check(
      id,
      cat,
      title,
      sev,
      "fail",
      `The effective policy is "${effective}", which sends the full URL path (and query string) of the page a visitor ` +
        "came from to third-party origins — search terms, cart tokens and account paths included.",
      fix,
      { observed },
    );
  }

  return check(id, cat, title, sev, "pass", `The effective policy is "${effective}".`, undefined, { observed });
}

function permissionsPolicyCheck(res: Response): SecurityCheck {
  const value = res.headers.get("permissions-policy");
  const legacy = res.headers.get("feature-policy");
  const id = "permissions-policy";
  const cat: SecurityCheckCategory = "headers";
  const title = "Permissions-Policy";
  const sev: SecuritySeverity = "low";
  const fix =
    "Send a Permissions-Policy from the edge denying the capabilities the storefront does not use, e.g. " +
    "`Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(self)`. It limits what an injected " +
    "script or an embedded third-party frame can even ask the visitor for.";

  if (value) {
    return check(id, cat, title, sev, "pass", `A Permissions-Policy is sent: ${value}`, undefined, {
      observed: [`permissions-policy: ${value}`],
    });
  }
  if (legacy) {
    return check(
      id,
      cat,
      title,
      sev,
      "warn",
      "Only the superseded Feature-Policy header is sent. Current browsers have dropped support for it, so it governs " +
        "nothing today.",
      fix,
      { observed: [`feature-policy: ${legacy}`] },
    );
  }
  return check(
    id,
    cat,
    title,
    sev,
    "fail",
    "No Permissions-Policy header is sent, so every browser capability the page could request — camera, microphone, " +
      "geolocation, payment — is available to any script running on it, first- or third-party.",
    fix,
  );
}

/* ── transport ───────────────────────────────────────────────────────────────────────────── */

async function httpRedirectCheck(origin: string): Promise<SecurityCheck> {
  const id = "https-redirect";
  const cat: SecurityCheckCategory = "transport";
  const title = "HTTP redirects to HTTPS";
  const sev: SecuritySeverity = "high";
  const target = `http://${new URL(origin).host}/`;
  const fix =
    "Configure a permanent (301/308) redirect from http:// to https:// for every path at the edge, and pair it with " +
    "Strict-Transport-Security so returning visitors never make the plaintext request in the first place.";

  const res = await get(target, { redirect: "manual" });
  if (!res) {
    return check(
      id,
      cat,
      title,
      sev,
      "not-tested",
      `No response was received on plaintext HTTP (${target}) within ${TIMEOUT_MS / 1000}s. That is consistent with ` +
        "port 80 being closed, which would be a good outcome — but it is also what a network block or a firewall rule " +
        "against this scanner looks like, so it is reported as untested rather than as a pass.",
      undefined,
      { urls: [target] },
    );
  }

  const location = res.headers.get("location");
  const observed = [`HTTP ${res.status}`, ...(location ? [`location: ${location}`] : [])];

  if (res.status >= 300 && res.status < 400 && location) {
    const dest = originOf(location, target);
    if (dest?.startsWith("https://")) {
      const permanent = res.status === 301 || res.status === 308;
      return check(
        id,
        cat,
        title,
        sev,
        permanent ? "pass" : "warn",
        `A plaintext request to ${target} answered ${res.status} and redirected to ${dest}.` +
          (permanent ? "" : " The redirect is temporary, so browsers and intermediaries will not cache it and every visit repeats the plaintext hop."),
        permanent ? undefined : "Change the redirect status to 301 (or 308 to preserve the request method) so it is cacheable.",
        { urls: [target], observed },
      );
    }
    return check(id, cat, title, sev, "fail", `A plaintext request to ${target} redirected to ${location}, which is not HTTPS.`, fix, {
      urls: [target],
      observed,
    });
  }

  if (res.status >= 200 && res.status < 300) {
    return check(
      id,
      cat,
      title,
      sev,
      "fail",
      `A plaintext request to ${target} was answered with ${res.status} and served the page over HTTP rather than ` +
        "redirecting. Everything on that page — including anything typed into it — crosses the network unencrypted.",
      fix,
      { urls: [target], observed },
    );
  }

  return check(
    id,
    cat,
    title,
    sev,
    "not-tested",
    `A plaintext request to ${target} answered ${res.status}, which is neither a redirect nor a served page, so the ` +
      "redirect behaviour could not be determined.",
    undefined,
    { urls: [target], observed },
  );
}

function firstName(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

interface CertInfo {
  authorized: boolean;
  authorizationError?: string;
  validTo?: string;
  issuer?: string;
  subject?: string;
}

/** Reads the leaf certificate with verification deliberately disabled, then reports Node's own
 * verification verdict from `socket.authorized`. Connecting with rejectUnauthorized:true would
 * throw on exactly the sites this check exists to catch, leaving the worst case indistinguishable
 * from an unreachable host. */
function inspectCertificate(host: string, port: number): Promise<CertInfo | null> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value: CertInfo | null) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };

    const socket = tlsConnect({ host, port, servername: host, rejectUnauthorized: false, timeout: TIMEOUT_MS }, () => {
      const cert = socket.getPeerCertificate();
      done({
        authorized: socket.authorized,
        authorizationError: socket.authorized ? undefined : String(socket.authorizationError ?? "unspecified"),
        validTo: cert?.valid_to,
        // A relative distinguished name can legitimately appear more than once in a certificate,
        // which is why these arrive as string | string[].
        issuer: firstName(cert?.issuer?.O) ?? firstName(cert?.issuer?.CN),
        subject: firstName(cert?.subject?.CN),
      });
    });

    socket.on("error", () => done(null));
    socket.on("timeout", () => done(null));
  });
}

async function certificateCheck(pageUrl: URL, isHttps: boolean): Promise<SecurityCheck> {
  const id = "tls-certificate";
  const cat: SecurityCheckCategory = "transport";
  const title = "TLS certificate validity";
  const sev: SecuritySeverity = "critical";

  if (!isHttps) {
    return check(id, cat, title, sev, "not-tested", "The storefront resolved to a plaintext HTTP URL, so there is no certificate to inspect.");
  }

  const host = pageUrl.hostname;
  const port = Number(pageUrl.port || 443);
  const info = await inspectCertificate(host, port);
  if (!info) {
    return check(id, cat, title, sev, "not-tested", `A TLS handshake with ${host}:${port} did not complete within ${TIMEOUT_MS / 1000}s.`);
  }

  const observed = [
    ...(info.subject ? [`subject CN: ${info.subject}`] : []),
    ...(info.issuer ? [`issuer: ${info.issuer}`] : []),
    ...(info.validTo ? [`notAfter: ${info.validTo}`] : []),
  ];

  if (!info.authorized) {
    return check(
      id,
      cat,
      title,
      sev,
      "fail",
      `The certificate served by ${host} does not verify against the public trust stores: ${info.authorizationError}. ` +
        "Visitors reach an interstitial browser warning before they reach the store.",
      "Reissue the certificate for this exact hostname from a publicly trusted CA and install the full chain " +
        "(leaf plus intermediates). On Shopify-hosted domains this usually means removing and re-adding the domain " +
        "under Online Store > Domains so the managed certificate is reprovisioned.",
      { observed },
    );
  }

  const expiry = info.validTo ? new Date(info.validTo) : null;
  if (!expiry || Number.isNaN(expiry.getTime())) {
    return check(id, cat, title, sev, "not-tested", `The certificate verified, but its expiry date could not be read from the handshake.`, undefined, {
      observed,
    });
  }

  const days = Math.floor((expiry.getTime() - Date.now()) / 86_400_000);
  if (days < 0) {
    return check(
      id,
      cat,
      title,
      sev,
      "fail",
      `The certificate expired ${Math.abs(days)} day(s) ago, on ${expiry.toISOString().slice(0, 10)}.`,
      "Renew and deploy the certificate now — every visitor is currently seeing a full-page browser security warning.",
      { observed },
    );
  }
  if (days <= 14) {
    return check(
      id,
      cat,
      title,
      sev,
      "warn",
      `The certificate is valid but expires in ${days} day(s), on ${expiry.toISOString().slice(0, 10)}.`,
      "Confirm automated renewal is actually running for this hostname. A certificate this close to expiry with no " +
        "renewal in flight becomes a total outage on a fixed date.",
      { observed },
    );
  }

  return check(
    id,
    cat,
    title,
    sev,
    "pass",
    `The certificate verifies against the public trust stores and is valid for another ${days} day(s), until ${expiry.toISOString().slice(0, 10)}.`,
    undefined,
    { observed },
  );
}

/** Attributes whose value the browser fetches as a subresource of the page. Split by whether the
 * browser treats an insecure one as active content (blocked outright, and a code-execution risk if
 * it were not) or passive (usually upgraded or blocked silently, an integrity risk rather than a
 * takeover) — because the two deserve different severities and different sentences. */
const ACTIVE_MIXED_SELECTORS = ["script[src]", 'link[rel="stylesheet"][href]', "iframe[src]", "object[data]", "form[action]"];
const PASSIVE_MIXED_SELECTORS = ["img[src]", "video[src]", "audio[src]", "source[src]", "track[src]"];

function mixedContentCheck($: cheerio.CheerioAPI, isHttps: boolean, csp: CspContext): SecurityCheck {
  const id = "mixed-content";
  const cat: SecurityCheckCategory = "transport";
  const title = "No mixed content in the delivered HTML";
  const sev: SecuritySeverity = "high";

  if (!isHttps) {
    return check(id, cat, title, sev, "not-tested", "The page itself was served over HTTP, so there is no secure context for content to be mixed into.");
  }

  const collect = (selectors: string[]): string[] => {
    const found: string[] = [];
    for (const selector of selectors) {
      $(selector).each((_, el) => {
        const attr = selector.includes("[src]") ? "src" : selector.includes("[href]") ? "href" : selector.includes("[data]") ? "data" : "action";
        const value = $(el).attr(attr) ?? "";
        if (value.toLowerCase().startsWith("http://")) found.push(value);
      });
    }
    return [...new Set(found)];
  };

  const active = collect(ACTIVE_MIXED_SELECTORS);
  const passive = collect(PASSIVE_MIXED_SELECTORS);
  const upgrades = csp.enforced ? cspDirective(csp.enforced, "upgrade-insecure-requests") !== null : false;

  // Stated as a markup check every time it appears, because that is the honest boundary: a tag
  // injected at runtime by an app's JavaScript never appears in this HTML, and a reader who thinks
  // this covers runtime requests will draw a stronger conclusion from a pass than it supports.
  const scopeNote = "Read from the HTML the server delivered; resources requested later by JavaScript are outside what this check can see.";

  if (active.length > 0) {
    return check(
      id,
      cat,
      title,
      sev,
      "fail",
      `${active.length} script, stylesheet, iframe or form target on the page is referenced over plaintext http://. ` +
        `Browsers block insecure active content on an HTTPS page outright, so these are broken as well as insecure. ${scopeNote}`,
      "Change these references to https:// (or to protocol-relative paths served by the theme). If a vendor genuinely " +
        "has no HTTPS endpoint, that vendor cannot be used on a secure page — `upgrade-insecure-requests` papers over " +
        "the symptom without fixing the underlying reference.",
      { observed: active.slice(0, 10), notes: [scopeNote] },
    );
  }

  if (passive.length > 0) {
    return check(
      id,
      cat,
      title,
      sev,
      "warn",
      `${passive.length} image or media file is referenced over plaintext http://. ` +
        (upgrades
          ? "The page's CSP sets upgrade-insecure-requests, so browsers rewrite these to https:// before requesting them — the markup is wrong but the requests are not made in the clear. "
          : "Browsers either block or silently upgrade these depending on the resource, so some may simply not render. ") +
        scopeNote,
      "Rewrite these references to https:// in the theme or in the merchandising data they come from.",
      { observed: passive.slice(0, 10), notes: [scopeNote] },
    );
  }

  return check(id, cat, title, sev, "pass", `No http:// subresource references appear in the delivered HTML. ${scopeNote}`, undefined, {
    notes: [scopeNote],
  });
}

/* ── cookies ─────────────────────────────────────────────────────────────────────────────── */

interface ParsedCookie {
  name: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: string | null;
  raw: string;
}

function parseCookies(res: Response): ParsedCookie[] {
  return res.headers.getSetCookie().map((raw) => {
    const [pair, ...attrs] = raw.split(";");
    const lower = attrs.map((a) => a.trim().toLowerCase());
    return {
      name: (pair ?? "").split("=")[0]?.trim() ?? "",
      secure: lower.includes("secure"),
      httpOnly: lower.includes("httponly"),
      sameSite: lower.find((a) => a.startsWith("samesite="))?.split("=")[1] ?? null,
      // Value redacted: a session cookie's value IS the credential, and a report that quotes one
      // verbatim has published it to everyone the report is later forwarded to.
      raw: [`${(pair ?? "").split("=")[0]}=<redacted>`, ...attrs.map((a) => a.trim())].join("; "),
    };
  });
}

/** Cookies that identify a visitor's session or authorise an action. These are the ones where a
 * missing HttpOnly matters, because reading one is equivalent to being the customer. */
const SESSION_COOKIE = /(^|_)(sess|session|sid|auth|token|jwt|login|logged_in|remember|csrf|xsrf)(_|$)|^_secure_|_sig$|^secure_/i;

/** Cookies a front-end script is supposed to read, so their lack of HttpOnly is by design and
 * demanding it would break the tag. Kept explicit rather than inferred: telling a client to set
 * HttpOnly on `_ga` is a recommendation that cannot be followed, and one of those is enough for an
 * engineer to stop reading the section. */
const CLIENT_READ_COOKIE = /^(_ga|_gid|_gat|_gcl|_fbp|_fbc|_clck|_clsk|_uet|_shopify_|_landing_page|_orig_referrer|cart_currency|localization|keep_alive)/i;

function cookieSecureCheck(cookies: ParsedCookie[], isHttps: boolean): SecurityCheck {
  const id = "cookie-secure";
  const cat: SecurityCheckCategory = "cookies";
  const title = "Cookies carry the Secure flag";
  const sev: SecuritySeverity = "high";

  if (cookies.length === 0) {
    return check(id, cat, title, sev, "not-tested", "The homepage response set no cookies, so there was nothing to inspect. Cookies written later by JavaScript are not visible to an HTTP-level check.");
  }
  if (!isHttps) {
    return check(id, cat, title, sev, "not-tested", "The page was served over HTTP, where the Secure flag would prevent the cookie from being set at all.");
  }

  const insecure = cookies.filter((c) => !c.secure);
  if (insecure.length === 0) {
    return check(id, cat, title, sev, "pass", `All ${cookies.length} cookie(s) set on this response carry the Secure flag.`, undefined, {
      observed: cookies.map((c) => c.raw).slice(0, 10),
    });
  }

  return check(
    id,
    cat,
    title,
    sev,
    "fail",
    `${insecure.length} of ${cookies.length} cookie(s) set on this HTTPS response omit the Secure flag: ` +
      `${insecure.map((c) => c.name).join(", ")}. Without it the browser will attach these to a future plaintext ` +
      "request to the same domain, which is the request an on-path attacker can read.",
    "Add `Secure` to every cookie the storefront sets. For cookies set by theme or app JavaScript, add `; Secure` to " +
      "the document.cookie write; for cookies set server-side, add the flag at the point they are issued.",
    { observed: insecure.map((c) => c.raw).slice(0, 10) },
  );
}

function cookieSameSiteCheck(cookies: ParsedCookie[]): SecurityCheck {
  const id = "cookie-samesite";
  const cat: SecurityCheckCategory = "cookies";
  const title = "Cookies declare SameSite";
  const sev: SecuritySeverity = "medium";

  if (cookies.length === 0) {
    return check(id, cat, title, sev, "not-tested", "The homepage response set no cookies, so there was nothing to inspect.");
  }

  // SameSite=None without Secure is rejected outright by every current browser, so this is a
  // functional bug as much as a security one — the cookie simply is not stored.
  const noneWithoutSecure = cookies.filter((c) => c.sameSite === "none" && !c.secure);
  if (noneWithoutSecure.length > 0) {
    return check(
      id,
      cat,
      title,
      sev,
      "fail",
      `${noneWithoutSecure.map((c) => c.name).join(", ")} declare SameSite=None without Secure. Current browsers reject ` +
        "that combination, so these cookies are not stored at all — whatever depends on them is silently broken.",
      "Add `Secure` alongside `SameSite=None`, or drop to `SameSite=Lax` if the cookie is not needed on cross-site requests.",
      { observed: noneWithoutSecure.map((c) => c.raw) },
    );
  }

  const unset = cookies.filter((c) => !c.sameSite);
  if (unset.length > 0) {
    return check(
      id,
      cat,
      title,
      sev,
      "warn",
      `${unset.length} of ${cookies.length} cookie(s) declare no SameSite attribute: ${unset.map((c) => c.name).join(", ")}. ` +
        "Chromium-based browsers apply Lax by default, so the practical exposure today is small, but the behaviour is " +
        "the browser's choice rather than the site's and it differs between engines.",
      "Set SameSite explicitly on each cookie — `Lax` for anything session-related, `None; Secure` only where a genuine " +
        "cross-site flow (an embedded checkout, a third-party iframe) needs it.",
      { observed: unset.map((c) => c.raw).slice(0, 10) },
    );
  }

  return check(id, cat, title, sev, "pass", `All ${cookies.length} cookie(s) declare a SameSite attribute.`, undefined, {
    observed: cookies.map((c) => c.raw).slice(0, 10),
  });
}

function cookieHttpOnlyCheck(cookies: ParsedCookie[]): SecurityCheck {
  const id = "cookie-httponly";
  const cat: SecurityCheckCategory = "cookies";
  const title = "Session cookies carry HttpOnly";
  const sev: SecuritySeverity = "medium";

  if (cookies.length === 0) {
    return check(id, cat, title, sev, "not-tested", "The homepage response set no cookies, so there was nothing to inspect.");
  }

  const sessionish = cookies.filter((c) => SESSION_COOKIE.test(c.name) && !CLIENT_READ_COOKIE.test(c.name));
  if (sessionish.length === 0) {
    return check(
      id,
      cat,
      title,
      sev,
      "not-tested",
      `None of the ${cookies.length} cookie(s) on this response name themselves as session or authentication cookies, ` +
        "and HttpOnly is deliberately not demanded of the rest — analytics and personalisation cookies exist to be read " +
        "by front-end scripts, so setting HttpOnly on them would break the tag that owns them.",
      undefined,
      { observed: cookies.map((c) => c.raw).slice(0, 10) },
    );
  }

  const exposed = sessionish.filter((c) => !c.httpOnly);
  if (exposed.length === 0) {
    return check(id, cat, title, sev, "pass", `Every session-identifying cookie on this response (${sessionish.map((c) => c.name).join(", ")}) carries HttpOnly.`, undefined, {
      observed: sessionish.map((c) => c.raw),
    });
  }

  return check(
    id,
    cat,
    title,
    sev,
    "fail",
    `${exposed.map((c) => c.name).join(", ")} look like session or authentication cookies but are readable from ` +
      "JavaScript. Any injected script — from a compromised app, a tag manager container, or an XSS — can read them and " +
      "replay the session.",
    "Add `HttpOnly` to these cookies where they are issued. This is asked only of session and authentication cookies: " +
      "analytics and personalisation cookies are read by the front-end scripts that own them by design, and adding " +
      "HttpOnly to those would break them, so they are excluded from this check.",
    { observed: exposed.map((c) => c.raw) },
  );
}

/* ── exposed surface ─────────────────────────────────────────────────────────────────────── */

/** A 200 is not evidence of exposure on its own: a great many hosts answer every unknown path with
 * the storefront's own HTML, which would turn this check into a false-positive generator on exactly
 * the sites it is meant to reassure. Each probe therefore has to match a signature only the real
 * file would produce. */
const EXPOSED_PROBES: { path: string; label: string; matches: (body: string) => boolean }[] = [
  { path: "/.env", label: ".env", matches: (b) => /^[ \t]*(export[ \t]+)?[A-Z][A-Z0-9_]{2,}[ \t]*=/m.test(b) },
  { path: "/.git/config", label: ".git/config", matches: (b) => /\[core\]/.test(b) && /repositoryformatversion/i.test(b) },
  { path: "/.git/HEAD", label: ".git/HEAD", matches: (b) => /^ref:\s+refs\//m.test(b.trim()) },
  {
    path: "/config.json",
    label: "config.json",
    matches: (b) => {
      try {
        const parsed = JSON.parse(b);
        return typeof parsed === "object" && parsed !== null;
      } catch {
        return false;
      }
    },
  },
];

async function exposedFilesCheck(origin: string): Promise<SecurityCheck> {
  const id = "exposed-files";
  const cat: SecurityCheckCategory = "exposure";
  const title = "Sensitive files are not served";
  const sev: SecuritySeverity = "critical";

  const results = await Promise.all(
    EXPOSED_PROBES.map(async (probe) => {
      const url = `${origin}${probe.path}`;
      const fetched = await getWithBody(url);
      if (!fetched) return { probe, url, reached: false, exposed: false, note: "no response" };
      const contentType = fetched.res.headers.get("content-type") ?? "";
      const isHtml = /text\/html/i.test(contentType);
      const exposed = fetched.res.ok && !isHtml && probe.matches(fetched.body);
      return {
        probe,
        url,
        reached: true,
        exposed,
        // The body is deliberately never quoted: a served .env is a list of live credentials, and
        // pasting them into a report distributes them to everyone the report is forwarded to.
        note: `HTTP ${fetched.res.status}${contentType ? `, ${contentType.split(";")[0]}` : ""}, ${fetched.body.length} bytes`,
      };
    }),
  );

  const exposed = results.filter((r) => r.exposed);
  const reached = results.filter((r) => r.reached);

  if (exposed.length > 0) {
    return check(
      id,
      cat,
      title,
      sev,
      "fail",
      `${exposed.map((r) => r.probe.label).join(", ")} ${exposed.length === 1 ? "is" : "are"} served publicly, and the ` +
        `response body matches the real file's format rather than a catch-all HTML page. Treat any credential in ` +
        `${exposed.length === 1 ? "it" : "them"} as compromised.`,
      "Block these paths at the edge and remove the files from the deployed document root. Then rotate every " +
        "credential the exposed file contained — the fix is not complete until the secrets themselves are replaced, " +
        "because anyone could have fetched them at any point while they were reachable. The response bodies are " +
        "deliberately not quoted here; fetch the URLs listed to see them.",
      { urls: exposed.map((r) => r.url), observed: exposed.map((r) => `${r.probe.path} → ${r.note}`) },
    );
  }

  if (reached.length === 0) {
    return check(id, cat, title, sev, "not-tested", "None of the probe requests completed, so nothing could be ruled in or out.", undefined, {
      urls: results.map((r) => r.url),
    });
  }

  return check(
    id,
    cat,
    title,
    sev,
    "pass",
    `${reached.length} sensitive path(s) were requested (${reached.map((r) => r.probe.path).join(", ")}) and none returned ` +
      "content matching the real file. This covers these specific paths only, not every file a deploy could leave behind.",
    undefined,
    { urls: reached.map((r) => r.url), observed: reached.map((r) => `${r.probe.path} → ${r.note}`) },
  );
}

async function sourceMapCheck(scriptUrls: string[], pageOrigin: string): Promise<SecurityCheck> {
  const id = "source-maps";
  const cat: SecurityCheckCategory = "exposure";
  const title = "Source maps are not published";
  const sev: SecuritySeverity = "low";

  const firstParty = scriptUrls.filter((u) => originOf(u, pageOrigin) === pageOrigin).slice(0, SOURCE_MAP_SAMPLE);
  if (firstParty.length === 0) {
    return check(id, cat, title, sev, "not-tested", "No first-party <script src> was found in the delivered HTML to sample.");
  }

  const found: string[] = [];
  let sampled = 0;
  for (const scriptUrl of firstParty) {
    const fetched = await getWithBody(scriptUrl);
    if (!fetched?.res.ok) continue;
    sampled += 1;

    const ref = [...fetched.body.matchAll(/[#@]\s*sourceMappingURL=(\S+)/g)].pop()?.[1];
    if (!ref) continue;

    if (ref.startsWith("data:")) {
      // An inline map needs no second request to be readable — it already shipped inside the bundle.
      found.push(`${scriptUrl} (map inlined as a data: URI)`);
      continue;
    }

    const mapUrl = new URL(ref, scriptUrl).toString();
    const map = await getWithBody(mapUrl);
    // A dangling sourceMappingURL comment is not an exposure, so the map has to actually be served
    // and actually be a source map before this is reported.
    if (map?.res.ok && /"sources"\s*:/.test(map.body)) found.push(mapUrl);
  }

  if (sampled === 0) {
    return check(id, cat, title, sev, "not-tested", `None of the ${firstParty.length} sampled first-party script(s) could be fetched.`);
  }

  if (found.length > 0) {
    return check(
      id,
      cat,
      title,
      sev,
      "fail",
      `${found.length} published source map(s) were found and fetched successfully across ${sampled} sampled first-party ` +
        "script(s). A source map hands anyone the original, unminified source of the bundle — including comments and " +
        "any internal endpoint or key left in it. This is information disclosure rather than a vulnerability by itself.",
      "Stop uploading .map files with production builds (or serve them only to authenticated internal users), and " +
        "strip the trailing //# sourceMappingURL comment from production bundles so nothing points at them.",
      { urls: found.slice(0, 10) },
    );
  }

  return check(
    id,
    cat,
    title,
    sev,
    "pass",
    `${sampled} first-party script(s) were sampled and none published a fetchable source map. A sample, not an exhaustive sweep.`,
    undefined,
    { urls: firstParty },
  );
}

function versionDisclosureCheck(res: Response): SecurityCheck {
  const id = "version-disclosure";
  const cat: SecurityCheckCategory = "exposure";
  const title = "Server software versions are not advertised";
  const sev: SecuritySeverity = "low";

  const server = res.headers.get("server");
  const poweredBy = res.headers.get("x-powered-by");
  const observed = [
    ...(server ? [`server: ${server}`] : []),
    ...(poweredBy ? [`x-powered-by: ${poweredBy}`] : []),
  ];

  // A bare product name is a fact about the stack that any TLS fingerprint would give up anyway;
  // a version number is the part that tells an attacker which published exploit to try first.
  const versioned = observed.filter((line) => /\d+\.\d+/.test(line));
  if (versioned.length > 0) {
    return check(
      id,
      cat,
      title,
      sev,
      "fail",
      `Response headers advertise exact software versions: ${versioned.join("; ")}. That is the first thing an ` +
        "automated scanner reads to decide which published exploit to try.",
      "Suppress the version in these headers at the edge — `server_tokens off;` in nginx, `ServerTokens Prod` in " +
        "Apache, `app.disable('x-powered-by')` in Express, or a response-header rewrite at the CDN.",
      { observed },
    );
  }

  if (poweredBy) {
    return check(
      id,
      cat,
      title,
      sev,
      "warn",
      `An X-Powered-By header is sent (${poweredBy}). It carries no version, but it names the stack for no benefit to anyone.`,
      "Remove the X-Powered-By header at the edge or in the application framework — it serves no purpose in production.",
      { observed },
    );
  }

  return check(
    id,
    cat,
    title,
    sev,
    "pass",
    server ? `The Server header names a product without a version (${server}), and no X-Powered-By is sent.` : "Neither Server nor X-Powered-By discloses software versions.",
    undefined,
    observed.length > 0 ? { observed } : undefined,
  );
}

/* ── supply chain ────────────────────────────────────────────────────────────────────────── */

interface ScriptRef {
  src: string;
  resolved: string;
  origin: string;
  integrity: boolean;
}

function readScripts($: cheerio.CheerioAPI, pageUrl: string): ScriptRef[] {
  const refs: ScriptRef[] = [];
  $("script[src]").each((_, el) => {
    const src = $(el).attr("src") ?? "";
    if (!src || src.startsWith("data:")) return;
    let resolved: URL;
    try {
      resolved = new URL(src, pageUrl);
    } catch {
      return;
    }
    refs.push({
      src,
      resolved: resolved.toString(),
      origin: resolved.origin,
      integrity: Boolean($(el).attr("integrity")?.trim()),
    });
  });
  return refs;
}

function sriCheck(thirdParty: ScriptRef[]): SecurityCheck {
  const id = "script-sri";
  const cat: SecurityCheckCategory = "supply-chain";
  const title = "Third-party scripts use subresource integrity";
  const sev: SecuritySeverity = "medium";

  if (thirdParty.length === 0) {
    return check(id, cat, title, sev, "not-tested", "No cross-origin <script src> appears in the delivered HTML, so there was nothing to check.");
  }

  const without = thirdParty.filter((s) => !s.integrity);
  if (without.length === 0) {
    return check(id, cat, title, sev, "pass", `All ${thirdParty.length} cross-origin script tag(s) in the HTML carry an integrity attribute.`, undefined, {
      urls: thirdParty.map((s) => s.resolved).slice(0, 10),
    });
  }

  // Never escalated to `fail`. Pinning a self-updating loader (a tag manager, a CMP, a chat widget)
  // with SRI breaks it the moment the vendor ships a new build, so "add SRI everywhere" is advice
  // that would take the storefront down — which makes a failing grade for not doing it dishonest.
  return check(
    id,
    cat,
    title,
    sev,
    "warn",
    `${without.length} of ${thirdParty.length} cross-origin script tag(s) load without an integrity attribute, from ` +
      `${[...new Set(without.map((s) => new URL(s.resolved).host))].join(", ")}. Each of those hosts can change the ` +
      "code running on this storefront at any time, and the browser will run whatever arrives.",
    "Add integrity + crossorigin attributes to any third-party script served from a versioned, immutable URL (a " +
      "pinned CDN build of a library, for example). Deliberately do not add SRI to self-updating loaders such as a " +
      "tag manager, CMP or chat widget — pinning those breaks them on the vendor's next release. For that group the " +
      "control is a CSP script-src allowlist plus a periodic review of which vendors are still needed.",
    { urls: without.map((s) => s.resolved).slice(0, 10) },
  );
}

function thirdPartyOriginCheck(origins: string[]): SecurityCheck {
  const id = "third-party-origins";
  const cat: SecurityCheckCategory = "supply-chain";
  const title = "Third-party script origins";
  const sev: SecuritySeverity = "low";
  const scopeNote =
    "Counted from the delivered HTML. Scripts injected at runtime by an app or a tag manager are not included, so the " +
    "real number is at least this high.";

  if (origins.length <= THIRD_PARTY_ORIGIN_BUDGET) {
    return check(
      id,
      cat,
      title,
      sev,
      "pass",
      `${origins.length} distinct cross-origin script host(s) are referenced${origins.length > 0 ? `: ${origins.join(", ")}` : ""}. ${scopeNote}`,
      undefined,
      origins.length > 0 ? { urls: origins, notes: [scopeNote] } : { notes: [scopeNote] },
    );
  }

  return check(
    id,
    cat,
    title,
    sev,
    "warn",
    `${origins.length} distinct cross-origin script hosts are referenced: ${origins.join(", ")}. Every one of them can ` +
      `ship new code to this storefront without review. ${scopeNote}`,
    "Review which of these vendors are still in use and remove the rest — an uninstalled app that left its script tag " +
      "behind is pure risk with no offsetting benefit. For the ones that stay, constrain them with a CSP script-src " +
      "allowlist so a compromised vendor cannot pull in a fourth-party payload.",
    { urls: origins, notes: [scopeNote] },
  );
}

function compareVersion(a: number[], b: readonly number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Reads the version out of the jQuery file itself rather than out of its filename. A path like
 * `/assets/jquery.min.js` carries no version, and a path like `/cdn/jquery-3.2.1.min.js` can be a
 * stale filename in front of a different build — the banner and the `.fn.jquery` assignment are
 * written by the library and cannot disagree with it. */
function jqueryVersionFrom(body: string): string | null {
  return (
    /jQuery(?: JavaScript Library)?\s+v?(\d+\.\d+\.\d+)/i.exec(body)?.[1] ??
    /\.fn\.jquery\s*=\s*["'](\d+\.\d+(?:\.\d+)?)/.exec(body)?.[1] ??
    null
  );
}

async function jqueryCheck(scripts: ScriptRef[]): Promise<SecurityCheck> {
  const id = "jquery-version";
  const cat: SecurityCheckCategory = "supply-chain";
  const title = "jQuery version";
  const sev: SecuritySeverity = "high";

  // jQuery UI and jQuery Migrate carry their own, unrelated version numbers; matching them here
  // would produce a confident finding about the wrong library.
  const candidates = scripts.filter((s) => /jquery/i.test(s.src) && !/jquery[.\-_]?(ui|migrate|mobile|validate)/i.test(s.src)).slice(0, 2);
  if (candidates.length === 0) {
    return check(
      id,
      cat,
      title,
      sev,
      "not-tested",
      "No jQuery <script src> was found in the delivered HTML. A copy bundled into a theme asset would not be visible " +
        "to an HTML-level check, so this is not evidence that jQuery is absent.",
    );
  }

  for (const candidate of candidates) {
    const fetched = await getWithBody(candidate.resolved);
    if (!fetched?.res.ok) continue;
    const version = jqueryVersionFrom(fetched.body);
    if (!version) continue;

    const parts = version.split(".").map(Number);
    const observed = [`${candidate.resolved} reports version ${version}`];

    if (compareVersion(parts, JQUERY_XSS_FIXED_IN) < 0) {
      const unsupportedBranch = parts[0] < 3;
      return check(
        id,
        cat,
        title,
        sev,
        "fail",
        `jQuery ${version} is loaded. jQuery 3.5.0 is the release that fixed the htmlPrefilter cross-site-scripting ` +
          `issues published as CVE-2020-11022 and CVE-2020-11023, and ${version} predates it.` +
          (unsupportedBranch ? ` The ${parts[0]}.x branch is also no longer maintained, so it will not receive further fixes.` : ""),
        "Upgrade to the current jQuery 3.7.x. If a theme or app depends on removed 1.x/2.x APIs, add jQuery Migrate " +
          "alongside the upgrade to surface exactly which call sites need changing, rather than staying on the old " +
          "branch. Nothing beyond the version string was tested here — whether this site actually reaches the " +
          "vulnerable code path is a separate question.",
        { urls: [candidate.resolved], observed },
      );
    }

    return check(
      id,
      cat,
      title,
      sev,
      "pass",
      `jQuery ${version} is loaded, which is at or past 3.5.0 — the release that fixed the last widely-reported jQuery ` +
        "XSS issues. No claim is made here about advisories published after this tool was written.",
      undefined,
      { urls: [candidate.resolved], observed },
    );
  }

  return check(
    id,
    cat,
    title,
    sev,
    "not-tested",
    `A jQuery script tag was found (${candidates.map((c) => c.resolved).join(", ")}) but its version could not be read ` +
      "from the file, so no version claim is made.",
    undefined,
    { urls: candidates.map((c) => c.resolved) },
  );
}

/* ── scoring ─────────────────────────────────────────────────────────────────────────────── */

function tally(checks: SecurityCheck[]): SecurityTotals {
  const totals: SecurityTotals = { pass: 0, warn: 0, fail: 0, notTested: 0, critical: 0 };
  for (const c of checks) {
    if (c.status === "not-tested") totals.notTested += 1;
    else totals[c.status] += 1;
    if (c.status === "fail" && c.severity === "critical") totals.critical += 1;
  }
  return totals;
}

/** A weighted proportion of what was actually checked, or null when too little was — the same
 * shape as the consent suite's score, for the same reasons and so the two numbers mean the same
 * thing when they sit side by side in one report.
 *
 * Three properties carried over deliberately:
 *
 * - **Proportional to what applied.** A site that sets no cookies on its homepage has three
 *   inapplicable checks; judging it out of a fixed 100 marks it down for questions never asked.
 * - **Unknown is not half-good.** `not-tested` is excluded from both sides of the ratio rather
 *   than given partial credit, so a site we largely failed to reach cannot out-rank one we did.
 * - **A critical failure is always visible.** Any confirmed critical failure scales the result
 *   into the bottom half, so a served `.env` or an invalid certificate can never present as a
 *   passing grade — while still separating one such failure from three.
 *
 * The one departure: `warn` earns half weight rather than being excluded. A warn here is a
 * confirmed observation of a weak-but-present control, not an absence of information — the state
 * consent excludes is `blocked`, and its analogue here is `not-tested`, which is excluded.
 */
function scoreOf(checks: SecurityCheck[]): number | null {
  const confirmed = checks.filter((c) => c.status !== "not-tested");
  if (confirmed.length < MIN_CONFIRMED) return null;

  const possible = confirmed.reduce((sum, c) => sum + WEIGHT[c.severity], 0);
  if (possible === 0) return null;
  const earned = confirmed.reduce((sum, c) => sum + (c.status === "pass" ? WEIGHT[c.severity] : c.status === "warn" ? WEIGHT[c.severity] / 2 : 0), 0);

  const raw = (100 * earned) / possible;
  const hasCritical = confirmed.some((c) => c.status === "fail" && c.severity === "critical");
  return Math.round(hasCritical ? raw * 0.49 : raw);
}

/* ── entry point ─────────────────────────────────────────────────────────────────────────── */

export async function analyzeSecurity(url: string, options: AnalyzeSecurityOptions = {}): Promise<SecuritySection> {
  const stage = options.onStage;
  lastFetchError = null;

  stage?.("Security: reading response headers");
  const home = await getWithBody(url, { headers: { accept: "text/html,application/xhtml+xml" } });
  if (!home) {
    const reason = lastFetchError;
    // An unreachable HTTPS page is most often an unreachable page *because of* its certificate,
    // and Node's fetch refuses the connection before any of this can be observed. So the one
    // check that does not need the page is still run: it turns "we could not read the site" into
    // "the site serves an expired certificate", which is the finding that actually matters and
    // the only one available at this point.
    const requested = new URL(url);
    const cert = await certificateCheck(requested, requested.protocol === "https:");
    return {
      score: scoreOf([cert]),
      scannedUrl: url,
      checks: [cert],
      totals: tally([cert]),
      thirdPartyScriptOrigins: [],
      fatalError:
        `The storefront could not be fetched${reason ? ` (${reason})` : ""}, so every check that reads the page or its ` +
        `headers is untested. Only the TLS certificate, which needs no successful request, could be inspected.`,
    };
  }

  // Every header verdict is about the response that actually rendered, which after redirects may
  // be a different origin than the one configured for the store.
  const finalUrl = new URL(home.res.url || url);
  const isHttps = finalUrl.protocol === "https:";
  const origin = finalUrl.origin;

  const $ = cheerio.load(home.body);
  const csp = readCsp(home.res, $);
  const cookies = parseCookies(home.res);
  const scripts = readScripts($, finalUrl.toString());
  const thirdPartyScripts = scripts.filter((s) => s.origin !== origin);
  const thirdPartyScriptOrigins = [...new Set(thirdPartyScripts.map((s) => s.origin))].sort();

  const checks: SecurityCheck[] = [
    cspCheck(csp),
    frameAncestorsCheck(home.res, csp),
    hstsCheck(home.res, isHttps),
    nosniffCheck(home.res),
    referrerPolicyCheck(home.res),
    permissionsPolicyCheck(home.res),
    mixedContentCheck($, isHttps, csp),
    cookieSecureCheck(cookies, isHttps),
    cookieSameSiteCheck(cookies),
    cookieHttpOnlyCheck(cookies),
    versionDisclosureCheck(home.res),
    sriCheck(thirdPartyScripts),
    thirdPartyOriginCheck(thirdPartyScriptOrigins),
  ];

  stage?.("Security: probing transport, exposed paths & script supply chain");
  const probed = await Promise.all([
    httpRedirectCheck(origin),
    certificateCheck(finalUrl, isHttps),
    exposedFilesCheck(origin),
    sourceMapCheck(
      scripts.map((s) => s.resolved),
      origin,
    ),
    jqueryCheck(scripts),
  ]);
  checks.push(...probed);

  // Grouped by category so the rendered list reads as a report rather than as the order the
  // requests happened to finish in.
  const categoryOrder: SecurityCheckCategory[] = ["transport", "headers", "cookies", "exposure", "supply-chain"];
  checks.sort((a, b) => categoryOrder.indexOf(a.category) - categoryOrder.indexOf(b.category));

  return {
    score: scoreOf(checks),
    scannedUrl: finalUrl.toString(),
    checks,
    totals: tally(checks),
    thirdPartyScriptOrigins,
  };
}
