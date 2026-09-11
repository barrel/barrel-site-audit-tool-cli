"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_AGENT_PORT, useLocalAgent } from "@/lib/use-local-agent";

/**
 * The visual GitHub connector.
 *
 * Three things happen on this one surface, in the order someone actually needs them: connect this
 * browser to GitHub, find the repo, and say how audits should read it. Splitting them across pages
 * would mean three page loads to answer one question ("which repo is this client's?").
 *
 * The search box queries GitHub on every keystroke (debounced) rather than filtering a list this
 * page downloaded, because on an instance with thousands of repositories any list short enough to
 * download is an arbitrary slice of them — and the repo someone is looking for is usually not in
 * it. The org filter narrows that further.
 *
 * Read-only throughout. "Read from GitHub each run" needs nothing but the connection record, so it
 * completes here. "Pull a copy" needs a specific disk, so it is handed to the local agent — the
 * same `barrel-audit serve` process the Run Audit form and Suggest fix already talk to.
 */

export interface PickerStore {
  slug: string;
  name: string;
  url: string;
  githubRepo?: string;
  githubBranch?: string;
  githubMode?: "pull" | "read";
  themeSubdir?: string;
  githubConnectedAt?: string;
  githubConnectedBy?: string;
}

interface Repo {
  fullName: string;
  description: string | null;
  private: boolean;
  defaultBranch: string;
  updatedAt: string;
  archived: boolean;
  language: string | null;
}

type Mode = "read" | "pull";

