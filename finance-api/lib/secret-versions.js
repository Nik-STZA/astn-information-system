// Which versions of a secret to destroy after a new one is added.
//
// Xero issues a new refresh token on every refresh, and each one is stored as
// a new Secret Manager version. Nothing removed the old ones, and Google bills
// every version that is not destroyed (enabled or disabled alike): by 28 Oct
// 2026 the five xero-refresh-* secrets held 292 versions, about 90% of the
// project's Secret Manager bill. A spent refresh token is useless, so we keep
// the newest KEEP and destroy the rest.
//
// KEEP is two, not one: the previous token is the fallback if the newest turns
// out to be bad, and Xero accepts a just-replaced refresh token for a short
// grace period.

const KEEP = 2;

// versions: as returned by listSecretVersions, each { name, state }, where name
// ends in /versions/<n>. Returns the names to destroy, oldest first.
function versionsToDestroy(versions, keep = KEEP) {
  const number = (v) => Number(String(v.name).split("/").pop());
  const live = versions
    .filter((v) => v.state === "ENABLED" || v.state === "DISABLED")
    .filter((v) => Number.isFinite(number(v)))
    .sort((a, b) => number(b) - number(a));
  return live.slice(keep).map((v) => v.name).reverse();
}

module.exports = { KEEP, versionsToDestroy };
