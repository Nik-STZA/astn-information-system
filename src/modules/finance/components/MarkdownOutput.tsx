"use client";

// Lightweight markdown renderer for agent output.
//
// Handles only what Claude actually produces: headers, bold, tables, lists,
// and paragraphs. No dependencies — keeps the bundle lean and avoids pulling
// in remark/rehype for formatting that is entirely predictable.

import { type CSSProperties, type ReactNode } from "react";

// ── Inline formatting ───────────────────────────────────────────────────────

function inlineFormat(text: string): ReactNode[] {
  // Split on **bold** and `code` spans
  const parts: ReactNode[] = [];
  const regex = /(\*\*(.+?)\*\*|`(.+?)`)/g;
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    if (match[2]) {
      parts.push(<strong key={match.index} style={{ color: "var(--tx)" }}>{match[2]}</strong>);
    } else if (match[3]) {
      parts.push(
        <code
          key={match.index}
          style={{
            fontSize: "0.9em",
            padding: "1px 5px",
            borderRadius: 3,
            background: "rgba(197,160,89,.08)",
            border: "1px solid var(--bd)",
          }}
        >
          {match[3]}
        </code>
      );
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

// ── Table parser ────────────────────────────────────────────────────────────

const TABLE_STYLE: CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: 12,
  margin: "6px 0 10px",
};
const TH_STYLE: CSSProperties = {
  textAlign: "left",
  padding: "6px 10px",
  borderBottom: "2px solid var(--bd)",
  color: "var(--sub)",
  fontWeight: 700,
  fontSize: 10.5,
  letterSpacing: ".03em",
  textTransform: "uppercase",
};
const TD_STYLE: CSSProperties = {
  padding: "5px 10px",
  borderBottom: "1px solid var(--bd)",
  color: "var(--tx)",
};

function parseTableRow(line: string): string[] {
  return line
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

function isSeparator(line: string): boolean {
  return /^\|[\s\-:|]+\|$/.test(line.trim()) || /^[\s\-:|]+$/.test(line.trim());
}

function renderTable(rows: string[]): ReactNode {
  const header = parseTableRow(rows[0]);
  const body = rows.slice(2).map(parseTableRow); // skip separator row

  // Detect right-alignment from separator row
  const sep = rows[1] ? parseTableRow(rows[1]) : [];
  const alignments = sep.map((s) => {
    const trimmed = s.trim();
    if (trimmed.startsWith(":") && trimmed.endsWith(":")) return "center" as const;
    if (trimmed.endsWith(":")) return "right" as const;
    return "left" as const;
  });

  // Auto-detect numeric columns (right-align if most body cells look numeric)
  const effectiveAlign = alignments.map((a, i) => {
    if (a !== "left") return a;
    const numericCount = body.filter((r) => r[i] && /^[\d£$€,.\-]+%?$/.test(r[i].replace(/\*\*/g, "").trim())).length;
    return numericCount > body.length * 0.5 ? ("right" as const) : a;
  });

  return (
    <table style={TABLE_STYLE}>
      <thead>
        <tr>
          {header.map((h, i) => (
            <th key={i} style={{ ...TH_STYLE, textAlign: effectiveAlign[i] ?? "left" }}>
              {inlineFormat(h)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {body.map((row, ri) => (
          <tr key={ri}>
            {row.map((cell, ci) => (
              <td key={ci} style={{ ...TD_STYLE, textAlign: effectiveAlign[ci] ?? "left" }}>
                {inlineFormat(cell)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── Block parser ────────────────────────────────────────────────────────────

export default function MarkdownOutput({ text }: { text: string }) {
  const lines = text.split("\n");
  const elements: ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Empty line — skip
    if (!trimmed) {
      i++;
      continue;
    }

    // Table: starts with | and next line is a separator
    if (trimmed.startsWith("|") && i + 1 < lines.length && isSeparator(lines[i + 1].trim())) {
      const tableRows: string[] = [trimmed];
      i++;
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        tableRows.push(lines[i].trim());
        i++;
      }
      elements.push(<div key={`t-${i}`}>{renderTable(tableRows)}</div>);
      continue;
    }

    // Headers
    const headerMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (headerMatch) {
      const level = headerMatch[1].length;
      const sizes: Record<number, CSSProperties> = {
        1: { fontSize: 16, fontWeight: 700, marginTop: 14, marginBottom: 6 },
        2: { fontSize: 14, fontWeight: 700, marginTop: 12, marginBottom: 5 },
        3: { fontSize: 12.5, fontWeight: 700, marginTop: 10, marginBottom: 4, color: "var(--sub)" },
        4: { fontSize: 11.5, fontWeight: 600, marginTop: 8, marginBottom: 3, color: "var(--sub)" },
      };
      elements.push(
        <div key={`h-${i}`} style={{ color: "var(--tx)", ...sizes[level] }}>
          {inlineFormat(headerMatch[2])}
        </div>
      );
      i++;
      continue;
    }

    // Unordered list
    if (/^[-*]\s/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*]\s+/, ""));
        i++;
      }
      elements.push(
        <ul key={`ul-${i}`} style={{ margin: "4px 0 8px", paddingLeft: 20 }}>
          {items.map((item, j) => (
            <li key={j} style={{ marginBottom: 3, color: "var(--tx)", fontSize: 12.5, lineHeight: 1.5 }}>
              {inlineFormat(item)}
            </li>
          ))}
        </ul>
      );
      continue;
    }

    // Numbered list
    if (/^\d+[.)]\s/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+[.)]\s/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+[.)]\s+/, ""));
        i++;
      }
      elements.push(
        <ol key={`ol-${i}`} style={{ margin: "4px 0 8px", paddingLeft: 20 }}>
          {items.map((item, j) => (
            <li key={j} style={{ marginBottom: 3, color: "var(--tx)", fontSize: 12.5, lineHeight: 1.5 }}>
              {inlineFormat(item)}
            </li>
          ))}
        </ol>
      );
      continue;
    }

    // Horizontal rule
    if (/^[-*_]{3,}$/.test(trimmed)) {
      elements.push(<hr key={`hr-${i}`} style={{ border: "none", borderTop: "1px solid var(--bd)", margin: "8px 0" }} />);
      i++;
      continue;
    }

    // Paragraph — collect consecutive non-special lines
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].trim().startsWith("#") &&
      !lines[i].trim().startsWith("|") &&
      !/^[-*]\s/.test(lines[i].trim()) &&
      !/^\d+[.)]\s/.test(lines[i].trim()) &&
      !/^[-*_]{3,}$/.test(lines[i].trim())
    ) {
      paraLines.push(lines[i].trim());
      i++;
    }
    if (paraLines.length) {
      elements.push(
        <p key={`p-${i}`} style={{ margin: "4px 0 8px", color: "var(--tx)", fontSize: 12.5, lineHeight: 1.55 }}>
          {inlineFormat(paraLines.join(" "))}
        </p>
      );
    }
  }

  return <div>{elements}</div>;
}
