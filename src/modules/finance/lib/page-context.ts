// What the person has open, sent with a question to an agent so "this bill" means
// something. It travels in the instruction, after a marker, so a follow-up keeps
// it; the portal shows only what was asked.

export const PAGE_MARK = "What I have open in os.stza.io";
const SEPARATOR = `\n\n---\n${PAGE_MARK}`;
// A screen is a page or two of text; ids in the query do the rest.
const MAX_SCREEN = 3000;

export interface PageContext {
  slug: string;
  section: string;
  path: string;
  entity: string | null;
  item: string | null;
}

// The client a path belongs to, or null on a page that is not a client's.
export function clientSlugOf(pathname: string): string | null {
  const m = /^\/(?:finance\/clients|clients\/all)\/([a-z0-9-]+)/.exec(pathname);
  return m ? m[1] : null;
}

const SECTIONS: Array<[RegExp, string]> = [
  [/\/bills/, "Bills"], [/\/work/, "Work"], [/\/procedures/, "Procedures"], [/\/reports/, "Reports"],
  [/\/approvals/, "Approvals"], [/\/xero/, "Xero"], [/\/agents/, "Agents"],
];

export function pageContext(pathname: string, query: URLSearchParams): PageContext | null {
  const slug = clientSlugOf(pathname);
  if (!slug) return null;
  const section = SECTIONS.find(([re]) => re.test(pathname))?.[1] ?? (pathname.startsWith("/clients") ? "Client set-up" : "Finance");
  return { slug, section, path: pathname, entity: query.get("entity"), item: query.get("item") };
}

// The agent most likely to be wanted on a page.
export function agentFor(section: string): string {
  return section === "Bills" ? "ap-clerk" : "";
}

export function withPageContext(instruction: string, c: PageContext, screen: string): string {
  const facts = [
    `Page: ${c.section} (${c.path})`,
    c.entity ? `Company: ${c.entity}` : null,
    c.item ? `Bills item: ${c.item}` : null,
  ].filter(Boolean).join("\n");
  const text = screen.trim().slice(0, MAX_SCREEN);
  return `${instruction.trim()}${SEPARATOR}\n${facts}${text ? `\nOn screen:\n${text}` : ""}`;
}

// The question alone, for showing it back.
export function askedText(instruction: string): string {
  const at = instruction.indexOf(SEPARATOR);
  return at === -1 ? instruction : instruction.slice(0, at);
}
