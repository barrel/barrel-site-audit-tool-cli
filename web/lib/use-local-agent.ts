"use client";

import { useCallback, useEffect, useState } from "react";

const AGENT_PORT_KEY = "barrel-audit-agent-port";
const AGENT_TOKEN_KEY = "barrel-audit-agent-token";
const DEFAULT_PORT = "5757";

/** Detects and talks to the local `barrel-audit serve` agent — a small HTTP server bound to
 * 127.0.0.1 on the user's own machine. The browser reaches it directly (never through Vercel)
 * regardless of which origin this page was loaded from, which is what lets "Run audit" (and the
 * Dev To-Do "Suggest fix" flow) work from the deployed dashboard, not just a locally-running
 * copy of this app. Shared across every feature that needs the agent, so a token pasted once
 * works everywhere. */
export function useLocalAgent() {
  const [port, setPort] = useState(DEFAULT_PORT);
  const [token, setToken] = useState("");
  const [detected, setDetected] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    setPort(localStorage.getItem(AGENT_PORT_KEY) ?? DEFAULT_PORT);
    setToken(localStorage.getItem(AGENT_TOKEN_KEY) ?? "");
  }, []);

  const check = useCallback(async (p: string) => {
    setChecking(true);
    try {
      const res = await fetch(`http://127.0.0.1:${p}/health`, { signal: AbortSignal.timeout(1500) });
      setDetected(res.ok);
    } catch {
      setDetected(false);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    check(port);
  }, [port, check]);

  function savePort(p: string) {
    setPort(p);
    localStorage.setItem(AGENT_PORT_KEY, p);
  }

  function saveToken(t: string) {
    setToken(t);
    localStorage.setItem(AGENT_TOKEN_KEY, t);
  }

  function clearToken() {
    saveToken("");
  }

  return { port, token, detected, checking, savePort, saveToken, clearToken, check, recheck: () => check(port) };
}

export const DEFAULT_AGENT_PORT = DEFAULT_PORT;
