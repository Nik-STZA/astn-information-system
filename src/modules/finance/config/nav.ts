// Finance navigation.
//
// Deliberately only two items. Every client-sensitive surface (Xero
// connections, chart of accounts, per-client settings, approvals, close,
// diary) lives INSIDE a client at /finance/clients/<slug>/*, never at practice
// level. Do not add client-scoped entries here.

import type { NavGroup } from "@/shared/layout/nav";

export const FINANCE_NAV: NavGroup = {
  label: "Finance",
  module: "finance",
  items: [
    { href: "/finance/overview", label: "Overview" },
    { href: "/finance/clients", label: "Clients", badge: "NEW" },
  ],
};
