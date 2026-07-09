alter table open_positions
  add column if not exists system text not null default 'volman';

alter table pending_orders
  add column if not exists system text not null default 'volman';

create index if not exists idx_open_positions_pair_system_status
  on open_positions (pair, system, status);

create index if not exists idx_pending_orders_pair_system_status
  on pending_orders (pair, system, status);
