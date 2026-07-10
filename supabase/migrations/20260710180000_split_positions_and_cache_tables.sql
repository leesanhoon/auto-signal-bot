-- Step 1: Create new tables for Volman system
CREATE TABLE IF NOT EXISTS public.open_positions_volman (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  pair text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('LONG', 'SHORT')),
  setup text,
  entry text NOT NULL,
  stop_loss text NOT NULL,
  take_profit_1 text NOT NULL,
  take_profit_2 text,
  reasons text[],
  opened_at timestamptz DEFAULT now(),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  last_decision text CHECK (last_decision IN ('HOLD', 'CLOSE', 'STOP')) DEFAULT NULL,
  last_decision_confidence integer DEFAULT NULL,
  last_decision_comment text DEFAULT NULL,
  last_checked_at timestamptz DEFAULT NULL,
  closed_at timestamptz DEFAULT NULL,
  trade_stage text DEFAULT 'open' CHECK (trade_stage IN ('open', 'tp1_partial', 'trailing', 'closed')),
  tp1_close_percent integer DEFAULT 50,
  tp1_closed_percent integer DEFAULT 0,
  tp1_closed_at timestamptz DEFAULT NULL,
  trailing_stop_loss text DEFAULT NULL,
  trailing_started_at timestamptz DEFAULT NULL,
  risk_reward_ratio numeric(10,2) DEFAULT NULL,
  tp1_risk_reward_ratio numeric(10,2) DEFAULT NULL,
  tp2_risk_reward_ratio numeric(10,2) DEFAULT NULL,
  min_risk_reward_ratio numeric(10,2) DEFAULT 1.5,
  last_management_action text NOT NULL DEFAULT 'NONE',
  last_management_comment text DEFAULT NULL,
  last_management_at timestamptz DEFAULT NULL,
  close_reason text CHECK (close_reason IN ('stop_loss', 'take_profit_2', 'manual_close')) DEFAULT NULL,
  realized_risk_reward_ratio numeric(10,2) DEFAULT NULL,
  realized_exit_price text DEFAULT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pending_orders_volman (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  pair text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('LONG', 'SHORT')),
  setup text,
  order_type text NOT NULL CHECK (order_type IN ('BUY_STOP', 'SELL_STOP', 'BUY_LIMIT', 'SELL_LIMIT', 'WAIT_FOR_CONFIRMATION')),
  entry text NOT NULL,
  stop_loss text NOT NULL,
  take_profit_1 text NOT NULL,
  take_profit_2 text,
  confidence integer,
  reasons text[],
  risks text[],
  primary_timeframe text NOT NULL DEFAULT 'H4' CHECK (primary_timeframe IN ('D1', 'H4', 'M15')),
  source_chart_filepath text,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'TRIGGERED', 'EXPIRED', 'CANCELLED')),
  run_count integer NOT NULL DEFAULT 0,
  expiry_runs integer NOT NULL DEFAULT 2,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_reason text,
  triggered_position_id bigint REFERENCES public.open_positions_volman(id)
);

