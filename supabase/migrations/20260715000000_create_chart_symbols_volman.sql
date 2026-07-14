create table if not exists public.chart_symbols_volman (
  id bigint generated always as identity primary key,
  name text not null,
  symbol text not null unique,
  category text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_chart_symbols_volman_is_active
  on public.chart_symbols_volman(is_active);
