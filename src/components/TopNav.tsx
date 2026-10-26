"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import ThemeToggle from "@/components/ThemeToggle";
import type { NavGroup } from "@/shared/layout/nav";
import styles from "./TopNav.module.css";

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

// Size and spacing live in TopNav.module.css so a phone can enlarge them; the
// colours stay inline because the hover handlers swap them.
const inactiveLinkStyle: React.CSSProperties = {
  fontWeight: 500,
  color: "#C7C4BD",
  background: "transparent",
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

const MENU_ID = "topnav-menu";

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
  // Only matters below 900px, where the links sit behind the menu button.
  const [menuOpen, setMenuOpen] = useState(false);

  // Close the phone menu once a link has taken the user somewhere.
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

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
      <div className={styles.bar}>
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

        {/* Phone only: opens the links as a full-width panel */}
        <button
          type="button"
          className={styles.menuButton}
          aria-expanded={menuOpen}
          aria-controls={MENU_ID}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span className={styles.menuIcon} aria-hidden="true">
            {menuOpen ? "×" : "☰"}
          </span>
          Menu
        </button>

        {/* Separator */}
        <div className={styles.separator} />

        <div id={MENU_ID} className={styles.panel} data-open={menuOpen}>
          {/* Nav groups */}
          <div className={styles.groups}>
            {groups.map((group, idx) => {
              return (
                <div key={group.label} style={{ display: "contents" }}>
                  {idx > 0 && <div className={styles.groupDivider} />}
                  <div className={styles.group}>
                    <div style={labelStyle}>{group.label}</div>
                    <div className={styles.links}>
                      {group.items.map((item) => {
                        const active = checkActive(pathname, item.href);
                        return (
                          <Link
                            key={item.href}
                            href={item.href}
                            className={styles.link}
                            aria-current={active ? "page" : undefined}
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
          <div className={styles.user}>
            <ThemeToggle />
            <span className={styles.email}>{userEmail}</span>
            <button
              type="button"
              onClick={handleSignOut}
              className={styles.signOut}
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
      </div>
    </nav>
  );
}
