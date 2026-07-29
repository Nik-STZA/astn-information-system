"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import ThemeToggle from "@/components/ThemeToggle";
import type { NavGroup } from "@/shared/layout/nav";

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
  /* /content exact — don't match /content/review or /content/briefs */
  if (href === "/content")
    return (
      pathname === "/content" ||
      (pathname.startsWith("/content/") &&
        !pathname.startsWith("/content/review") &&
        !pathname.startsWith("/content/briefs") &&
        !pathname.startsWith("/content/linkedin"))
    );
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

const badgeStyle: React.CSSProperties = {
  marginLeft: 5,
  fontSize: 7,
  fontWeight: 800,
  lineHeight: 1,
  letterSpacing: "0.08em",
  padding: "2px 4px",
  borderRadius: 3,
  background: "#C5A059",
  color: "#141414",
  verticalAlign: "middle",
};

// Groups are resolved server-side from the FEATURES flag and passed in, so a
// disabled module never reaches the browser at all.
export default function TopNav({
  userEmail,
  groups,
}: {
  userEmail: string;
  groups: NavGroup[];
}) {
  const pathname = usePathname();

  const handleSignOut = async () => {
    // IAP session cookie is cleared at the proxy, not in the app.
    window.location.href = "/_gcp_iap/clear_login_cookie";
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
          {groups.map((group, idx) => {
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
                          {item.badge && <span style={badgeStyle}>{item.badge}</span>}
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
