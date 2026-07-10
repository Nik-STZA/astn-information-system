"use client";

import Image from "next/image";
import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

/**
 * Login screen — reskinned July 2026 to match designer deliverable.
 *
 * Dark ambient background with gold-tinted radial glows and a subtle grid.
 * Centred glassmorphic card with brand lockup, Google sign-in, and footer.
 * Full "African Sports Technology Network" name appears here (brand rule).
 */

const GoogleLogo = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 48 48"
    aria-hidden="true"
    style={{ flexShrink: 0 }}
  >
    <path
      fill="#EA4335"
      d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
    />
    <path
      fill="#4285F4"
      d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
    />
    <path
      fill="#FBBC05"
      d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
    />
    <path
      fill="#34A853"
      d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
    />
  </svg>
);

export default function LoginPage() {
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSignIn() {
    setSigningIn(true);
    setError(null);
    const supabase = createSupabaseBrowserClient();
    const { error: authError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (authError) {
      setError(authError.message);
      setSigningIn(false);
    }
  }

  return (
    <div
      style={{
        position: "relative",
        minHeight: "100vh",
        width: "100%",
        background: "#0B0B0B",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        fontFamily: "Manrope, sans-serif",
      }}
    >
      {/* Ambient background: radial glows + grid */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: [
            "radial-gradient(circle at 22% 28%, rgba(198,162,78,.10), transparent 42%)",
            "radial-gradient(circle at 82% 74%, rgba(198,162,78,.07), transparent 45%)",
            "repeating-linear-gradient(0deg, rgba(198,162,78,.035) 0 1px, transparent 1px 46px)",
            "repeating-linear-gradient(90deg, rgba(198,162,78,.035) 0 1px, transparent 1px 46px)",
          ].join(","),
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(ellipse at 50% 42%, transparent 30%, rgba(11,11,11,.72) 78%)",
        }}
      />

      {/* Card */}
      <div
        style={{
          position: "relative",
          width: 400,
          maxWidth: "calc(100vw - 40px)",
          background:
            "linear-gradient(180deg, rgba(26,26,26,.92), rgba(17,17,17,.94))",
          border: "1px solid rgba(198,162,78,.28)",
          borderRadius: 16,
          padding: "44px 40px 30px",
          boxShadow:
            "0 30px 80px -20px rgba(0,0,0,.8), 0 0 0 1px rgba(255,255,255,.02) inset",
        }}
      >
        {/* Brand lockup */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            textAlign: "center",
          }}
        >
          <Image
            src="/logos/stza-logo-white.png"
            alt="STZA"
            width={120}
            height={30}
            style={{ height: 30, width: "auto", marginBottom: 22 }}
            priority
          />

          {/* Gold separator */}
          <div
            style={{
              width: 44,
              height: 1,
              background:
                "linear-gradient(90deg, transparent, rgba(198,162,78,.6), transparent)",
              marginBottom: 22,
            }}
          />

          <div
            style={{
              fontWeight: 700,
              fontSize: 10,
              lineHeight: 1,
              letterSpacing: "0.26em",
              textTransform: "uppercase",
              color: "#C6A24E",
              marginBottom: 12,
            }}
          >
            Information system
          </div>

          <h1
            style={{
              fontWeight: 700,
              fontSize: 22,
              lineHeight: 1.25,
              letterSpacing: "-0.01em",
              color: "#F4F1EA",
              margin: "0 0 8px",
              textWrap: "balance",
            }}
          >
            African Sports Technology Network
          </h1>

          <p
            style={{
              fontWeight: 400,
              fontSize: 13,
              lineHeight: 1.5,
              color: "#8B877C",
              margin: "0 0 30px",
            }}
          >
            Registry, verification &amp; compliance intelligence for the African
            sports-technology ecosystem.
          </p>
        </div>

        {/* Google sign-in button */}
        <button
          type="button"
          onClick={handleSignIn}
          disabled={signingIn}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            background: "#FFFFFF",
            border: "none",
            borderRadius: 10,
            padding: "13px 16px",
            cursor: signingIn ? "wait" : "pointer",
            fontWeight: 600,
            fontSize: 14,
            lineHeight: 1,
            fontFamily: "Manrope, sans-serif",
            color: "#1F1F1F",
            boxShadow: "0 2px 10px rgba(0,0,0,.35)",
            transition: "transform .12s ease, box-shadow .2s ease",
            opacity: signingIn ? 0.7 : 1,
          }}
          onMouseEnter={(e) => {
            if (!signingIn) {
              e.currentTarget.style.transform = "translateY(-1px)";
              e.currentTarget.style.boxShadow =
                "0 6px 18px rgba(0,0,0,.45)";
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = "none";
            e.currentTarget.style.boxShadow = "0 2px 10px rgba(0,0,0,.35)";
          }}
        >
          <GoogleLogo />
          <span>{signingIn ? "Signing in..." : "Sign in with Google"}</span>
        </button>

        {/* Access notice */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            justifyContent: "center",
            marginTop: 16,
          }}
        >
          <span
            style={{
              width: 5,
              height: 5,
              borderRadius: "50%",
              background: "#C6A24E",
              display: "block",
            }}
          />
          <span
            style={{
              fontWeight: 500,
              fontSize: 11,
              lineHeight: 1.4,
              color: "#75716A",
            }}
          >
            Authorised Sports Tech Africa staff only
          </span>
        </div>

        {/* Error message */}
        {error && (
          <p
            role="alert"
            style={{
              marginTop: 12,
              fontWeight: 500,
              fontSize: 12,
              color: "#CC0000",
              textAlign: "center",
            }}
          >
            {error}
          </p>
        )}

        {/* Footer */}
        <div
          style={{
            marginTop: 30,
            paddingTop: 18,
            borderTop: "1px solid rgba(255,255,255,.07)",
            textAlign: "center",
          }}
        >
          <div
            style={{
              fontWeight: 600,
              fontSize: 11,
              lineHeight: 1.5,
              color: "#9A968B",
            }}
          >
            An{" "}
            <span style={{ color: "#C6A24E", fontWeight: 700 }}>STZA</span>{" "}
            platform &middot; operated by Sports Tech Africa Ltd
          </div>
          <div
            style={{
              fontWeight: 500,
              fontSize: 11,
              lineHeight: 1.6,
              color: "#5E5B54",
              marginTop: 3,
            }}
          >
            <a
              href="https://stza.io"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "#C6A24E", textDecoration: "none" }}
            >
              stza.io
            </a>{" "}
            &middot;{" "}
            <a
              href="https://africanstn.com"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "#C6A24E", textDecoration: "none" }}
            >
              africanstn.com
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
