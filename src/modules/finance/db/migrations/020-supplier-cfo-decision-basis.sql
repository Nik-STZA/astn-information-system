-- 020: a CFO decision as a VAT basis (22 Oct 2026).
--
-- The basis branches in 019 are the determination tree's. Sometimes the CFO sets
-- a treatment by judgement on facts the tree does not ask about (first case:
-- Underdog, a US supplier whose services were performed entirely from the USA,
-- set to NONE). Recording that under the nearest branch would put a reason on
-- record that is not the real one, so the decision is its own basis and must
-- carry its reasoning.

ALTER TABLE finance.supplier_entities DROP CONSTRAINT supplier_entities_vat_basis_check;
ALTER TABLE finance.supplier_entities ADD CONSTRAINT supplier_entities_vat_basis_check
  CHECK (vat_basis IN ('uk_charges_vat', 'uk_exempt', 'uk_zero_rated', 'uk_not_registered',
                       'non_uk_services_reverse_charge', 'non_uk_services_where_performed',
                       'non_uk_goods', 'intra_vat_group', 'cfo_decision'));
ALTER TABLE finance.supplier_entities ADD CONSTRAINT supplier_entity_cfo_reason
  CHECK (vat_basis IS DISTINCT FROM 'cfo_decision' OR vat_basis_note IS NOT NULL);
