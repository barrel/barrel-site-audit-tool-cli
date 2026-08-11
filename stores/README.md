# stores

One folder per client, created with:

```
pnpm barrel-audit init-store <slug> --url https://client-store.com --name "Client Name"
```

For example, auditing Allbirds' storefront:

```
pnpm barrel-audit init-store allbirds --url https://www.allbirds.com --name "Allbirds"
```

This creates `stores/allbirds/config.json` and `stores/allbirds/theme/`. From there:

```
pnpm barrel-audit run allbirds
```

(You can also skip `init-store` entirely and just run `pnpm barrel-audit run https://www.allbirds.com` —
it auto-creates the store from the URL's hostname.)

Each store folder contains:

- `config.json` — slug, display name, and live URL used by the CLI
- `theme/` — the store's Shopify theme code (gitignored — pull it fresh per audit)

See the root README for the full workflow.
