# CRO audits

A CRO audit is a **separate report type** from the site audit, with its own command, its own pages,
its own Blob namespace and its own share links. Nothing in it appears in a site-audit report and
nothing from a site audit appears in it.

The reason for the split is that the two answer different questions for different readers. A site
audit says what is technically wrong with a storefront and scores it. A CRO audit is a strategist's
argument about where conversion is being lost, and its deliverable is a deck: one slide per page
type, three to five opportunities each, framed as opportunities rather than faults.

## Running one

Two passes, split by what each physically needs.

**Pass 1 — the capture.** Needs a real browser, so it runs on your machine:

```
pnpm barrel-audit cro <url-or-slug>
```

It picks a page for each page group, walks them at a phone width and a laptop width, screenshots
each one, records what it measured, and writes the UX and competitive-benchmark slides. The report
URL it prints is where the second pass happens.

You can also start it from **CRO Audits → New CRO audit** in the dashboard. That works from the
deployed site as well as a local one, as long as `barrel-audit serve` is running on your machine —
the browser talks to that agent directly, exactly as the site audit's Run button does.

**Pass 2 — Generate.** Runs on the deployed site with no browser and no terminal. It reads the
store's GA4 property for the conversion picture, then writes the four key insights across every
step that has findings. A store with GA4 linked can get this half with no local setup at all.

### Options

| Flag | Effect |
|---|---|
| `--groups <list>` | Which page groups to capture. Default `nav,home,plp,pdp,cart`. |
| `--devices <list>` | Default `mobile,desktop`. |
| `--checkout` | Also capture the first checkout step. **Off by default** — see below. |
| `--competitor <url>` | Repeatable, max 3. Saved to the store's brief for later runs. |
| `--skip-competitors` | Skip the benchmark. |
| `--skip-ux` | Skip the capture and the slides drafted from it. |
| `--capture-only` | Store the evidence, write no slides. |
| `--no-upload` | Run everything, publish nothing. |

`--checkout` adds a real item to a real cart on the client's live store, which leaves an abandoned
checkout in their admin. That is why it takes an explicit flag rather than being included in the
default group list, and why `--groups checkout` without it is an error rather than a silent yes.

## Step 0 — the brief

Filled in once per client, from **CRO Audits → (a store) → CRO brief**. Stored on the store's
config, so later audits reuse it; each audit copies the brief it was run against, so editing the
brief never changes what a past deck was based on.

- **Competitors** (up to 3). Each one is a full capture sweep of their storefront, at the same cost
  as the client's own — which is why three is the ceiling.
- **Data available** — GA4, Shopify Analytics, Hotjar, Clarity, Quantum Metric, a reviews platform,
  survey data. Ticking a box connects nothing. It records what exists, so a step with no source
  says so on the page instead of looking like a step that found nothing.
- **Business model** — subscriptions, gift cards. Changes which decisions a shopper is actually
  making: a subscription store asks for a delivery frequency before checkout, and reviewing it as a
  one-off purchase misses the step where most of the hesitation is.
- **In the client's words** — brand positioning and their own hypotheses. Both go into the drafting
  prompts, so the audit engages with what they already believe rather than talking past it. Neither
  is treated as a finding unless the capture supports it.

## What each step does, and what it does not

| Step | Automated | Runs where |
|---|---|---|
| 1. Analytics & Customer Journey | Yes — GA4 | Dashboard (Generate) |
| 2. Website & UX Audit | Yes — browser capture | Your machine (`cro`) |
| 3. Heatmaps & Session Recordings | **No** — by hand | — |
| 4. Voice of the Customer | **No** — by hand | — |
| 5. CX Journey Mapping | **No** — by hand | — |
| 6. Competitive Benchmark | Yes — browser capture | Your machine (`cro`) |
| 7. Key Insights | Yes — synthesis | Dashboard (Generate) |

