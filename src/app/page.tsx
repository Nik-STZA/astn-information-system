import { redirect } from "next/navigation";

/**
 * Root path - the middleware will catch this for unauthenticated users
 * and redirect to /login. For authenticated users on the allowlist,
 * the middleware lets it through and we redirect to /overview.
 */
export default function RootPage() {
  redirect("/overview");
}
