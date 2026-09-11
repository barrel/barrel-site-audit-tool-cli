import { NextResponse } from "next/server";
import { endGithubSession, getGithubSession } from "@/lib/github-session";
import { NotConnectedError, githubOrgs } from "@/lib/github";

export const dynamic = "force-dynamic";

/** Whether this browser is connected to GitHub, and as whom.
 *
 * Also returns the orgs that login can see, because the picker needs them the moment it renders
 * and a second round trip for a list of five strings is a wasted one. */
export async function GET() {
  const session = await getGithubSession();
  if (!session) return NextResponse.json({ connected: false });

  try {
    const orgs = await githubOrgs();
    return NextResponse.json({ connected: true, login: session.login, orgs });
  } catch (err: unknown) {
    // A cookie that decrypts fine but whose token GitHub no longer accepts (revoked, or the OAuth
    // app's grant withdrawn) is not a connection. Say so, and clear it, rather than letting every
    // later search fail with the same 401 behind a UI that claims to be connected.
    if (err instanceof NotConnectedError) return NextResponse.json({ connected: false });
    await endGithubSession();
    return NextResponse.json({
      connected: false,
      error: `That GitHub connection is no longer valid (${String((err as Error)?.message ?? err)}). Connect again.`,
    });
  }
}

/** Disconnect. Drops this app's cookie only — it does not revoke the OAuth grant on GitHub, which
 * is the user's own to revoke at github.com/settings/applications. */
export async function DELETE() {
  await endGithubSession();
  return NextResponse.json({ connected: false });
}
