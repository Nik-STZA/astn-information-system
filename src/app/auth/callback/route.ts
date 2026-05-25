import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { isAllowed } from "@/lib/allowlist";

/**
 * OAuth callback handler.
 *
 * Flow:
 *   1. User signs in with Google via Supabase Auth
 *   2. Google redirects to Supabase callback with an authorisation code
 *   3. Supabase exchanges the code for a session
 *   4. Supabase redirects here with the session cookie set
 *   5. This handler checks the user's email against the allowlist
 *   6. On success, redirects to /overview
 *   7. On allowlist failure, redirects to /blocked
 */
export async function GET(req: NextRequest) {
  const requestUrl = new URL(req.url);
  const code = requestUrl.searchParams.get("code");

  if (code) {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.exchangeCodeForSession(code);
  }

  // Check the resulting session against the allowlist
  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  if (!isAllowed(session.user.email)) {
    // Sign out the unauthorised user so they cannot retry from the session
    await supabase.auth.signOut();
    return NextResponse.redirect(new URL("/blocked", req.url));
  }

  return NextResponse.redirect(new URL("/overview", req.url));
}
