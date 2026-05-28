"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

type NavItem = {
  href: string;
  label: string;
};

const NAV_ITEMS: NavItem[] = [
  { href: "/overview", label: "Overview" },
  { href: "/registry", label: "Registry" },
  { href: "/registry/verify", label: "Verify" },
  { href: "/reports", label: "Reports" },
];

/**
 * Persistent top navigation bar.
 *
 * Layout per memo Section 3.2:
 *   - Brand Dark background
 *   - Left: mono dark protea (24px) + "AfricanSTN" wordmark in Warm Light
 *   - Centre: navigation items
 *   - Right: "Signed in as {name}" with sign-out chevron
 */
export default function TopNav({ userEmail }: { userEmail: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);

  async function handleSignOut() {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  // Extract display name from email (everything before the @)
  const displayName = userEmail.split("@")[0];

  return (
    <nav className="bg-brand-dark border-b border-brand-gold/20 sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
        {/* Left: Logo + wordmark */}
        <Link href="/overview" className="flex items-center gap-2.5 group">
          <Image
            src="/logos/protea-mono-gold.png"
            alt=""
            width={28}
            height={28}
            className="transition-transform group-hover:scale-105"
          />
          <span className="text-h2-app text-warm-light font-bold tracking-wide">
            AfricanSTN
          </span>
        </Link>

        {/* Centre: Navigation */}
        <div className="hidden md:flex items-center gap-1">
          {NAV_ITEMS.map((item) => {
            // Longest-match: this item is active only if no other nav item
            // has a more specific path that also matches. Prevents /registry
            // from staying highlighted while we're on /registry/verify.
            const matches = pathname.startsWith(item.href);
            const hasMoreSpecific = NAV_ITEMS.some(
              (other) =>
                other.href !== item.href &&
                other.href.length > item.href.length &&
                pathname.startsWith(other.href),
            );
            const isActive = matches && !hasMoreSpecific;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={
                  isActive
                    ? "px-4 py-2 rounded-brand bg-brand-gold text-brand-dark font-bold text-body-app"
                    : "px-4 py-2 rounded-brand text-warm-light font-bold text-body-app hover:bg-white/5 transition-colors"
                }
              >
                {item.label}
              </Link>
            );
          })}
        </div>

        {/* Right: User menu */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-brand text-warm-light text-caption hover:bg-white/5 transition-colors"
          >
            <span className="text-warm-grey">Signed in as</span>
            <span className="font-bold">{displayName}</span>
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="currentColor"
              className={`transition-transform ${menuOpen ? "rotate-180" : ""}`}
            >
              <path d="M2 4l4 4 4-4z" />
            </svg>
          </button>

          {menuOpen && (
            <div
              className="absolute right-0 mt-2 w-48 card overflow-hidden"
              role="menu"
              onMouseLeave={() => setMenuOpen(false)}
            >
              <div className="px-4 py-3 border-b border-gold-border">
                <p className="text-caption text-warm-grey">Signed in as</p>
                <p className="text-body-app text-near-black truncate">{userEmail}</p>
              </div>
              <button
                type="button"
                onClick={handleSignOut}
                className="w-full px-4 py-2.5 text-left text-body-app text-near-black hover:bg-warm-light transition-colors"
                role="menuitem"
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}
