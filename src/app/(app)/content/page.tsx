/**
 * Content Engine page.
 * Shows AfricanSTN weekly series editions and weekly reports.
 */

import { fetchEditions, type Edition } from "@/lib/data/content";

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

export default async function ContentPage() {
  const editionsRes = await fetchEditions();
  const editions = editionsRes.data?.data ?? [];

  const published = editions.filter((e) => e.status === "published").length;
  const inProgress = editions.filter((e) =>
    ["drafting", "draft", "drafted", "review", "researching"].includes(
      e.status
    )
  ).length;
  const totalWords = editions.reduce(
    (sum, e) => sum + (e.word_count ?? 0),
    0
  );

  return (
    <div className="space-y-8" style={{ fontFamily: "Calibri, sans-serif" }}>
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-[#1A1C1E]">Content engine</h1>
        <p className="text-sm text-gray-500 mt-1">
          AfricanSTN weekly series editions &middot; editorial pipeline
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total editions" value={editions.length.toString()} />
        <StatCard label="Published" value={published.toString()} />
        <StatCard label="In progress" value={inProgress.toString()} />
        <StatCard
          label="Total words"
          value={totalWords.toLocaleString()}
        />
      </div>

      {/* Editions grid */}
      <section>
        <h2 className="text-lg font-semibold text-[#1A1C1E] mb-3">
          Editions
        </h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {editions.map((e) => (
            <EditionCard key={e.id} edition={e} />
          ))}
        </div>
        {editions.length === 0 && (
          <p className="text-sm text-gray-500">No editions found.</p>
        )}
      </section>

      {/* Error */}
      {editionsRes.error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-4">
          <strong>API error:</strong> {editionsRes.error}
        </div>
      )}
    </div>
  );
}

function EditionCard({ edition }: { edition: Edition }) {
  return (
    <div className="border border-gray-200 rounded-lg p-4 flex flex-col justify-between">
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-gray-400 font-medium">
            Edition #{edition.edition_number}
          </span>
          <span
            className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLOURS[edition.status] ?? "bg-gray-100 text-gray-700"}`}
          >
            {edition.status}
          </span>
        </div>
        <h3 className="font-semibold text-[#1A1C1E] text-sm leading-tight">
          {edition.title}
        </h3>
        {edition.subtitle && (
          <p className="text-xs text-gray-500 mt-1">{edition.subtitle}</p>
        )}
      </div>
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100">
        <span className="text-xs text-gray-400">
          {edition.country_name ?? "—"}
        </span>
        {edition.word_count != null && (
          <span className="text-xs text-gray-400">
            {edition.word_count.toLocaleString()} words
          </span>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-200 p-4">
      <div className="text-2xl font-bold text-[#1A1C1E]">{value}</div>
      <div className="text-xs text-gray-500 mt-1">{label}</div>
    </div>
  );
}
