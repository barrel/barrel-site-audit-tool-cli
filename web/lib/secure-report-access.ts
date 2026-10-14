import { cookies } from "next/headers";
import { getShare, isLive, secureReportCookieName, verifyUnlockCookie, type ConsentShareRecord } from "@/lib/consent-share";

/** The link's record if — and only if — it is live and this browser has unlocked it. Every page and
 * asset route behind a secure link goes through this one check, so a new route cannot forget it. */
export async function getUnlockedShare(id: string): Promise<ConsentShareRecord | null> {
  const record = await getShare(id);
  if (!isLive(record)) return null;
  const value = (await cookies()).get(secureReportCookieName(id))?.value;
  return verifyUnlockCookie(record, value) ? record : null;
}