CREATE TABLE IF NOT EXISTS public.analysis_cache_volman (
  candle_key text PRIMARY KEY,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Step 2: Create new tables for SMC system
CREATE TABLE IF NOT EXISTS public.open_positions_smc (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  pair text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('LONG', 'SHORT')),
  setup text,
  entry text NOT NULL,
  stop_loss text NOT NULL,
  take_profit_1 text NOT NULL,
  take_profit_2 text,
  reasons text[],
  opened_at timestamptz DEFAULT now(),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  last_decision text CHECK (last_decision IN ('HOLD', 'CLOSE', 'STOP')) DEFAULT NULL,
  last_decision_confidence integer DEFAULT NULL,
  last_decision_comment text DEFAULT NULL,
  last_checked_at timestamptz DEFAULT NULL,
  closed_at timestamptz DEFAULT NULL,
  trade_stage text DEFAULT 'open' CHECK (trade_stage IN ('open', 'tp1_partial', 'trailing', 'closed')),
  tp1_close_percent integer DEFAULT 50,
  tp1_closed_percent integer DEFAULT 0,
  tp1_closed_at timestamptz DEFAULT NULL,
  trailing_stop_loss text DEFAULT NULL,
  trailing_started_at timestamptz DEFAULT NULL,
  risk_reward_ratio numeric(10,2) DEFAULT NULL,
  tp1_risk_reward_ratio numeric(10,2) DEFAULT NULL,
  tp2_risk_reward_ratio numeric(10,2) DEFAULT NULL,
  min_risk_reward_ratio numeric(10,2) DEFAULT 1.5,
  last_management_action text NOT NULL DEFAULT 'NONE',
  last_management_comment text DEFAULT NULL,
  last_management_at timestamptz DEFAULT NULL,
  close_reason text CHECK (close_reason IN ('stop_loss', 'take_profit_2', 'manual_close')) DEFAULT NULL,
  realized_risk_reward_ratio numeric(10,2) DEFAULT NULL,
  realized_exit_price text DEFAULT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pending_orders_smc (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  pair text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('LONG', 'SHORT')),
  setup text,
  order_type text NOT NULL CHECK (order_type IN ('BUY_STOP', 'SELL_STOP', 'BUY_LIMIT', 'SELL_LIMIT', 'WAIT_FOR_CONFIRMATION')),
  entry text NOT NULL,
  stop_loss text NOT NULL,
  take_profit_1 text NOT NULL,
  take_profit_2 text,
  confidence integer,
  reasons text[],
  risks text[],
  primary_timeframe text NOT NULL DEFAULT 'H4' CHECK (primary_timeframe IN ('D1', 'H4', 'M15')),
  source_chart_filepath text,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'TRIGGERED', 'EXPIRED', 'CANCELLED')),
  run_count integer NOT NULL DEFAULT 0,
  expiry_runs integer NOT NULL DEFAULT 2,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_reason text,
  triggered_position_id bigint REFERENCES public.open_positions_smc(id)
);

