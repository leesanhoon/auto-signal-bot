alter table open_positions_volman
  add column if not exists binance_symbol text,
  add column if not exists binance_leverage integer,
  add column if not exists binance_quantity numeric,
  add column if not exists binance_entry_order_id bigint,
  add column if not exists binance_sl_order_id bigint,
  add column if not exists binance_tp1_order_id bigint,
  add column if not exists binance_tp2_order_id bigint,
  add column if not exists binance_execution_status text;
