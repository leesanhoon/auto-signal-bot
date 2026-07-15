create table if not exists scanner_health_volman (
  id bigserial primary key,
  ts timestamptz not null default now(),
  source text not null,
  status text not null check (status in ('ok', 'error')),
  detail text
);

create index if not exists scanner_health_volman_ts_idx
  on scanner_health_volman (ts desc);

create table if not exists scanner_alert_state_volman (
  id smallint primary key default 1,
  last_alert_sent_at timestamptz,
  constraint scanner_alert_state_volman_singleton check (id = 1)
);
