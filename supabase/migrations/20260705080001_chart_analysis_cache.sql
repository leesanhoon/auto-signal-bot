create table if not exists public.chart_analysis_cache (
  candle_key text primary key,
  result jsonb not null,
  created_at timestamptz not null default now()
);