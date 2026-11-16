#!/usr/bin/env python3
"""Asset register importer (docs/asset-register-spec.md section 8).

Reads one register workbook (a copy re-saved by Excel, so its formula results
are cached) and writes the JSON a finance-api bulk endpoint loads: assets,
cost lines and opening amortisation, each row carrying where it came from.
It also prints the opening reconciliation: per asset (invoices against each
tab's typed total) and per company and account (against Xero's trial balance).

Refuses, naming the cell, any formula the importer reads that has no cached
result. A formula whose cached result is an empty string is valid; openpyxl
reads both as None, so the cache is read from the sheet XML.

Client specifics (company names, account codes) come from a profile file kept
with the client's data, never from this script.

  python -I asset-register-import.py --layout ip_register --profile P.json
      --file RESAVED.xlsx --original ORIGINAL.xlsx --as-at 2026-08-31
      [--tb TB.json] --out OUT.json
"""
import argparse
import collections
import datetime as dt
import hashlib
import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

import openpyxl

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
R2 = lambda x: round(float(x or 0) + 0.0, 2)


class Refused(Exception):
    pass


# ── Files ────────────────────────────────────────────────────────────────────

def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def sheet_xml_paths(z):
    wb = z.read("xl/workbook.xml").decode("utf-8")
    rels = z.read("xl/_rels/workbook.xml.rels").decode("utf-8")
    target = {}
    for m in re.finditer(r"<Relationship ([^>]*)/>", rels):
        a = dict(re.findall(r'(\w+)="([^"]*)"', m.group(1)))
        t = a["Target"].lstrip("/")
        target[a["Id"]] = t if t.startswith("xl/") else "xl/" + t
    out = {}
    for m in re.finditer(r"<sheet ([^>]*)/>", wb):
        a = dict(re.findall(r'([\w:]+)="([^"]*)"', m.group(1)))
        name = a["name"].replace("&amp;", "&")
        out[name] = target[a["r:id"]]
    return out


def uncached(path, sheets):
    """Formula cells in these sheets with no cached result: [(sheet, cell)]."""
    bad = []
    with zipfile.ZipFile(path) as z:
        paths = sheet_xml_paths(z)
        for s in sheets:
            if s not in paths:
                raise Refused(f"sheet '{s}' is not in {path}")
            for _, el in ET.iterparse(z.open(paths[s])):
                if el.tag == NS + "c":
                    f = el.find(NS + "f")
                    if f is not None:
                        v = el.find(NS + "v")
                        if v is None or (not (v.text or "") and el.get("t") != "str"):
                            bad.append((s, el.get("r")))
                    el.clear()
    return bad


# ── Helpers ──────────────────────────────────────────────────────────────────

def day(v):
    if isinstance(v, dt.datetime):
        return None if v.year < 1901 else v.date().isoformat()
    if isinstance(v, dt.date):
        return v.isoformat()
    return None


def text(v):
    if v is None:
        return None
    s = str(v).strip()
    return s or None


def num(v):
    if v in (None, ""):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    try:
        return float(str(v).replace(",", ""))
    except ValueError:
        return None


class Ctx:
    def __init__(self, profile, file, original, as_at):
        self.profile = profile
        self.file = file
        self.as_at = as_at
        self.source = {
            "file": original, "original_sha256": sha256(original),
            "read_sha256": sha256(file), "original_modified": dt.datetime.fromtimestamp(
                __import__("os").path.getmtime(original), dt.timezone.utc).isoformat(timespec="seconds"),
        }
        self.findings = []

    def ref(self, sheet, row):
        return {"file": self.source["file"], "sheet": sheet, "row": row,
                "original_sha256": self.source["original_sha256"], "read_sha256": self.source["read_sha256"]}

    def entity(self, name, where):
        slug = self.profile["entities"].get(re.sub(r"\s+", " ", str(name or "")).strip().lower())
        if not slug:
            self.findings.append({"kind": "unknown_company", "where": where, "value": name})
        return slug

    def find(self, kind, where, **kw):
        self.findings.append({"kind": kind, "where": where, **kw})


def header_map(ws, row):
    out = {}
    for c in next(ws.iter_rows(min_row=row, max_row=row)):
        v = text(c.value)
        if v:
            out[v] = c.column - 1
    return out


def col(h, *names):
    for n in names:
        for k, i in h.items():
            if k.lower().startswith(n.lower()):
                return i
    raise Refused(f"no column starting {names[0]!r}; the layout has changed")


