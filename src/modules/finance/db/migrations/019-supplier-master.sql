-- 019: the supplier master (docs/ap-lane/ap-lane-spec.md, section 2).
--
-- The source of truth for who a supplier is and how its bills are treated. Xero
-- contacts are written FROM it after approval; Xero has no field for the
-- determination, its evidence, or who approved it.
--
-- Four tables:
--
--   suppliers                 one identity per client, shared by the client's
--                             entities: a supplier billing UDL and FGH is one row
--                             (spec 2.2). Identity and reporting fields (2.3).
--   supplier_entities         the supplier as one entity's Xero contact: the link
--                             to the contact and the coding determination for that
--                             entity - default account and VAT type, and the
--                             branch of the determination tree that justifies it.
--   supplier_detail_baselines the approved address, email and bank fingerprint a
--                             new invoice or a Xero edit is compared against
--                             (2.6). Append-only: a change adds a row.
--   supplier_proposals        each proposal pass run (2.4 step 3): what the model
--                             read, what it proposed, the differences code
--                             computed, and the reviewer's decision.
--
-- Contacts are keyed by Xero ContactID, never by name, which repeats and changes.
--
-- Bank details are never stored (2.3). A baseline holds the last 4 characters
-- and a keyed hash (HMAC-SHA256 with a key held in Secret Manager) of the
-- normalised number: enough to say "this changed", not enough to recover it.
-- A plain hash would not do: a sort code and account number are few enough
-- digits to brute-force.
--
-- Individuals (sole traders, expense-claim payees) are personal data: only what
-- reporting needs is held, as for any supplier (2.3).
--
-- Idempotent. Nothing is seeded: rows come from the mechanical and proposal
-- passes through finance-api.

-- ── suppliers ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS finance.suppliers (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id                 uuid NOT NULL REFERENCES shared.clients (id) ON DELETE CASCADE,
  legal_name                text NOT NULL CHECK (length(trim(legal_name)) > 0),
  trading_name              text,
  -- ISO 3166 alpha-2. Establishment decides place of supply; not the billing
  -- address and not the currency (15 Sep note).
  country_of_establishment  text CHECK (country_of_establishment ~ '^[A-Z]{2}$'),
  vat_number                text,
  company_number            text,
  supplier_type             text NOT NULL DEFAULT 'company'
                              CHECK (supplier_type IN ('company', 'sole_trader', 'individual',
                                                       'public_body', 'expense_payee')),
  -- The CFO's call; the model never sets it.
  related_party             boolean NOT NULL DEFAULT false,
  -- Bills always go to the CFO as a question: intangibles, capital items,
  -- intercompany, related parties.
  always_discuss            boolean NOT NULL DEFAULT false,
  -- No default VAT type; every bill reviewed (e.g. Venture Proof, 20 Oct 2026).
  mixed_treatment           boolean NOT NULL DEFAULT false,
  -- Optional; filled when an ONS return needs it (Q2).
  service_category          text,
  -- dormant = no bill in 12 months; excluded = not a supplier for the master
  -- (an expense-claim payee). Archiving in Xero is a separate, approved act.
  status                    text NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active', 'dormant', 'excluded')),
  status_reason             text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);
-- A mixed-treatment supplier must not carry a default VAT type on any entity.
-- That rule spans two tables, so finance-api enforces it when a determination is
-- approved, and the AP checks treat any default on such a supplier as an exception.

CREATE INDEX IF NOT EXISTS suppliers_client_idx ON finance.suppliers (client_id);
CREATE UNIQUE INDEX IF NOT EXISTS suppliers_client_vat_idx
  ON finance.suppliers (client_id, upper(regexp_replace(vat_number, '\s', '', 'g')))
  WHERE vat_number IS NOT NULL;

