// Receives the redirect back from Xero, checks the request is one we started,
// and hands the code to the module to exchange.

import { NextResponse, type NextRequest } from "next/server";
import { getIapEmail } from "@/lib/auth";
import { clientIpFrom, publicOrigin } from "@/shared/lib/request-origin";
import {
  completeConnection,
  decodeState,
  XERO_STATE_COOKIE,
} from "@/modules/finance/lib/xero-connect";

export const dynamic = "force-dynamic";

function back(origin: string, slug: string, params: Record<string, string>) {
  const url = new URL(`/finance/clients/${slug}/xero`, origin);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = NextResponse.redirect(url);
  res.cookies.delete(XERO_STATE_COOKIE);
  return res;
}

export async function GET(req: NextRequest) {
  const actorEmail = getIapEmail();
  if (!actorEmail) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 403 });
  }

  // Behind the load balancer the request origin is the container's own
  // address, so a redirect built from it is unreachable from a browser.
  const origin = publicOrigin(req.headers, req.nextUrl.origin);
  const code = req.nextUrl.searchParams.get("code");
  const rawState = req.nextUrl.searchParams.get("state");
  const xeroError = req.nextUrl.searchParams.get("error");

  const state = rawState ? decodeState(rawState) : null;
  const slug = state?.slug ?? "";

  // Xero declined, usually because consent was cancelled.
  if (xeroError) {
    return slug
      ? back(origin, slug, { error: xeroError })
      : NextResponse.redirect(new URL("/finance/overview", origin));
  }

  if (!code || !state) {
    return NextResponse.redirect(new URL("/finance/overview", origin));
  }

  // The nonce must match the cookie set when we started, or this callback did
  // not originate from a request we made.
  const expected = req.cookies.get(XERO_STATE_COOKIE)?.value;
  if (!expected || expected !== state.nonce) {
    return back(origin, slug, { error: "Authorisation could not be verified. Please try again." });
  }

  const redirectUri =
    process.env.XERO_REDIRECT_URI ??
    new URL("/api/finance/xero/callback", origin).toString();

  const result = await completeConnection({
    slug: state.slug,
    entity: state.entity,
    code,
    redirectUri,
    actorEmail,
    ip: clientIpFrom(req.headers.get("x-forwarded-for")) ?? undefined,
  });

  return result.ok
    ? back(origin, slug, { connected: result.tenantName ?? state.entity })
    : back(origin, slug, { error: result.error ?? "Connection failed" });
}