def month_col(ws, row, as_at):
    want = dt.date.fromisoformat(as_at)
    for c in next(ws.iter_rows(min_row=row, max_row=row)):
        if isinstance(c.value, dt.datetime) and c.value.date() == want:
            return c.column - 1
    raise Refused(f"no {as_at} column on '{ws.title}'")


# ── IP register layout ───────────────────────────────────────────────────────

IP_SHEETS = ["Tracking of all IA", "Registered Assets", "Pending Assets", "Reg. Asset  Acc Depr.", "Impairments & Write-offs"]
ASSET_NO = re.compile(r"^[A-Z]{3}-[A-Z]{3}-[0-9]{3,4}")


def treatment_of(raw, why):
    r = (raw or "").strip().lower()
    w = (why or "").strip().lower()
    if r.startswith("capital"):
        return "capitalise"
    if r.startswith("expense"):
        return "expense_research" if re.search(r"research|search|feasib|prior art|landscap", w) else "expense_admin"
    return None


def extract_ip(ctx, wb):
    accounts = ctx.profile["ip_registered"]["accounts"]
    assets = {}

    def acct(kind, where):
        a = accounts.get(kind or "")
        if not a:
            ctx.find("unknown_asset_type", where, value=kind)
        return a or {}

    # Master list.
    ws = wb["Tracking of all IA"]
    h = header_map(ws, 2)
    c = {k: col(h, n) for k, n in [("owner", "IP Owner"), ("no", "Intangible Asset No"), ("name", "Asset Name"), ("ipo", "Local IPO"),
         ("wipo", "WIPO"), ("type", "Asset Type"), ("cat", "2 - Category"), ("reg", "Registration No"), ("jur", "Jurisdiction"),
         ("status", "Status"), ("filed", "Filing Date"), ("entry", "Date of Entry"), ("expiry", "Expiry"), ("cost", "Capitalised")]}
    for i, r in enumerate(ws.iter_rows(min_row=3, values_only=True), start=3):
        no = text(r[c["no"]])
        if not no or not ASSET_NO.match(no):
            if no:
                ctx.find("not_an_asset", f"Tracking of all IA row {i}", value=no)
            continue
        if "-TBD-" in no:
            ctx.find("budget_placeholder", f"Tracking of all IA row {i}", value=no, note="goes to planned lines, not the register")
            continue
        assets[no] = {
            "asset_no": no, "entity": ctx.entity(r[c["owner"]], f"Tracking of all IA row {i}"),
            "name": text(r[c["name"]]), "asset_type": text(r[c["type"]]), "status_raw": text(r[c["status"]]),
            "ip_category": text(r[c["cat"]]), "registration_no": text(r[c["reg"]]), "jurisdiction": text(r[c["jur"]]),
            "ipo_url": text(r[c["ipo"]]) if text(r[c["ipo"]]) not in ("0", "-") else None,
            "wipo_url": text(r[c["wipo"]]) if text(r[c["wipo"]]) not in ("0", "-") else None,
            "filing_date": day(r[c["filed"]]), "registration_date": day(r[c["entry"]]), "expiry_date": day(r[c["expiry"]]),
            "tracking_cost": num(r[c["cost"]]), "source_ref": ctx.ref("Tracking of all IA", i),
        }

    # Amortisation settings and typed cost for registered assets.
    ws = wb["Registered Assets"]
    h = header_map(ws, 3)
    c = {k: col(h, n) for k, n in [("no", "Asset No"), ("type", "Asset Type"), ("status", "Status"), ("entry", "Date of Entry"),
         ("cost", "Capitalised"), ("method", "Amortisation method"), ("period", "Amortisation Period"), ("end", "Amort. End"),
         ("disposal", "Disposal Date"), ("imp_date", "Impairment Date"), ("imp_amt", "Impairment Amount"), ("imp_why", "Impairment Reason")]}
    for i, r in enumerate(ws.iter_rows(min_row=4, values_only=True), start=4):
        no = text(r[c["no"]])
        if not no or not ASSET_NO.match(no):
            continue
        a = assets.get(no)
        if not a:
            ctx.find("registered_not_in_tracking", f"Registered Assets row {i}", asset_no=no)
            continue
        a.update({"register_cost": num(r[c["cost"]]), "life_months": int(num(r[c["period"]]) or 0) or None,
                  "amort_end": day(r[c["end"]]), "registered_type": text(r[c["type"]]), "registered_status": text(r[c["status"]]),
                  "amort_start": day(r[c["entry"]]), "disposal_date": day(r[c["disposal"]]),
                  "impairment": {"date": day(r[c["imp_date"]]), "amount": num(r[c["imp_amt"]]), "reason": text(r[c["imp_why"]])}
                  if num(r[c["imp_amt"]]) else None})

    # Pending (WIP) assets.
    ws = wb["Pending Assets"]
    h = header_map(ws, 3)
    c = {k: col(h, n) for k, n in [("no", "Asset No"), ("type", "Asset Type"), ("cost", "Capitalised"), ("risk", "Impairment Risk"), ("next", "Notes")]}
    for i, r in enumerate(ws.iter_rows(min_row=4, values_only=True), start=4):
        no = text(r[c["no"]])
        if not no or not ASSET_NO.match(no):
            continue
        a = assets.get(no)
        if not a:
            ctx.find("pending_not_in_tracking", f"Pending Assets row {i}", asset_no=no)
            continue
        if a.get("register_cost") is not None:
            ctx.find("on_registered_and_pending", f"Pending Assets row {i}", asset_no=no,
                     registered_cost=R2(a["register_cost"]), pending_cost=R2(num(r[c["cost"]])),
                     note="held as registered: that is the tab whose totals tie to the ledger")
        a.update({"pending_cost": num(r[c["cost"]]), "pending_type": text(r[c["type"]]),
                  "impairment_risk": text(r[c["risk"]]), "next_action": text(r[c["next"]])})

    # Write-offs and impairments up to the opening date.
    ws = wb["Impairments & Write-offs"]
    h = header_map(ws, 4)
    c = {k: col(h, n) for k, n in [("date", "Date"), ("no", "Asset No"), ("why", "Trigger"), ("amt", "Impairment / write-off"),
         ("dr", "Dr account"), ("cr", "Cr account"), ("posted", "Posted"), ("ref", "Journal ref")]}
    for i, r in enumerate(ws.iter_rows(min_row=5, values_only=True), start=5):
        no, d, amt = text(r[c["no"]]), day(r[c["date"]]), num(r[c["amt"]])
        if not no or not ASSET_NO.match(no) or not amt or not d or d > ctx.as_at:
            continue
        a = assets.get(no)
        if not a:
            ctx.find("write_off_for_unknown_asset", f"Impairments & Write-offs row {i}", asset_no=no)
            continue
        cr = re.match(r"\s*(\d+)", text(r[c["cr"]]) or "")
        a["opening_impairment"] = {"date": d, "amount": R2(amt), "credit_account": cr.group(1) if cr else None,
                                   "debit": text(r[c["dr"]]), "reason": text(r[c["why"]]), "journal_ref": text(r[c["ref"]]),
                                   "source_ref": ctx.ref("Impairments & Write-offs", i)}
        if (text(r[c["posted"]]) or "").upper() != "Y":
            ctx.find("write_off_log_not_marked_posted", f"Impairments & Write-offs row {i}", asset_no=no, amount=R2(amt),
                     note="check the ledger: the opening tie shows whether it was posted")

    # Accumulated amortisation at the opening date.
    ws = wb["Reg. Asset  Acc Depr."]
    mc = month_col(ws, 3, ctx.as_at)
    for i, r in enumerate(ws.iter_rows(min_row=4, values_only=True), start=4):
        no = text(r[1])
        if no and no in assets:
            assets[no]["opening_accumulated"] = R2(r[mc])

    # Cost lines.
    lines = []
    cur_key, cur_net = None, None
    inv_sheet = ctx.profile["ip_registered"]["invoice_sheet"]
    ws = wb[inv_sheet]
    h = header_map(ws, 2)
    c = {k: col(h, n) for k, n in [("no", "Asset No"), ("vendor", "Vendor"), ("billed", "Invoice to"), ("owner", "Reg IP Owner"),
         ("date", "Invoice Date"), ("inv", "Invoice No"), ("project", "Project"), ("type", "Type"), ("work", "Work Description"),
         ("item", "Item"), ("item_type", "Item Type"), ("jur", "Jurisdiction"), ("cpc", "Cost per Country"), ("net", "Net"),
         ("vat", "Vat"), ("gross", "Gross"), ("status", "Status"), ("regno", "Reg. No"), ("treat", "Treatment"), ("why", "Treatment Explanation")]}
    for i, r in enumerate(ws.iter_rows(min_row=3, values_only=True), start=3):
        if not text(r[c["vendor"]]):
            continue
        where = f"{inv_sheet} row {i}"
        no = text(r[c["no"]])
        raw, why = text(r[c["treat"]]), text(r[c["why"]])
        t = treatment_of(raw, why)
        if raw and raw.lower().startswith("capital") and why and why.lower().startswith("expense"):
            ctx.find("treatment_contradicts_reason", where, asset_no=no, treatment=raw, reason=why[:120])
        amount = num(r[c["cpc"]]) if num(r[c["cpc"]]) is not None else num(r[c["net"]])
        # The first row of an invoice line carries its net; the per-country
        # rows below it carry only their share, and belong to it.
        if num(r[c["net"]]):
            cur_key, cur_net = f"{inv_sheet}|{text(r[c['inv']])}|row {i}", R2(r[c["net"]])
        elif cur_key is None:
            cur_key, cur_net = f"{inv_sheet}|row {i}", R2(amount)
        known = no in assets
        if no and not known and no != "REVIEW":
            ctx.find("line_for_unknown_asset", where, asset_no=no)
        lines.append({
            "source_type": "workbook", "supplier": text(r[c["vendor"]]), "invoice_no": text(r[c["inv"]]),
            "line_date": day(r[c["date"]]), "billed_entity": ctx.entity(r[c["billed"]], where),
            "owning_entity": ctx.entity(r[c["owner"]], where),
            "source_net": cur_net, "source_vat": R2(r[c["vat"]]), "source_gross": R2(r[c["gross"]]),
            "amount": R2(amount), "asset_no": no if known else None,
            # Capitalised cost always names its asset; without one the line
            # waits, unallocated, with a question.
            "treatment": None if (t == "capitalise" and not known) else t, "reason_text": why,
            "proposal_no": text(r[c["project"]]), "work_description": text(r[c["work"]]), "item": text(r[c["item"]]),
            "item_type": text(r[c["item_type"]]), "jurisdiction": text(r[c["jur"]]), "ipo_status": text(r[c["status"]]),
            "fields": {"source_key": cur_key, "registration_no": text(r[c["regno"]]), "workbook_treatment": raw,
                       **({"question": f"Which asset is this for? The workbook marks it {no or 'with no asset'}."} if not known else {})},
            "source_ref": ctx.ref(inv_sheet, i),
        })

    # Each asset's opening cost and accounts, from the tab that feeds the schedules.
    out = []
    for no, a in assets.items():
        registered = a.get("register_cost") is not None
        kind = a.get("registered_type") if registered else (a.get("pending_type") or a.get("asset_type"))
        ac = acct(kind, f"asset {no}")
        a["opening_cost"] = R2(a["register_cost"] if registered else (a.get("pending_cost") if a.get("pending_cost") is not None else a.get("tracking_cost")))
        a["cost_account"] = ac.get("cost")
        a["accum_account"] = ac.get("accumulated")
        a["status"] = "registered" if registered else "pending"
        if a.get("opening_impairment"):
            a["status"] = "impaired"
            if not a["opening_impairment"]["credit_account"]:
                a["opening_impairment"]["credit_account"] = a["cost_account"]
        a.setdefault("opening_accumulated", 0.0)
        out.append(a)
    return out, lines