-- ── supplier_entities ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS finance.supplier_entities (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id           uuid NOT NULL REFERENCES finance.suppliers (id) ON DELETE CASCADE,
  entity_id             uuid NOT NULL REFERENCES finance.entities (id) ON DELETE CASCADE,
  xero_contact_id       text NOT NULL,
  -- The contact name as it was when last read, so a rename in Xero is visible.
  xero_contact_name     text NOT NULL,
  default_account_code  text,
  default_tax_type      text CHECK (default_tax_type IN ('INPUT2', 'EXEMPTINPUT', 'ZERORATEDINPUT',
                                                         'NONE', 'REVERSECHARGES')),
  -- The branch of the determination tree (spec 2.3, 15 Sep note).
  vat_basis             text CHECK (vat_basis IN ('uk_charges_vat', 'uk_exempt', 'uk_zero_rated',
                                                  'uk_not_registered', 'non_uk_services_reverse_charge',
                                                  'non_uk_services_where_performed', 'non_uk_goods',
                                                  'intra_vat_group')),
  vat_basis_note        text,
  default_currency      text CHECK (default_currency ~ '^[A-Z]{3}$'),
  payment_terms_days    integer CHECK (payment_terms_days BETWEEN 0 AND 365),
  status                text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'approved')),
  approved_by_email     text,
  approved_role         text,
  approved_at           timestamptz,
  -- Set when the approved determination has been written to the Xero contact.
  written_to_xero_at    timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity_id, xero_contact_id),
  CONSTRAINT supplier_entity_approval CHECK (
    status = 'proposed' OR (approved_by_email IS NOT NULL AND approved_at IS NOT NULL)
  ),
  -- An approved determination names its basis; a VAT type alone is not evidence.
  CONSTRAINT supplier_entity_basis CHECK (
    status = 'proposed' OR default_tax_type IS NULL OR vat_basis IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS supplier_entities_supplier_idx ON finance.supplier_entities (supplier_id);

-- ── supplier_detail_baselines ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS finance.supplier_detail_baselines (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_entity_id   uuid NOT NULL REFERENCES finance.supplier_entities (id) ON DELETE CASCADE,
  address_lines        text,
  address_country      text,
  email                text,
  phone                text,
  bank_last4           text CHECK (bank_last4 ~ '^[A-Za-z0-9]{1,4}$'),
  bank_hmac            text CHECK (bank_hmac ~ '^[0-9a-f]{64}$'),
  -- xero_unapproved: today's Xero values, captured at first sync and not yet
  -- approved (2.6, first run). approved: confirmed by the CFO.
  basis                text NOT NULL CHECK (basis IN ('xero_unapproved', 'approved')),
  evidence             text,
  approved_by_email    text,
  approved_at          timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT baseline_approval CHECK (
    basis = 'xero_unapproved' OR (approved_by_email IS NOT NULL AND approved_at IS NOT NULL)
  ),
  CONSTRAINT baseline_bank_pair CHECK ((bank_last4 IS NULL) = (bank_hmac IS NULL))
);

CREATE INDEX IF NOT EXISTS supplier_detail_baselines_latest_idx
  ON finance.supplier_detail_baselines (supplier_entity_id, created_at DESC);

-- Append-only: a baseline is evidence of what was approved when. A change adds
-- a row. The trigger refuses updates; finance-api never deletes, so a row goes
-- only by cascade when its client or entity is removed (offboarding, spec 8).
CREATE OR REPLACE FUNCTION finance.supplier_baselines_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'supplier_detail_baselines is append-only: add a new row instead';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS append_only ON finance.supplier_detail_baselines;
CREATE TRIGGER append_only BEFORE UPDATE ON finance.supplier_detail_baselines
  FOR EACH ROW EXECUTE FUNCTION finance.supplier_baselines_append_only();

-- ── supplier_proposals ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS finance.supplier_proposals (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id            uuid NOT NULL REFERENCES shared.clients (id) ON DELETE CASCADE,
  entity_id            uuid NOT NULL REFERENCES finance.entities (id) ON DELETE CASCADE,
  xero_contact_id      text NOT NULL,
  supplier_entity_id   uuid REFERENCES finance.supplier_entities (id) ON DELETE SET NULL,
  -- Which run, and what was read: the invoice and a hash of the exact document.
  run_id               uuid NOT NULL,
  model                text NOT NULL,
  model_location       text NOT NULL,
  xero_invoice_id      text,
  document_sha256      text CHECK (document_sha256 ~ '^[0-9a-f]{64}$'),
  -- The model's proposal with its citations, after the server's bank masking,
  -- and the differences from the Xero contact computed by code.
  proposal             jsonb NOT NULL,
  differences          jsonb NOT NULL DEFAULT '[]'::jsonb,
  usage                jsonb,
  decision             text NOT NULL DEFAULT 'pending'
                         CHECK (decision IN ('pending', 'approved', 'edited', 'always_discuss',
                                             'question', 'excluded', 'rejected')),
  decision_note        text,
  decided_by_email     text,
  decided_at           timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT proposal_decision CHECK (
    decision = 'pending' OR (decided_by_email IS NOT NULL AND decided_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS supplier_proposals_contact_idx
  ON finance.supplier_proposals (entity_id, xero_contact_id, created_at DESC);
CREATE INDEX IF NOT EXISTS supplier_proposals_pending_idx
  ON finance.supplier_proposals (client_id) WHERE decision = 'pending';

-- ── updated_at ──────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS set_updated_at ON finance.suppliers;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON finance.suppliers
  FOR EACH ROW EXECUTE FUNCTION finance.set_updated_at();
DROP TRIGGER IF EXISTS set_updated_at ON finance.supplier_entities;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON finance.supplier_entities
  FOR EACH ROW EXECUTE FUNCTION finance.set_updated_at();
