import { redirect } from "next/navigation";

// The old Engagements page listed data protection clients on their own. The
// client master (/clients/all) lists every client, and each one's data
// protection records open from its section in the sidebar (28 Oct 2026).
export default function ClientsPage() {
  redirect("/clients/all");
}
