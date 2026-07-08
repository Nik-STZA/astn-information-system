-- Migration 005: Add document/URL fields to compliance_prospects for agent review
-- These fields store URLs that the compliance review agent will analyse.

ALTER TABLE compliance_prospects
  ADD COLUMN IF NOT EXISTS privacy_policy_url TEXT,
  ADD COLUMN IF NOT EXISTS terms_url TEXT,
  ADD COLUMN IF NOT EXISTS linkedin_url TEXT,
  ADD COLUMN IF NOT EXISTS app_store_url TEXT,
  ADD COLUMN IF NOT EXISTS other_urls TEXT;

COMMENT ON COLUMN compliance_prospects.privacy_policy_url IS 'URL of company privacy policy for POPIA review';
COMMENT ON COLUMN compliance_prospects.terms_url IS 'URL of company terms of service';
COMMENT ON COLUMN compliance_prospects.linkedin_url IS 'LinkedIn company page URL';
COMMENT ON COLUMN compliance_prospects.app_store_url IS 'App Store or Play Store listing URL';
COMMENT ON COLUMN compliance_prospects.other_urls IS 'Additional URLs for compliance review, newline-separated';
