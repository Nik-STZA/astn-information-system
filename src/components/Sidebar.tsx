"use client";

// The left sidebar (redesign, 27 Oct 2026; replaces TopNav). Client-first
// (28 Oct 2026, Nik): a Clients section lists every client, and opening one
// shows its own sections, so there is no client dropdown to pick from first.
// Every module's other navigation follows as icon + label sections. It
// collapses to icons on a computer (remembered per browser) from the button at
// the top, and is a drawer behind the top bar's menu button on a phone.
//
// A client's services decide what shows under it (client master, 28 Oct
// 2026): its set-up, then each active service's pages, then Past for the
// services it has completed, still readable.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BadgeCheck, BookOpen, Bot, Building2, ChevronRight, ClipboardPen, History, SlidersHorizontal, Coins, ClipboardCheck, ClipboardList, Database, FileBarChart, FileText,
  Filter, Gauge, Globe, Inbox, LayoutDashboard, ListChecks, LogOut, Menu, Network, Newspaper, NotebookPen,
  PanelLeftClose, PanelLeftOpen, PenLine, Receipt, Settings, Share2, ShieldCheck, SquareKanban, Table2, Users, X,
  type LucideIcon,
} from "lucide-react";
import ThemeToggle from "@/components/ThemeToggle";
import type { NavGroup } from "@/shared/layout/nav";
import styles from "./Sidebar.module.css";

export interface SidebarClient {
  slug: string;
  name: string;
  // From the client master. Absent when the master did not answer: then the
  // client is shown with Finance, as before.
  services?: Array<{ service: string; state: "active" | "completed" }>;
  complianceId?: string | null;
}

type Leaf = { href: string; label: string; icon: LucideIcon; seg?: string };

// The pages a service has under a client.
function servicePages(c: SidebarClient, service: string): Leaf[] {
  const slug = encodeURIComponent(c.slug);
  if (service === "finance") return CLIENT_FINANCE.map((t) => ({ href: `/finance/clients/${slug}/${t.seg}`, label: t.label, icon: t.icon, seg: t.seg }));
  if (service === "data_protection" && c.complianceId) {
    return [{ href: `/compliance/client/${encodeURIComponent(c.complianceId)}`, label: "Workspace", icon: ClipboardPen }];
  }
  return [];
}

const SERVICE_LABEL: Record<string, string> = { finance: "Finance", data_protection: "Data protection", consulting: "Consulting" };

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
  "/clients/pipeline": Filter,
  "/content/review": Inbox,
  "/content/briefs": FileText,
  "/content/linkedin": Share2,
  "/content": PenLine,
  "/reports": FileBarChart,
  "/finance/overview": LayoutDashboard,
  "/clients/all": Users,
  "/finance/clients": Users,
  "/admin/costs": Coins,
};

