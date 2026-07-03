/**
 * TopNav — updated with OS module navigation items.
 *
 * INTEGRATION NOTE: This file replaces the existing TopNav.tsx.
 * The only change is the expanded NAV_ITEMS array.
 * All existing behaviour (active detection, sign-out, brand styling) is preserved.
 */

"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

type NavItem = { href: string; label: string };

const NAV_ITEMS: NavItem[] = [
  // Dashboard
  { href: "/dashboard", label: "Dashboard" },
  // Existing pages
  { href: "/overview", label: "Overview" },
  { href: "/registry", label: "Registry" },
  { href: "/registry/verify", label: "Verify" },
  { href: "/reports", label: "Reports" },
  // OS modules
  { href: "/data-protection", label: "Data protection" },
  { href: "/compliance", label: "Compliance" },
  { href: "/content", label: "Content" },
  { href: "/pipeline", label: "Pipeline" },
];

export default function TopNav({ userEmail }: { userEmail: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push("/login");
  };

  return (
    <nav className="bg-[#1A1C1E] text-white px-6 py-3 flex items-center justify-between">
      <div className="flex items-center gap-6">
        {/* Brand */}
        <Link
          href="/dashboard"
          className="font-bold text-lg tracking-tight text-[#C5A059]"
        >
          AfricanSTN
        </Link>

        {/* Nav links */}
        <div className="flex items-center gap-1">
          {NAV_ITEMS.map((item) => {
            // Longest-match active detection
            const isActive =
              pathname === item.href ||
              (pathname.startsWith(item.href) &&
                item.href !== "/overview" &&
                item.href !== "/dashboard");

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`px-3 py-1.5 rounded text-sm transition-colors ${
                  isActive
                    ? "bg-[#C5A059] text-[#1A1C1E] font-medium"
                    : "text-gray-300 hover:text-white hover:bg-white/10"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      </div>

      {/* User / sign-out */}
      <div className="flex items-center gap-3 text-sm">
        <span className="text-gray-400 hidden md:inline">{userEmail}</span>
        <button
          onClick={handleSignOut}
          className="text-gray-400 hover:text-white transition-colors"
        >
          Sign out
        </button>
      </div>
    </nav>
  );
}
