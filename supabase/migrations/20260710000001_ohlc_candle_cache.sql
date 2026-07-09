create table if not exists public.ohlc_candle_cache (
  cache_key text primary key,
  candles jsonb not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
