import { AdminsOnlyScreen } from "@/components/AdminsOnly";

export const dynamic = "force-dynamic";

/** Rendered in place of an admin-only route, at that route's own URL — middleware rewrites rather
 * than redirects, so the address bar still shows where the person was trying to go. */
export default function AdminsOnlyPage() {
  return <AdminsOnlyScreen what="Privacy Compliance" />;
}
