---
name: ship-cli-features
description: Ship a change that touches the CLI so a globally-installed barrel-audit can actually get it — decide whether the version needs bumping, bump shared/cli, publish to GitHub Packages, and redeploy the web app. Use this whenever work adds, changes, or removes anything under cli/ or shared/src/, whenever a new report section or analyzer is added, and whenever someone asks why a feature is missing from their global barrel-audit or from a report a teammate generated.
---

# Shipping a change that touches the CLI

Most people at Barrel do not run this tool from a checkout. They run a **globally installed**
`barrel-audit` from a client theme repo, with the dashboard in the browser driving it. That install
comes from GitHub Packages, so **a CLI feature that isn't published does not exist for them** — no
matter that it is on `main` and the web app is deployed.

This has already gone wrong once: the Recommendations tab and Theme & Codebase profile shipped to
production while every global install was on `cli@1.5.0`, seven minor versions behind. The web app
had the tabs; nothing could generate the data for them.

## Does this change need a publish?

Yes if the change touches any of these:

- anything under `cli/` — a new analyzer, a new command, a new `--flag`, changed output
- anything under `shared/src/` — the CLI bundles `@barrel/site-audit-shared`, so a type or helper
  the CLI reads has to be published too
- a **new report section**. This is the easy one to miss: the section renders in `web/`, but the
  data comes from an analyzer in `cli/`. Deploying the web app alone gives everyone an empty tab.

No if the change is web-only — a component, a page, styling, a route, `web/lib/*` that no analyzer
imports. Deploy the web app and stop.

If unsure, check what a report actually needs:

```
git diff --stat main -- cli/ shared/src/
```

Anything there means publish.

## Steps

1. **Confirm the gate passes first.** Never publish from a tree that fails it.

   ```
   pnpm check
   ```

2. **Bump both versions.** `shared` and `cli` are versioned independently but published as a pair,
   because `cli` depends on `shared` via `workspace:*` — publishing `cli` without republishing a
   `shared` it needs produces an install that resolves an older `shared` and fails at runtime in a
   way that is very hard to read.

   - `shared/package.json` — bump the minor for new/changed exported types, the patch for a fix
   - `cli/package.json` — bump the minor for a new analyzer, command or flag; the patch for a fix

   These are *not* the same number as the app version in `web/lib/release-notes.ts`. That one is
   the dashboard's user-facing version; these two are npm package versions. Bump all three.

3. **Publish, `shared` first.** Order matters for the reason in step 2.

   ```
   pnpm --filter @barrel/site-audit-shared build && pnpm --filter @barrel/site-audit-shared publish --no-git-checks
   pnpm --filter @barrel/site-audit-cli build && pnpm --filter @barrel/site-audit-cli publish --no-git-checks
   ```

   Needs `~/.npmrc` to carry a GitHub token with **`write:packages`** (read-only is enough to
   install, not to publish). Publishing is outward-facing and can't be undone — **confirm with the
   user before running it** unless they have already asked for the publish in this session.

4. **Deploy the web app.** This project has **no Vercel git integration** — pushing to `main`
   deploys nothing. Every production deployment is a manual CLI deploy:

   ```
   pnpm web:deploy
   ```

   Vercel captures env vars at build time, so if an env var was added for this feature, add it
   *before* deploying or the build won't see it.

5. **Tell the user how to pick it up.** The publish does nothing for their machine on its own:

   ```
   npm install -g @barrel/site-audit-cli
   barrel-audit --help          # confirm the new command/flag is there
   ```

## Checks worth making before you call it shipped

- **Is the version in the tree actually newer than what's published?** A publish silently no-ops in
  the user's mind if the version wasn't bumped — npm refuses to overwrite, and it is easy to read
  the error as unimportant.

  ```
  npm view @barrel/site-audit-cli version --registry=https://npm.pkg.github.com
  node -e 'console.log(require("./cli/package.json").version)'
  ```

- **What version is actually installed globally?** Worth checking whenever someone reports a
  missing feature, before assuming a bug:

  ```
  barrel-audit --help | sed -n '/Commands:/,$p'
  ```

  A command missing from that list means a stale install, not a broken feature.

- **Docs.** A new flag or command belongs in the README's flags line and in
  `web/app/instructions/page.tsx`, and every user-visible change needs a versioned entry in
  `web/lib/release-notes.ts`. See the standing instruction in the project's memory.

## The `pnpm` prefix trap

When telling someone how to run the global CLI, write `barrel-audit ...`, never
`pnpm barrel-audit ...`. The prefix is not itself broken — that is the confusing part — but it makes
the CLI depend on the *theme repo's* dependency state, which has nothing to do with this tool:

- In a folder with no `package.json`: `ERR_PNPM_NO_IMPORTER_MANIFEST_FOUND`, which at least names
  the problem.
- In a client theme repo that **does** have one — the normal case, since most themes have a build —
  pnpm adopts that repo as the workspace and runs verify-deps-before-run first, i.e. `pnpm install`
  on the theme, before running anything. Healthy install: the command works, since pnpm falls
  through to the global binary on `PATH`. Broken install: the CLI is never reached, and what the
  user sees is a `pnpm install` failure ending in `runDepsStatusCheck` — which reads as a bug in
  this tool and is not one.

Seen in the wild (2026-08-25): pnpm 11 wrote an unresolved `allowBuilds:` block into a theme's own
`pnpm-workspace.yaml` (`esbuild: set this to true or false`) and then failed every install with
`ERR_PNPM_IGNORED_BUILDS` until those became real booleans. Every `pnpm barrel-audit ...` in that
repo died on it; plain `barrel-audit serve` worked throughout.

So when someone reports the CLI failing with a `pnpm install` error, check two things before looking
at this tool at all: whether they used the `pnpm` prefix, and what `barrel-audit --version` says
(a stale global install is the other half of "my feature is missing").
