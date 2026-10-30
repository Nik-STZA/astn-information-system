import { describe, expect, it } from "vitest";
import { markdownToHtml } from "./markdown";

describe("markdownToHtml", () => {
  it("still renders the markdown briefs use", () => {
    const html = markdownToHtml("## Title\n\nSome **bold** text\n\n- one\n- two\n\n[Site](https://example.com/a?b=1&c=2)");
    expect(html).toContain("<h2>Title</h2>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<li>one</li>");
    expect(html).toContain('href="https://example.com/a?b=1&amp;c=2"');
  });

  it("shows raw HTML as text, so it cannot run", () => {
    for (const bad of ["<script>alert(1)</script>", "<img src=x onerror=alert(1)>", "<svg onload=alert(1)>"]) {
      const html = markdownToHtml(bad);
      expect(html).not.toContain("<script");
      expect(html).not.toContain("<img");
      expect(html).not.toContain("<svg");
    }
  });

  it("drops links that aren't web, mail or our own", () => {
    for (const href of ["javascript:alert(1)", "JavaScript:alert(1)", "data:text/html,x", "//evil.example", "vbscript:x"]) {
      const html = markdownToHtml(`[click](${href})`);
      expect(html).not.toContain("<a ");
      expect(html).toContain("click");
    }
  });

  it("can't break out of a link with a quote", () => {
    const html = markdownToHtml('[x](https://example.com" onmouseover="alert(1))');
    expect(html).not.toContain('" onmouseover="');
  });
});
