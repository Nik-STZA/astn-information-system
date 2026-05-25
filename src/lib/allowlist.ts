/**
 * Allowlist check for the AfricanSTN information system.
 *
 * For v1, the allowlist is held in an environment variable as a comma-separated
 * list of email addresses. v1.2 will move this to a database table for easier
 * management when more users are added.
 *
 * The allowlist is checked at two points:
 *   1. In the OAuth callback handler, before establishing the session
 *   2. In the middleware on every request, for defence in depth
 */

export function isAllowed(email: string | null | undefined): boolean {
  if (!email) return false;

  const allowlist = (process.env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  return allowlist.includes(email.toLowerCase());
}
