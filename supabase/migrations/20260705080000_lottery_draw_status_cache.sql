create table if not exists public.lottery_draw_status_cache (
  date text not null,
  region text not null,
  drawn boolean not null,
  checked_at timestamptz not null default now(),
  primary key (date, region)
);