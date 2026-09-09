// `barrel-audit setup` edits a file that already holds someone's working credentials, so the merge
// is the part worth locking down: a setup run that answers one question must not drop the keys it
// didn't ask about, the comments a human wrote, or a key this command doesn't manage at all.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { readEnvFile, writeEnvFile } from "../src/commands/setup.js";

function tempEnv(contents?: string): string {
  const path = join(mkdtempSync(join(tmpdir(), "barrel-audit-setup-")), ".env");
  if (contents !== undefined) writeFileSync(path, contents);
  return path;
}

describe("setup: reading an existing .env", () => {
  it("reads plain, quoted, spaced and commented lines", () => {
    const values = readEnvFile(
      tempEnv(
        [
          "# a comment",
          "BLOB_READ_WRITE_TOKEN=vercel_blob_rw_abc",
          'ANTHROPIC_API_KEY="sk-ant-quoted"',
          "  GITHUB_OAUTH_CLIENT_ID = Ov23spaced  ",
          "",
          "not a key line at all",
        ].join("\n"),
      ),
    );
    assert.equal(values.get("BLOB_READ_WRITE_TOKEN"), "vercel_blob_rw_abc");
    assert.equal(values.get("ANTHROPIC_API_KEY"), "sk-ant-quoted");
    assert.equal(values.get("GITHUB_OAUTH_CLIENT_ID"), "Ov23spaced");
    assert.equal(values.size, 3);
  });

  it("treats a missing file as empty rather than throwing", () => {
    assert.equal(readEnvFile(join(tmpdir(), "barrel-audit-nope", ".env")).size, 0);
  });
});

describe("setup: writing the .env", () => {
  it("rewrites a key in place and keeps everything else byte for byte", () => {
    const path = tempEnv(
      ["# hand-written note", "BLOB_READ_WRITE_TOKEN=old", "SOME_OTHER_THING=keep-me", ""].join("\n"),
    );
    writeEnvFile(path, new Map([["BLOB_READ_WRITE_TOKEN", "new"]]));
    assert.equal(readFileSync(path, "utf8"), ["# hand-written note", "BLOB_READ_WRITE_TOKEN=new", "SOME_OTHER_THING=keep-me", ""].join("\n"));
  });

  it("appends keys the file doesn't have yet without disturbing the ones it does", () => {
    const path = tempEnv(["BLOB_READ_WRITE_TOKEN=tok", ""].join("\n"));
    writeEnvFile(path, new Map([["ANTHROPIC_API_KEY", "sk-ant-new"]]));
    const values = readEnvFile(path);
    assert.equal(values.get("BLOB_READ_WRITE_TOKEN"), "tok");
    assert.equal(values.get("ANTHROPIC_API_KEY"), "sk-ant-new");
  });

  it("creates the file with a header when there was none", () => {
    const path = tempEnv();
    writeEnvFile(path, new Map([["BLOB_READ_WRITE_TOKEN", "tok"]]));
    const written = readFileSync(path, "utf8");
    assert.match(written, /^# Written by `barrel-audit setup`/);
    assert.equal(readEnvFile(path).get("BLOB_READ_WRITE_TOKEN"), "tok");
  });

  it("leaves the file readable only by its owner", () => {
    const path = tempEnv();
    writeEnvFile(path, new Map([["BLOB_READ_WRITE_TOKEN", "tok"]]));
    assert.equal(statSync(path).mode & 0o777, 0o600);
  });
});
