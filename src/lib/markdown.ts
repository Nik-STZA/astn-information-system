/**
 * Simple markdown → HTML for weekly briefs and editions. These are drafted from
 * web sources, so the text is escaped first: only the markup made here reaches
 * the page, and links go only to web, mail or our own addresses.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const SAFE_HREF = /^(https?:\/\/|mailto:|\/(?!\/)|#)/i;

export function markdownToHtml(md: string): string {
  let html = escapeHtml(md)
    /* Headings — ## at line start */
    .replace(/^#### (.+)$/gm, "<h4>$1</h4>")
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    /* Horizontal rules */
    .replace(/^---+$/gm, "<hr/>")
    /* Bold + italic */
    .replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    /* Links */
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label: string, href: string) =>
      SAFE_HREF.test(href)
        ? `<a href="${href}" target="_blank" rel="noopener noreferrer" style="color:#C5A059;text-decoration:underline">${label}</a>`
        : label,
    );

  /* Unordered lists: lines starting with - */
  html = html.replace(
    /(^- .+(?:\n- .+)*)/gm,
    (block) => {
      const items = block
        .split("\n")
        .map((l) => `<li>${l.replace(/^- /, "")}</li>`)
        .join("\n");
      return `<ul>${items}</ul>`;
    },
  );

  /* Wrap remaining plain lines in <p> — skip already-wrapped elements */
  html = html
    .split("\n\n")
    .map((block) => {
      const trimmed = block.trim();
      if (!trimmed) return "";
      if (/^<(h[1-6]|ul|ol|hr|table|blockquote|div|p)/.test(trimmed))
        return trimmed;
      return `<p>${trimmed.replace(/\n/g, "<br/>")}</p>`;
    })
    .join("\n");

  return html;
}
