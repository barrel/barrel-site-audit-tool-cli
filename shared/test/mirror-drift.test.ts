// web/ deploys to Vercel as a self-contained directory, so it cannot import the shared workspace
// package. Four separate things are therefore hand-copied across that boundary, and every one of
// them has drifted at least once. These tests are the only thing standing between a copy and its
// original — nothing in the type system crosses the gap.
//
// Deliberately compares *sets of names and literals*, never bytes: the two sides legitimately
// differ in imports, comments and ordering, and a byte-equality test would be turned off within a
// week for crying wolf.
//
// Lives under shared/ because shared/ is the original every copy is a copy of, even though the
// assertions reach across into web/.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const root = new URL("../../", import.meta.url);
const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, root)), "utf-8");

/** Exported type-level names. Regex rather than the TypeScript compiler API on purpose: the whole
 * point is a check that stays cheap enough to run on every build. */
function exportedTypeNames(source: string): Set<string> {
  const names = new Set<string>();
  for (const m of source.matchAll(/^export\s+(?:type|interface|enum)\s+([A-Za-z0-9_]+)/gm)) names.add(m[1]);
  return names;
}

function exportedValueNames(source: string): Set<string> {
  const names = new Set<string>();
  for (const m of source.matchAll(/^export\s+(?:function|const|let)\s+([A-Za-z0-9_]+)/gm)) names.add(m[1]);
  return names;
}

/** Every `--flag` literal a source file can push onto an argv array. */
function flagLiterals(source: string): Set<string> {
  return new Set([...source.matchAll(/"(--[a-z0-9-]+)"/g)].map((m) => m[1]));
}

function report(label: string, missing: string[]): string {
  return missing.length === 0 ? "" : `\n  ${label}: ${missing.sort().join(", ")}`;
}

describe("web/lib/shared.ts mirrors shared/src/types.ts", () => {
  const sharedTypes = exportedTypeNames(read("shared/src/types.ts"));
  const mirror = exportedTypeNames(read("web/lib/shared.ts"));

  // Types the mirror deliberately omits, each because nothing under web/ reads that shape. Adding
  // a name here is a decision to be made once and written down — not a way to silence the test.
  // Verified against the tree: no file in web/ mentions any of them.
  const INTENTIONALLY_UNMIRRORED = new Set([
    // Audit-run bookkeeping. The dashboard follows a run over its own /api routes, never by
    // reading the run record blob the CLI writes.
    "RunMode",
    "RunRecord",
    "RunStatus",
    "RunnerInfo",
    "RunsIndex",
    // Store configuration. web/ lists stores out of the report manifest instead.
    "StoreConfig",
    "StoresIndex",
  ]);

  it("is actually reading both files", () => {
    // Without this, a rename that broke the extraction would make every check below pass by
    // comparing two empty sets — a drift guard that guards nothing is worse than none.
    assert.ok(sharedTypes.size > 50, `only found ${sharedTypes.size} exported types in shared/src/types.ts`);
    assert.ok(mirror.size > 50, `only found ${mirror.size} exported types in web/lib/shared.ts`);
  });

  it("carries every type the original exports", () => {
    const missing = [...sharedTypes].filter((n) => !mirror.has(n) && !INTENTIONALLY_UNMIRRORED.has(n));
    assert.deepEqual(
      missing,
      [],
      `web/lib/shared.ts has fallen behind shared/src/types.ts.${report("missing from web/lib/shared.ts", missing)}\n` +
        "  Copy the declaration across, or add the name to INTENTIONALLY_UNMIRRORED with the reason.",
    );
  });

  it("keeps the waiver list honest — an omission that got mirrored anyway must leave it", () => {
    const stale = [...INTENTIONALLY_UNMIRRORED].filter((n) => mirror.has(n) || !sharedTypes.has(n));
    assert.deepEqual(stale, [], `INTENTIONALLY_UNMIRRORED is out of date.${report("no longer applicable", stale)}`);
  });

  it("declares nothing the shared package does not", () => {
    // A type invented in the mirror, or renamed on one side only, is the drift that is hardest to
    // spot by eye — the web app compiles perfectly and disagrees with the CLI at runtime.
    const sharedAll = new Set(
      ["types.ts", "scoring.ts", "blob-paths.ts", "ada-scope.ts", "run-args.ts"].flatMap((f) => [
        ...exportedTypeNames(read(`shared/src/${f}`)),
      ]),
    );
    const orphans = [...mirror].filter((n) => !sharedAll.has(n));
    assert.deepEqual(
      orphans,
      [],
      `web/lib/shared.ts declares types no shared/src file does.${report("web-only", orphans)}\n` +
        "  Either the original was renamed or deleted, or the type belongs somewhere other than the mirror.",
    );
  });

  it("mirrors the value exports it claims to as well", () => {
    // The mirror carries gradeForScore/colorForScore/parseAdaScope; if one is copied and another
    // silently dropped, a report page starts colouring scores by a rule the CLI does not use.
    const sharedValues = new Set(
      ["scoring.ts", "ada-scope.ts"].flatMap((f) => [...exportedValueNames(read(`shared/src/${f}`))]),
    );
    const mirrored = exportedValueNames(read("web/lib/shared.ts"));
    const present = [...mirrored].filter((n) => sharedValues.has(n));
    assert.ok(present.length > 0, "expected the mirror to carry at least the scoring helpers");
    const orphans = [...mirrored].filter(
      (n) => !sharedValues.has(n) && !exportedValueNames(read("shared/src/types.ts")).has(n),
    );
    assert.deepEqual(orphans, [], `web/lib/shared.ts exports values with no shared original.${report("web-only", orphans)}`);
  });
});