The three unautomated steps appear in every report with an explanation of what still has to be done
by hand. An empty section with no explanation reads as "nothing to improve here", which is never
what it means.

### Step 1 — Analytics & Customer Journey

Nine GA4 queries over 28 complete days ending yesterday: totals, day-by-day history, device,
channel, landing page, new against returning, engagement, the
`view_item → add_to_cart → begin_checkout → purchase` funnel, and item-level performance.

Landing pages are rolled up into **page types** by path, which is the aggregation a CRO audit
reasons from: one collection page converting badly is a merchandising question, and every collection
page converting badly is a template question. Rates are recomputed from summed totals rather than
averaged across rows, so a 6,000-session page is not weighted the same as a 60-session one.

Two things it deliberately does not do:

- **Funnel figures are progression rates, not a followed cohort.** They count sessions in which each
  event was recorded. GA4's session-scoped event counts cannot guarantee that every session which
  reached checkout also recorded a product view, so a later step recording more sessions yields a
  zero drop rather than a negative one. The report states this.
- **No forecasts.** Gap sizes are arithmetic on days that already happened. Nothing says what a fix
  would earn.

If the data cannot carry a conclusion — fewer than 21 days of recorded sessions, no transactions,
fewer than 25 transactions, transactions with no revenue — the step says which of those is true and
stops. No model call is made at all, because a model handed a fortnight of traffic will produce five
confident recommendations from it.

### Step 2 — Website & UX Audit

One page per page group, captured in a single browser session with a 2–4 second pause between loads.
Nothing runs in parallel, nothing is retried, and the browser identifies itself normally.

Which page stands for each group:

- **PLP** — the largest published collection from `collections.json`, not `/collections/all`, which
  many themes disable and which has none of the merchandising a real collection has.
- **PDP** — the most-viewed product in GA4 over the window when a property is linked; otherwise the
  first purchasable product. The fallback is recorded as a limitation, because the first product in
  catalogue order is very often a gift card.
- **Cart** — with a real item added through the storefront's own AJAX cart API, so the page shows a
  cart rather than the empty state. Many themes have no cart *page*: `/cart` redirects to a drawer
  over another page. That is detected, and the page-level scroll measurements are withheld because
  they would describe the page underneath the drawer.
- **Nav** — the header with its menu opened, on the home page.

Per page it records the signals read out of the DOM and a set of measurements: the document height,
where the primary call to action sits and whether that is inside the first screen, the top offset of
each major section in reading order, how many interactive elements begin below the fold, tap targets
under 44px on mobile, and the contrast of the primary button.

**The measurements are a proxy for attention, not evidence of it.** They say what a visitor would
have to scroll past. Every surface that shows them says so.

### Step 6 — Competitive Benchmark

The same page groups, captured against each competitor at mobile width. Two outputs with very
different standing, kept apart on the deck:

- A **feature matrix**, derived from the captures with no model involved. Whether a competitor
  offers subscriptions is a fact about their markup. A tick means the feature was found on the site;
  it says nothing about how well it is implemented, and the slide says that.
- **Per-competitor bullets** written from screenshots, plus their brand positioning in two or three
  words. Useful, and softer — a strategist's read of a rival's site, which is what it is.

### Step 7 — Key Insights

Runs last, presented first. Four cards, each a category tag, a headline and two or three sentences.

Every card must draw on findings from at least two different steps: a "key insight" that restates
one slide is that slide, moved to the front. When only one step has findings the rule is relaxed and
the report says so rather than pretending to a synthesis it could not do.

## The format is enforced, not requested

`shared/src/cro-slides.ts` (and its app-side copy, `web/lib/cro-slides.ts`) decides what may appear
on a slide. A bullet is discarded if it:

- has a title past 52 characters or 7 words, ending in sentence punctuation, or containing a colon —
  the rendered form is `title: description`, and a second colon makes the line unreadable;
