# Management account templates: plan

**18 November 2026.** CFO's ask: the Feldspar management pack P&L is the template for management accounts, and other clients default to standard templates. The mapping comes from a master file, not by hand.

## Where it stands

- The pack (pack-engine) draws the P&L as categories (Turnover, Cost of sales, overhead categories, finance, taxation), each with its accounts beneath. Since #207 it shows Management EBITDA before depreciation and amortisation.
- Categories are standard (migration 017) plus client-level ones (`finance.reporting_categories` with a client_id). Each Xero account maps to one category (`finance.account_mappings`), approved on the Chart of accounts page.
- Feldspar's real layout is two levels: **P&L Mapping 1** (the heading: IT Costs) and **P&L Mapping 2** (the sub-line: Software & Subscriptions, Hosting & Infrastructure). The platform has only the first level.
- The Feldspar master (`Feldspar - Master Mapping with Raise Buckets - 10 November 2026.xlsx`) was applied by hand on 18 Nov. Nothing reads a master file automatically.

## What we build, in four PRs

### 1. Sub-lines (P&L Mapping 2)
- `account_mappings.subline` (migration): an optional sub-line per P&L account.
- The pack draws each category's sub-lines as subtotal rows with their accounts beneath (formulas throughout); a category with no sub-lines draws as now.
- The Chart of accounts page shows and edits the sub-line beside the category.

### 2. Templates
A template is a named P&L (and balance sheet) layout, kept in code and versioned:
- its categories: key, label, section, order, cash or non-cash;
- each category's sub-lines, in order;
- its subtotals and their labels: Gross profit, Total operating costs, Management EBITDA (on or off), Operating profit, Net profit;
- a heading map from a master file's words to its categories ("IT Costs" → it_costs), so a master file can be read.

Three to start:
- **Feldspar management**: from the 10 Nov master and `clients/feldspar.py` (Marketing, Payroll & Related, Property & General, IT, Travel & Entertainment, Legal & Professional, Capitalised Development, then Management EBITDA).
- **Standard management (EBITDA)**: the same shape with generic headings, the default for a new client.
- **Standard statutory**: today's layout (FRS 102 headings, no EBITDA), for a client that wants it.

The client picks one in Settings > Financial; it sets the client's categories and the pack follows it. A client can still add its own lines on top.

### 3. Master file upload
On the Chart of accounts page (or Settings), upload a master file (xlsx or CSV with Code, Name, Type, P&L Mapping 1, P&L Mapping 2, BS Mapping):
- matched to each company's Xero accounts on code and name (the `code - name` key, as the Feldspar master does);
- translated through the template's heading map;
- shown as a preview: what will change, what does not match, what has no heading. The CFO approves it in one step, recorded as from that file;
- the checks in the 21 Oct spec §5: names that no longer match Xero, duplicate keys, accounts with balances and no mapping.

### 4. Agents keep it current
- FM1 proposes a category and sub-line for any new Xero account (from the template and similar accounts), for the CFO to approve. The pack's mapping warning names what is waiting.

## Built

- **Part 1** (#208, migration 054): sub-lines.
- **Part 2** (migration 055): `finance-api/lib/pack-templates.js` holds the three templates; `shared.clients.pack_template` records the client's (default `standard_management`, Feldspar Sport Group `feldspar_management`). Categories layer standard → template → client's own rows; the client can still rename a template line and reset it back. The account-mapping endpoint gives the pack a `layout` (EBITDA on or off, subtotal labels, sub-line order) and the pack draws from it; with no layout it draws as before. The CFO picks the template in Settings > Financial; a template that would leave mapped accounts without a line is refused, naming them. Feldspar's heading map leaves out Rounding and Impairment: no account was given a line for them, so the CFO decides when the master upload (part 3) shows them.

- **Part 2b** (#210): a template names the lines below EBITDA (`belowEbitda`); Feldspar adds Impairment and puts FX below EBITDA. Rounding (860) stays on the balance sheet (CFO).
- **Part 3**: Chart of accounts > Upload a master file. The browser reads .xlsx (no library: `src/modules/finance/lib/xlsx-read.ts`) or .csv into a table; finance-api (`lib/master-mapping.js`) finds the header row, matches every company's Xero accounts on code and name, and translates P&L Mapping 1 / 2 and BS Mapping through the template (`headings`, `bsHeadings`; a BS heading may allow more than one line, and an account already on one keeps it). The preview lists each change (tick to keep) and what it cannot decide: same code with a different name, no heading, a heading the template does not know, accounts not in the file, rows no company has, rows in twice. Apply plans again on the server, drops what was unticked and saves every company in one transaction, source upload, reason "uploaded from <file>"; approving needs the CFO.

## Order and first step

1 then 2 then 3 then 4. Feldspar's mapping is already right by hand, so nothing waits on this for the Feldspar pack except sub-lines (1) and the template's labels (2).
