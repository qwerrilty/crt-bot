-- ─── CRT Setups ──────────────────────────────────────────────────────────────
create table if not exists crt_setups (
  id               uuid primary key default gen_random_uuid(),

  -- identity
  symbol           text        not null,
  direction        text        not null check (direction in ('BULLISH', 'BEARISH')),

  -- C1 displacement candle
  c1_open_time     timestamptz not null,
  c1_high          numeric     not null,
  c1_low           numeric     not null,
  c1_mid           numeric     not null,
  c1_range_pct     numeric     not null,
  c1_body_pct      numeric     not null,
  sweep_pct        numeric     not null,

  -- C2 consolidation
  c2_overlap_pct   numeric     not null,

  -- C3 signal
  c3_close         numeric     not null,

  -- FVG (nullable)
  fvg_high         numeric,
  fvg_low          numeric,

  -- market snapshot
  last_price       numeric     not null,
  price_change_pct numeric     not null,
  volume_24h       numeric     not null,

  -- meta
  detected_at      timestamptz not null default now(),
  alerted          boolean     not null default false,
  created_at       timestamptz not null default now()
);

create index if not exists crt_setups_symbol_direction_idx
  on crt_setups (symbol, direction, created_at desc);

create index if not exists crt_setups_detected_at_idx
  on crt_setups (detected_at desc);

-- ─── Alert Settings ───────────────────────────────────────────────────────────
create table if not exists alert_settings (
  id              uuid primary key default gen_random_uuid(),
  chat_id         text        not null unique,   -- Telegram chat_id
  min_mc_volume   numeric     not null default 10000,  -- 24h vol proxy
  watchlist       text[]      not null default '{}',   -- [] = all
  notify_bullish  boolean     not null default true,
  notify_bearish  boolean     not null default true,
  active          boolean     not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists alert_settings_active_idx
  on alert_settings (active) where active = true;

-- ─── Scan Logs ────────────────────────────────────────────────────────────────
create table if not exists scan_logs (
  id               uuid primary key default gen_random_uuid(),
  started_at       timestamptz not null default now(),
  finished_at      timestamptz,
  symbols_scanned  integer     not null default 0,
  setups_found     integer     not null default 0,
  alerts_sent      integer     not null default 0,
  error            text
);

create index if not exists scan_logs_started_at_idx
  on scan_logs (started_at desc);

-- ─── RLS: service role only (bot uses service role key) ──────────────────────
alter table crt_setups    enable row level security;
alter table alert_settings enable row level security;
alter table scan_logs     enable row level security;

-- Allow full access for service role (used by the bot)
create policy "service role full access" on crt_setups
  for all using (auth.role() = 'service_role');

create policy "service role full access" on alert_settings
  for all using (auth.role() = 'service_role');

create policy "service role full access" on scan_logs
  for all using (auth.role() = 'service_role');
