"use client";

import Image from "next/image";
import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

/**
 * Login screen for the AfricanSTN information system.
 *
 * This is the one place per session where the full "African Sports Technology Network"
 * name appears alongside the hero protea, per the brand-aware naming convention.
 *
 * Layout per memo Section 3.1:
 *   - Full-screen Near Black background
 *   - Centred composition
 *   - Hero protea at 200px wide
 *   - Full brand name in Brand Gold beneath
 *   - "Information system" subtitle in Warm Grey
 *   - Single primary "Sign in with Google" button
 *   - Footer attribution in Warm Grey
 */
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
    <div className="min-h-screen flex flex-col items-center justify-center bg-near-black p-6">
      {/* Hero protea + brand mark */}
      <div className="flex flex-col items-center max-w-md w-full">
        <Image
          src="/logos/protea-hero.png"
          alt="AfricanSTN protea emblem"
          width={200}
          height={200}
          priority
          className="mb-8"
        />
        <h1 className="text-display text-brand-gold text-center mb-2 font-bold">
          African Sports Technology Network
        </h1>
        <p className="text-body-app text-warm-grey text-center mb-12">
          Information system
        </p>

        <button
          type="button"
          onClick={handleSignIn}
          disabled={signingIn}
          className="btn-primary w-full justify-center"
        >
          {signingIn ? "Signing in..." : "Sign in with Google"}
        </button>

        {error && (
          <p className="mt-4 text-body-app text-alert-red text-center" role="alert">
            {error}
          </p>
        )}

        <p className="mt-12 text-caption text-warm-grey text-center">
          Operated by Sports Tech Africa Limited
          <br />
          <span className="text-warm-grey/70">stza.io &middot; africanstn.com</span>
        </p>
      </div>
    </div>
  );
}
