# Running audits online — Plan

**Status:** Phase 1 (the GitHub connector) built, verified live, committed on branch
`privacy-compliance-pass-list`. Phase 2 (Sandbox runs) — decisions taken, measurement harness
built, **not yet run**.
**Author:** nick.meyer@barrelny.com · **Date:** 2026-09-10

**Pick this up by:** running the probe (§3), reading its output, then starting §5 step 1.

---

## 1. Where things stand

| | State | Where |
|---|---|---|
| GitHub connector, read-only, two modes | Built, verified against the real `barrel` org | `cli/src/github*.ts`, `web/app/repos/`, release notes 1.39 |
| `run --output` (publish nothing) | Built, verified | `cli/src/index.ts`, `report/generate.ts` |
| Sandbox measurement harness | Built, **never executed** | `tools/sandbox-probe/` |
| Cloud-run scaffolding (`RunRecord`, `runner`, `BARREL_RUNNER`) | Already existed before this work; nothing in `web/` reads it | `shared/src/types.ts`, `cli/src/report/run-record.ts` |
| Sandbox launcher, queue, run UI | **Not started** | — |

`pnpm check` green: 398 tests, format, lint, three typechecks, both static write-guards.

### Not done, and deliberate

- **It is committed on `privacy-compliance-pass-list`**, which is not where this belongs. Decide
  where it should live before merging.
- **`GITHUB_OAUTH_CLIENT_ID` is not set on the Vercel project.** The `/repos` picker cannot
  connect to GitHub on the deployed site until it is. It is a public client ID, not a secret —
  the same value the CLI already uses.
- **Nothing published to GitHub Packages.** `cli` 1.16.0 / `shared` 1.7.0 are bumped locally
  only, so a teammate's global `barrel-audit` does not have `--mode read`, `repos`, or
  `--output` yet. See the `ship-cli-features` skill.

---

## 2. The question Phase 2 turns on

**Does this audit produce the same answers from a cloud VM as it does from a laptop?**

Not answerable by reasoning. It depends on how fast a shared vCPU is and on how a client's bot
protection treats a datacenter IP. The three risks, in the order they matter:

| Risk | Why it matters | Verdict |
|---|---|---|
| **Bot protection on a datacenter IP** | Cloudflare/Akamai/Shopify score AWS ranges far harder than an office IP. A challenge page returning **HTTP 200** becomes a *wrong finding*, not an error — the exact shape that already forced `SOFT_404_MARKERS` into `ux.ts`. Moving to cloud undoes the throttling in `ux.ts` that exists specifically to avoid tripping client protection. | **The one that could kill the plan.** Must be measured. |
| **Lighthouse scores move** | `performance.ts:96` uses default throttling with no `cpuSlowdownMultiplier` override, so the CPU multiplier rides on the host's real speed. Same reason PageSpeed Insights and local Lighthouse disagree. | Expected. Cloud is *more consistent* than "whichever laptop with Slack open", but **not comparable to laptop-set baselines** — and Baseline & Reporting is shipped. Size of the gap decides what happens to existing baselines. |
| **Consent region is the scanner's IP** | `cli/src/analyzers/consent/testcases.ts:790` states it outright: `region` is "where the *scanner* ran, not who the storefront serves." | **An improvement.** A pinned region makes geography an explicit input rather than an accident of who clicked Run, and unlocks EU scans without a person in the EU. |

Unaffected either way: anything read from an HTTP response, HTML, or a TLS handshake — health,
security, SEO/GEO, agent readiness, structured data. Same bytes, same verdicts.

---

## 3. Next action: run the probe

`tools/sandbox-probe/` exists to answer §2 with numbers. Full detail in its own README; the
short version:

```bash
# 1. The laptop half — the reference.
node tools/sandbox-probe/probe.mjs --local <urls...>

# 2. The sandbox half.
cd web && vercel env pull && cd ..     # for VERCEL_OIDC_TOKEN (expires every 12h)
node tools/sandbox-probe/probe.mjs <urls...>

# 3. The answer, ordered by what would make you abandon the plan first.
node tools/sandbox-probe/compare.mjs ./probe-out
```

