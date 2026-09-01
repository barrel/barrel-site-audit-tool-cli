"use client";

/**
 * THE BARREL LABS UTILITY NAV — the standard top bar for every Labs app.
 *
 * Copy to src/components/labs-nav.tsx. No dependencies beyond React.
 *
 * Three jobs, and only these three:
 *   1. say who is signed in           — avatar, address, role and clearance
 *   2. get you to another stable tool — the switcher, straight from the token
 *   3. get you out                    — EJECT, which really does sign you out
 *
 * The BARREL LABS lockup on the left is a LABEL, not a link. It says whose app
 * this is and stops there. It used to go to Labs' dispatch, which was the wrong
 * call: a lockup in the top left corner reads as "home of the thing I am using"
 * in every app anybody has ever used, so clicking it threw people out of the
 * tool they were working in. The two exits are explicit instead — TOOLS for the
 * hub, `appLogo` for the app's own front page — and neither is disguised as the
 * other.
 *
 * It is NOT your app's navigation. Anything app-specific goes in `children`,
 * which renders to the left of the utility cluster, or in a second bar of your
 * own underneath. Keeping this bar identical everywhere is the entire point:
 * someone moving between four Barrel tools should never have to hunt for their
 * own account or the way back to the hub.
 *
 * The one piece of app identity the bar itself carries is `appLogo`: the app's
 * own mark, in the far right corner, linking to the app's own home. The Labs
 * lockup on the left goes to Labs and the TOOLS menu is the way back to the
 * hub, so the corner is free for "take me to the front page of the thing I am
 * actually using" — which is what people reach for a logo expecting. The mark
 * has to read against `--color-panel`, so an app with a dark palette should
 * pass a mark that works on it.
 *
 * STYLING — read before you restyle it. Every colour is written as
 * `var(--color-x, <design-system literal>)`. An app that defines the Barrel
 * design-system tokens gets its own values (so Labs' dark mode drags this bar
 * dark along with everything else, for free); an app that defines nothing gets
 * the design system's light palette hardcoded. That is why the CSS is inline
 * and self-contained rather than Tailwind: this file has to look right dropped
 * into an app whose styling you have never seen.
 *
 * There is deliberately no theme toggle. Labs' dark mode is Labs' house style
 * and most Barrel apps define no dark palette at all — a toggle here would
 * flip those apps to a set of tokens that doesn't exist.
 *
 * Usage, from a server component (usually the root layout):
 *
 *   import { getLabsSession, labsOrigin } from "@/lib/labs-auth";
 *   import { LabsNav } from "@/components/labs-nav";
 *
 *   const session = await getLabsSession();
 *   ...
 *   {session && (
 *     <LabsNav
 *       session={session}
 *       appName="QA Swarm"
 *       labsUrl={labsOrigin()}
 *       currentSlug={process.env.LABS_APP_SLUG}
 *       appLogo={{ src: "/qa-swarm-mark.png", href: "/", alt: "QA Swarm home" }}
 *     />
 *   )}
 */

import { useEffect, useRef, useState } from "react";

import type { LabsSession } from "@/lib/labs-auth";

