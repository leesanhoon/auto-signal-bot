alter table open_positions_smc
  add column if not exists binance_entry_order_type text,
  add column if not exists binance_entry_order_status text,
  add column if not exists binance_entry_order_placed_at timestamptz;
