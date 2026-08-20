# Testing and the build gate

Two commands matter:

```bash
pnpm test      # the suite on its own (~0.5s)
pnpm check     # the whole gate: safety guard, format, lint, typecheck, tests (~8s)
```

`pnpm build` runs `pnpm check` first and refuses to build if it fails.

---

## What "self-healing" means here, and what it does not

This is the part worth reading carefully. A harness that hides failures is worse than no harness:
it converts a known problem into an unknown one, and it does it silently. So the boundary is drawn
explicitly.

### It does

- **Re-run a failing test on its own, up to three attempts, with backoff** (250ms, then 1s). The
  retry uses `--test-name-pattern` so only the failing test runs again, not its whole file.
- **Report anything that only passed on a retry as `flaky`, never as `passed`.** Flaky results are
  printed in yellow, counted separately, and written to `test-results/`. They are *not* counted
  toward the pass total.
- **Auto-fix formatting and lint** when run with healing on (the default outside CI — see below),
  then re-run that step. If the fix worked, the step is marked `fixed` rather than `ok`, and the
  run ends with a reminder that files were rewritten.

### It does not

- **It does not retry a test that fails consistently.** Three identical failures are reported as a
  failure and exit non-zero. There is no "eventually green" mode.
- **It does not modify, soften, skip, or regenerate any assertion.** No snapshot updating, no
  `.skip` insertion, no expected-value rewriting. The healer only ever touches whitespace and the
  things `eslint --fix` will change.
- **It does not touch source files in CI.** `--no-heal` is implied whenever `$CI` is set, because a
  green pipeline that only went green because the pipeline edited the code is not a signal anybody
  can act on. `pnpm check:ci` makes that explicit.
- **It does not treat flaky as fine.** Every test in this suite is a pure function over fabricated
  input — no network, no clock, no filesystem, no browser. A result that changes between two
  identical runs therefore means **shared state between tests**, which is a real defect. The retry
  exists to *detect* that, not to paper over it. If you see a flaky line, fix the test.

### Why retry at all, then?

Because the alternative — a single observation — cannot tell a genuine failure from a process that
lost a race with the OS. Retrying answers that question and writes the answer down. What it must
never do is answer it *for* you.

---

## The runner

Node's built-in `node:test`, run through `tsx`.

Both were already in the tree — `tsx` is a `cli/` devDependency and `node:test` ships with the
Node 22 this repo already requires — so the suite costs zero new runtime dependencies. Vitest
would add roughly forty packages and a bundler's worth of configuration to run assertions against
pure functions that need neither; its real advantages (browser mode, module mocking, a watch UI)
are things nothing here wants. Revisit that if this repo ever needs to test React components —
that is the point where vitest earns its weight.

Test files live **outside** each package's `src/`, in `cli/test/` and `shared/test/`. That is not
cosmetic: both packages set `rootDir: "src"` and `include: ["src"]`, so a test file inside `src/`
would be compiled into `dist/` and published to consumers. `tsconfig.test.json` at the repo root
typechecks the suites with the same compiler settings, so a test cannot pass a typecheck the code
it exercises would fail.

---

## What is covered

Everything here is hermetic and finishes in well under a second. **Nothing in the suite opens a
socket or launches a browser** — in particular, nothing runs `barrel-audit consent-scan`, which
takes minutes per site and hits third-party services.

| Area | File | What it pins |
| --- | --- | --- |
| Tracker classification | `cli/test/consent-trackers.test.ts` | script-vs-transmission (the file extension outranks a `pixel`/`collect` path segment), Consent Mode denial reading (`gcs=G100` is a denial; `G1--` and no-`gcs` are not), per-vendor matching, cookie categorisation, evidence rendering |
| Verdict logic | `cli/test/consent-testcases.test.ts` | a state that was never reached yields `blocked`, never `fail`; the opt-out model turns those into `skipped`; per-test detail, evidence and recommendation content |
| Scoring | `cli/test/consent-score.test.ts` | `scoreOf` returns null below the confirmed-result threshold, excludes flaky/blocked from both sides of the ratio, and forces any confirmed blocker failure under 50; screenshot attachment covers every suite |
| Argv construction | `shared/test/run-args.test.ts` | the dashboard→CLI argv builder, including the validation that keeps a flag-shaped value out of `argv` |
| Scope parsing | `shared/test/ada-scope.test.ts` | bullet/heading/sentence parsing of a pasted ADA scope, and catalogue invariants |
| Scoring + blob keys | `shared/test/scoring-and-paths.test.ts` | grade/colour agreement at every cutoff, and that no two blob namespaces collide |
| Mirror drift | `shared/test/mirror-drift.test.ts` | see below |

