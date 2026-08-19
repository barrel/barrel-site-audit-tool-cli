---
description: Run the behavioural consent QA scan and explain the failures in plain English
---

Run the consent scanner and turn its output into something an account lead can act on.

## Steps

1. Work out the scope from the user's request:
   - No target named → `pnpm barrel-audit consent-scan --json /tmp/consent-scan.json`
   - One client named → resolve it to a slug in `sites.yml`, then pass the slug as the argument
   - A URL given → pass the URL directly
   - They only want to know what's installed → add `--inventory` (much faster, no behavioural tests)

2. Run it. A full scan takes roughly 90 seconds per site with a concurrency of 4, so a
   six-site fleet is about three minutes. Don't add `--no-retry` unless asked: the retry
   pass is what stops an intermittent result being reported as fact.

3. Read the JSON, not just the terminal output — `rows[].failedTests[]` carries the detail
   and evidence that the terminal summary omits.

4. Report back in this shape:

   - **Lead with the blockers.** These mean consent is not working: a marketing tag fired
     before a choice was made, or kept firing after a rejection. Name the site, the tag, and
     quote the actual request URL from the evidence.
   - **Then the errors**, grouped by what a developer would do about them — several sites
     failing `C4` is one fix (wire the CMP to Shopify's Customer Privacy API), not N.
   - **Separate `blocked` from `fail` explicitly.** Blocked means the site could not be
     tested — down, bot-walled, or the banner never appeared. Never describe it as a
     compliance problem; describe it as coverage to re-run.
   - **Flag anything `flaky`** as unconfirmed, and say so plainly.

5. Never state or imply that a site is legally compliant or non-compliant. The scan reports
   technical behaviour. "Meta Pixel fired before consent" is a fact; what it means under a
   given statute is counsel's call. Say what was observed and let that stand.

## Reference

Test IDs, what each suite covers, and how to add a site are in `docs/consent-qa.md`.
