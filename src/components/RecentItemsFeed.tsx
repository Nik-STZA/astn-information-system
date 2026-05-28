import type { RecentItem } from "@/lib/data/overview";

function formatDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * Recent items feed on the overview page.
 * Each item shows title, source, date, and vertical tags.
 * Title is a link to the original source.
 */
export default function RecentItemsFeed({ items }: { items: RecentItem[] }) {
  if (items.length === 0) {
    return (
      <div className="card p-8 text-center">
        <p className="text-body-app text-warm-grey">
          No recent items in the pipeline. The next scheduled fetch will populate this view.
        </p>
      </div>
    );
  }

  return (
    <div className="card overflow-hidden">
      <ul className="divide-y divide-gold-border">
        {items.map((item) => (
          <li key={item.id} className="px-5 py-3.5 hover:bg-warm-light transition-colors">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
              <div className="flex-1 min-w-0">
                {item.url ? (
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-body-app text-near-black hover:text-brand-gold font-medium block"
                  >
                    {item.title}
                  </a>
                ) : (
                  <p className="text-body-app text-near-black font-medium">
                    {item.title}
                  </p>
                )}
                <div className="flex items-center gap-2 mt-1 text-caption text-warm-grey">
                  <span>{item.source}</span>
                  {item.createdAt && (
                    <>
                      <span>&middot;</span>
                      <span>{formatDate(item.createdAt)}</span>
                    </>
                  )}
                  {item.languageCode && item.languageCode !== "EN" && (
                    <>
                      <span>&middot;</span>
                      <span
                        className="pill bg-warm-light text-brand-dark border border-gold-border"
                        title="Non-English source"
                      >
                        {item.languageCode}
                      </span>
                    </>
                  )}
                </div>
              </div>
              {item.verticals.length > 0 && (
                <div className="flex flex-wrap gap-1.5 sm:flex-shrink-0">
                  {item.verticals.slice(0, 3).map((v) => (
                    <span
                      key={v}
                      className="pill bg-warm-light text-brand-dark border border-gold-border"
                    >
                      {v}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