# ── Tangible build layout ────────────────────────────────────────────────────

def extract_tangible(ctx, wb):
    p = ctx.profile["tangible_build"]
    assets = {}
    ws = wb["Tangible Assets - WIP"]
    h = header_map(ws, 3)
    c = {k: col(h, n) for k, n in [("entity", "Entity"), ("no", "Asset No"), ("name", "Asset Name"), ("type", "Asset Type"),
         ("start", "Start Date"), ("done", "Date of Completion"), ("cost", "Total WIP Cost")]}
    for i, r in enumerate(ws.iter_rows(min_row=4, values_only=True), start=4):
        no = text(r[c["no"]])
        if not no:
            continue
        assets[no] = {"asset_no": no, "entity": ctx.entity(r[c["entity"]], f"Tangible Assets - WIP row {i}"),
                      "name": text(r[c["name"]]), "status": "wip", "start_date": day(r[c["start"]]),
                      "completion_date": day(r[c["done"]]), "wip_cost": num(r[c["cost"]]),
                      "cost_account": p["wip_account"], "accum_account": None, "opening_accumulated": 0.0,
                      "source_ref": ctx.ref("Tangible Assets - WIP", i)}
    ws = wb["Tangible Assets - Cost"]
    h = header_map(ws, 3)
    c = {k: col(h, n) for k, n in [("no", "Asset No"), ("name", "Asset Name"), ("type", "Asset Type"), ("done", "Date of Completion")]}
    for i, r in enumerate(ws.iter_rows(min_row=4, values_only=True), start=4):
        no = text(r[c["no"]])
        if no in assets:
            assets[no].update({"completed_name": text(r[c["name"]]), "completed_type": text(r[c["type"]])})
            if day(r[c["done"]]) and day(r[c["done"]]) <= ctx.as_at:
                ctx.find("completed_before_opening", f"Tangible Assets - Cost row {i}", asset_no=no, note="a completed asset needs a signed transfer event")
    lines = []
    ws = wb["WIP Invoice Schedule"]
    h = header_map(ws, 2)
    c = {k: col(h, n) for k, n in [("no", "Asset No"), ("supplier", "Supplier"), ("inv", "Invoice No"), ("date", "Invoice Date"),
         ("amount", "Amount"), ("desc", "Description")]}
    for i, r in enumerate(ws.iter_rows(min_row=3, values_only=True), start=3):
        no = text(r[c["no"]])
        if not no or no not in assets:
            continue
        a = assets[no]
        amt = R2(r[c["amount"]])
        lines.append({"source_type": "workbook", "supplier": text(r[c["supplier"]]), "invoice_no": text(r[c["inv"]]),
                      "line_date": day(r[c["date"]]), "billed_entity": a["entity"], "owning_entity": a["entity"],
                      "source_net": amt, "amount": amt, "asset_no": no, "treatment": "capitalise",
                      "reason_text": "Cost of a self-constructed tangible asset under construction (FRS 102 s17), as the workbook's WIP Invoice Schedule.",
                      "work_description": text(r[c["desc"]]), "fields": {}, "source_ref": ctx.ref("WIP Invoice Schedule", i)})
    for a in assets.values():
        a["opening_cost"] = R2(sum(l["amount"] for l in lines if l["asset_no"] == a["asset_no"] and (l["line_date"] or "") <= ctx.as_at))
    return list(assets.values()), lines


