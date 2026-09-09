# stores

Per-store working files, one folder per client. **Nothing in here is versioned** — the whole
directory is gitignored apart from this README, because everything in it is either regenerated on
the next run or specific to one machine. The shared copy of a store's `config.json` lives in Blob
storage, which is what the dashboard and your teammates read.

With the CLI installed globally these folders live in `~/.barrel-audit/stores/` instead; inside a
checkout they live here.

A folder is created for you the first time you audit a URL:

```
barrel-audit run https://www.allbirds.com
```

That derives the slug from the hostname (`www-allbirds-com`). To name it yourself instead:

```
barrel-audit init-store allbirds --url https://www.allbirds.com --name "Allbirds"
barrel-audit run allbirds
```

Each store folder contains:

- `config.json` — slug, display name, live URL, and any linked Shopify domain / GA4 property /
  local theme directory. Mirrored to Blob so other machines and the dashboard see the store.
- `theme/` — the store's Shopify theme code, pulled fresh per audit. Not needed at all unless you
  want the theme code and structure sections; `barrel-audit run <url> --local-repo .` reads a
  checkout you already have instead of copying anything in here.
- `fixes/` — disposable clones for in-progress AI fix branches. Safe to delete any time.

See the root README for the full workflow.
