"use client";

// The left sidebar (redesign, 27 Oct 2026; replaces TopNav). Every module's
// navigation as icon + label sections, a client switcher at the top, and the
// chosen client's own sections under Finance, so a client is one pick away
// instead of a trip through the Clients page. It collapses to icons on a
// computer (remembered per browser) and is a drawer behind the top bar's menu
// button on a phone.

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BadgeCheck, BookOpen, Bot, Building2, ChevronDown, ClipboardCheck, ClipboardList, Database, FileBarChart, FileText,
  Filter, Gauge, Globe, Inbox, LayoutDashboard, ListChecks, LogOut, Menu, Network, Newspaper, NotebookPen,
  PanelLeftClose, PanelLeftOpen, PenLine, Receipt, Settings, Share2, ShieldCheck, Table2, Users, X,
  type LucideIcon,
} from "lucide-react";
import ThemeToggle from "@/components/ThemeToggle";
import type { NavGroup } from "@/shared/layout/nav";
import styles from "./Sidebar.module.css";

export interface SidebarClient {
  slug: string;
  name: string;
}

const ICONS: Record<string, LucideIcon> = {
  "/dashboard": LayoutDashboard,
  "/overview": Gauge,
  "/registry": Database,
  "/registry/verify": BadgeCheck,
  "/data-protection": ShieldCheck,
  "/data-protection/jurisdictions": Globe,
  "/data-protection/editions": Newspaper,
  "/compliance": ClipboardCheck,
  "/compliance/jurisdictions": BookOpen,
  "/clients": Building2,
  "/pipeline": Filter,
  "/content/review": Inbox,
  "/content/briefs": FileText,
  "/content/linkedin": Share2,
  "/content": PenLine,
  "/reports": FileBarChart,
  "/finance/overview": LayoutDashboard,
  "/finance/clients": Users,
};

// A client's own sections, as ClientTabs lists them.
const CLIENT_WORK: Array<{ seg: string; label: string; icon: LucideIcon }> = [
  { seg: "bills", label: "Bills", icon: Receipt },
  { seg: "approvals", label: "Approvals", icon: ListChecks },
  { seg: "agents", label: "Agents", icon: Bot },
  { seg: "close", label: "Close", icon: ClipboardList },
  { seg: "reports", label: "Reports", icon: FileBarChart },
  { seg: "diary", label: "Diary", icon: NotebookPen },
  { seg: "open-items", label: "Open items", icon: Inbox },
];
const CLIENT_SETUP: Array<{ seg: string; label: string; icon: LucideIcon }> = [
  { seg: "xero", label: "Xero", icon: Network },
  { seg: "coa", label: "Chart of accounts", icon: Table2 },
  { seg: "settings", label: "Settings", icon: Settings },
];

// Which nav item a path belongs to: the longest href that is the path or a
// parent of it, so /registry/verify lights Verify and not Registry.
function activeHref(pathname: string, hrefs: string[]): string | null {
  let best: string | null = null;
  for (const h of hrefs) {
    if ((pathname === h || pathname.startsWith(h + "/")) && (!best || h.length > best.length)) best = h;
  }
  return best;
}

function initials(email: string): string {
  const name = email.split("@")[0].replace(/[^a-z]/gi, " ").trim().split(/\s+/);
  // One name in the address (nik@) gives one letter; two (jo.bloggs@) give two.
  return (name.length > 1 ? name[0][0] + name[1][0] : name[0].slice(0, 1)).toUpperCase();
}

const COLLAPSED_KEY = "stza-sidebar";
const CLIENT_KEY = "stza-client";

