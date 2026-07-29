// Composes the platform navigation from the shell plus each enabled module.
//
// The shell knows a module's nav only through the NavGroup contract in
// shared/layout/nav. A module removed from FEATURES disappears from the nav
// without any other change, which is what makes FEATURES=finance a viable
// extraction target.

import { enabledModules } from "@/shared/config/features";
import type { NavGroup } from "@/shared/layout/nav";
import { FINANCE_NAV } from "@/modules/finance/config/nav";

// The AfricanSTN groups still live in src/app rather than in modules, so their
// definitions stay here until they are relocated.
const SHELL_NAV: NavGroup[] = [
  { label: "Home", items: [{ href: "/dashboard", label: "Dashboard" }] },
  {
    label: "Registry",
    module: "registry",
    items: [
      { href: "/overview", label: "Overview" },
      { href: "/registry", label: "Registry" },
      { href: "/registry/verify", label: "Verify" },
    ],
  },
  {
    label: "Regulatory",
    module: "compliance",
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
    module: "compliance",
    items: [
      { href: "/clients", label: "Clients" },
      { href: "/pipeline", label: "Pipeline" },
    ],
  },
  {
    label: "Publishing",
    module: "publishing",
    items: [
      { href: "/content/review", label: "Review" },
      { href: "/content/briefs", label: "Briefs" },
      { href: "/content/linkedin", label: "LinkedIn" },
      { href: "/content", label: "Content" },
      { href: "/reports", label: "Reports" },
    ],
  },
  FINANCE_NAV,
];

// Groups with no module are shell furniture and always render.
export function navigationForEnvironment(env = process.env.FEATURES): NavGroup[] {
  const enabled = enabledModules(env);
  return SHELL_NAV.filter((g) => !g.module || enabled.includes(g.module));
}
