"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import ThemeToggle from "@/components/ThemeToggle";

interface NavItem {
  href: string;
  label: string;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const GROUPS: NavGroup[] = [
  { label: "Home", items: [{ href: "/dashboard", label: "Dashboard" }] },
  {
    label: "Registry",
    items: [
      { href: "/overview", label: "Overview" },
      { href: "/registry", label: "Registry" },
      { href: "/registry/verify", label: "Verify" },
    ],
  },
  {
    label: "Regulatory",
    items: [
      { href: "/data-protection", label: "Data protection" },
      { href: "/data-protection/jurisdictions", label: "Jurisdictions" },
      { href: "/data-protection/editions", label: "Editions" },
      { href: "/compliance", label: "Compliance" },
      { href: "/compliance/jurisdictions", label: "Knowledge base" },
    ],
  },
  {
    label: "Commercial",
    items: [
      { href: "/clients", label: "Clients" },
      { href: "/pipeline", label: "Pipeline" },
    ],
  },
  {
    label: "Publishing",
    items: [
      { href: "/content", label: "Content" },
      { href: "/reports", label: "Reports" },
    ],
  },
];

function checkActive(pathname: string, href: string): boolean {
  if (pathname === href) return true;
  if (href === "/registry/verify") return pathname.startsWith("/registry/verify");
  if (href === "/registry")
    return (
      pathname === "/registry" ||
      (pathname.startsWith("/registry/") &&
        !pathname.startsWith("/registry/verify"))
    );
  if (href === "/overview" || href === "/dashboard") return pathname === href;
  /* /data-protection exact — don't match /data-protection/jurisdictions or /editions */
  if (href === "/data-protection")
    return (
      pathname === "/data-protection" ||
      (pathname.startsWith("/data-protection/") &&
        !pathname.startsWith("/data-protection/jurisdictions") &&
        !pathname.startsWith("/data-protection/editions"))
    );
  return pathname.startsWith(href + "/") || pathname === href;
}

const labelStyle: React.CSSProperties = {
  fontWeight: 700,
  fontSize: 8,
  lineHeight: 1,
  letterSpacing: "0.17em",
  textTransform: "uppercase",
  color: "#8F7A45",
  paddingLeft: 9,
};

const inactiveLinkStyle: React.CSSProperties = {
  fontSize: 12,
  lineHeight: 1,
  padding: "7px 10px",
  whiteSpace: "nowrap",
  borderRadius: 6,
  fontWeight: 500,
  color: "#C7C4BD",
  background: "transparent",
  transition: "color .15s, background .15s",
};

const activeLinkStyle: React.CSSProperties = {
  ...inactiveLinkStyle,
  fontWeight: 700,
  color: "#141414",
  background: "#C5A059",
};

export default function TopNav({ userEmail }: { userEmail: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push("/login");
  };

  return (
    <nav
      data-topnav
      style={{
        background: "#0F1113",
        borderBottom: "1px solid rgba(197,160,89,.28)",
      }}
    >
      <div
        style={{
          maxWidth: 1320,
          margin: "0 auto",
          padding: "10px 26px",
          display: "flex",
          alignItems: "center",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        {/* STZA wordmark + co-brand */}
        <Link
          href="/dashboard"
          style={{
            flexShrink: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
            gap: 2,
            textDecoration: "none",
          }}
        >
          <Image
            src="/logos/stza-logo-white-crop.png"
            alt="STZA"
            width={120}
            height={30}
            style={{ height: 30, width: "auto" }}
            priority
          />
          <span
            style={{
              fontSize: 9,
              fontWeight: 500,
              color: "#8F7A45",
              letterSpacing: "0.04em",
              paddingLeft: 1,
            }}
          >
            An STZA platform
          </span>
        </Link>

        {/* Separator */}
        <div
          style={{
            width: 1,
            height: 34,
            background: "rgba(255,255,255,.12)",
            flexShrink: 0,
          }}
        />

        {/* Nav groups */}
        <div
          style={{
            display: "flex",
            alignItems: "stretch",
            flex: 1,
            flexWrap: "wrap",
            gap: 0,
            rowGap: 10,
            minWidth: 0,
          }}
        >
          {GROUPS.map((group, idx) => {
            return (
              <div key={group.label} style={{ display: "contents" }}>
                {idx > 0 && (
                  <div
                    style={{
                      width: 1,
                      alignSelf: "stretch",
                      background: "rgba(255,255,255,.08)",
                    }}
                  />
                )}
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    padding: "0 13px",
                  }}
                >
                  <div style={labelStyle}>{group.label}</div>
                  <div style={{ display: "flex", gap: 2 }}>
                    {group.items.map((item) => {
                      const active = checkActive(pathname, item.href);
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          style={active ? activeLinkStyle : inactiveLinkStyle}
                          onMouseEnter={(e) => {
                            if (!active) {
                              e.currentTarget.style.color = "#F4F1EA";
                              e.currentTarget.style.background =
                                "rgba(255,255,255,.05)";
                            }
                          }}
                          onMouseLeave={(e) => {
                            if (!active) {
                              e.currentTarget.style.color = "#C7C4BD";
                              e.currentTarget.style.background = "transparent";
                            }
                          }}
                        >
                          {item.label}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* User section */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            flexShrink: 0,
          }}
        >
          <ThemeToggle />
          <span
            className="hidden md:inline"
            style={{ fontWeight: 500, fontSize: 12, color: "#8E9196" }}
          >
            {userEmail}
          </span>
          <button
            onClick={handleSignOut}
            style={{
              fontWeight: 600,
              fontSize: 12,
              color: "#C5A059",
              background: "none",
              border: "none",
              cursor: "pointer",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "#F4F1EA";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "#C5A059";
            }}
          >
            Sign out
          </button>
        </div>
      </div>
    </nav>
  );
}
