import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { isAllowed } from "@/lib/allowlist";

/**
 * Middleware for the AfricanSTN information system.
 *
 * Responsibilities:
 *   1. Refresh the Supabase session on every request
 *   2. Redirect unauthenticated users to the login page
 *   3. Redirect authenticated-but-not-allowed users to a polite block page
 *   4. Pass through the auth callback and static asset requests
 */
export async function middleware(req: NextRequest) {
  let res = NextResponse.next({ request: req });

  // IAP mode (Cloud Run behind the load balancer): authentication happened at
  // the edge. Require the IAP assertion header as defence in depth — direct
  // hits on the .run.app URL are already blocked by ingress settings, but a
  // missing header should never fall through to an open page.
  if (process.env.AUTH_MODE === "iap") {
    const assertion = req.headers.get("x-goog-authenticated-user-email");
    if (!assertion) {
      return new NextResponse("Forbidden — this app is served via IAP.", { status: 403 });
    }
    return res;
  }

  // Pass through public routes
  const publicPaths = ["/login", "/auth", "/blocked", "/_next", "/logos", "/favicon"];
  if (publicPaths.some((p) => req.nextUrl.pathname.startsWith(p))) {
    return res;
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }) => req.cookies.set(name, value));
          res = NextResponse.next({ request: req });
          cookiesToSet.forEach(({ name, value, options }) =>
            res.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  if (!isAllowed(user.email)) {
    return NextResponse.redirect(new URL("/blocked", req.url));
  }

  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|logos).*)"],
};
