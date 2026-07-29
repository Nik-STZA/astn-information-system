// Navigation contract shared by the shell and every module.
//
// The shell owns rendering. Each module owns its own nav definition and
// declares which feature flag gates it, so removing a module from FEATURES
// removes its navigation without the shell knowing anything about it.

import type { ModuleName } from "@/shared/config/features";

export interface NavItem {
  href: string;
  label: string;
  badge?: string;
}

export interface NavGroup {
  label: string;
  // Which module gates this group. Undefined means always visible (the shell).
  module?: ModuleName;
  items: NavItem[];
}