const CSS = `
.bln{position:relative;z-index:50;display:flex;height:73px;align-items:center;gap:16px;
  border-bottom:1px solid var(--color-line,#e5e5e5);
  background:var(--color-panel,#ffffff);
  padding:0 20px;font-family:var(--font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);
  color:var(--color-ink,#1a1a1a);box-sizing:border-box}
@media(min-width:1024px){.bln{padding:0 32px}}
.bln *{box-sizing:border-box}
/* No blanket colour here: .bln a is class+element and would out-specify every
   single-class link rule below, quietly greying out the green ones. */
.bln a{text-decoration:none}

/* A label, not a link: no hover, no pointer, nothing that offers to navigate.
   The padding and the negative margin stay so the wordmark still lines up with
   the page content below it. */
.bln-lockup{color:inherit;display:flex;align-items:center;gap:10px;padding:4px 6px;margin-left:-6px}
.bln-mark{height:24px;width:auto;color:var(--color-phosphor,#15803d);flex-shrink:0}
.bln-names{display:flex;flex-direction:column;line-height:1;min-width:0}
.bln-wordmark{font-size:14px;font-weight:600;letter-spacing:-.01em;color:var(--color-ink,#1a1a1a)}
.bln-appname{margin-top:5px;font-size:9px;letter-spacing:.24em;
  color:var(--color-ink-3,#717171);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

.bln-slot{display:flex;align-items:center;gap:4px;min-width:0}
.bln-right{margin-left:auto;display:flex;align-items:center;gap:8px}

.bln-btn{display:inline-flex;align-items:center;gap:6px;border-radius:8px;
  border:1px solid var(--color-line-bright,#d4d4d4);background:transparent;
  padding:7px 11px;font:inherit;font-size:10px;font-weight:600;letter-spacing:.08em;
  color:var(--color-ink-2,#6b6b6b);cursor:pointer;transition:color .12s ease,border-color .12s ease}
.bln-btn:hover{color:var(--color-phosphor,#15803d);border-color:var(--color-phosphor,#15803d)}
.bln-btn[aria-expanded=true]{color:var(--color-phosphor,#15803d);border-color:var(--color-phosphor,#15803d)}
.bln-eject:hover{color:var(--color-danger,#b91c1c);border-color:var(--color-danger,#b91c1c)}
.bln-caret{font-size:8px;line-height:1;opacity:.8}
.bln-diamond{color:var(--color-phosphor,#15803d);font-size:9px;line-height:1}

.bln-who{display:flex;align-items:center;gap:9px;min-width:0}
.bln-avatar{height:28px;width:28px;flex-shrink:0;border-radius:999px;object-fit:cover;
  border:1px solid var(--color-line-bright,#d4d4d4);background:var(--color-panel-2,#fafafa)}
.bln-initials{display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:600;
  color:var(--color-ink-2,#6b6b6b)}
.bln-id{display:flex;flex-direction:column;line-height:1;text-align:right;min-width:0}
.bln-email{font-size:11px;color:var(--color-ink-2,#6b6b6b);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:30ch}
.bln-rank{margin-top:4px;font-size:9px;letter-spacing:.08em;color:var(--color-phosphor-dim,#2f7d4f)}
.bln-rule{width:1px;height:24px;background:var(--color-line,#e5e5e5);margin:0 4px}

.bln-applogo{display:flex;align-items:center;border-radius:6px;padding:4px;margin-right:-4px;
  transition:background-color .12s ease}
.bln-applogo:hover{background:var(--color-hover,rgba(0,0,0,.04))}
.bln-applogo img{width:auto;display:block}

.bln-menu-wrap{position:relative}
.bln-menu{position:absolute;top:calc(100% + 8px);right:0;width:268px;
  border:1px solid var(--color-line,#e5e5e5);border-radius:8px;
  background:var(--color-panel,#ffffff);padding:6px;
  box-shadow:0 12px 28px -12px rgba(0,0,0,.35);max-height:70vh;overflow-y:auto}
.bln-menu-label{padding:8px 10px 6px;font-size:9px;font-weight:600;letter-spacing:.24em;
  color:var(--color-ink-muted,#727272)}
.bln-item{display:flex;align-items:center;gap:9px;border-radius:6px;padding:9px 10px;
  font-size:12.5px;color:var(--color-ink,#1a1a1a);transition:background-color .12s ease}
.bln-item:hover{background:var(--color-hover,rgba(0,0,0,.04))}
.bln-item-here{color:var(--color-ink-3,#717171)}
.bln-item-here:hover{background:transparent}
.bln-here-tag{margin-left:auto;font-size:8.5px;font-weight:600;letter-spacing:.14em;
  color:var(--color-phosphor-dim,#2f7d4f)}
.bln-empty{padding:10px;font-size:12px;line-height:1.5;color:var(--color-ink-3,#717171)}
.bln-menu-foot{margin-top:6px;border-top:1px solid var(--color-line,#e5e5e5);padding-top:6px}
.bln-foot-link{display:block;border-radius:6px;padding:9px 10px;font-size:10px;font-weight:600;
  letter-spacing:.08em;color:var(--color-phosphor,#15803d);transition:background-color .12s ease}
.bln-foot-link:hover{background:var(--color-hover,rgba(0,0,0,.04))}

@media(max-width:767px){
  .bln-id,.bln-appname,.bln-rule,.bln-btn-text{display:none}
  .bln-btn{padding:7px 9px}
  /* The app mark stays: on a phone it is the only way home that survives the
     collapse, and it costs less width than anything it sits beside. */
}
@media(prefers-reduced-motion:reduce){.bln *{transition:none!important}}
`;

