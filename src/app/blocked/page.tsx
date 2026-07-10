import Image from "next/image";
import Link from "next/link";

/**
 * Polite block page for users who authenticate successfully with Google
 * but are not on the allowlist for the information system.
 *
 * Per memo Section 3.1 wording, the message is direct without being unfriendly.
 */
export default function BlockedPage() {
  return (
    <div style={{
      minHeight: "100vh", display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      background: "#0F1113", padding: 24,
      fontFamily: "'Manrope', sans-serif",
    }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", maxWidth: 440, width: "100%" }}>
        <Image
          src="/logos/protea-mono-gold.png"
          alt=""
          width={120}
          height={120}
          style={{ marginBottom: 32, opacity: 0.6 }}
        />

        <h1 style={{
          fontSize: 27, fontWeight: 800, color: "#C5A059",
          textAlign: "center", marginBottom: 16,
        }}>
          This system is private
        </h1>

        <p style={{
          fontSize: 13, fontWeight: 400, color: "#8E9196",
          textAlign: "center", marginBottom: 32, lineHeight: 1.6,
        }}>
          If you believe you should have access, contact{" "}
          <a
            href="mailto:nik@stza.io"
            style={{ color: "#C5A059", textDecoration: "underline" }}
          >
            nik@stza.io
          </a>
          .
        </p>

        <Link
          href="/login"
          style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            padding: "10px 20px", borderRadius: 8,
            fontWeight: 700, fontSize: 13,
            color: "#B08D3F", background: "#FFFFFF",
            border: "1px solid rgba(212,197,169,.5)",
            textDecoration: "none",
          }}
        >
          Return to sign-in
        </Link>
      </div>
    </div>
  );
}
