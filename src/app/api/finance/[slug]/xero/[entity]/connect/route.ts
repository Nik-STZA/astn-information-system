// Starts the Xero authorisation. Generates a CSRF nonce, stores it in an
// httpOnly cookie, and sends the browser to Xero.

import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { getIapEmail } from "@/lib/auth";
import {
  buildAuthorizeUrl,
  encodeState,
  XERO_STATE_COOKIE,
} from "@/modules/finance/lib/xero-connect";

export const dynamic = "force-dynamic";

function redirectUri(req: NextRequest): string {
  // Must match the URI registered on the Xero app exactly.
  const configured = process.env.XERO_REDIRECT_URI;
  if (configured) return configured;
  return new URL("/api/finance/xero/callback", req.nextUrl.origin).toString();
}

export async function GET(
  req: NextRequest,
  { params }: { params: { slug: string; entity: string } }
) {
  if (!getIapEmail()) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 403 });
  }

  const nonce = randomBytes(24).toString("base64url");
  const state = encodeState({ nonce, slug: params.slug, entity: params.entity });

  let url: string;
  try {
    url = await buildAuthorizeUrl(state, redirectUri(req));
  } catch (e) {
    const message = e instanceof Error ? e.message : "could not start authorisation";
    return NextResponse.redirect(
      new URL(
        `/finance/clients/${params.slug}/xero?error=${encodeURIComponent(message)}`,
        req.nextUrl.origin
      )
    );
  }

  const res = NextResponse.redirect(url);
  // The nonce is what proves the callback belongs to this request. Short lived,
  // httpOnly, and not readable by page scripts.
  res.cookies.set(XERO_STATE_COOKIE, nonce, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return res;
}
