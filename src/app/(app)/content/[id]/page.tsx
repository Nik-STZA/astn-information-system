/**
 * Edition detail page.
 * Shows full content for a single AfricanSTN weekly edition.
 */

import { fetchEditions, type Edition } from "@/lib/data/content";
import Link from "next/link";
import { notFound } from "next/navigation";

const STATUS_COLOURS: Record<string, string> = {
  planned: "bg-gray-100 text-gray-700",
  researching: "bg-blue-100 text-blue-800",
  drafting: "bg-amber-100 text-amber-800",
  draft: "bg-amber-100 text-amber-800",
  drafted: "bg-amber-100 text-amber-800",
  review: "bg-purple-100 text-purple-800",
  scheduled: "bg-indigo-100 text-indigo-800",
  published: "bg-emerald-100 text-emerald-800",
  archived: "bg-gray-100 text-gray-500",
};

export default async function EditionDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const editionsRes = await fetchEditions();
  const editions = editionsRes.data?.data ?? [];
  const edition = editions.find((e) => String(e.id) === params.id);

  if (!edition) return notFound();

  return (
    <div className="space-y-6" style={{ fontFamily: "Calibri, sans-serif" }}>
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm">
        <Link
          href="/content"
          className="text-[#C5A059] hover:underline"
        >
          Content
        </Link>
        <span className="text-gray-300">/</span>
        <span className="text-gray-500">Edition #{edition.edition_number}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#1A1C1E]">
            {edition.title}
          </h1>
          {edition.subtitle && (
            <p className="text-sm text-gray-500 mt-1">{edition.subtitle}</p>
          )}
        </div>
        <span
          className={`inline-block px-3 py-1 rounded text-xs font-medium whitespace-nowrap ${STATUS_COLOURS[edition.status] ?? "bg-gray-100 text-gray-700"}`}
        >
          {edition.status}
        </span>
      </div>

      {/* Meta */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetaCard label="Series" value={edition.series} />
        <MetaCard label="Country" value={edition.country_name ?? "—"} />
        <MetaCard
          label="Word count"
          value={edition.word_count?.toLocaleString() ?? "—"}
        />
        <MetaCard
          label="Target publish"
          value={
            edition.target_publish_date
              ? new Date(edition.target_publish_date).toLocaleDateString(
                  "en-GB",
                  { day: "numeric", month: "short", year: "numeric" }
                )
              : "—"
          }
        />
      </div>

      {/* Content area */}
      <section className="border border-gray-200 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-[#1A1C1E] mb-4">
          Edition content
        </h2>
        {edition.file_path ? (
          <div className="prose prose-sm max-w-none text-gray-600">
            <p className="text-sm text-gray-500 italic">
              Content file: {edition.file_path}
            </p>
            <p className="text-sm text-gray-400 mt-2">
              Content rendering from file storage will be available once the
              content pipeline is connected. The file exists at the path above.
            </p>
          </div>
        ) : (
          <div className="text-center py-12 text-gray-400">
            <p className="text-sm">
              No content file attached to this edition yet.
            </p>
            <p className="text-xs mt-1">
              Content will appear here once drafted by the Content Agent or
              uploaded manually.
            </p>
          </div>
        )}
      </section>

      {/* Timeline */}
      <section className="border border-gray-200 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-[#1A1C1E] mb-4">
          Timeline
        </h2>
        <div className="space-y-3">
          <TimelineItem
            label="Created"
            date={edition.created_at}
            active
          />
          <TimelineItem
            label="Last updated"
            date={edition.updated_at}
            active
          />
          {edition.target_publish_date && (
            <TimelineItem
              label="Target publish"
              date={edition.target_publish_date}
              active={!!edition.actual_publish_date}
            />
          )}
          {edition.actual_publish_date && (
            <TimelineItem
              label="Published"
              date={edition.actual_publish_date}
              active
            />
          )}
        </div>
      </section>

      {/* Back link */}
      <Link
        href="/content"
        className="inline-flex items-center gap-1 text-sm text-[#C5A059] hover:underline"
      >
        ← Back to all editions
      </Link>
    </div>
  );
}

function MetaCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-200 p-3">
      <div className="text-sm font-semibold text-[#1A1C1E]">{value}</div>
      <div className="text-xs text-gray-400 mt-0.5">{label}</div>
    </div>
  );
}

function TimelineItem({
  label,
  date,
  active,
}: {
  label: string;
  date: string;
  active: boolean;
}) {
  const formatted = new Date(date).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  return (
    <div className="flex items-center gap-3">
      <div
        className={`w-2.5 h-2.5 rounded-full ${active ? "bg-[#C5A059]" : "bg-gray-200"}`}
      />
      <span className="text-sm text-gray-600 w-32">{label}</span>
      <span className="text-sm text-gray-400">{formatted}</span>
    </div>
  );
}