### The drift guards

`web/` deploys to Vercel as a self-contained directory and cannot import the shared workspace
package, so four things are hand-copied across that boundary. Every one has drifted at least once,
and nothing in the type system crosses the gap:

1. `shared/src/types.ts` → `web/lib/shared.ts`
2. `shared/src/run-args.ts` → `web/app/api/run/route.ts` (the CLI flags and the request body)
3. `shared/src/blob-paths.ts` → `web/lib/data.ts` (the blob keys both sides read and write)

The guards compare **sets of exported names and string literals, never bytes**. The two sides
legitimately differ in imports, comments and ordering; a byte-equality test would be switched off
within a week for crying wolf. When a guard fails it names which side is missing what.

Types the mirror deliberately omits are listed in `INTENTIONALLY_UNMIRRORED` in that file, each
with its reason. A second test keeps that list honest: a name that gets mirrored anyway, or that
disappears from the original, has to leave the list.

---

## The lint baseline

ESLint was introduced to a repo that had never run it and found sixteen pre-existing problems.
Rather than switch off the rules that found them (which is how a lint config becomes decorative),
they are recorded in `tools/lint-baseline.json` and the gate fails only on **new** problems.

The baseline is keyed by file + rule with a **count**, not by line number: an unrelated edit above
a known problem must not resurrect it, and a second violation of the same rule in the same file
must not slip in behind the first. Counts may only go down — fix one and run `pnpm lint:baseline`
to lock the improvement in. The gate tells you when there is an improvement to lock in.

The baseline is a debt ledger, not a rule exemption. Nothing in it is considered acceptable, only
pre-existing.

## The formatter

`tools/harness/format.mjs`, deliberately **not** Prettier. Prettier would reformat every file in
the repo on its first run — thousands of lines of churn that buries real changes in review, to
settle arguments nobody here is having. What is checked instead is the subset that is a defect
rather than a taste, and that a mechanical edit can fix with no judgement: byte-order marks,
carriage returns, tab indentation, trailing whitespace, and the final newline. Markdown is
excluded, because two trailing spaces are a line break there. Generated files under `stores/` and
`test-results/` are excluded, because the tool rewrites them anyway.

---

## Results in the repo

Every run writes `test-results/latest.json` (machine-readable) and `test-results/summary.md`
(human-readable), both timestamped, both tracked in git.

They stay small on purpose: counts, durations, and the name and error of anything that failed or
went flaky. Individual passing tests are counted but not listed — a 400-line file regenerated on
every run is a merge conflict, not a record. The tradeoff of tracking them is that a run dirties
the working tree; the payoff is that the last known state travels with the branch.

---

## Commands

| Command | What it does |
| --- | --- |
| `pnpm test` | the whole suite, with retry and flake detection; writes `test-results/` |
| `pnpm -r test` | the same tests, per package, raw TAP, no retry |
| `pnpm check` | git-pr safety guard → format → lint → typecheck (cli, web, tests) → tests |
| `pnpm check:quick` | the same without the test step, for a fast typecheck loop |
| `pnpm check:ci` | `check` with healing disabled — never rewrites files |
| `pnpm build` | `check`, then the real cli and web builds |
| `pnpm build:packages` | the builds alone, skipping the gate |
| `pnpm lint` / `lint:fix` / `lint:baseline` | ESLint against the baseline |
| `pnpm format` / `format:fix` | the whitespace checker |
| `pnpm typecheck` | every package's `tsc`, nothing else |

The gate runs in about eight seconds on a laptop, which is why it is wired into `pnpm build`
rather than split into a separate slow suite. If it ever stops being fast, split the tests out of
`check` before anyone starts reaching for `build:packages`.
