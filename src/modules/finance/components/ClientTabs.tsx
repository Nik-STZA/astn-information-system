// Client-scoped tab bar for the Finance module: retired.
//
// The sidebar now lists the chosen client's sections (redesign, 27 Oct 2026),
// so this bar would only repeat it. It renders nothing; the pages drop their
// <ClientTabs> calls as each is restyled, and then this file goes.

export default function ClientTabs(props: { slug: string; active: string }) {
  void props;
  return null;
}