export default function Sidebar({ userEmail, groups, clients }: {
  userEmail: string;
  groups: NavGroup[];
  clients: SidebarClient[];
}) {
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [picking, setPicking] = useState(false);
  const [find, setFind] = useState("");
  const [lastClient, setLastClient] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // The client the page is about, else the last one chosen.
  const inClient = /^\/finance\/clients\/([^/]+)(?:\/([^/]+))?/.exec(pathname);
  const currentSlug = inClient?.[1] ?? lastClient;
  const current = clients.find((c) => c.slug === currentSlug) ?? null;
  const currentSeg = inClient?.[2] ?? null;

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSED_KEY) === "1");
      setLastClient(localStorage.getItem(CLIENT_KEY));
    } catch { /* no storage: defaults */ }
  }, []);
  useEffect(() => {
    if (inClient?.[1]) {
      try { localStorage.setItem(CLIENT_KEY, inClient[1]); } catch { /* ignore */ }
      setLastClient(inClient[1]);
    }
  }, [inClient?.[1]]); // eslint-disable-line react-hooks/exhaustive-deps
  // A page change closes the drawer and the client list.
  useEffect(() => { setDrawer(false); setPicking(false); }, [pathname]);
  useEffect(() => {
    if (!picking) return;
    const close = (e: PointerEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setPicking(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [picking]);

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    try { localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0"); } catch { /* ignore */ }
  }

  function pickClient(slug: string) {
    setPicking(false);
    setFind("");
    // Keep the section you were in (Bills stays Bills), else open Bills.
    router.push(`/finance/clients/${encodeURIComponent(slug)}/${currentSeg ?? "bills"}`);
  }

  const hrefs = useMemo(() => groups.flatMap((g) => g.items.map((i) => i.href)), [groups]);
  const active = inClient?.[2] ? null : activeHref(pathname, hrefs);
  const shown = clients.filter((c) => c.name.toLowerCase().includes(find.trim().toLowerCase()));
  const finance = groups.some((g) => g.module === "finance");
  const title = current && inClient ? current.name : groups.flatMap((g) => g.items).find((i) => i.href === active)?.label ?? "STZA OS";

  function signOut() {
    window.location.href = "/_gcp_iap/clear_login_cookie";
  }

  const sideClass = [styles.side, collapsed ? styles.collapsed : "", drawer ? styles.open : ""].join(" ");

  return (
    <>
      <div className={styles.phoneBar}>
        <button type="button" className={styles.iconBtn} onClick={() => setDrawer(true)} aria-label="Open the menu" aria-expanded={drawer}>
          <Menu size={20} aria-hidden="true" />
        </button>
        <span className={styles.phoneTitle}>{title}</span>
        <span className={styles.ava} title={userEmail}>{initials(userEmail)}</span>
      </div>
      <div className={drawer ? styles.scrimOn : styles.scrim} onClick={() => setDrawer(false)} aria-hidden="true" />

      <aside className={sideClass} aria-label="Main menu">
        <div style={{ display: "flex", alignItems: "center" }}>
          <Link href="/dashboard" className={styles.brand} style={{ flex: "1 1 auto" }}>
            <span className={styles.mark} aria-hidden="true">S</span>
            <span className={`${styles.brandName} ${styles.lbl}`}>STZA OS</span>
          </Link>
          {drawer && (
            <button type="button" className={styles.iconBtn} onClick={() => setDrawer(false)} aria-label="Close the menu">
              <X size={20} aria-hidden="true" />
            </button>
          )}
        </div>

        {finance && clients.length > 0 && !collapsed && (
          <div ref={menuRef}>
            <button type="button" className={styles.switch} onClick={() => setPicking(!picking)} aria-expanded={picking} aria-haspopup="listbox">
              <Building2 size={16} aria-hidden="true" />
              <span className={styles.switchName}>{current ? current.name : "Choose a client"}</span>
              <ChevronDown size={14} aria-hidden="true" />
            </button>
            {picking && (
              <div className={styles.menu}>
                <label>
                  <span style={{ position: "absolute", left: -9999 }}>Find a client</span>
                  <input className={styles.find} type="search" placeholder="Find a client" value={find} autoFocus
                    onChange={(e) => setFind(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && shown[0]) pickClient(shown[0].slug); if (e.key === "Escape") setPicking(false); }} />
                </label>
                <div role="listbox" aria-label="Clients">
                  {shown.map((c) => (
                    <button key={c.slug} type="button" role="option" aria-selected={c.slug === currentSlug}
                      className={`${styles.opt} ${styles.plain} ${c.slug === currentSlug ? styles.optCurrent : ""}`}
                      onClick={() => pickClient(c.slug)}>
                      <span>{c.name}</span>
                    </button>
                  ))}
                  {!shown.length && <div className={styles.opt} style={{ color: "var(--sub)" }}>No client matches</div>}
                </div>
                <Link href="/finance/clients" className={styles.opt} style={{ color: "var(--sub)" }}>All clients</Link>
              </div>
            )}
          </div>
        )}

        {groups.map((g) => (
          <div key={g.label} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <div className={styles.sec}><span className={styles.lbl}>{g.label}</span></div>
            {g.items.map((item) => {
              const Icon = ICONS[item.href] ?? FileText;
              const on = item.href === active;
              return (
                <Link key={item.href} href={item.href} title={collapsed ? item.label : undefined}
                  className={`${styles.nav} ${on ? styles.on : ""}`} aria-current={on ? "page" : undefined}>
                  <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
                  <span className={styles.lbl}>{item.label}</span>
                  {item.badge && <span className={`${styles.badge} ${styles.lbl}`}>{item.badge}</span>}
                </Link>
              );
            })}
            {g.module === "finance" && current && (
              <>
                <div className={`${styles.client} ${styles.lbl}`}>{current.name}</div>
                {[...CLIENT_WORK, ...CLIENT_SETUP].map((t) => {
                  const href = `/finance/clients/${encodeURIComponent(current.slug)}/${t.seg}`;
                  const on = inClient?.[1] === current.slug && currentSeg === t.seg;
                  const Icon = t.icon;
                  return (
                    <Link key={t.seg} href={href} title={collapsed ? `${current.name}: ${t.label}` : undefined}
                      className={`${styles.nav} ${styles.sub} ${on ? styles.on : ""}`} aria-current={on ? "page" : undefined}>
                      <Icon size={16} strokeWidth={1.8} aria-hidden="true" />
                      <span className={styles.lbl}>{t.label}</span>
                    </Link>
                  );
                })}
              </>
            )}
          </div>
        ))}

        <div className={styles.foot}>
          {!collapsed && <div style={{ padding: "0 4px" }}><ThemeToggle /></div>}
          <button type="button" className={`${styles.nav} ${styles.plain} ${styles.collapseBtn}`} onClick={toggleCollapsed}
            aria-label={collapsed ? "Expand the menu" : "Collapse the menu"}>
            {collapsed ? <PanelLeftOpen size={18} aria-hidden="true" /> : <PanelLeftClose size={18} aria-hidden="true" />}
            <span className={styles.lbl}>Collapse menu</span>
          </button>
          <div className={styles.user}>
            <span className={styles.ava} title={userEmail}>{initials(userEmail)}</span>
            <span className={`${styles.email} ${styles.lbl}`}>{userEmail}</span>
          </div>
          <button type="button" className={`${styles.nav} ${styles.plain}`} onClick={signOut} title={collapsed ? "Sign out" : undefined}>
            <LogOut size={18} aria-hidden="true" />
            <span className={styles.lbl}>Sign out</span>
          </button>
        </div>
      </aside>
    </>
  );
}
