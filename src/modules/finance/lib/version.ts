// Finance module version, surfaced on the module overview page.
// Imports from src/shared only. Any import from another module or from the
// legacy AfricanSTN code fails the boundaries/element-types lint rule.
import { PLATFORM_VERSION } from "@/shared/lib/module-version";

export const FINANCE_MODULE_VERSION = "0.1.0";
export const FINANCE_PLATFORM_VERSION = PLATFORM_VERSION;
