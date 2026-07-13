-- TP is now one full-position order (2R). Keep the legacy value for historical data.
ALTER TABLE public.open_positions_volman
  DROP CONSTRAINT IF EXISTS open_positions_volman_close_reason_check;

ALTER TABLE public.open_positions_volman
  ADD CONSTRAINT open_positions_volman_close_reason_check
  CHECK (close_reason IN ('stop_loss', 'take_profit', 'take_profit_2', 'manual_close'));
