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
    <div className="min-h-screen flex flex-col items-center justify-center bg-near-black p-6">
      <div className="flex flex-col items-center max-w-md w-full">
        <Image
          src="/logos/protea-mono-gold.png"
          alt=""
          width={120}
          height={120}
          className="mb-8 opacity-60"
        />

        <h1 className="text-h1-app text-brand-gold text-center mb-4 font-bold">
          This system is private
        </h1>

        <p className="text-body-app text-warm-grey text-center mb-8">
          If you believe you should have access, contact{" "}
          <a
            href="mailto:nik@stza.io"
            className="text-brand-gold underline hover:text-brand-gold/80"
          >
            nik@stza.io
          </a>
          .
        </p>

        <Link href="/login" className="btn-secondary">
          Return to sign-in
        </Link>
      </div>
    </div>
  );
}
