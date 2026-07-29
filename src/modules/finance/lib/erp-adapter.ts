// ERPAdapter, the single interface the portal and agents talk to instead of
// any specific accounting system (portal spec section 3.3).
//
// STZA's clients will not all run Xero. Adding QuickBooks, Sage or FreeAgent
// should be one adapter, not a structural change, so nothing above this
// interface may reference a Xero concept.
//
// Normalised model notes:
//   - Money is minor units as an integer (pence), never a float. Xero returns
//     decimals and JavaScript floats cannot represent them exactly, which is
//     how reconciliations end up out by a penny.
//   - Amounts carry their currency. Xero LineAmount is in the document's own
//     currency, not GBP, and must be converted at the document's rate before
//     aggregation (Feldspar CLAUDE.md rule 10).
//   - Dates are ISO date strings, not Date objects, so they survive a JSON
//     round trip through the API without timezone drift.

export interface Money {
  /** Minor units, for example pence. Integer. */
  amount: number;
  /** ISO 4217, for example GBP. */
  currency: string;
}

export interface Entity {
  /** Stable identifier within the adapter, for example a Xero tenant id. */
  id: string;
  name: string;
  legalName?: string;
  /** Adapter-specific config name, where one exists. */
  configName?: string;
}

export type AccountClass =
  | "asset"
  | "liability"
  | "equity"
  | "revenue"
  | "expense"
  | "unknown";

export interface Account {
  code: string;
  name: string;
  /** The source system's own type string, preserved verbatim. */
  type: string;
  accountClass: AccountClass;
  taxCode?: string;
  /** False for archived or deleted accounts. */
  active: boolean;
}

export interface TrialBalanceLine {
  accountCode: string;
  accountName: string;
  type: string;
  debit: Money;
  credit: Money;
  ytdDebit?: Money;
  ytdCredit?: Money;
}

export interface TrialBalance {
  entityId: string;
  /** ISO date the balance is struck at. */
  asOf: string;
  lines: TrialBalanceLine[];
  /** True when total debits equal total credits. */
  balanced: boolean;
  totalDebit: Money;
  totalCredit: Money;
}

export interface Balance {
  accountCode: string;
  asOf: string;
  balance: Money;
}

export interface Contact {
  id: string;
  name: string;
  type: "vendor" | "customer" | "both";
  taxNumber?: string;
}

export interface TransactionQuery {
  from?: string;
  to?: string;
  accountCode?: string;
  /** Adapter-defined page cursor. Callers must treat it as opaque. */
  cursor?: string;
  limit?: number;
}

export interface Transaction {
  id: string;
  date: string;
  reference?: string;
  description?: string;
  accountCode?: string;
  /** In the document's own currency. */
  amount: Money;
  /** Converted to the entity's reporting currency, where the adapter can. */
  reportingAmount?: Money;
  contactName?: string;
  source: string;
}

export interface Page<T> {
  items: T[];
  /** Absent when there are no further pages. */
  nextCursor?: string;
}

export interface JournalLine {
  accountCode: string;
  /** Positive debits the account, negative credits it. */
  amount: Money;
  description?: string;
  taxCode?: string;
  trackingCategory?: Record<string, string>;
}

export interface JournalInput {
  date: string;
  narration: string;
  lines: JournalLine[];
  status?: "draft" | "posted";
}

export interface JournalResult {
  id: string;
  status: string;
  /** What the source system reports the journal netted to. Must be zero. */
  net: Money;
  postedAt?: string;
}

export interface ConnectionStatus {
  connected: boolean;
  entityId?: string;
  /** When the access token was last refreshed. */
  lastRefreshedAt?: string;
  /** When the current refresh token stops working if unused. */
  refreshTokenExpiresAt?: string;
  scopes?: string[];
  /** Populated when connected is false. */
  error?: string;
}

// What a given adapter can actually do. The UI hides or disables features
// rather than offering an action that will fail, for example a spreadsheet
// adapter that can never post a journal.
export interface AdapterCapabilities {
  readTrialBalance: boolean;
  readTransactions: boolean;
  readContacts: boolean;
  postJournal: boolean;
  createContact: boolean;
  createInvoice: boolean;
  /** True when postJournal supports a validate-only mode. */
  dryRunJournal: boolean;
  multiCurrency: boolean;
}

export interface ERPAdapter {
  readonly system: string;

  capabilities(): AdapterCapabilities;
  isConnected(entityId: string): Promise<ConnectionStatus>;

  listEntities(): Promise<Entity[]>;
  getChartOfAccounts(entityId: string): Promise<Account[]>;
  getTrialBalance(entityId: string, asOf: string): Promise<TrialBalance>;
  getAccountBalance(entityId: string, accountCode: string, asOf: string): Promise<Balance>;
  listContacts(entityId: string, type: "vendor" | "customer"): Promise<Contact[]>;
  listTransactions(entityId: string, query: TransactionQuery): Promise<Page<Transaction>>;

  // Writes. Only ever called after CFO approval, and every call is expected to
  // leave an entry in finance.audit_log.
  postJournal(entityId: string, journal: JournalInput): Promise<JournalResult>;
}

export class ErpError extends Error {
  constructor(
    message: string,
    readonly system: string,
    readonly kind: "auth" | "rate-limit" | "not-found" | "validation" | "transport" | "unknown",
    readonly retryable = false
  ) {
    super(message);
    this.name = "ErpError";
  }
}

// Money helpers. Kept here so no adapter reinvents rounding.

export function money(amount: number, currency = "GBP"): Money {
  return { amount: Math.round(amount), currency };
}

// Parses a decimal string or number from an ERP into minor units.
//
// Works on the digits rather than multiplying by 100. For ordinary two-decimal
// amounts a float multiply with Math.round lands on the same answer, so this is
// not about 19.99 * 100 being 1998.9999...; rounding hides that. It is about
// keeping the rounding decision explicit and staying exact at magnitudes where
// a float multiply starts to drift.
//
// Rounds half away from zero at the third decimal rather than truncating. ERP
// unit prices carry four decimals, and truncating 1.005 to 1.00 loses value
// silently, which is the worst way to lose it.
export function toMinorUnits(value: string | number, currency = "GBP"): Money {
  const text = typeof value === "number" ? value.toFixed(4) : value.trim();
  const negative = text.trim().startsWith("-");
  const digits = text.replace(/[^0-9.]/g, "");
  const [whole, frac = ""] = digits.split(".");

  const padded = (frac + "000").slice(0, 3);
  const minor = Number(whole || "0") * 100 + Number(padded.slice(0, 2));
  const rounded = minor + (Number(padded[2]) >= 5 ? 1 : 0);

  return { amount: negative ? -rounded : rounded, currency };
}

export function formatMoney(m: Money, locale = "en-GB"): string {
  return (m.amount / 100).toLocaleString(locale, {
    style: "currency",
    currency: m.currency,
  });
}

export function addMoney(a: Money, b: Money): Money {
  if (a.currency !== b.currency) {
    throw new ErpError(
      `cannot add ${a.currency} to ${b.currency} without a conversion rate`,
      "core",
      "validation"
    );
  }
  return { amount: a.amount + b.amount, currency: a.currency };
}
