-- Approval routing: whether an item reaches the CFO inside a batch or on its
-- own.
--
-- Stored so the queue can group and so the record of what was approved says
-- honestly how it was approved. A batch attestation states a population and a
-- total; an item that was read individually says so.
--
-- The value is DERIVED at import from the client's routing config, never taken
-- from wip.json. See src/modules/finance/lib/routing.ts for why.

BEGIN;

ALTER TABLE finance.wip_items
  ADD COLUMN IF NOT EXISTS routing_class  text NOT NULL DEFAULT 'judgement',
  ADD COLUMN IF NOT EXISTS routing_reason text;

-- The default is the conservative one on purpose: an item whose class could not
-- be established reaches a human individually. An absent config must degrade to
-- more attention, never less.
ALTER TABLE finance.wip_items
  DROP CONSTRAINT IF EXISTS wip_items_routing_class_check;

ALTER TABLE finance.wip_items
  ADD CONSTRAINT wip_items_routing_class_check
  CHECK (routing_class IN ('mechanical', 'judgement'));

COMMENT ON COLUMN finance.wip_items.routing_class IS
  'mechanical items may be approved inside a batch; judgement items reach the CFO individually. Derived from the client routing config at import, never set by the drafting agent.';

COMMENT ON COLUMN finance.wip_items.routing_reason IS
  'Why this class, in words a reviewer can read in the queue.';

CREATE INDEX IF NOT EXISTS wip_items_routing_idx
  ON finance.wip_items (client_id, panel, routing_class);

COMMIT;