function relativeTime(iso: string): string {
  if (!iso) return "unknown";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

function formatConnectedAt(iso?: string): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function GithubRepoPicker({ stores }: { stores: PickerStore[] }) {
  /* ── GitHub connection ─────────────────────────────────────────────────────────────────── */
  const [connected, setConnected] = useState<boolean | null>(null);
  const [login, setLogin] = useState("");
  const [orgs, setOrgs] = useState<string[]>([]);
  const [device, setDevice] = useState<{ userCode: string; verificationUri: string } | null>(null);
  const [connectError, setConnectError] = useState("");
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadSession = useCallback(async () => {
    const res = await fetch("/api/github/session");
    const data = await res.json().catch(() => null);
    setConnected(Boolean(data?.connected));
    setLogin(data?.login ?? "");
    setOrgs(Array.isArray(data?.orgs) ? data.orgs : []);
    if (data?.error) setConnectError(data.error);
  }, []);

  useEffect(() => {
    void loadSession();
    return () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, [loadSession]);

  async function startConnect() {
    setConnectError("");
    const res = await fetch("/api/github/device", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "start" }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setConnectError(data?.error ?? "Could not start the GitHub sign-in.");
      return;
    }
    if (data.connected) {
      await loadSession();
      return;
    }
    setDevice({ userCode: data.userCode, verificationUri: data.verificationUri });
    schedulePoll((data.interval ?? 5) * 1000);
  }

  function schedulePoll(delayMs: number) {
    if (pollTimer.current) clearTimeout(pollTimer.current);
    pollTimer.current = setTimeout(async () => {
      const res = await fetch("/api/github/device", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "poll" }),
      });
      const data = await res.json().catch(() => null);
      if (data?.status === "pending") {
        schedulePoll((data.interval ?? 5) * 1000);
        return;
      }
      if (data?.status === "connected") {
        setDevice(null);
        await loadSession();
        return;
      }
      setDevice(null);
      setConnectError(data?.error ?? "The GitHub sign-in did not complete.");
    }, delayMs);
  }

  async function disconnect() {
    await fetch("/api/github/session", { method: "DELETE" });
    setDevice(null);
    setConnectError("");
    setRepos([]);
    setSelected(null);
    await loadSession();
  }

  /* ── Store, search, selection ──────────────────────────────────────────────────────────── */
  const [slug, setSlug] = useState(stores[0]?.slug ?? "");
  const store = useMemo(() => stores.find((s) => s.slug === slug) ?? null, [stores, slug]);

  const [org, setOrg] = useState("");
  const [query, setQuery] = useState("");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [repos, setRepos] = useState<Repo[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [selected, setSelected] = useState<Repo | null>(null);
  const [branches, setBranches] = useState<string[]>([]);
  const [branch, setBranch] = useState("");
  const [mode, setMode] = useState<Mode>("read");

  // Debounced, and only while connected. Every keystroke is a GitHub search request and the
  // endpoint allows 30 a minute, so firing one per character would rate-limit a fast typist out
  // of their own search.
  useEffect(() => {
    if (!connected) return;
    setSearching(true);
    const timer = setTimeout(async () => {
      const params = new URLSearchParams({ q: query, limit: "30" });
      if (org) params.set("org", org);
      if (includeArchived) params.set("archived", "1");
      try {
        const res = await fetch(`/api/github/repos?${params}`);
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          setSearchError(data?.error ?? "GitHub search failed.");
          setRepos([]);
        } else {
          setSearchError("");
          setRepos(data.repos ?? []);
        }
      } catch {
        setSearchError("Could not reach GitHub.");
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [connected, query, org, includeArchived]);

  async function chooseRepo(repo: Repo) {
    setSelected(repo);
    setBranch(repo.defaultBranch);
    setBranches([repo.defaultBranch]);
    setResult(null);
    const res = await fetch(`/api/github/repos?branches=${encodeURIComponent(repo.fullName)}`);
    const data = await res.json().catch(() => null);
    if (Array.isArray(data?.branches) && data.branches.length > 0) setBranches(data.branches);
  }

  /* ── Connecting a repo to a store ──────────────────────────────────────────────────────── */
  const agent = useLocalAgent();
  const [linking, setLinking] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string; warning?: string } | null>(null);
  const [pullLog, setPullLog] = useState("");

  async function connectRepo() {
    if (!store || !selected) return;
    setLinking(true);
    setResult(null);
    setPullLog("");

    try {
      const res = await fetch("/api/github/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: store.slug, repo: selected.fullName, branch, mode }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setResult({ ok: false, message: data?.error ?? "Could not connect that repo." });
        return;
      }

      const where = data.themeSubdir ? ` (theme at ${data.themeSubdir}/)` : "";
      if (mode === "read") {
        setResult({
          ok: true,
          message: `${data.repo} (${data.branch})${where} is connected to ${store.name}. Every audit reads it fresh — nothing is kept on disk.`,
          warning: data.warning,
        });
        return;
      }

      // "pull" is the half that needs a machine. The record above is saved either way, so a failed
      // or skipped pull leaves a correct connection rather than a half-written one.
      if (!agent.detected || !agent.token) {
        setResult({
          ok: true,
          message: `${data.repo} (${data.branch})${where} is connected to ${store.name}, but nothing has been pulled yet — that needs the local agent.`,
          warning: `Start \`barrel-audit serve\` on your machine and paste its token below, or run \`barrel-audit link-repo ${store.slug} --repo ${data.repo} --mode pull\` in a terminal.`,
        });
        return;
      }
      await pullWithAgent(data.repo, data.branch, store.slug, where);
    } catch (err) {
      setResult({ ok: false, message: String((err as Error)?.message ?? err) });
    } finally {
      setLinking(false);
    }
  }

  async function pullWithAgent(repo: string, ref: string, storeSlug: string, where: string) {
    try {
      const res = await fetch(`http://127.0.0.1:${agent.port}/github/pull`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${agent.token}` },
        body: JSON.stringify({ slug: storeSlug, repo, branch: ref }),
      });

      if (!res.ok || !res.body) {
        const detail = await res.text().catch(() => "");
        setResult({
          ok: false,
          message: `The local agent refused the pull (${res.status}). ${detail.slice(0, 300)}`,
        });
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let log = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        log += decoder.decode(value, { stream: true });
        setPullLog(log);
      }

      const exit = log.match(/__BARREL_PULL_DONE__(-?\d+)__/);
      const code = exit ? Number.parseInt(exit[1], 10) : -1;
      setResult(
        code === 0
          ? { ok: true, message: `${repo} (${ref})${where} pulled into this machine's stores/${storeSlug}/theme/.` }
          : { ok: false, message: `The pull failed (exit ${code}). The output below says why; the connection itself was saved.` },
      );
    } catch (err) {
      setResult({
        ok: false,
        message: `Could not reach the local agent on port ${agent.port}: ${String((err as Error)?.message ?? err)}`,
      });
    }
  }

  async function disconnectStore() {
    if (!store) return;
    setLinking(true);
    try {
      const res = await fetch("/api/github/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: store.slug, repo: "" }),
      });
      const data = await res.json().catch(() => null);
      setResult(
        res.ok
          ? { ok: true, message: `${store.name} is no longer connected to a GitHub repo. Nothing on GitHub changed.` }
          : { ok: false, message: data?.error ?? "Could not disconnect." },
      );
    } finally {
      setLinking(false);
    }
  }

  /* ── Render ─────────────────────────────────────────────────────────────────────────────── */
  return (
    <div className="space-y-5">
      {/* 1 — this browser's GitHub connection */}
      <section className="bg-white border border-[#E5E5E5] rounded-lg px-5 py-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-lg font-semibold text-[#000000] tracking-tight">GitHub connection</h2>
            <p className="mt-1 text-sm text-[#6B6B6B] leading-relaxed max-w-[80ch]">
              Read-only. This tool lists and reads repositories; it never writes to one. The only
              exception in the whole app is the separately-confirmed &ldquo;Suggest fix&rdquo; pull request, which
              runs from your own machine and asks every time.
            </p>
          </div>
          {connected === true && (
            <div className="flex items-center gap-3 shrink-0">
              <span className="text-sm text-[#1A1A1A]">
                Connected as <span className="font-semibold">{login}</span>
              </span>
              <button
                onClick={disconnect}
                className="text-sm text-[#6B6B6B] hover:text-[#1A1A1A] border border-[#E5E5E5] rounded-lg px-3 py-1.5"
              >
                Disconnect
              </button>
            </div>
          )}
        </div>

        {connected === null && <p className="mt-3 text-sm text-[#9A9A9A]">Checking…</p>}

        {connected === false && !device && (
          <div className="mt-3">
            <button
              onClick={startConnect}
              className="bg-[#1A1A1A] text-white text-sm font-semibold rounded-lg px-4 py-2 hover:bg-black"
            >
              Connect GitHub
            </button>
            <p className="mt-2 text-xs text-[#9A9A9A] max-w-[80ch]">
              Opens GitHub&apos;s device sign-in: you&apos;ll get a short code to enter on github.com. The
              connection is stored encrypted in this browser only — a teammate on another machine connects
              their own.
            </p>
          </div>
        )}

        {device && (
          <div className="mt-4 bg-[#fafafa] border border-[#E5E5E5] rounded-lg px-4 py-4">
            <p className="text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-wider">Step 1</p>
            <p className="text-sm text-[#1A1A1A]">
              Open{" "}
              <a
                href={device.verificationUri}
                target="_blank"
                rel="noreferrer"
                className="text-[#2563EB] hover:underline font-medium"
              >
                {device.verificationUri.replace("https://", "")}
              </a>
            </p>
            <p className="mt-3 text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-wider">Step 2 — enter this code</p>
            <p className="text-2xl font-semibold text-[#000000] tracking-[0.2em] font-mono">{device.userCode}</p>
            <p className="mt-3 text-sm text-[#D97706]">Waiting for you to approve it on GitHub…</p>
          </div>
        )}

        {connectError && <p className="mt-3 text-sm text-[#B91C1C] max-w-[80ch]">{connectError}</p>}
      </section>

      {/* 2 — which store */}
      <section className="bg-white border border-[#E5E5E5] rounded-lg px-5 py-4">
        <h2 className="text-lg font-semibold text-[#000000] tracking-tight">Store</h2>
        {stores.length === 0 ? (
          <p className="mt-2 text-sm text-[#6B6B6B] max-w-[80ch]">
            No stores have been synced yet. Run an audit for one, or{" "}
            <code className="bg-[#fafafa] px-1 rounded font-mono text-xs">barrel-audit init-store &lt;slug&gt; --url …</code>,
            and it&apos;ll show up here.
          </p>
        ) : (
          <>
            <select
              value={slug}
              onChange={(e) => {
                setSlug(e.target.value);
                setResult(null);
              }}
              className="mt-2 w-full border border-[#E5E5E5] rounded-lg px-3 py-2 text-sm bg-white"
            >
              {stores.map((s) => (
                <option key={s.slug} value={s.slug}>
                  {s.name} — {s.slug}
                  {s.githubRepo ? ` · ${s.githubRepo}` : ""}
                </option>
              ))}
            </select>

            {store?.githubRepo ? (
              <div className="mt-3 bg-[#fafafa] border border-[#E5E5E5] rounded-lg px-4 py-3">
                <p className="text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-wider">Currently connected</p>
                <p className="text-sm text-[#1A1A1A] mt-0.5">
                  <a
                    href={`https://github.com/${store.githubRepo}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[#2563EB] hover:underline font-medium"
                  >
                    {store.githubRepo}
                  </a>
                  {store.githubBranch ? ` (${store.githubBranch})` : ""}
                  {store.themeSubdir ? ` · theme at ${store.themeSubdir}/` : ""}
                </p>
                <p className="mt-1 text-xs text-[#6B6B6B]">
                  {store.githubMode === "pull"
                    ? "Pulled to disk — audits read whatever copy the auditing machine has."
                    : "Read from GitHub on every run — nothing kept on disk."}
                  {formatConnectedAt(store.githubConnectedAt)
                    ? ` Connected ${formatConnectedAt(store.githubConnectedAt)}${store.githubConnectedBy ? ` by ${store.githubConnectedBy}` : ""}.`
                    : ""}
                </p>
                <button
                  onClick={disconnectStore}
                  disabled={linking}
                  className="mt-2 text-xs text-[#6B6B6B] hover:text-[#B91C1C] border border-[#E5E5E5] rounded-lg px-2.5 py-1 disabled:opacity-50"
                >
                  Disconnect this repo
                </button>
              </div>
            ) : (
              <p className="mt-2 text-sm text-[#9A9A9A]">No repo connected to this store yet.</p>
            )}
          </>
        )}
      </section>

      {/* 3 — find the repo */}
      {connected && stores.length > 0 && (
        <section className="bg-white border border-[#E5E5E5] rounded-lg px-5 py-4">
          <h2 className="text-lg font-semibold text-[#000000] tracking-tight">Find a repository</h2>
          <p className="mt-1 text-sm text-[#6B6B6B] max-w-[80ch]">
            Searched on GitHub&apos;s side, not filtered from a downloaded list — so this finds a repo
            however many the org has.
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search repository names…"
              className="flex-1 min-w-[240px] border border-[#E5E5E5] rounded-lg px-3 py-2 text-sm"
            />
            {orgs.length > 0 && (
              <select
                value={org}
                onChange={(e) => setOrg(e.target.value)}
                className="border border-[#E5E5E5] rounded-lg px-3 py-2 text-sm bg-white"
              >
                <option value="">All orgs &amp; personal</option>
                {orgs.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            )}
            <button
              onClick={() => setIncludeArchived((v) => !v)}
              className={`text-sm rounded-lg px-3 py-2 border ${
                includeArchived
                  ? "bg-[#1A1A1A] text-white border-[#1A1A1A]"
                  : "border-[#E5E5E5] text-[#6B6B6B] hover:text-[#1A1A1A]"
              }`}
            >
              Archived
            </button>
          </div>

          {searchError && <p className="mt-3 text-sm text-[#B91C1C]">{searchError}</p>}

          <div className="mt-3 border border-[#E5E5E5] rounded-lg divide-y divide-[#E5E5E5] max-h-[360px] overflow-y-auto">
            {searching && repos.length === 0 && <p className="px-4 py-3 text-sm text-[#9A9A9A]">Searching…</p>}
            {!searching && repos.length === 0 && !searchError && (
              <p className="px-4 py-3 text-sm text-[#9A9A9A]">
                {query ? `No repository matching “${query}”.` : "No repositories visible to this login."}
              </p>
            )}
            {repos.map((repo) => {
              const isSelected = selected?.fullName === repo.fullName;
              return (
                <button
                  key={repo.fullName}
                  onClick={() => chooseRepo(repo)}
                  className={`w-full text-left px-4 py-2.5 ${isSelected ? "bg-[#EDECE8]" : "hover:bg-[#fafafa]"}`}
                >
                  <span className="text-sm font-medium text-[#1A1A1A]">{repo.fullName}</span>
                  <span className="ml-2 text-[10px] text-[#9A9A9A]">
                    {repo.private ? "private" : "public"}
                    {repo.language ? ` · ${repo.language}` : ""} · updated {relativeTime(repo.updatedAt)}
                    {repo.archived ? " · archived" : ""}
                  </span>
                  {repo.description && (
                    <span className="block text-xs text-[#6B6B6B] truncate">{repo.description}</span>
                  )}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* 4 — branch + mode + go */}
      {connected && selected && store && (
        <section className="bg-white border border-[#E5E5E5] rounded-lg px-5 py-4">
          <h2 className="text-lg font-semibold text-[#000000] tracking-tight">
            Connect {selected.fullName} to {store.name}
          </h2>

          <label className="block mt-3 text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-wider">Branch</label>
          <select
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            className="mt-1 w-full border border-[#E5E5E5] rounded-lg px-3 py-2 text-sm bg-white"
          >
            {branches.map((b) => (
              <option key={b} value={b}>
                {b}
                {b === selected.defaultBranch ? " (default)" : ""}
              </option>
            ))}
          </select>

          <p className="mt-4 text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-wider">How audits read it</p>
          <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
            <button
              onClick={() => setMode("read")}
              className={`text-left border rounded-lg px-4 py-3 ${
                mode === "read" ? "border-[#1A1A1A] bg-[#fafafa]" : "border-[#E5E5E5] hover:bg-[#fafafa]"
              }`}
            >
              <span className="block text-sm font-semibold text-[#1A1A1A]">Read it from GitHub each run</span>
              <span className="block mt-1 text-xs text-[#6B6B6B] leading-relaxed">
                Every audit downloads this branch as it is at that moment, reads it, and deletes it. No copy of
                the client&apos;s code is left on anyone&apos;s machine. Works from here, with nothing installed.
              </span>
            </button>
            <button
              onClick={() => setMode("pull")}
              className={`text-left border rounded-lg px-4 py-3 ${
                mode === "pull" ? "border-[#1A1A1A] bg-[#fafafa]" : "border-[#E5E5E5] hover:bg-[#fafafa]"
              }`}
            >
              <span className="block text-sm font-semibold text-[#1A1A1A]">Pull a copy to my machine</span>
              <span className="block mt-1 text-xs text-[#6B6B6B] leading-relaxed">
                Clones once into <code className="font-mono">stores/{store.slug}/theme/</code>. Later audits read
                that snapshot until it&apos;s pulled again. Needs the local agent running.
              </span>
            </button>
          </div>

          {mode === "pull" && (
            <div className="mt-3 bg-[#fafafa] border border-[#E5E5E5] rounded-lg px-4 py-3">
              {agent.detected ? (
                <p className="text-sm text-[#10B981]">
                  Local agent detected on port {agent.port}
                  {agent.token ? "." : " — paste the token it printed to authorise the pull."}
                </p>
              ) : (
                <p className="text-sm text-[#D97706]">
                  No local agent on port {agent.port}. Run{" "}
                  <code className="bg-white border border-[#E5E5E5] px-1 rounded font-mono text-xs">barrel-audit serve</code>{" "}
                  and paste its token, or connect in read mode instead.
                </p>
              )}
              <div className="mt-2 flex flex-wrap gap-2">
                <input
                  value={agent.port}
                  onChange={(e) => agent.savePort(e.target.value.replace(/\D/g, "") || DEFAULT_AGENT_PORT)}
                  className="w-24 border border-[#E5E5E5] rounded-lg px-2 py-1.5 text-sm font-mono"
                  aria-label="Local agent port"
                />
                <input
                  value={agent.token}
                  onChange={(e) => agent.saveToken(e.target.value.trim())}
                  placeholder="Agent token"
                  className="flex-1 min-w-[200px] border border-[#E5E5E5] rounded-lg px-2 py-1.5 text-sm font-mono"
                />
                <button
                  onClick={agent.recheck}
                  className="text-sm border border-[#E5E5E5] rounded-lg px-3 py-1.5 text-[#6B6B6B] hover:text-[#1A1A1A]"
                >
                  Re-check
                </button>
              </div>
            </div>
          )}

          <button
            onClick={connectRepo}
            disabled={linking}
            className="mt-4 bg-[#1A1A1A] text-white text-sm font-semibold rounded-lg px-4 py-2 hover:bg-black disabled:opacity-50"
          >
            {linking ? "Connecting…" : mode === "read" ? "Connect (read-only)" : "Connect and pull"}
          </button>

          <p className="mt-2 text-xs text-[#9A9A9A]">
            Same thing from a terminal:{" "}
            <code className="bg-[#fafafa] px-1 rounded font-mono">
              barrel-audit link-repo {store.slug} --repo {selected.fullName} --branch {branch} --mode {mode}
            </code>
          </p>
        </section>
      )}

      {result && (
        <section
          className={`border rounded-lg px-5 py-4 ${
            result.ok ? "bg-white border-[#10B981]" : "bg-white border-[#B91C1C]"
          }`}
        >
          <p className={`text-sm font-semibold ${result.ok ? "text-[#10B981]" : "text-[#B91C1C]"}`}>
            {result.ok ? "Connected" : "Not connected"}
          </p>
          <p className="mt-1 text-sm text-[#1A1A1A] max-w-[80ch]">{result.message}</p>
          {result.warning && <p className="mt-2 text-sm text-[#D97706] max-w-[80ch]">{result.warning}</p>}
          {result.ok && (
            <p className="mt-2 text-sm text-[#6B6B6B]">
              Next: run an audit for {store?.name ?? "this store"} and the Theme Code, Theme Structure and Theme
              Architecture sections will be included.
            </p>
          )}
          {pullLog && (
            <details className="mt-3">
              <summary className="text-xs text-[#6B6B6B] cursor-pointer">Pull output</summary>
              <pre className="mt-2 bg-[#fafafa] border border-[#E5E5E5] rounded-lg p-3 text-xs overflow-x-auto whitespace-pre-wrap">
                {pullLog.replace(/__BARREL_PULL_DONE__-?\d+__/g, "").trim()}
              </pre>
            </details>
          )}
        </section>
      )}
    </div>
  );
}
