import { NextResponse } from "next/server";
import { LABS_URL } from "@/lib/labs-auth";
import { endSession } from "@/lib/labs-session";

/** Drops this app's session and returns the person to the Barrel Labs hub.
 *
 * It deliberately does not sign them out of Labs — that session belongs to every Barrel tool, not
 * just this one. Landing on the hub rather than back here also avoids the confusing round trip
 * where signing out redirects straight into a silent, successful re-authorization. */
export async function POST() {
  await endSession();
  return NextResponse.redirect(LABS_URL, { status: 303 });
}