// A client's own sections, by service.
const CLIENT_FINANCE: Array<{ seg: string; label: string; icon: LucideIcon }> = [
  { seg: "work", label: "Work", icon: SquareKanban },
  { seg: "bills", label: "Bills", icon: Receipt },
  { seg: "approvals", label: "Approvals", icon: ListChecks },
  { seg: "agents", label: "Agents", icon: Bot },
  { seg: "close", label: "Close", icon: ClipboardList },
  { seg: "reports", label: "Reports", icon: FileBarChart },
  { seg: "diary", label: "Diary", icon: NotebookPen },
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

// First and last word: "Feldspar Sport Group" -> "FG", "Sandbox Test Group" ->
// "SG", "STZA" -> "ST", so clients sharing a first word still look different.
function clientInitials(name: string): string {
  const words = name.replace(/[^a-z0-9 ]/gi, " ").trim().split(/\s+/);
  return (words.length > 1 ? words[0][0] + words[words.length - 1][0] : words[0].slice(0, 2)).toUpperCase();
}

const COLLAPSED_KEY = "stza-sidebar";

export default function Sidebar({ userEmail, groups, clients }: {
  userEmail: string;
  groups: NavGroup[];
  clients: SidebarClient[];
}) {
  const pathname = usePathname() ?? "/";
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  // The client the page is about: its Finance pages, its set-up, or its data
  // protection workspace. pageSeg is the Finance section, if any.
  const inClient = /^\/finance\/clients\/([^/]+)(?:\/([^/]+))?/.exec(pathname);
  const inSetup = /^\/clients\/all\/([^/]+)/.exec(pathname);
  const inDp = /^\/compliance\/client\/([^/]+)/.exec(pathname);
  const pageClient = inClient?.[1]
    ?? inSetup?.[1]
    ?? (inDp ? clients.find((c) => c.complianceId === decodeURIComponent(inDp[1]))?.slug ?? null : null);
  const pageSeg = inClient?.[2] ?? null;

  useEffect(() => {
    try { setCollapsed(localStorage.getItem(COLLAPSED_KEY) === "1"); } catch { /* no storage: expanded */ }
  }, []);
  // Arriving on a client's page opens that client in the list.
  useEffect(() => { if (pageClient) setOpen(pageClient); }, [pageClient]);
  // A page change closes the drawer.
  useEffect(() => { setDrawer(false); }, [pathname]);

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    try { localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0"); } catch { /* ignore */ }
  }

  const finance = groups.some((g) => g.module === "finance");
  const clientLinks = [
    ...(finance ? [{ href: "/clients/all", label: "All clients" }] : []),
    ...(finance ? [{ href: "/clients/pipeline", label: "Pipeline" }] : []),
  ];
  const hrefs = useMemo(
    () => [...clientLinks.map((l) => l.href), ...groups.flatMap((g) => g.items.map((i) => i.href))],
    [groups] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const active = pageClient ? null : activeHref(pathname, hrefs);
  const pageClientName = clients.find((c) => c.slug === pageClient)?.name;
  const title = pageClientName ?? [...clientLinks, ...groups.flatMap((g) => g.items)].find((i) => i.href === active)?.label ?? "STZA OS";

  function signOut() {
    window.location.href = "/_gcp_iap/clear_login_cookie";
  }

  const navLink = (href: string, label: string, Icon: LucideIcon, badge?: string) => {
    const on = href === active;
    return (
      <Link key={href} href={href} title={collapsed ? label : undefined}
        className={`${styles.nav} ${on ? styles.on : ""}`} aria-current={on ? "page" : undefined}>
        <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
        <span className={styles.lbl}>{label}</span>
        {badge && <span className={`${styles.badge} ${styles.lbl}`}>{badge}</span>}
      </Link>
    );
  };

  const sideClass = [styles.side, collapsed ? styles.collapsed : "", drawer ? styles.open : ""].join(" ");
  const [home, ...rest] = groups;

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
        <div className={styles.head}>
          <Link href="/dashboard" className={styles.brand}>
            <span className={styles.mark} aria-hidden="true">S</span>
            <span className={`${styles.brandName} ${styles.lbl}`}>STZA OS</span>
          </Link>
          {drawer ? (
            <button type="button" className={styles.headBtn} onClick={() => setDrawer(false)} aria-label="Close the menu" title="Close the menu">
              <X size={18} aria-hidden="true" />
            </button>
          ) : (
            <button type="button" className={`${styles.headBtn} ${styles.collapseBtn}`} onClick={toggleCollapsed}
              aria-label={collapsed ? "Expand the menu" : "Collapse the menu"} title={collapsed ? "Expand the menu" : "Collapse the menu"}>
              {collapsed ? <PanelLeftOpen size={18} aria-hidden="true" /> : <PanelLeftClose size={18} aria-hidden="true" />}
            </button>
          )}
        </div>

        {home && (
          <div className={styles.group}>
            <div className={styles.sec}><span className={styles.lbl}>{home.label}</span></div>
            {home.items.map((item) => navLink(item.href, item.label, ICONS[item.href] ?? FileText, item.badge))}
          </div>
        )}

        {(clientLinks.length > 0 || (finance && clients.length > 0)) && (
          <div className={styles.group}>
            <div className={styles.sec}><span className={styles.lbl}>Clients</span></div>
            {clientLinks.map((l) => navLink(l.href, l.label, ICONS[l.href] ?? FileText))}
            {finance && clients.map((c) => {
              const isOpen = open === c.slug && !collapsed;
              const here = pageClient === c.slug;
              const services = c.services ?? [{ service: "finance", state: "active" as const }];
              const activeSvcs = services.filter((s) => s.state === "active");
              const pastSvcs = services.filter((s) => s.state === "completed");
              const setupHref = `/clients/all/${encodeURIComponent(c.slug)}`;
              if (collapsed) {
                const first = activeSvcs.map((s) => servicePages(c, s.service)[0]).find(Boolean);
                return (
                  <Link key={c.slug} href={first?.href ?? setupHref} title={c.name}
                    className={`${styles.nav} ${here ? styles.on : ""}`}>
                    <span className={styles.ini} aria-hidden="true">{clientInitials(c.name)}</span>
                    <span className={styles.lbl}>{c.name}</span>
                  </Link>
                );
              }
              return (
                <div key={c.slug}>
                  <button type="button" className={`${styles.nav} ${styles.plain} ${here ? styles.here : ""}`}
                    onClick={() => setOpen(isOpen ? null : c.slug)} aria-expanded={isOpen}>
                    <span className={styles.ini} aria-hidden="true">{clientInitials(c.name)}</span>
                    <span className={`${styles.lbl} ${styles.clientName}`}>{c.name}</span>
                    <ChevronRight size={14} aria-hidden="true" className={`${styles.chev} ${isOpen ? styles.chevOpen : ""}`} />
                  </button>
                  {isOpen && (
                    <div className={styles.tree}>
                      {c.services && (
                        <Link href={setupHref} className={`${styles.nav} ${styles.sub} ${pathname === setupHref ? styles.on : ""}`}
                          aria-current={pathname === setupHref ? "page" : undefined}>
                          <SlidersHorizontal size={16} strokeWidth={1.8} aria-hidden="true" />
                          <span className={styles.lbl}>Set-up</span>
                        </Link>
                      )}
                      {activeSvcs.map((s) => {
                        const pages = servicePages(c, s.service);
                        return (
                          <div key={s.service} className={styles.group}>
                            <div className={styles.svc}>{SERVICE_LABEL[s.service] ?? s.service}</div>
                            {pages.map((p) => {
                              const on = p.seg ? here && pageSeg === p.seg : pathname === p.href;
                              const Icon = p.icon;
                              return (
                                <Link key={p.href} href={p.href}
                                  className={`${styles.nav} ${styles.sub} ${on ? styles.on : ""}`} aria-current={on ? "page" : undefined}>
                                  <Icon size={16} strokeWidth={1.8} aria-hidden="true" />
                                  <span className={styles.lbl}>{p.label}</span>
                                </Link>
                              );
                            })}
                            {!pages.length && <div className={styles.none}>No pages yet</div>}
                          </div>
                        );
                      })}
                      {pastSvcs.length > 0 && (
                        <div className={styles.group}>
                          <div className={styles.svc}>Past</div>
                          {pastSvcs.map((s) => {
                            const first = servicePages(c, s.service)[0];
                            const label = SERVICE_LABEL[s.service] ?? s.service;
                            return first ? (
                              <Link key={s.service} href={first.href} className={`${styles.nav} ${styles.sub} ${styles.past}`}>
                                <History size={16} strokeWidth={1.8} aria-hidden="true" />
                                <span className={styles.lbl}>{label}</span>
                              </Link>
                            ) : (
                              <div key={s.service} className={`${styles.nav} ${styles.sub} ${styles.past}`}>
                                <History size={16} strokeWidth={1.8} aria-hidden="true" />
                                <span className={styles.lbl}>{label}</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                      {!activeSvcs.length && !pastSvcs.length && <div className={styles.none}>No services yet. Turn one on in set-up.</div>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {rest.map((g) => (
          <div key={g.label} className={styles.group}>
            <div className={styles.sec}><span className={styles.lbl}>{g.label}</span></div>
            {g.items.map((item) => navLink(item.href, item.label, ICONS[item.href] ?? FileText, item.badge))}
          </div>
        ))}

        <div className={styles.foot}>
          <ThemeToggle compact={collapsed} />
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
