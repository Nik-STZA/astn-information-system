-- 024-namespaced-schemas.sql
--
-- Creates the module-namespaced Postgres schemas required by the modular
-- monolith architecture (portal spec section 15.2). Extraction of a module
-- becomes a dump of shared.* plus that module's schema, rather than a
-- rewrite.
--
-- Migrations 003 through 023 all created their tables unqualified, so the
-- entire existing platform (63 tables) lives in public. This migration does
-- NOT move any of them. It only creates the namespaces. registry, compliance
-- and publishing are created now so the naming is reserved and consistent;
-- they stay empty until a later migration relocates the existing tables.
--
-- finance.* is the only schema populated in the near term.
--
-- Idempotent and re-runnable.

CREATE SCHEMA IF NOT EXISTS shared;
CREATE SCHEMA IF NOT EXISTS registry;
CREATE SCHEMA IF NOT EXISTS compliance;
CREATE SCHEMA IF NOT EXISTS publishing;
CREATE SCHEMA IF NOT EXISTS finance;

COMMENT ON SCHEMA shared IS
  'Cross-module foundation: clients, users, platform audit. Safe for any module to read.';
COMMENT ON SCHEMA registry IS
  'AfricanSTN organisation registry. Reserved; tables still in public.';
COMMENT ON SCHEMA compliance IS
  'AfricanSTN data protection and compliance. Reserved; tables still in public.';
COMMENT ON SCHEMA publishing IS
  'AfricanSTN content and publishing. Reserved; tables still in public.';
COMMENT ON SCHEMA finance IS
  'STZA Finance module. Populated from migration 001 in src/modules/finance/db/migrations.';

GRANT USAGE, CREATE ON SCHEMA shared    TO africastn_app;
GRANT USAGE, CREATE ON SCHEMA registry  TO africastn_app;
GRANT USAGE, CREATE ON SCHEMA compliance TO africastn_app;
GRANT USAGE, CREATE ON SCHEMA publishing TO africastn_app;
GRANT USAGE, CREATE ON SCHEMA finance   TO africastn_app;
