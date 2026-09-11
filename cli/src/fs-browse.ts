import { readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { looksLikeShopifyTheme } from "./store.js";

/** Directory browsing for the dashboard's "Browse…" button.
 *
 * A web page can never learn the absolute path of a folder the user picked — a directory
 * <input> hands back relative names and nothing else — and an absolute path is precisely what
 * `--local-repo` needs. So the browsing happens here, on the machine that actually has the
 * folders, and the dashboard renders the listing. Directory *names* only: no file contents, no
 * sizes, nothing about the files inside. */

export interface BrowseEntry {
  name: string;
  path: string;
  /** The folder is itself a theme root, so it can be chosen without opening it. */
  isTheme: boolean;
}

export interface BrowseResult {
  path: string;
  /** Null at the filesystem root, where "up" has nowhere to go. */
  parent: string | null;
  home: string;
  isTheme: boolean;
  /** Path split into clickable ancestors, root first, ending at `path` itself. */
  crumbs: { name: string; path: string }[];
  entries: BrowseEntry[];
  /** More subfolders than MAX_ENTRIES — the listing is a prefix, not the whole directory. */
  truncated: boolean;
}

// A directory with more subfolders than this is not one anybody is browsing by eye, and sending
// tens of thousands of names would make the picker crawl. The flag tells the UI to say so.
const MAX_ENTRIES = 500;

function expandHome(input: string): string {
  if (input === "~") return homedir();
  if (input.startsWith("~/")) return join(homedir(), input.slice(2));
  return input;
}

function crumbsFor(dir: string): { name: string; path: string }[] {
  const crumbs: { name: string; path: string }[] = [];
  for (let cur = dir; ; cur = dirname(cur)) {
    // basename(), not a split on "/": a folder name may legitimately contain a backslash,
    // and at the filesystem root basename() is empty, where the path itself is the label.
    crumbs.unshift({ name: cur === dirname(cur) ? cur : basename(cur), path: cur });
    if (cur === dirname(cur)) break;
  }
  return crumbs;
}

/** Lists the subfolders of `path` (the user's home directory when omitted).
 *
 * Throws with a sentence fit to show in the picker — "no such folder", "not a folder",
 * "permission denied" are all things a hand-typed path does routinely, and each has a different
 * fix. */
export function browseDirectory(path?: string): BrowseResult {
  const dir = resolve(expandHome((path ?? "").trim() || homedir()));

  let stats;
  try {
    stats = statSync(dir);
  } catch (err: any) {
    if (err?.code === "ENOENT") throw new Error(`No such folder: ${dir}`);
    if (err?.code === "EACCES" || err?.code === "EPERM") throw new Error(`Not allowed to read ${dir}.`);
    throw new Error(`Could not read ${dir}: ${err?.message ?? String(err)}`);
  }
  if (!stats.isDirectory()) throw new Error(`Not a folder: ${dir}`);

  let names: string[];
  try {
    names = readdirSync(dir, { withFileTypes: true })
      // Dot-directories are .git, .next, .cache and friends — noise in every listing, and never
      // a theme root. Hidden here rather than filtered in the UI so they aren't even sent.
      .filter((e) => !e.name.startsWith("."))
      .filter((e) => {
        if (e.isDirectory()) return true;
        // A symlinked checkout is a real thing people have; resolve it rather than hiding it.
        if (!e.isSymbolicLink()) return false;
        try {
          return statSync(join(dir, e.name)).isDirectory();
        } catch {
          return false; // Broken link — nothing to open.
        }
      })
      .map((e) => e.name);
  } catch (err: any) {
    if (err?.code === "EACCES" || err?.code === "EPERM") throw new Error(`Not allowed to read ${dir}.`);
    throw new Error(`Could not read ${dir}: ${err?.message ?? String(err)}`);
  }

  names.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  const truncated = names.length > MAX_ENTRIES;

  return {
    path: dir,
    parent: dirname(dir) === dir ? null : dirname(dir),
    home: homedir(),
    isTheme: looksLikeShopifyTheme(dir),
    crumbs: crumbsFor(dir),
    entries: names.slice(0, MAX_ENTRIES).map((name) => {
      const full = join(dir, name);
      return { name, path: full, isTheme: looksLikeShopifyTheme(full) };
    }),
    truncated,
  };
}
