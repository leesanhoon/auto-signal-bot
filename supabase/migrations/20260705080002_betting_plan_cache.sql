create table if not exists public.betting_plan_cache (
  date text primary key,
  game_ids text[] not null,
  plan jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_betting_plan_cache_created_at on public.betting_plan_cache(created_at);
