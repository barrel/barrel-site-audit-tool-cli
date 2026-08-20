import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildRunArgs, buildRunEnv, validateLocalRepo, validateTarget } from "../src/run-args.js";

describe("validateTarget", () => {
  it("accepts a bare store slug", () => {
    assert.equal(validateTarget("acme-store", "URL/slug"), "acme-store");
    assert.equal(validateTarget("  acme-store  ", "URL/slug"), "acme-store");
    assert.equal(validateTarget("Store123", "URL/slug"), "Store123");
  });

  it("accepts http and https URLs", () => {
    assert.equal(validateTarget("https://shop.example.com/", "URL/slug"), "https://shop.example.com/");
    assert.equal(validateTarget("http://localhost:3000", "URL/slug"), "http://localhost:3000");
  });

  it("rejects a non-http scheme, which is the whole reason this runs before argv is built", () => {
    assert.throws(() => validateTarget("file:///etc/passwd", "URL/slug"), /must be an http\(s\) URL/);
    assert.throws(() => validateTarget("javascript://x", "URL/slug"), /must be an http\(s\) URL/);
  });

  it("rejects a slug that could be read as a flag", () => {
    assert.throws(() => validateTarget("--skip-code", "URL/slug"), /store slug/);
    assert.throws(() => validateTarget("-x", "URL/slug"), /store slug/);
    assert.throws(() => validateTarget("acme store", "URL/slug"), /store slug/);
    assert.throws(() => validateTarget("acme/../..", "URL/slug"), /store slug/);
  });

  it("rejects an empty value with the label the caller gave it", () => {
    assert.throws(() => validateTarget("   ", "Competitor URL"), /Competitor URL is required/);
  });

  it("propagates the URL parser's own error on malformed input", () => {
    assert.throws(() => validateTarget("https://", "URL/slug"));
  });
});

describe("validateLocalRepo", () => {
  it("requires an absolute path", () => {
    // A relative path would resolve against the spawned process's cwd — the data root — rather
    // than the directory the person filling in the dashboard has in mind.
    assert.equal(validateLocalRepo("/Users/you/code/theme"), "/Users/you/code/theme");
    assert.throws(() => validateLocalRepo("code/theme"), /must be absolute/);
    assert.throws(() => validateLocalRepo("../theme"), /must be absolute/);
    assert.throws(() => validateLocalRepo("-rf"), /must be absolute/);
  });
});

describe("buildRunArgs", () => {
  it("emits the subcommand and target first", () => {
    assert.deepEqual(buildRunArgs({ target: "acme" }), ["run", "acme", "--skip-github"]);
  });

  it("always passes --skip-github, because nothing can answer a confirm prompt here", () => {
    assert.ok(buildRunArgs({ target: "acme" }).includes("--skip-github"));
  });

  it("maps each skip flag exactly once and only when set", () => {
    const args = buildRunArgs({ target: "acme", skipCode: true, skipAxe: true, sitespeed: true });
    assert.deepEqual(args, ["run", "acme", "--skip-code", "--skip-axe", "--sitespeed", "--skip-github"]);
    assert.equal(buildRunArgs({ target: "acme", skipCode: false }).includes("--skip-code"), false);
  });

  it("validates every competitor rather than only the first", () => {
    const args = buildRunArgs({ target: "acme", competitorUrls: ["https://a.example", " https://b.example "] });
    assert.deepEqual(args.slice(-4), ["--competitor", "https://a.example", "--competitor", "https://b.example"]);
    assert.throws(
      () => buildRunArgs({ target: "acme", competitorUrls: ["https://a.example", "ftp://b.example"] }),
      /Competitor URL must be an http\(s\) URL/,
    );
  });

  it("drops blank competitor entries rather than passing an empty argv slot", () => {
    const args = buildRunArgs({ target: "acme", competitorUrls: ["", "   ", "https://a.example"] });
    assert.equal(args.filter((a) => a === "--competitor").length, 1);
  });

  it("caps the competitor list", () => {
    const six = Array.from({ length: 6 }, (_, i) => `https://c${i}.example`);
    assert.throws(() => buildRunArgs({ target: "acme", competitorUrls: six }), /At most 5 competitor URLs/);
  });

  it("passes a local repo as a two-element pair so it cannot be read as a flag", () => {
    const args = buildRunArgs({ target: "acme", localRepo: "/Users/you/theme" });
    const i = args.indexOf("--local-repo");
    assert.notEqual(i, -1);
    assert.equal(args[i + 1], "/Users/you/theme");
  });

  it("ignores a whitespace-only local repo instead of failing the whole run", () => {
    assert.equal(buildRunArgs({ target: "acme", localRepo: "   " }).includes("--local-repo"), false);
  });
});

describe("buildRunEnv", () => {
  it("keeps the ADA scope out of argv", () => {
    // A scope pasted with "- " bullets starts with a dash, which commander reads as the next flag.
    const env = buildRunEnv({ target: "acme", adaScope: "- WCAG 2.1 AA\n- Keyboard nav" });
    assert.deepEqual(env, { BARREL_ADA_SCOPE: "- WCAG 2.1 AA\n- Keyboard nav" });
    assert.equal(buildRunArgs({ target: "acme", adaScope: "- WCAG" }).includes("- WCAG"), false);
  });

  it("returns an empty environment when there is no scope", () => {
    assert.deepEqual(buildRunEnv({ target: "acme" }), {});
    assert.deepEqual(buildRunEnv({ target: "acme", adaScope: "   " }), {});
  });

  it("refuses a scope large enough to blow the environment limit", () => {
    assert.throws(() => buildRunEnv({ target: "acme", adaScope: "x".repeat(20_001) }), /too long/);
  });
});