Both halves publish nothing (`run --output`), so no probe run touches a client's report history.
Output lands in `probe-out/` (gitignored). Cost ≈ **$0.05–0.15 per storefront**.

**Open question — which storefronts?** Three to five with different protection postures is the
informative set. Aiming it at a live client from a datacenter IP is the thing under test, so a
Barrel-owned site is the sensible smoke test first.

### How to read the result

| Outcome | Means |
|---|---|
| No coverage gaps, no verdict flips, Lighthouse moved | **Green light.** Proceed to §5. Decide separately what happens to existing baselines. |
| Browser sections missing from the sandbox only | Bot protection. Read the `.log`. Either fall back to HTTP-only online runs, or investigate egress options before building anything. |
| A verdict flipped in an HTTP-only section | Unexpected — understand it before trusting either runner. Usually geography or a client-side redirect. |

---

## 4. Decisions taken (2026-09-10)

| Decision | Choice | Why |
|---|---|---|
| Sequence | **Measure before building** | Accuracy is the stated concern and half a day of measurement decides the architecture. |
| Queue + lock backing | **Upstash Redis via Vercel Marketplace** | **`@vercel/blob` has no conditional/compare-and-swap write.** A lock on `runs/index.json` races: two clicks in the same second both read "nothing active" and both start a sandbox. `SET key NX EX` is genuinely atomic. Also fixes the pre-existing read-modify-write race on that index. |
| Runner-up | Vercel Queues | Purpose-built and native, but public beta. |
| Concurrency | **Per-domain lock + global cap of 2–3** | Serializing everything is a *laptop* constraint (one Chrome, one CPU). Each sandbox run gets its own microVM, so the real reasons to serialize are not hammering one client's storefront and bounding spend — both served by a per-domain lock. A global limit of 1 makes a second person wait ~12 minutes for an unrelated audit. |
| What runs in the sandbox | **The published CLI, unchanged** | `npm i -g @barrel/site-audit-cli` and the same `barrel-audit run`. One code path; an online runner that reimplements the audit would drift from the CLI. |

---

## 5. Build plan

Ordered so each step is verifiable on its own. Most of the state model already exists — **use it,
don't rebuild it.**

**Already there:** `RunRecord` (`status: "queued"`, `mode: "cloud"`, `sandboxName`, `cmdId`),
`runRecordBlobPath()`, `RUNS_INDEX_BLOB_PATH`, `run-record.ts` publishing live stage lines when
`BARREL_RUN_ID` is set, `runnerInfo()` reading `BARREL_RUNNER`/`_VCPUS`/`_REGION`, and `runner`
stamped on both `Report` and `ManifestEntry`. Nothing in `web/` consumes any of it yet.

1. **Custom Sandbox image.** Chrome + the CLI baked in, pushed to Vercel Container Registry.
   Without it every run pays ~60s of `apt-get`. Build it from what `probe.mjs` provisions —
   that script is the working recipe.
2. **Upstash + the lock.** Marketplace integration, then `acquireRunSlot(domain)` /
   `releaseRunSlot()`: per-domain `SET NX EX` plus a global counter. TTL must exceed the longest
   audit, or a crashed run holds the lock forever.
3. **Launcher route.** `POST /api/cloud-run` → acquire slot → `Sandbox.create()` → run the CLI
   with `BARREL_RUN_ID`, `BARREL_RUNNER=cloud`, `BARREL_RUNNER_VCPUS` → record `sandboxName`
   and `cmdId` on the `RunRecord` → release the slot in a `finally`. The function must not wait
   for the audit; the run reports itself through Blob.
4. **The new component.** Reads run records from Blob and polls — *not* a held-open stream; that
   is the whole reason `run-record.ts` exists. Shows the queue, the live stage, and links the
   finished report. Reuse `RunAuditForm`'s option set rather than inventing a second one.
5. **Stop.** `sandboxName`/`cmdId` are on the record for exactly this. Must release the lock.
6. **Baselines.** Decide with the probe numbers in hand: re-baseline every store on cloud runs,
   or keep laptop and cloud baselines separate. The progress views already flag a cross-runner
   comparison — this decides whether that flag is enough.

