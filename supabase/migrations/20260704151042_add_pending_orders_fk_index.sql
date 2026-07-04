-- Add missing index for pending_orders foreign key
-- Resolves database performance advisor warning about unindexed foreign keys
-- FK constraint: pending_orders.triggered_position_id -> open_positions.id

CREATE INDEX IF NOT EXISTS pending_orders_triggered_position_id_idx
  ON public.pending_orders (triggered_position_id);
