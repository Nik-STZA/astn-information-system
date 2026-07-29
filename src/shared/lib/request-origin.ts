// Deriving the caller's address and our own public address, behind a proxy.
//
// Both of these are wrong if taken naively from the request, because the app
// runs on Cloud Run behind an Identity-Aware Proxy load balancer. The request
// the app sees has been rewritten: its host is the container's internal
// address, and the original client IP survives only in a forwarded header.

// X-Forwarded-For is a comma separated chain, client first, then each proxy.
// Postgres inet accepts exactly one address, so passing the raw header value
// throws "invalid input syntax for type inet" and takes the transaction with
// it. Only the leftmost entry is the caller.
//
// The chain is client-supplied and therefore spoofable. It is recorded for the
// audit trail, never used to make an access decision.
export function clientIpFrom(forwardedFor: string | null | undefined): string | null {
  if (!forwardedFor) return null;

  const first = forwardedFor.split(",")[0]?.trim();
  if (!first) return null;

  // Strip a port from IPv4 (1.2.3.4:5678) or bracketed IPv6 ([::1]:5678).
  const bracketed = /^\[(.+)\](?::\d+)?$/.exec(first);
  const candidate = bracketed ? bracketed[1] : first.replace(/:\d+$/, (m, o, s) =>
    // Only strip a trailing :port when it is not part of a bare IPv6 address.
    s.indexOf(":") === s.lastIndexOf(":") ? "" : m
  );

  return isIpAddress(candidate) ? candidate : null;
}

export function isIpAddress(value: string): boolean {
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(value);
  if (v4) return v4.slice(1).every((o) => Number(o) <= 255);

  // Deliberately permissive on IPv6 shapes: hex groups and colons only, with
  // an optional trailing IPv4 form. Postgres does the authoritative parsing.
  if (value.includes(":")) return /^[0-9a-fA-F:.]+$/.test(value) && !value.endsWith(":::");

  return false;
}

// The public origin of this app. X-Forwarded-Host and X-Forwarded-Proto are set
// by the load balancer; without them a redirect built from the request lands on
// the container's own address, which is unreachable from a browser.
export function publicOrigin(
  headers: { get(name: string): string | null },
  fallback: string
): string {
  const explicit = process.env.APP_BASE_URL;
  if (explicit) return explicit.replace(/\/+$/, "");

  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  if (host) {
    const proto = headers.get("x-forwarded-proto") ?? "https";
    // A forwarded host can itself be a list.
    return `${proto.split(",")[0].trim()}://${host.split(",")[0].trim()}`;
  }

  return fallback;
}
