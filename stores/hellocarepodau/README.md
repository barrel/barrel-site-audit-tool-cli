# hellocarepodau

Storefront: https://hellocarepod.com/?_ab=0&_fd=0&_sc=1&preview_theme_id=158293295335

## Adding theme code

`theme/` is a plain folder — get the theme's Liquid source into it either way:

**Option A — pull it via the Shopify CLI:**

```
pnpm barrel-audit pull-theme hellocarepodau --store <your-store>.myshopify.com
```

**Option B — copy/paste the files in yourself:** unzip a theme export, drag files in Finder, `cp -r` from a local checkout, whatever's fastest — just get the theme's files into `theme/`.

Once the code is in place, run:

```
pnpm barrel-audit run hellocarepodau
```
