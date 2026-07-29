// Module feature flags.
//
// FEATURES is a comma-separated list of the modules the shell renders, e.g.
// "registry,compliance,publishing,finance". The extraction target for the
// Finance module is FEATURES=finance, with everything else invisible.
//
// Server-side only. Read this in a server component and pass the result down
// rather than exposing the variable to the browser.

export const MODULES = ["registry", "compliance", "publishing", "finance"] as const;

export type ModuleName = (typeof MODULES)[number];

const DEFAULT_FEATURES: ModuleName[] = ["registry", "compliance", "publishing"];

// Parses FEATURES. An unset variable falls back to the three modules that
// predate the flag, so an environment that has not been updated keeps working
// exactly as it did. An empty value means "nothing enabled" and is honoured.
//
// Accepts commas, whitespace or semicolons as separators. That tolerance is
// not cosmetic: deployment tooling treats a comma inside an environment value
// as its own delimiter, which once silently reduced FEATURES to "registry" in
// production and hid three live modules. Space separation avoids the clash,
// and accepting either means a value written the old way still works.
export function enabledModules(env: string | undefined = process.env.FEATURES): ModuleName[] {
  if (env === undefined) return DEFAULT_FEATURES;

  const requested = env
    .split(/[,;\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  return MODULES.filter((m) => requested.includes(m));
}

export function isModuleEnabled(
  module: ModuleName,
  env: string | undefined = process.env.FEATURES
): boolean {
  return enabledModules(env).includes(module);
}
