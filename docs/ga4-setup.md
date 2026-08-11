# Connecting Google Analytics (GA4) — one-time setup

This lets `barrel-audit` pull real traffic, conversion rate, and average order value (AOV)
into a report, instead of just technical scores. It's a **one-time setup per Barrel Google
account** (not per client) — after this, connecting an individual client's store is just
two things: they add one email as a viewer, and you paste in one number.

You'll need access to a Google account that can create things in
[Google Cloud Console](https://console.cloud.google.com) — this is a different thing from
a regular Google Analytics login. If nobody at Barrel has done this before, loop in an
engineer for this part; it's about 10 minutes.

## Part A — create the credential (do this once, ever)

1. **Go to [console.cloud.google.com](https://console.cloud.google.com)** and sign in with
   Barrel's Google account.
2. **Create a project** (top-left dropdown → "New Project"). Name it something like
   `barrel-site-audit`. This is just a container Google uses to organize things — it
   doesn't need to be anything fancy.
3. **Enable the Analytics API.** In the search bar at the top, type
   `Google Analytics Data API`, click the result, then click **Enable**.
4. **Create a service account.** A "service account" is like a robot user — it's how our
   CLI tool identifies itself to Google, instead of a real person logging in each time.
   - In the left sidebar: **IAM & Admin → Service Accounts → + Create Service Account**
   - Name it something like `barrel-audit-ga4-reader`
   - You can skip the optional "grant access" steps that follow — click through to Done
5. **Create a key for it.** Click into the service account you just made → **Keys** tab →
   **Add Key → Create new key → JSON** → Create. A `.json` file downloads to your
   computer. **This file is a secret credential — treat it like a password.**
6. **Find the service account's email address.** Open the downloaded `.json` file in any
   text editor and find the `"client_email"` field. It looks like:
   ```
   barrel-audit-ga4-reader@barrel-site-audit.iam.gserviceaccount.com
   ```
   Copy this — you'll give it to clients in Part B.
7. **Add the whole key to `.env`.** In the `barrel-site-audit` project's root `.env` file
   (create it from `.env.example` if you haven't already — see the main README), add:
   ```
   GOOGLE_SERVICE_ACCOUNT_KEY='<paste the entire contents of the .json file here, all on one line>'
   ```
   Wrap it in single quotes so the JSON's own quotation marks don't confuse anything.

That's it for the one-time part. Nobody needs to touch Google Cloud Console again — every
client after this is just Part B.

## Part B — connect an individual client's store (do this per client)

1. **Ask the client (or find in your own access) for their GA4 property**, and send them
   this ask: *"Can you add `<the service account email from step 6 above>` as a **Viewer**
   under Admin → Property Access Management in Google Analytics?"* This gives read-only
   access to traffic/revenue numbers — it cannot change anything or see other Google data.
2. **Get the GA4 Property ID.** In their Google Analytics: **Admin → Property Settings** →
   the Property ID is a plain number near the top, e.g. `123456789` (not the same as the
   "Measurement ID" that starts with `G-`).
3. **Add it to the store's config** — either when creating the store:
   ```
   pnpm barrel-audit init-store <slug> --url https://client-store.com --ga4-property-id 123456789
   ```
   or by editing `stores/<slug>/config.json` afterward and adding:
   ```json
   "ga4PropertyId": "123456789"
   ```

Once both are done, `pnpm barrel-audit run <slug>` automatically includes a **Traffic &
Revenue** section with real sessions, conversion rate, AOV, and channel breakdown. If
either piece is missing, that section is just skipped — nothing else in the report is
affected.
