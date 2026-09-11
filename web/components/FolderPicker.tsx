"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface BrowseEntry {
  name: string;
  path: string;
  isTheme: boolean;
}

interface BrowseResult {
  path: string;
  parent: string | null;
  home: string;
  isTheme: boolean;
  crumbs: { name: string; path: string }[];
  entries: BrowseEntry[];
  truncated: boolean;
}

/** Folder picker for a path on the machine running `barrel-audit serve`.
 *
 * The browser's own directory picker is no use here: it hands back relative names, never the
 * absolute path `--local-repo` needs, and the dashboard is usually the deployed site rather than
 * a local copy. So the listing comes from the local agent's /fs/browse — the same 127.0.0.1
 * connection that runs the audits — and this renders it. Folders holding a theme are marked, so
 * the right one is recognisable without opening it. */
export function FolderPicker({
  port,
  token,
  initialPath,
  onSelect,
  onClose,
}: {
  port: string;
  token: string;
  initialPath?: string;
  onSelect: (path: string) => void;
  onClose: () => void;
}) {
  const [listing, setListing] = useState<BrowseResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Editable so a path can still be pasted or hand-typed — browsing is the addition here, not a
  // replacement for knowing where you keep your checkouts.
  const [pathInput, setPathInput] = useState(initialPath ?? "");
  const dialogRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const load = useCallback(
    async (path?: string) => {
      setLoading(true);
      setError(null);
      try {
        const query = path ? `?path=${encodeURIComponent(path)}` : "";
        const res = await fetch(`http://127.0.0.1:${port}/fs/browse${query}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(10_000),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          setError(
            res.status === 401
              ? "The local agent rejected the saved token. Close this, re-open the agent settings above, and paste the token it printed."
              : (data?.error ?? `The local agent refused that (${res.status}).`),
          );
          return;
        }
        setListing(data as BrowseResult);
        setPathInput((data as BrowseResult).path);
        listRef.current?.scrollTo({ top: 0 });
      } catch (err: unknown) {
        setError(
          `Couldn't reach the local agent on port ${port}. Is \`barrel-audit serve\` still running? (${
            (err as Error)?.message ?? String(err)
          })`,
        );
      } finally {
        setLoading(false);
      }
    },
    [port, token],
  );

  useEffect(() => {
    load(initialPath?.trim() || undefined);
    // Deliberately once: reopening the picker remounts it, and re-running on every keystroke in
    // the path box would fight the person typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // Deep paths are the normal case, and a breadcrumb that wraps to three lines pushes the folder
  // list off the screen — so only the tail is clickable, with the full path shown below it.
  const crumbs = listing?.crumbs.slice(-4) ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="folder-picker-title"
        tabIndex={-1}
        className="relative w-full max-w-[620px] max-h-[85vh] flex flex-col bg-white border border-[#E5E5E5] rounded-lg shadow-xl focus:outline-none"
      >
        <div className="px-6 pt-6 pb-4 border-b border-[#E5E5E5]">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute top-3 right-3 w-8 h-8 flex items-center justify-center rounded-full text-[#6B6B6B] hover:text-[#1A1A1A] hover:bg-[#f0efed] transition-colors text-lg leading-none"
          >
            ×
          </button>
          <h3 id="folder-picker-title" className="text-base font-semibold text-[#1A1A1A]">
            Choose the theme folder
          </h3>
          <p className="text-xs text-[#9A9A9A] mt-1">
            Browsing the machine running <code className="bg-[#fafafa] px-1 rounded">barrel-audit serve</code>.
            Folders containing <code className="bg-[#fafafa] px-1 rounded">layout/theme.liquid</code> are marked
            as themes.
          </p>

          <div className="flex items-center gap-2 mt-3">
            <button
              type="button"
              disabled={loading || !listing?.parent}
              onClick={() => load(listing?.parent ?? undefined)}
              className="shrink-0 text-xs font-medium text-[#1A1A1A] border border-[#E5E5E5] rounded-lg px-2.5 py-1.5 hover:bg-[#fafafa] disabled:opacity-40"
            >
              ↑ Up
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={() => load(listing?.home)}
              className="shrink-0 text-xs font-medium text-[#1A1A1A] border border-[#E5E5E5] rounded-lg px-2.5 py-1.5 hover:bg-[#fafafa] disabled:opacity-40"
            >
              Home
            </button>
            <form
              className="flex-1 min-w-0 flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                load(pathInput.trim() || undefined);
              }}
            >
              <input
                value={pathInput}
                onChange={(e) => setPathInput(e.target.value)}
                spellCheck={false}
                aria-label="Folder path"
                className="flex-1 min-w-0 rounded-lg border border-[#E5E5E5] px-2.5 py-1.5 text-xs font-mono text-[#1A1A1A] focus:outline-none focus:ring-2 focus:ring-[#1A1A1A]/10 focus:border-[#1A1A1A]"
              />
              <button
                type="submit"
                disabled={loading}
                className="shrink-0 text-xs font-medium text-[#1A1A1A] border border-[#E5E5E5] rounded-lg px-2.5 py-1.5 hover:bg-[#fafafa] disabled:opacity-40"
              >
                Go
              </button>
            </form>
          </div>

          {crumbs.length > 0 && (
            <div className="flex items-center gap-1 mt-2 text-xs text-[#6B6B6B] overflow-hidden">
              {listing && listing.crumbs.length > crumbs.length && <span className="shrink-0">…</span>}
              {crumbs.map((crumb, i) => (
                <span key={crumb.path} className="flex items-center gap-1 min-w-0">
                  {i > 0 && <span className="text-[#D5D5D5]">/</span>}
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => load(crumb.path)}
                    className="truncate hover:text-[#1A1A1A] hover:underline disabled:opacity-50"
                  >
                    {crumb.name}
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        <div ref={listRef} className="flex-1 overflow-auto px-3 py-2 min-h-[180px]">
          {error && (
            <p className="m-3 text-xs text-[#B91C1C] bg-[#FEF2F2] border border-[#FECACA] rounded-lg px-3 py-2.5 leading-relaxed">
              {error}
            </p>
          )}
          {loading && !error && <p className="m-3 text-xs text-[#9A9A9A]">Loading…</p>}
          {!loading && !error && listing?.entries.length === 0 && (
            <p className="m-3 text-xs text-[#9A9A9A]">
              No subfolders here. Use the button below if this is the theme itself.
            </p>
          )}
          {!loading &&
            !error &&
            listing?.entries.map((entry) => (
              <div
                key={entry.path}
                className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-[#fafafa] group"
              >
                <button
                  type="button"
                  onClick={() => load(entry.path)}
                  className="flex-1 min-w-0 flex items-center gap-2 text-left"
                >
                  <span aria-hidden="true" className="shrink-0 text-sm">
                    {entry.isTheme ? "🛍️" : "📁"}
                  </span>
                  <span className="truncate text-sm text-[#1A1A1A]">{entry.name}</span>
                  {entry.isTheme && (
                    <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-[#10B981]">
                      Theme
                    </span>
                  )}
                </button>
                {/* Always visible on a theme, which is the row most likely to be the answer —
                    opening it only to come straight back out is a pointless round trip. */}
                <button
                  type="button"
                  onClick={() => onSelect(entry.path)}
                  className={`shrink-0 text-xs font-medium underline hover:text-[#1A1A1A] focus:opacity-100 ${
                    entry.isTheme ? "text-[#1A1A1A]" : "text-[#6B6B6B] opacity-0 group-hover:opacity-100"
                  }`}
                >
                  Use
                </button>
              </div>
            ))}
          {listing?.truncated && (
            <p className="m-3 text-xs text-[#9A9A9A]">
              Only the first 500 subfolders are listed — type the path above to jump straight to one.
            </p>
          )}
        </div>

        <div className="border-t border-[#E5E5E5] px-6 py-4">
          {listing?.isTheme && !loading && !error && (
            <p className="text-xs text-[#10B981] mb-2.5 leading-relaxed">
              This folder is a Shopify theme — <code className="bg-[#fafafa] px-1 rounded">layout/theme.liquid</code>{" "}
              is right here.
            </p>
          )}
          {listing && !listing.isTheme && !loading && !error && (
            <p className="text-xs text-[#D97706] mb-2.5 leading-relaxed">
              No <code className="bg-[#fafafa] px-1 rounded">layout/theme.liquid</code> in this folder — pick
              it anyway if you know the theme lives here, otherwise open a subfolder.
            </p>
          )}
          <div className="flex items-center justify-end gap-3">
            <button type="button" onClick={onClose} className="text-sm text-[#6B6B6B] hover:text-[#1A1A1A]">
              Cancel
            </button>
            <button
              type="button"
              disabled={!listing || loading}
              onClick={() => listing && onSelect(listing.path)}
              className="text-sm font-semibold text-white bg-[#1A1A1A] hover:bg-black px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
            >
              Use this folder
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
