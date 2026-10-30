import { NextResponse, type NextRequest } from "next/server";
import { isSameSite } from "@/shared/lib/request-origin";

/**
 * Middleware for the AfricanSTN information system.
 *
 * Authentication happens at the edge: the app is served exclusively through a
 * load balancer with Identity-Aware Proxy. IAP authenticates the user
 * (Google login) and enforces the allowlist via IAM before a request ever
 * reaches the app, asserting the identity in x-goog-authenticated-user-email.
 *
 * This middleware requires that assertion as defence in depth — direct hits
 * on the .run.app URL are already blocked by the service's ingress settings,
 * but a missing header must never fall through to an open page.
 *
 * IAP cannot tell a person's click from a request another site made with
 * their cookie, so changes must also come from our own pages.
 */
export async function middleware(req: NextRequest) {
  const assertion = req.headers.get("x-goog-authenticated-user-email");
  if (!assertion) {
    return new NextResponse("Forbidden — this app is served via IAP.", { status: 403 });
  }
  if (!isSameSite(req.method, req.headers)) {
    return new NextResponse("Forbidden — this request did not come from this site.", { status: 403 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|logos).*)"],
};
