// Platform costs moved to Admin (28 Oct 2026); old links land there.
import { redirect } from "next/navigation";

export default function Page() {
  redirect("/admin/costs");
}
