create table if not exists public.pending_orders (
  id bigint generated always as identity primary key,
  pair text not null,
  direction text not null check (direction in ('LONG', 'SHORT')),
  setup text,
  order_type text not null check (order_type in ('BUY_STOP', 'SELL_STOP', 'BUY_LIMIT', 'SELL_LIMIT', 'WAIT_FOR_CONFIRMATION')),
  entry text not null,
  stop_loss text not null,
  take_profit_1 text not null,
  take_profit_2 text,
  confidence integer,
  reasons text[],
  risks text[],
  primary_timeframe text not null default 'H4' check (primary_timeframe in ('D1', 'H4', 'M15')),
  source_chart_filepath text,
  status text not null default 'PENDING' check (status in ('PENDING', 'TRIGGERED', 'EXPIRED', 'CANCELLED')),
  run_count integer not null default 0,
  expiry_runs integer not null default 2,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_reason text,
  triggered_position_id bigint references public.open_positions(id)
);

create index if not exists pending_orders_status_idx on public.pending_orders(status);
create index if not exists pending_orders_pair_status_idx on public.pending_orders(pair, status);