/** The compact barrel, flattened to a literal path so this file stays standalone. */
function BarrelMark() {
  return (
    <svg className="bln-mark" viewBox="0 0 120 160" fill="none" aria-hidden="true">
      <path
        d="M 26,14 L 26.0,14.0 L 22.3,27.2 L 18.9,40.4 L 16.3,53.6 L 14.6,66.8 L 14.0,80.0 L 14.6,93.2 L 16.3,106.4 L 18.9,119.6 L 22.3,132.8 L 26.0,146.0 L 94,146 L 94.0,146.0 L 97.7,132.8 L 101.1,119.6 L 103.7,106.4 L 105.4,93.2 L 106.0,80.0 L 105.4,66.8 L 103.7,53.6 L 101.1,40.4 L 97.7,27.2 L 94.0,14.0 Z"
        stroke="currentColor"
        strokeWidth="7"
        strokeLinejoin="round"
      />
      <line x1="14.57" y1="52" x2="105.43" y2="52" stroke="currentColor" strokeWidth="7" />
      <line x1="14.57" y1="108" x2="105.43" y2="108" stroke="currentColor" strokeWidth="7" />
    </svg>
  );
}

function initials(session: LabsSession): string {
  const source = session.name?.trim() || session.email;
  const parts = source.split(/[\s.@_-]+/).filter(Boolean);
  return (parts[0]?.[0] ?? "?").concat(parts[1]?.[0] ?? "").toUpperCase();
}

function Avatar({ session }: { session: LabsSession }) {
  const [broken, setBroken] = useState(false);

  if (!session.picture || broken) {
    return (
      <span className="bln-avatar bln-initials" aria-hidden="true">
        {initials(session)}
      </span>
    );
  }

  // A Google avatar URL, which can 403 once the referrer policy changes under
  // us — fall back to initials rather than a broken-image glyph.
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="bln-avatar"
      src={session.picture}
      alt=""
      referrerPolicy="no-referrer"
      onError={() => setBroken(true)}
    />
  );
}

