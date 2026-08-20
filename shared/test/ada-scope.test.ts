import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ADA_REQUIREMENTS, adaRequirement, matchAdaRequirements, parseAdaScope } from "../src/ada-scope.js";

describe("parseAdaScope", () => {
  it("strips the bullet markers Word, Docs, Notion and plain email produce", () => {
    const items = parseAdaScope("- One\n* Two\n• Three\n1. Four\n(2) Five\na) Six");
    assert.deepEqual(items.map((i) => i.text), ["One", "Two", "Three", "Four", "Five", "Six"]);
  });

  it("treats a trailing-colon line with items below it as a heading, not a requirement", () => {
    const items = parseAdaScope("Basic accessibility, such as:\n- Keyboard nav\n- Alt text");
    assert.deepEqual(items.map((i) => i.text), ["Keyboard nav", "Alt text"]);
    assert.deepEqual(items.map((i) => i.group), ["Basic accessibility, such as", "Basic accessibility, such as"]);
  });

  it("keeps a trailing-colon line that has nothing under it — it is the whole scope", () => {
    const items = parseAdaScope("Everything below:");
    assert.deepEqual(items.map((i) => i.text), ["Everything below:"]);
  });

  it("splits prose pasted as one semicolon-separated line", () => {
    const items = parseAdaScope("Keyboard nav; alt text; colour contrast.");
    assert.deepEqual(items.map((i) => i.text), ["Keyboard nav", "alt text", "colour contrast"]);
  });

  it("falls back to sentence boundaries for one unbroken paragraph", () => {
    // Otherwise the verifiers receive a single 300-character item nobody can check.
    const paragraph = `${"We will review the site for accessibility across every template. ".repeat(4)}Then we will fix what we find. And retest.`;
    assert.ok(paragraph.length > 240);
    const items = parseAdaScope(paragraph);
    assert.ok(items.length > 1, "expected the paragraph to be split");
    assert.equal(items[items.length - 1].text, "And retest");
  });

  it("leaves a short single line alone", () => {
    assert.deepEqual(parseAdaScope("Keyboard nav").map((i) => i.text), ["Keyboard nav"]);
  });

  it("de-duplicates case-insensitively", () => {
    assert.deepEqual(parseAdaScope("- Alt text\n- ALT TEXT\n- alt text").map((i) => i.text), ["Alt text"]);
  });

  it("assigns stable sequential ids after de-duplication", () => {
    assert.deepEqual(parseAdaScope("- A\n- A\n- B").map((i) => i.id), ["scope-1", "scope-2"]);
  });

  it("caps the item count and each item's length", () => {
    const many = Array.from({ length: 200 }, (_, i) => `- Item ${i}`).join("\n");
    assert.equal(parseAdaScope(many).length, 60);
    const long = `- ${"x".repeat(900)}`;
    assert.equal(parseAdaScope(long)[0].text.length, 500);
  });

  it("survives empty and whitespace-only input", () => {
    assert.deepEqual(parseAdaScope(""), []);
    assert.deepEqual(parseAdaScope("\n\n   \n"), []);
  });

  it("normalises Windows and old-Mac line endings", () => {
    assert.deepEqual(parseAdaScope("- A\r\n- B\r- C").map((i) => i.text), ["A", "B", "C"]);
  });
});

describe("matchAdaRequirements", () => {
  it("maps a scope line to the requirements it names", () => {
    assert.ok(matchAdaRequirements("Ensure the site can be navigated using the TAB key").includes("keyboard-tab-order"));
  });

  it("returns nothing rather than guessing when a line matches no phrase", () => {
    assert.deepEqual(matchAdaRequirements("Deliver a summary deck to the client"), []);
  });

  it("is case-insensitive", () => {
    assert.deepEqual(matchAdaRequirements("KEYBOARD NAVIGATION"), matchAdaRequirements("keyboard navigation"));
  });
});

describe("the requirement catalog", () => {
  it("has unique ids and resolves each of them", () => {
    const seen = new Set<string>();
    for (const req of ADA_REQUIREMENTS) {
      assert.equal(seen.has(req.id), false, `duplicate requirement id ${req.id}`);
      seen.add(req.id);
      assert.equal(adaRequirement(req.id), req);
    }
    assert.equal(adaRequirement("nope"), undefined);
  });

  it("keeps every keyword lowercase, since matching lowercases the haystack only", () => {
    // An uppercase character in a keyword makes that phrase permanently unmatchable.
    for (const req of ADA_REQUIREMENTS) {
      for (const k of req.keywords) {
        assert.equal(k, k.toLowerCase(), `${req.id} keyword "${k}" is not lowercase`);
      }
    }
  });

  it("gives every non-automated requirement a manual hint", () => {
    // Without one, a manual item hands over "verify this by hand" and nothing else.
    for (const req of ADA_REQUIREMENTS) {
      if (req.automated) continue;
      assert.ok(req.manualHint?.trim(), `${req.id} is manual but has no hint`);
    }
  });
});