### Worth doing while in there

- **Record Lighthouse's `environment.benchmarkIndex` on `RunnerInfo`.** It is the number
  Lighthouse itself uses to judge host capability, and it turns "these two reports are
  incomparable" into "these two hosts differed by X". Currently not captured at all.
- **Theme code for a cloud run needs `githubMode: "read"`.** A cloud runner has no
  `stores/<slug>/theme/`. Phase 1 is what makes this possible; `themeSubdir`'s doc comment
  already anticipated it. A store connected in `"pull"` mode gets **no** theme sections from a
  cloud run — the UI should say so rather than producing a report with silent gaps.
- **Secrets in the sandbox.** The CLI needs `BLOB_READ_WRITE_TOKEN` (which can write *every*
  client report), plus `ANTHROPIC_API_KEY` and optionally `GOOGLE_SERVICE_ACCOUNT_KEY`. Worth a
  scoped token if one is possible.

---

## 6. Verified platform facts

Checked 2026-09-10 against the live docs, not from memory.

| Fact | Value |
|---|---|
| Default image | `vercel/sandbox/universal:latest`, **Ubuntu 26.04 → `apt-get`** |
| ⚠️ Stale guidance | The bundled `vercel:vercel-sandbox` skill still says Amazon Linux / `dnf`. Ignore it. |
| Pro limits | 8 vCPU max, 2 GB per vCPU (16 GB), 64 GB disk, **24h** max session |
| Concurrency | 10,000 on Pro — **single-flight is entirely self-imposed, not a platform limit** |
| Region | `Sandbox.create()` in SDK 3.0.0 takes **no** `region`; it uses the project default (`iad1`). 19 regions available. |
| Cost | $0.128/vCPU-hour Active CPU (real CPU time, not wall clock) + $0.0212/GB-hour → **~$0.05–0.15 per audit** |
| Chrome | Install real Google Chrome from the `.deb`. Ubuntu's `chromium` is a **snap** and will not run in a container. |
| Chrome as root | Needs `--no-sandbox`. Safe here in a way it never is on a workstation: the microVM *is* the sandbox. |

---

## 7. Phase 1 reference — what the connector actually does

Full docs in the README and `/instructions`. The parts that matter to Phase 2:

- **`githubMode`** on `StoreConfig`: `"read"` (nothing on disk — each run downloads the ref's
  tarball to a temp dir, reads it, deletes it) or `"pull"` (clone once into
  `stores/<slug>/theme/`). **Absent means legacy, and behaves as `"pull"`** — never treat absent
  as `"read"`.
- **`acquireThemeSource(store)`** in `cli/src/theme-source.ts` is the async sibling of
  `resolveThemeDir()`. Callers must `release()` in a `finally`; signals skip that, which is why
  `github-checkout.ts` tracks live checkouts for `shutdown.ts` to delete.
- **Read-only is enforced.** `cli/scripts/verify-github-readonly.mjs` greps five connector
  modules for write-capable calls and fails `pnpm build` and `pnpm check`. `git-pr.ts` is
  excluded on purpose — it is the one sanctioned write path and has its own guard. **Do not add
  a write to a connector module because it is convenient.**
- **The dashboard has its own GitHub login** (`web/lib/github-session.ts`): the same device
  flow, with the token sealed into an encrypted JWE cookie. Per-browser by design — the
  alternative was this app holding a write-capable GitHub credential for every teammate in
  shared Blob.

### Verified live, not just compiled

| Check | Result |
|---|---|
| Server-side search on the real org | `repos theme --org barrel` → 8 private Liquid repos, incl. ones last touched months ago |
| Theme-root detection | `carepod-theme` → root; `embark-metaobject-pagination-theme` → correctly "no theme found" |
| Ephemeral checkout | 1.25s to download + unpack; Theme Check found 4,212 errors / 134 warnings; temp dir deleted on release |
| Web routes | session, search, branches, link happy path, unknown-repo 400, unsynced-store 404 — all against real GitHub |
| Write guard | A planted `octokit.pulls.create(` is caught, exit 1 |

The `link` route was tested against `wamsutta-com` and its original config restored afterwards.