# ── Development project layout ───────────────────────────────────────────────

def optional_col(h, *names):
    try:
        return col(h, *names)
    except Refused:
        return None


def extract_dev(ctx, wb):
    p = ctx.profile["dev_project"]
    ent = p["entity"]
    assets = {}
    ws = wb[p["asset_sheet"]]
    h = header_map(ws, 3)
    c = {k: col(h, n) for k, n in [("no", "Asset No"), ("name", "Asset Name"), ("type", "Asset Type"), ("status", "Status"), ("done", "Date of Completion")]}
    mc = month_col(ws, 3, ctx.as_at)
    for i, r in enumerate(ws.iter_rows(min_row=4, values_only=True), start=4):
        name = text(r[c["name"]])
        if not name:
            continue
        kind = text(r[c["type"]])
        ac = p["accounts"].get(kind or "")
        if not ac:
            ctx.find("unknown_asset_type", f"{p['asset_sheet']} row {i}", value=kind)
            ac = {}
        no = f"IA-{int(num(r[c['no']])):03d}" if num(r[c["no"]]) is not None else name
        status = (text(r[c["status"]]) or "").lower()
        assets[name.lower()] = {"asset_no": no, "entity": ent, "name": name, "asset_type": kind,
                                "status": "wip" if status == "wip" else status,
                                "completion_date": day(r[c["done"]]), "workbook_wip": num(r[mc]) or 0.0,
                                "cost_account": ac.get("wip"), "accum_account": ac.get("accumulated"), "opening_accumulated": 0.0,
                                "accounts": ac, "source_ref": ctx.ref(p["asset_sheet"], i)}
    lines = []
    for sheet in p["invoice_tabs"]:
        ws = wb[sheet]
        h = header_map(ws, 3)
        ci = {"date": col(h, "Date"), "inv": optional_col(h, "Invoice Number"), "net": col(h, "Net"), "item": col(h, "Item"),
              "treat": col(h, "Accounting Treatment")}
        for k, n in [("pct", "% allocation"), ("alloc", "Allocated amount"), ("phase_name", "Phase Name"), ("proposal", "Proposal Number"),
                     ("milestone", "R&D Claim"), ("research", "Research"), ("dev", "Development"), ("admin", "Admin")]:
            ci[k] = optional_col(h, n)
        ci["phase"] = h.get("Phase")
        ci["year"], ci["month"] = optional_col(h, "Year"), optional_col(h, "Month")
        cur = None
        for i, r in enumerate(ws.iter_rows(min_row=4, values_only=True), start=4):
            net = num(r[ci["net"]])
            where = f"{sheet} row {i}"
            base_is_cont = False
            if net is None or not day(r[ci["date"]]):
                base_is_cont = True
                # A continuation row of a split invoice: no date, number or
                # net, only the item and its share. It belongs to the invoice
                # above, which must be in the same year and month.
                share = (num(r[ci["alloc"]]) if ci["alloc"] is not None else None)
                if cur is None or not text(r[ci["item"]]) or share is None:
                    continue
                y = num(r[ci["year"]]) if ci["year"] is not None else None
                m = num(r[ci["month"]]) if ci["month"] is not None else None
                if y and m and (int(y), int(m)) != tuple(int(x) for x in cur["line_date"][:7].split("-")):
                    ctx.find("continuation_row_other_month", where, invoice=cur["invoice_no"])
                    continue
                own = num(r[ci["net"]])
                net = own if own is not None else cur["source_net"]
                r = list(r)
                r[ci["date"]] = dt.datetime.fromisoformat(cur["line_date"])
                if ci["inv"] is not None:
                    r[ci["inv"]] = cur["invoice_no"]
                for k in ("proposal", "phase_name", "milestone"):
                    if ci.get(k) is not None and r[ci[k]] in (None, ""):
                        r[ci[k]] = cur.get({"proposal": "proposal_no", "milestone": "rd_milestone"}.get(k, k))
                if ci.get("phase") is not None and r[ci["phase"]] in (None, ""):
                    r[ci["phase"]] = cur.get("phase")
            item = text(r[ci["item"]])
            raw = text(r[ci["treat"]])
            a = assets.get((item or "").lower())
            pick = lambda k: text(r[ci[k]]) if ci.get(k) is not None else None
            inv = pick("inv")
            base = {"source_type": "workbook", "supplier": p["supplier_of_tab"].get(sheet, sheet), "invoice_no": inv,
                    "line_date": day(r[ci["date"]]), "billed_entity": ent, "owning_entity": ent, "source_net": R2(net),
                    "proposal_no": pick("proposal"), "phase": pick("phase"), "phase_name": pick("phase_name"),
                    "item": item, "rd_milestone": pick("milestone"), "source_ref": ctx.ref(sheet, i),
                    "group": f"{sheet}|{inv or ('row ' + str(i))}|{R2(net)}" + (f"|row {i}" if (cur is not None and num(r[ci["net"]]) is not None and base_is_cont) else "")}
            if text(r[ci["net"]]) is not None and day(r[ci["date"]]):
                cur = base
            slices = []
            if ci["dev"] is not None and ci["admin"] is not None:
                # Research, development (capitalised) and admin split on one row.
                for k, t in [("research", "expense_research"), ("dev", "capitalise"), ("admin", "expense_admin")]:
                    v = num(r[ci[k]]) if ci[k] is not None else None
                    if v:
                        slices.append((v, t))
            else:
                v = num(r[ci["alloc"]]) if ci["alloc"] is not None else None
                if v is None:
                    v = net * (num(r[ci["pct"]]) if (ci["pct"] is not None and num(r[ci["pct"]]) is not None) else 1)
                t = treatment_of(raw, base.get("phase_name") or "")
                if t is None:
                    ctx.find("no_treatment", where, value=raw)
                slices.append((v, t))
            for v, t in slices:
                if t == "capitalise" and not a:
                    ctx.find("capitalised_without_asset", where, item=item, amount=R2(v))
                lines.append({**base, "raw_amount": v, "amount": R2(v), "treatment": t,
                              "asset_no": a["asset_no"] if (a and t == "capitalise") else None,
                              "percent_info": num(r[ci["pct"]]) if ci["pct"] is not None else None,
                              "posted_account": a["cost_account"] if (a and t == "capitalise") else None,
                              "reason_text": f"Workbook treatment: {raw}" + (f"; phase: {base['phase_name']}" if base.get("phase_name") else ""),
                              "fields": {"workbook_treatment": raw}})
    # Pence: rows of one invoice may split one net amount by percentages. Each
    # slice is rounded, then any difference goes on the largest slice so the
    # slices of an invoice sum to its net.
    groups = collections.defaultdict(list)
    for l in lines:
        groups[l["group"]].append(l)
    for g, ls in groups.items():
        net = ls[0]["source_net"]
        total = R2(sum(l["amount"] for l in ls))
        raw_total = sum(l["raw_amount"] for l in ls)
        if abs(raw_total - net) < 0.01:
            if total != net:
                big = max(ls, key=lambda l: abs(l["amount"]))
                big["fields"]["rounding"] = R2(net - total)
                big["amount"] = R2(big["amount"] + net - total)
        else:
            ctx.find("slices_do_not_make_invoice", g, net=net, slices=R2(raw_total))
    for l in lines:
        l.pop("raw_amount", None)
        l["fields"]["source_key"] = l.pop("group")
    for a in assets.values():
        a["opening_cost"] = R2(sum(l["amount"] for l in lines if l["asset_no"] == a["asset_no"] and (l["line_date"] or "") <= ctx.as_at))
        if abs(a["opening_cost"] - a["workbook_wip"]) >= 0.005:
            ctx.find("asset_total_after_rounding", a["asset_no"], name=a["name"], workbook=round(a["workbook_wip"], 4), register=a["opening_cost"])
    return list(assets.values()), lines