- opens its title with a word that frames the finding as a fault (*missing, poor, broken, weak,
  lacks, unclear*) rather than an opportunity;
- runs past one sentence, or two to three for a Key Insight card;
- cites evidence that does not exist, or cites nothing at all;
- contains a **figure that appears nowhere in the evidence it cited**.

That last one is the important one, and it is the same rule the Data Analysis feature runs on. A
sentence like *"moving the CTA above the fold typically lifts add-to-cart by 12–18%"* is
indistinguishable from a measurement once it is on a slide. Discarded bullets are listed with their
reason rather than dropped, so a thin slide reads as a caught mistake and not as a thin finding.

The prompt asks for the format as well. That is not redundant: the validator is what *guarantees* the
format, and asking for it is what stops the validator from rejecting half of every response.

When the check rejects something good, the fix is usually the **evidence**, not the check. On the
first live run three sound bullets about a store's free-shipping threshold were thrown away because
the catalogue said "a threshold is stated" without saying it was $50. Capturing the amount fixed it;
loosening the number check would not have.

## Editing, and why it never rewrites the audit

Hover any bullet and click **Edit**. Corrections are saved to an overlay blob beside the report and
composed at render time. The generated record is never modified — by the time anyone is editing it,
it may already have been sent to a client, and "did we change this after we presented it?" has to
stay answerable.

Bullets are **hidden** rather than deleted, so the decision is reversible.

Bullet ids are derived from their content, so an edit survives a page reload but is deliberately
orphaned by a re-draft that rewords the bullet. Orphans are kept and flagged rather than silently
re-applied to different words.

## Storage

```
cro/index.json                          every audit, for the list page
cro/<slug>/<id>.json                    the interpreted deck
cro/<slug>/<id>-capture.json            what the browser saw
cro/<slug>/<id>-edits.json              the strategist's overlay
screenshots/cro-<slug>/<id>/<group>-<device>-<full|fold>.jpg
```

Screenshots live under `screenshots/` to reuse the web app's blob proxy, which is hard-scoped to
that one prefix. The store segment is `cro-<slug>` rather than `cro/<slug>` on purpose: the app
authorises a shared report's images by splitting the proxy path into `<store>/<report>`, and with a
slash one CRO share link would authorise every CRO audit that store has ever had.

## Sharing

**Share with client** mints the same kind of signed link the site audit uses — HMAC-signed, scoped
to one audit, 30-day expiry — carrying `resource: "cro"` so `/share/<token>` renders the
client-facing view. That view drops the machinery (discarded bullets, evidence toggles, edit
controls, capture thumbnails) and keeps the argument, plus each step's limitations. A deck that
quietly omits what it could not see invites the reader to assume it saw everything.

**Deck view** renders one 16:9 slide per page and prints through the browser's own dialog, so the
PDF keeps selectable text and needs no headless Chrome on the deployed instance.

## Cost and load

A full sweep is roughly 12 page loads for the client plus 5 per competitor, sequential, with a pause
between each. That is more than the site audit's two-page UX pass and enough that an aggressive WAF
might notice, which is why none of it is parallelised.

Drafting is one image-bearing model call per page group plus one per competitor, and two more on
Generate. Per-step token usage is recorded on the report and totalled in its footer.

## Phase 2

Designs already settled, not built:

- **Heatmaps** — upload click and scroll maps per page group per device, analysed alongside our own
  screenshot of the same page and the fold measurements already captured. The Microsoft Clarity data
  export API is the highest-value later automation; Hotjar has no comparable export.
- **Voice of the Customer** — the fixed three-slide structure, with every quote verified as an exact
  substring of the supplied review corpus, and theme frequencies so "recurring theme" is a number.
- **CX Journey Mapping** — AI-proposed steps from the business model and the observed page groups,
  with the strategist deciding the final list; each step scored with the evidence that justified it,
  moments of truth flagged, and the chart as inline SVG so it prints.
