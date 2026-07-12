alter table open_positions_smc
  add column if not exists binance_failure_reason text,
  add column if not exists binance_failure_at timestamptz;