/** The switcher. Entries come from the token; every one goes through /go. */
function ToolSwitcher({
  session,
  labsUrl,
  currentSlug,
}: {
  session: LabsSession;
  labsUrl: string;
  currentSlug?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    // pointerdown, not click: a click listener closes the menu before the
    // browser has followed the link the user actually pressed.
    const onPointer = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };

    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  const others = session.tools.filter((t) => t.slug !== currentSlug);

  return (
    <div className="bln-menu-wrap" ref={wrap}>
      <button
        type="button"
        className="bln-btn"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="bln-diamond" aria-hidden="true">
          ◆
        </span>
        <span className="bln-btn-text">TOOLS</span>
        <span className="bln-caret" aria-hidden="true">
          ▼
        </span>
      </button>

      {open && (
        <div className="bln-menu" role="menu" aria-label="Barrel Labs tools">
          <p className="bln-menu-label">IN SERVICE</p>

          {others.length === 0 && session.tools.length === 0 && (
            <p className="bln-empty">
              Nothing else is in service for you yet. The lab floor has the
              experiments.
            </p>
          )}

          {session.tools.map((tool) =>
            tool.slug === currentSlug ? (
              <span key={tool.slug} className="bln-item bln-item-here" role="menuitem">
                {tool.name}
                <span className="bln-here-tag">YOU ARE HERE</span>
              </span>
            ) : (
              // Straight to Labs' deeplink, never to the tool's own URL: /go
              // re-checks access and writes the audit row. This menu is a
              // shortcut, not a decision.
              <a
                key={tool.slug}
                className="bln-item"
                role="menuitem"
                href={`${labsUrl}/go/${tool.slug}`}
              >
                {tool.name}
              </a>
            ),
          )}

          <div className="bln-menu-foot">
            <a className="bln-foot-link" role="menuitem" href={`${labsUrl}/dispatch`}>
              ALL TOOLS & EXPERIMENTS ▸
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

export type AppLogo = {
  /** Anything this app serves — e.g. `/commerce-care-mark.png`. */
  src: string;
  /** Where it goes: the app's own home. */
  href: string;
  /** Accessible name. It is a link, so say where it leads. */
  alt: string;
  /** Rendered height in px. Default 28; raise it for a mark with padding. */
  height?: number;
};

export function LabsNav({
  session,
  appName,
  labsUrl = "https://barrel-labs.vercel.app",
  currentSlug,
  signOutPath = "/api/labs-auth/signout",
  appLogo,
  children,
}: {
  session: LabsSession;
  /** This app's name, under the BARREL LABS wordmark. */
  appName?: string;
  /** Labs origin. Pass `labsOrigin()` from the server — LABS_URL isn't public. */
  labsUrl?: string;
  /** This app's Labs slug, so the switcher can mark where you already are. */
  currentSlug?: string;
  /** Where EJECT posts. Only change this if you moved the signout route. */
  signOutPath?: string;
  /** This app's own mark, far right, linking to the app's own home. */
  appLogo?: AppLogo;
  /** App-specific nav, rendered left of the utility cluster. */
  children?: React.ReactNode;
}) {
  const origin = labsUrl.replace(/\/$/, "");

  return (
    <header className="bln">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      {/* Provenance, not navigation. See the note at the top of the file: a
          corner lockup that leaves the app is a trap, however sensible the
          destination. The way back to Labs is the TOOLS menu, and the way to
          this app's own home is `appLogo`. */}
      <div className="bln-lockup">
        <BarrelMark />
        <span className="bln-names">
          <span className="bln-wordmark">BARREL LABS</span>
          {appName && <span className="bln-appname">{appName.toUpperCase()}</span>}
        </span>
      </div>

      {children && <div className="bln-slot">{children}</div>}

      <div className="bln-right">
        <ToolSwitcher session={session} labsUrl={origin} currentSlug={currentSlug} />

        <span className="bln-rule" aria-hidden="true" />

        <div className="bln-who">
          <Avatar session={session} />
          <span className="bln-id">
            <span className="bln-email">{session.email}</span>
            <span className="bln-rank">
              {session.role.toUpperCase()} · CLEARANCE L{session.clearance}
            </span>
          </span>
        </div>

        {/* A form POST, not a link: sign-out changes state, and a GET here
            would let another site log a Barrel user out with an <img> tag. */}
        <form method="post" action={signOutPath}>
          <button type="submit" className="bln-btn bln-eject">
            EJECT
          </button>
        </form>

        {/* The app's own mark terminates the bar. A plain <img>, not
            next/image: this file has to survive being copied into an app whose
            framework you have never seen. */}
        {appLogo && (
          <>
            <span className="bln-rule" aria-hidden="true" />
            <a className="bln-applogo" href={appLogo.href} title={appLogo.alt}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={appLogo.src}
                alt={appLogo.alt}
                style={{ height: appLogo.height ?? 28 }}
              />
            </a>
          </>
        )}
      </div>
    </header>
  );
}
