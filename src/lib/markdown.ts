/**
 * Simple markdown → HTML for trusted, internally-generated content
 * (weekly briefs, editions). Not for user-supplied input.
 */
export function markdownToHtml(md: string): string {
  let html = md
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
    .replace(
      /\[([^\]]+)\]\(([^)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer" style="color:#C5A059;text-decoration:underline">$1</a>',
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
