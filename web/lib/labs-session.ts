/**
 * Barrel Labs SSO — the cookie-store side.
 *
 * Split from `lib/labs-auth.ts` because this imports `next/headers`, which `middleware.ts` cannot.
 * Server components and route handlers should read the user from here.
 */
import { cookies } from "next/headers";

import {
  LABS_COOKIE_NAME,
  SESSION_TTL_SECONDS,
  signSessionCookie,
  verifySessionCookie,
  type LabsSession,
} from "@/lib/labs-auth";

/** The signed-in user, or null. Safe to call from any server component or route handler. */
export async function getLabsSession(): Promise<LabsSession | null> {
  return verifySessionCookie((await cookies()).get(LABS_COOKIE_NAME)?.value);
}

/** True only for a Barrel Labs admin. Anything else — including no session — is false. */
export async function isLabsAdmin(): Promise<boolean> {
  return (await getLabsSession())?.role === "admin";
}

export async function startSession(session: LabsSession): Promise<void> {
  (await cookies()).set(LABS_COOKIE_NAME, await signSessionCookie(session), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function endSession(): Promise<void> {
  (await cookies()).delete(LABS_COOKIE_NAME);
}
