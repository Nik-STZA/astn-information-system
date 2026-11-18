// Reads the first worksheet of an .xlsx file into rows of cell text, in the
// browser, with no library: an xlsx is a zip of XML parts. Only what a mapping
// file needs: shared strings, inline strings, numbers and booleans as text.
// Formulas give their cached value. Dates come through as Excel serial numbers.

type Entry = { name: string; method: number; size: number; offset: number };

function zipEntries(buf: Uint8Array): Entry[] {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("This is not an xlsx file (no zip directory found)");
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out: Entry[] = [];
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error("The xlsx file is damaged (bad zip directory)");
    const method = dv.getUint16(p + 10, true);
    const size = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const offset = dv.getUint32(p + 42, true);
    out.push({ name: dec.decode(buf.subarray(p + 46, p + 46 + nameLen)), method, size, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

async function readEntry(buf: Uint8Array, e: Entry): Promise<string> {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const start = e.offset + 30 + dv.getUint16(e.offset + 26, true) + dv.getUint16(e.offset + 28, true);
  const data = buf.slice(start, start + e.size);
  if (e.method === 0) return new TextDecoder().decode(data);
  if (e.method !== 8) throw new Error(`The xlsx file uses compression ${e.method}, which cannot be read here`);
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Response(stream).text();
}

const unescape = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, x: string) => {
    const k = x.toLowerCase();
    if (k === "amp") return "&";
    if (k === "lt") return "<";
    if (k === "gt") return ">";
    if (k === "quot") return '"';
    if (k === "apos") return "'";
    return String.fromCodePoint(k.startsWith("#x") ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10));
  });

// All the <t> text inside a fragment, joined (rich text has several runs).
const texts = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g)].map((m) => unescape(m[1] ?? "")).join("");

const attr = (tag: string, name: string) => {
  const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`));
  return m ? unescape(m[1]) : null;
};

function colIndex(ref: string): number {
  const letters = ref.replace(/[^A-Z]/gi, "").toUpperCase();
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export async function readXlsx(data: ArrayBuffer | Uint8Array): Promise<{ sheet: string; rows: string[][] }> {
  const buf = data instanceof Uint8Array ? data : new Uint8Array(data);
  const entries = zipEntries(buf);
  const byName = new Map(entries.map((e) => [e.name.replace(/^\/+/, ""), e]));
  const part = async (name: string) => {
    const e = byName.get(name);
    return e ? readEntry(buf, e) : null;
  };

  const workbook = await part("xl/workbook.xml");
  if (!workbook) throw new Error("This is not an xlsx file (no workbook)");
  const firstSheet = workbook.match(/<sheet\s[^>]*>/);
  if (!firstSheet) throw new Error("The workbook has no sheets");
  const sheetName = attr(firstSheet[0], "name") ?? "Sheet1";
  const rid = attr(firstSheet[0], "r:id");
  let target = "worksheets/sheet1.xml";
  const rels = await part("xl/_rels/workbook.xml.rels");
  if (rels && rid) {
    const rel = [...rels.matchAll(/<Relationship\s[^>]*>/g)].map((m) => m[0]).find((t) => attr(t, "Id") === rid);
    const t = rel ? attr(rel, "Target") : null;
    if (t) target = t;
  }
  const sheetPath = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
  const sheet = await part(sheetPath);
  if (!sheet) throw new Error(`The workbook's first sheet (${sheetPath}) is missing`);

  const sharedXml = await part("xl/sharedStrings.xml");
  const shared = sharedXml ? [...sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => texts(m[1])) : [];

  const rows: string[][] = [];
  for (const rm of sheet.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>|<row\b([^>]*)\/>/g)) {
    const rAttr = attr(`<row${rm[1] ?? rm[3] ?? ""}>`, "r");
    const rowAt = rAttr ? parseInt(rAttr, 10) - 1 : rows.length;
    const cells: string[] = [];
    let next = 0;
    for (const cm of (rm[2] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const open = `<c${cm[1]}>`;
      const ref = attr(open, "r");
      const at = ref ? colIndex(ref) : next;
      next = at + 1;
      const type = attr(open, "t");
      const body = cm[2] ?? "";
      const v = body.match(/<v>([\s\S]*?)<\/v>/);
      let value = "";
      if (type === "s") value = v ? shared[parseInt(v[1], 10)] ?? "" : "";
      else if (type === "inlineStr") value = texts(body);
      else if (type === "b") value = v ? (v[1] === "1" ? "TRUE" : "FALSE") : "";
      else value = v ? unescape(v[1]) : "";
      cells[at] = value;
    }
    rows[rowAt] = Array.from(cells, (c) => c ?? "");
  }
  return { sheet: sheetName, rows: Array.from(rows, (r) => r ?? []) };
}
