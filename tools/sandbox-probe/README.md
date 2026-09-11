# Sandbox probe

Answers one question, with numbers instead of reasoning: **does this audit produce the same
answers from a cloud VM as it does from a laptop?**

That question is the gate on moving audits into the web interface. It is not answerable in the
abstract, because it turns on two things nobody can predict — how fast a shared vCPU is, and how a
client's bot protection treats a datacenter IP.

## Why it matters, in the order it matters

1. **Coverage.** Does the sandbox produce every section a laptop does? A section that one runner
   produces and the other doesn't is the worst outcome and the easiest to miss: an absent section
   renders as a missing heading, which reads as *"nothing to flag"* rather than *"never looked"*.
   If the browser-driven sections (consent, pixels, UX) come back thin from the sandbox only, the
   cause is almost certainly bot protection challenging a datacenter IP — and a challenge page
   that returns HTTP 200 produces a *wrong finding*, not an error. This codebase already carries
   `SOFT_404_MARKERS` because of exactly that shape of failure.
2. **Verdicts.** Do any pass/fail checks disagree? A flipped verdict is a wrong statement about a
   client's site, which costs more than a wrong number.
3. **Scores.** Lighthouse numbers are *expected* to move: the CPU throttling multiplier is applied
   on top of the host's real speed, so a shared vCPU and an M-series laptop do not agree. This is
   the same reason PageSpeed Insights and local Lighthouse disagree. What matters is the size of
   the gap, because it decides whether the baselines already recorded in Baseline & Reporting
   survive a switch to cloud runs. Anything read from an HTTP response or a TLS handshake — health,
   security, SEO/GEO, agent readiness — should be identical, and the comparison flags it loudly
   when it isn't.

## Running it

Both halves publish nothing. Every run goes through `barrel-audit run --output`, which writes the
report to a local file and skips the report blob, the manifest and the store's history — because
the thing being measured *is* a client's baseline, and appending probe runs to it would corrupt the
history the comparison exists to protect.

```bash
# 1. The laptop half — the reference. Uses this working tree's build.
node tools/sandbox-probe/probe.mjs --local https://store-a.com https://store-b.com

# 2. The sandbox half. Provisions one microVM with real Google Chrome + this working tree's CLI.
cd web && vercel env pull && cd ..          # for VERCEL_OIDC_TOKEN, if you have no VERCEL_TOKEN
node tools/sandbox-probe/probe.mjs https://store-a.com https://store-b.com

# 3. The answer.
node tools/sandbox-probe/compare.mjs ./probe-out
node tools/sandbox-probe/compare.mjs ./probe-out --json   # every metric, not the top 20
```

Everything lands in `probe-out/` (gitignored — it is client audit data, and regenerable):
`local-<slug>.json`, `sandbox-<slug>.json`, `sandbox-<slug>.log` (the run's raw output — read this
first when a section is missing) and `sandbox-summary.json`.

### Flags

| Flag           | Default      | Notes |
| -------------- | ------------ | ----- |
| `--local`      | off          | Run the laptop half instead of creating a sandbox. |
| `--vcpus <n>`  | `4`          | 2 GB of memory per vCPU. Pro caps at 8. Worth running twice at different sizes — the gap between them tells you how CPU-sensitive the score is. |
| `--out <dir>`  | `probe-out/` | |
| `--keep-alive` | off          | Leave the sandbox running to poke at it. Remember to stop it. |

## What it costs

About **$0.05–0.15 per audited storefront**. Sandbox bills Active CPU (real CPU time, not wall
clock) at $0.128/vCPU-hour plus $0.0212/GB-hour of provisioned memory, and an audit spends much of
its life waiting on the network. Provisioning Chrome adds roughly a minute to the first run.

## Notes on the setup, and why each choice is deliberate

- **Real Google Chrome, installed from the `.deb`** — not Ubuntu's `chromium`, which is a snap and
  will not run in a container. Also the right call for the comparison: the auditors' laptops run
  Chrome, so using Chromium here would measure the browser difference on top of the machine
  difference, which is the confound the probe exists to remove. `apt-get install ./chrome.deb`
  pulls the dependency tree itself, so there is no hand-maintained list of shared libraries to go
  stale with each Chrome release.
- **`CHROME_PATH` and `--no-sandbox` are set in the sandbox environment.** `chrome-launcher` reads
  the first, so every analyzer finds the same browser. The second is needed because the audit runs
  as root, and it is safe here in a way it never is on a workstation: the microVM *is* the sandbox.
- **This working tree, not the published CLI.** The probe packs `shared` and `cli` with
  `pnpm pack` (which rewrites the `workspace:*` dependency to a real version) and installs both
  tarballs in the sandbox. So it measures the code about to ship, and it needs no GitHub Packages
  credential inside the VM.
- **The AI sections are skipped.** They are one Claude call over text the run already produced, so
  they cannot vary by runner — including them would spend money to compare two identical answers.
  Theme code is skipped too: a bare URL has no repo connected.
- **Region is the project default (`iad1`)** in SDK 3.0.0. Worth knowing for the consent suite,
  where `cli/src/analyzers/consent/testcases.ts` states outright that `region` is *"where the
  scanner ran, not who the storefront serves"* — a pinned region makes that an explicit input
  rather than an accident of who clicked Run.
