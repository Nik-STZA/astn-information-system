import { redirect } from "next/navigation";

/**
 * Root path - IAP authenticated the user at the edge; send them to the
 * overview.
 */
export default function RootPage() {
  redirect("/overview");
}
