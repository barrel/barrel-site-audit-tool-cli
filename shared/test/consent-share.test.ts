// The password-gated external link for a scan report. The blob-backed parts (create, unlock,
// lockout) need a store, so this covers the pure guards that decide whether a request is let in:
// the unlock cookie and the liveness check. Code under test: web/lib/consent-share.ts.
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  isLive,
  makeUnlockCookie,
  parseEmails,
  verifyUnlockCookie,
  type ConsentShareRecord,
} from "../../web/lib/consent-share.js";

function record(over: Partial<ConsentShareRecord> = {}): ConsentShareRecord {
  return {
    id: "abcdefghijklmnopqrstuvwxyz012345",
    scanId: "scan-1",
    emails: ["a@client.com"],
    salt: "00",
    hash: "11".repeat(32),
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    failures: [],
    ...over,
  };
}

describe("secure report guards", () => {
  beforeEach(() => {
    process.env.SESSION_SECRET = "test-secret";
  });

  it("accepts the cookie it issued", () => {
    const r = record();
    assert.equal(verifyUnlockCookie(r, makeUnlockCookie(r).value), true);
  });

  it("rejects a missing, malformed or tampered cookie", () => {
    const r = record();
    const { value } = makeUnlockCookie(r);
    assert.equal(verifyUnlockCookie(r, undefined), false);
    assert.equal(verifyUnlockCookie(r, "garbage"), false);
    assert.equal(verifyUnlockCookie(r, value.replace(/.$/, (c) => (c === "0" ? "1" : "0"))), false);
  });

  it("does not let a cookie for one link open another", () => {
    const { value } = makeUnlockCookie(record());
    assert.equal(verifyUnlockCookie(record({ id: "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz" }), value), false);
  });

  it("is invalidated when the password hash changes", () => {
    const { value } = makeUnlockCookie(record());
    assert.equal(verifyUnlockCookie(record({ hash: "22".repeat(32) }), value), false);
  });

  it("never outlives the link's own expiry", () => {
    const r = record({ expiresAt: new Date(Date.now() + 60_000).toISOString() });
    assert.ok(makeUnlockCookie(r).maxAge <= 60);
  });

  it("treats revoked, expired and missing links as not live", () => {
    assert.equal(isLive(record()), true);
    assert.equal(isLive(record({ revokedAt: new Date().toISOString() })), false);
    assert.equal(isLive(record({ expiresAt: new Date(Date.now() - 1000).toISOString() })), false);
    assert.equal(isLive(null), false);
  });

  it("parses a pasted email list and flags what is not an email", () => {
    const { emails, invalid } = parseEmails("A@Client.com, b@client.com;\nA@client.com not-an-email");
    assert.deepEqual(emails, ["a@client.com", "b@client.com"]);
    assert.deepEqual(invalid, ["not-an-email"]);
  });
});
