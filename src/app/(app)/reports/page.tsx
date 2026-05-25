import Image from "next/image";

/**
 * Reports landing - skeleton for v1 Day 1.
 *
 * Wednesday's build will add the profile report builder (shape A) in full.
 * v1.1 adds shape C (narrative reports). v1.2 adds B and D.
 */
export default function ReportsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1>Reports</h1>
        <p className="text-caption text-warm-grey mt-1">
          Produce briefings, profiles, exports, and narrative reports from the registry.
        </p>
      </div>

      <nav className="border-b border-gold-border">
        <ul className="flex gap-1">
          <li>
            <span className="inline-block px-4 py-2.5 text-body-app font-bold text-brand-gold border-b-2 border-brand-gold">
              Profile reports
            </span>
          </li>
          <li>
            <span className="inline-block px-4 py-2.5 text-body-app text-warm-grey">
              Narrative reports <span className="text-caption">(v1.1)</span>
            </span>
          </li>
          <li>
            <span className="inline-block px-4 py-2.5 text-body-app text-warm-grey">
              Filtered exports <span className="text-caption">(v1.2)</span>
            </span>
          </li>
          <li>
            <span className="inline-block px-4 py-2.5 text-body-app text-warm-grey">
              Snapshot exports <span className="text-caption">(v1.2)</span>
            </span>
          </li>
        </ul>
      </nav>

      <div className="card p-10 flex flex-col items-center text-center">
        <Image
          src="/logos/protea-mono-gold.png"
          alt=""
          width={80}
          height={80}
          className="mb-4 opacity-40"
        />
        <h2 className="mb-2">Profile report builder coming Wednesday</h2>
        <p className="text-body-app text-warm-grey max-w-xl">
          Select an organisation or filtered subset and generate a brand-correct Word document profile.
          The builder ships in Wednesday&apos;s deployment as part of the v1 release for Thursday&apos;s demo.
        </p>
      </div>
    </div>
  );
}