CREATE TABLE IF NOT EXISTS public.analysis_cache_smc (
  candle_key text PRIMARY KEY,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Step 3: Migrate data from old tables to new tables
-- NOTE: legacy `open_positions` table has no `created_at` column, so it is
-- omitted here and left to default to now() on the new tables.
INSERT INTO open_positions_volman (id, pair, direction, setup, entry, stop_loss, take_profit_1, take_profit_2, reasons, opened_at, status, last_decision, last_decision_confidence, last_decision_comment, last_checked_at, closed_at, trade_stage, tp1_close_percent, tp1_closed_percent, tp1_closed_at, trailing_stop_loss, trailing_started_at, risk_reward_ratio, tp1_risk_reward_ratio, tp2_risk_reward_ratio, min_risk_reward_ratio, last_management_action, last_management_comment, last_management_at, close_reason, realized_risk_reward_ratio, realized_exit_price)
OVERRIDING SYSTEM VALUE
SELECT id, pair, direction, setup, entry, stop_loss, take_profit_1, take_profit_2, reasons, opened_at, status, last_decision, last_decision_confidence, last_decision_comment, last_checked_at, closed_at, trade_stage, tp1_close_percent, tp1_closed_percent, tp1_closed_at, trailing_stop_loss, trailing_started_at, risk_reward_ratio, tp1_risk_reward_ratio, tp2_risk_reward_ratio, min_risk_reward_ratio, last_management_action, last_management_comment, last_management_at, close_reason, realized_risk_reward_ratio, realized_exit_price
FROM open_positions
WHERE system = 'volman' OR system IS NULL;

INSERT INTO open_positions_smc (id, pair, direction, setup, entry, stop_loss, take_profit_1, take_profit_2, reasons, opened_at, status, last_decision, last_decision_confidence, last_decision_comment, last_checked_at, closed_at, trade_stage, tp1_close_percent, tp1_closed_percent, tp1_closed_at, trailing_stop_loss, trailing_started_at, risk_reward_ratio, tp1_risk_reward_ratio, tp2_risk_reward_ratio, min_risk_reward_ratio, last_management_action, last_management_comment, last_management_at, close_reason, realized_risk_reward_ratio, realized_exit_price)
OVERRIDING SYSTEM VALUE
SELECT id, pair, direction, setup, entry, stop_loss, take_profit_1, take_profit_2, reasons, opened_at, status, last_decision, last_decision_confidence, last_decision_comment, last_checked_at, closed_at, trade_stage, tp1_close_percent, tp1_closed_percent, tp1_closed_at, trailing_stop_loss, trailing_started_at, risk_reward_ratio, tp1_risk_reward_ratio, tp2_risk_reward_ratio, min_risk_reward_ratio, last_management_action, last_management_comment, last_management_at, close_reason, realized_risk_reward_ratio, realized_exit_price
FROM open_positions
WHERE system = 'smc';

INSERT INTO pending_orders_volman (id, pair, direction, setup, order_type, entry, stop_loss, take_profit_1, take_profit_2, confidence, reasons, risks, primary_timeframe, source_chart_filepath, status, run_count, expiry_runs, created_at, resolved_at, resolved_reason, triggered_position_id)
OVERRIDING SYSTEM VALUE
SELECT id, pair, direction, setup, order_type, entry, stop_loss, take_profit_1, take_profit_2, confidence, reasons, risks, primary_timeframe, source_chart_filepath, status, run_count, expiry_runs, created_at, resolved_at, resolved_reason, triggered_position_id
FROM pending_orders
WHERE system = 'volman' OR system IS NULL;

INSERT INTO pending_orders_smc (id, pair, direction, setup, order_type, entry, stop_loss, take_profit_1, take_profit_2, confidence, reasons, risks, primary_timeframe, source_chart_filepath, status, run_count, expiry_runs, created_at, resolved_at, resolved_reason, triggered_position_id)
OVERRIDING SYSTEM VALUE
SELECT id, pair, direction, setup, order_type, entry, stop_loss, take_profit_1, take_profit_2, confidence, reasons, risks, primary_timeframe, source_chart_filepath, status, run_count, expiry_runs, created_at, resolved_at, resolved_reason, triggered_position_id
FROM pending_orders
WHERE system = 'smc';

-- FIX (Lead self-review 2026-07-10): candle_key thực tế có dạng
-- "<candleBaseKey>:<cacheLabel>:<timeframeMode>[:<primaryTimeframe>]" (xem buildChartAnalysisCacheKey
-- trong src/charts/analyzer.ts và cacheLabel "smc"/"deterministic" trong index.ts/smc-index.ts).
-- Do đó suffix luôn có dạng ":smc:multi", ":smc:single:M15"... KHÔNG BAO GIỜ kết thúc đúng bằng ":smc".
-- Pattern "LIKE '%:smc'" (không có % ở cuối) sẽ luôn FALSE cho mọi row thật, khiến toàn bộ cache SMC
-- bị phân loại nhầm sang analysis_cache_volman và analysis_cache_smc luôn rỗng. Sửa thành ':smc:%'.
INSERT INTO analysis_cache_volman (candle_key, result, created_at)
SELECT candle_key, result, created_at
FROM chart_analysis_cache
WHERE candle_key NOT LIKE '%:smc:%';

INSERT INTO analysis_cache_smc (candle_key, result, created_at)
SELECT candle_key, result, created_at
FROM chart_analysis_cache
WHERE candle_key LIKE '%:smc:%';

-- Step 4: Recreate indexes for new tables
CREATE INDEX IF NOT EXISTS idx_open_positions_volman_pair_status 
  ON open_positions_volman(pair, status);
CREATE INDEX IF NOT EXISTS idx_open_positions_volman_status 
  ON open_positions_volman(status);
CREATE INDEX IF NOT EXISTS idx_open_positions_volman_opened_at 
  ON open_positions_volman(opened_at);

CREATE INDEX IF NOT EXISTS idx_pending_orders_volman_pair_status 
  ON pending_orders_volman(pair, status);
CREATE INDEX IF NOT EXISTS idx_pending_orders_volman_status 
  ON pending_orders_volman(status);

CREATE INDEX IF NOT EXISTS idx_open_positions_smc_pair_status 
  ON open_positions_smc(pair, status);
CREATE INDEX IF NOT EXISTS idx_open_positions_smc_status 
  ON open_positions_smc(status);
CREATE INDEX IF NOT EXISTS idx_open_positions_smc_opened_at 
  ON open_positions_smc(opened_at);

CREATE INDEX IF NOT EXISTS idx_pending_orders_smc_pair_status 
  ON pending_orders_smc(pair, status);
CREATE INDEX IF NOT EXISTS idx_pending_orders_smc_status 
  ON pending_orders_smc(status);

-- Step 5: Foreign key constraints are already defined in CREATE TABLE statements above
-- pending_orders_volman.triggered_position_id -> open_positions_volman.id
-- pending_orders_smc.triggered_position_id -> open_positions_smc.id

-- NOTE: Old tables (open_positions, pending_orders, chart_analysis_cache) are NOT dropped
-- They will be kept for backward compatibility during the code transition period.
-- Cleanup (DROP old tables) will be done in a separate migration after code deployment.