LAYOUTS = {
    "ip_register": {"grouping": "ip_registered", "sheets": IP_SHEETS, "extract": extract_ip},
    "dev_project": {"grouping": "dev_project", "extract": extract_dev, "sheets": []},
    "tangible_build": {"grouping": "tangible_build", "extract": extract_tangible,
                       "sheets": ["Tangible Assets - WIP", "Tangible Assets - Cost", "WIP Invoice Schedule"]},
}


# ── Reconciliation ───────────────────────────────────────────────────────────

def reconcile(ctx, assets, lines, tb):
    by_asset = collections.defaultdict(float)
    for l in lines:
        if l["treatment"] == "capitalise" and l["asset_no"] and (l["line_date"] or "") <= ctx.as_at:
            by_asset[l["asset_no"]] += l["amount"]
    per_asset = []
    for a in assets:
        inv = R2(by_asset.get(a["asset_no"], 0))
        row = {"asset_no": a["asset_no"], "entity": a["entity"], "opening_cost": a["opening_cost"], "invoices": inv,
               "invoices_less_opening": R2(inv - a["opening_cost"])}
        for k in ("tracking_cost", "register_cost", "pending_cost"):
            if a.get(k) is not None and R2(a[k]) != a["opening_cost"]:
                row[k] = R2(a[k])
        if row["invoices_less_opening"] != 0 or len(row) > 5:
            per_asset.append(row)
    per_account = collections.defaultdict(float)
    for a in assets:
        if a["entity"] and a["cost_account"]:
            per_account[(a["entity"], a["cost_account"])] += a["opening_cost"]
        if a["entity"] and a.get("accum_account"):
            per_account[(a["entity"], a["accum_account"])] -= abs(a.get("opening_accumulated") or 0)
        imp = a.get("opening_impairment")
        if a["entity"] and imp:
            per_account[(a["entity"], imp["credit_account"])] -= abs(imp["amount"])
    ties = []
    if tb:
        keys = set(per_account)
        accts = {x for a in assets for x in (a["cost_account"], a.get("accum_account")) if x}
        for ent, codes in tb["balances"].items():
            for code in codes:
                if code in accts:
                    keys.add((ent, code))
        for ent, code in sorted(keys, key=lambda k: (str(k[0]), str(k[1]))):
            reg = R2(per_account.get((ent, code), 0))
            led = R2(tb["balances"].get(ent, {}).get(code, 0))
            ties.append({"entity": ent, "account": code, "register": reg, "ledger": led, "difference": R2(led - reg)})
    return per_asset, ties


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--layout", required=True, choices=sorted(LAYOUTS))
    ap.add_argument("--profile", required=True)
    ap.add_argument("--file", required=True, help="the copy re-saved by Excel")
    ap.add_argument("--original", required=True, help="the client's file it was copied from")
    ap.add_argument("--as-at", required=True)
    ap.add_argument("--tb", help="Xero balances at the opening date, JSON")
    ap.add_argument("--named", help="named items carried at the opening date, JSON")
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    sys.stdout.reconfigure(errors="replace")
    layout = LAYOUTS[a.layout]
    profile = json.load(open(a.profile, encoding="utf-8"))
    ctx = Ctx(profile, a.file, a.original, a.as_at)
    gp = profile.get(layout["grouping"], {})
    sheets = list(layout["sheets"]) + [v for k, v in gp.items() if k.endswith("_sheet")] + list(gp.get("invoice_tabs", []))
    bad = uncached(a.file, sheets)
    if bad:
        print(f"REFUSED: {len(bad)} formula cell(s) with no cached result, e.g. " + ", ".join(f"'{s}'!{c}" for s, c in bad[:10]))
        print("Open the file in Excel, let it recalculate, save it, and run again.")
        sys.exit(2)
    wb = openpyxl.load_workbook(a.file, data_only=True, read_only=True)
    assets, lines = layout["extract"](ctx, wb)
    tb = json.load(open(a.tb, encoding="utf-8")) if a.tb else None
    # The opening: one brought-forward line per asset, from the tab that ties
    # to the ledger. Earlier invoice lines are kept as evidence, replaced by it
    # (state superseded), so nothing counts twice and nothing is lost.
    bf = []
    for x in assets:
        if x["opening_cost"]:
            bf.append({"source_type": "workbook", "kind": "brought_forward", "supplier": None, "invoice_no": None,
                       "line_date": a.as_at, "billed_entity": x["entity"], "owning_entity": x["entity"],
                       "source_net": x["opening_cost"], "amount": x["opening_cost"], "asset_no": x["asset_no"],
                       "treatment": "capitalise", "posted_account": x["cost_account"],
                       "reason_text": f"Cost brought forward at {a.as_at} from the register workbook, which ties to the ledger by account.",
                       "fields": {}, "source_ref": x["source_ref"]})
    for l in lines:
        if layout["grouping"] == "ip_registered" and (l["line_date"] or "") <= a.as_at and l["treatment"] == "capitalise" and l["asset_no"]:
            l["state"] = "superseded"
            l["superseded_by_asset_no"] = l["asset_no"]
    if layout["grouping"] != "ip_registered":
        bf = []  # its invoices are the full history and tie to the ledger: they are the opening
    lines = bf + lines
    per_asset, ties = reconcile(ctx, assets, lines, tb)
    named = json.load(open(a.named, encoding="utf-8"))["items"] if a.named else []
    # Only the named items on accounts this grouping uses.
    mine = {(m["entity"], str(m["code"])) for m in profile.get(layout["grouping"], {}).get("account_map", [])}
    named = [n for n in named if (n["entity"], str(n["account"])) in mine]
    for t in ties:
        mine = [n for n in named if n["entity"] == t["entity"] and str(n["account"]) == str(t["account"])]
        t["named_items"] = mine
        t["unexplained"] = R2(t["difference"] - sum(n["amount"] for n in mine))
    gp = profile.get(layout["grouping"], {})
    out = {"layout": a.layout, "grouping": layout["grouping"], "client": profile["client"], "as_at": a.as_at,
           "account_map": gp.get("account_map", []), "named_items": named,
           "source": ctx.source, "assets": assets, "cost_lines": lines, "findings": ctx.findings,
           "reconciliation": {"per_asset": per_asset, "per_account": ties}}
    json.dump(out, open(a.out, "w", encoding="utf-8"), indent=1, default=str)
    print(f"{a.layout}: {len(assets)} assets, {len(lines)} cost lines, {len(ctx.findings)} findings -> {a.out}")
    for t in ties:
        flag = "ties" if t["difference"] == 0 else ("ties after named items" if t["unexplained"] == 0 else f"UNEXPLAINED {t['unexplained']:,.2f}")
        print(f"  {t['entity']:24} {t['account']:4} register {t['register']:>12,.2f}  ledger {t['ledger']:>12,.2f}  diff {t['difference']:>10,.2f}  {flag}")
    if per_asset:
        print(f"  assets whose typed cost differs from invoices or another tab: {len(per_asset)}")
    kinds = collections.Counter(f["kind"] for f in ctx.findings)
    for k, n in kinds.most_common():
        print(f"  finding {k}: {n}")


if __name__ == "__main__":
    try:
        main()
    except Refused as e:
        print(f"REFUSED: {e}")
        sys.exit(2)
