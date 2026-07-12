alter table open_positions_volman
  add column if not exists binance_failure_reason text,
  add column if not exists binance_failure_at timestamptz;