describe("web/app/api/run/route.ts mirrors shared/src/run-args.ts", () => {
  const original = read("shared/src/run-args.ts");
  const copy = read("web/app/api/run/route.ts");

  it("passes the same set of CLI flags", () => {
    // The two build the same command for the same CLI. A flag added to one and not the other means
    // a dashboard checkbox that silently does nothing — the failure mode nobody reports as a bug.
    const a = flagLiterals(original);
    const b = flagLiterals(copy);
    const onlyShared = [...a].filter((f) => !b.has(f));
    const onlyWeb = [...b].filter((f) => !a.has(f));
    assert.deepEqual(
      [onlyShared, onlyWeb],
      [[], []],
      `The two argv builders disagree.${report("only in shared/src/run-args.ts", onlyShared)}${report("only in web/app/api/run/route.ts", onlyWeb)}`,
    );
  });

  it("accepts the same request body fields", () => {
    const fields = (source: string) => {
      const body = /interface RunAuditBody \{([\s\S]*?)\n\}/.exec(source);
      assert.ok(body, "could not find the RunAuditBody declaration");
      return new Set([...body[1].matchAll(/^\s{2}([a-zA-Z0-9_]+)\??:/gm)].map((m) => m[1]));
    };
    const a = fields(original);
    const b = fields(copy);
    const onlyShared = [...a].filter((f) => !b.has(f));
    const onlyWeb = [...b].filter((f) => !a.has(f));
    assert.deepEqual([onlyShared, onlyWeb], [[], []], `RunAuditBody has drifted.${report("only in shared", onlyShared)}${report("only in web", onlyWeb)}`);
  });

  it("keeps the same limits", () => {
    for (const constant of ["MAX_COMPETITORS", "MAX_ADA_SCOPE_CHARS"]) {
      const value = (source: string) => new RegExp(`${constant} = ([0-9_]+)`).exec(source)?.[1];
      assert.equal(value(copy), value(original), `${constant} differs between the two copies`);
    }
  });
});

describe("web/lib/data.ts mirrors shared/src/blob-paths.ts", () => {
  const original = read("shared/src/blob-paths.ts");
  const copy = read("web/lib/data.ts");

  it("reads and writes the same blob keys", () => {
    // Every one of these is a string the CLI writes and the dashboard reads. A one-character
    // difference produces an empty dashboard and no error anywhere.
    const literals = (source: string) =>
      new Set(
        [...source.matchAll(/["`](reports\/[^"`$]*|stores\/[^"`$]*|runs\/[^"`$]*|consent\/[^"`$]*)["`]/g)].map((m) => m[1]),
      );
    for (const key of ["reports/manifest.json", "consent/index.json"]) {
      assert.ok(literals(original).has(key), `${key} vanished from shared/src/blob-paths.ts`);
      assert.ok(literals(copy).has(key), `${key} is no longer the key web/lib/data.ts reads`);
    }
  });

  it("builds the same templated paths", () => {
    const template = (source: string, name: string) =>
      new RegExp(`${name}\\([^)]*\\)[^{]*\\{\\s*return \`([^\`]+)\``).exec(source)?.[1];
    for (const fn of ["consentFleetBlobPath", "consentSiteBlobPath"]) {
      const a = template(original, fn);
      const b = template(copy, fn);
      assert.ok(a, `${fn} not found in shared/src/blob-paths.ts`);
      assert.equal(b, a, `${fn} builds a different path in web/lib/data.ts`);
    }
  });
});
