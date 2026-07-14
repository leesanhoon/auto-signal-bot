# Chart Symbols → Database + Chart-Render Failure Alert Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the hardcoded Volman chart-symbol list into Supabase (editable from the Dashboard), guarantee every crypto symbol is actually tradeable on Binance Futures, and make the previously-silent "Render chart batch failed, fallback to text-only" failure self-diagnosing via a Telegram alert and a preflight check.

**Architecture:** A new `chart_symbols_volman` table replaces the hardcoded `BASE_CHARTS` array. `volman-charts.config.ts` becomes an async, memoized loader (`getCharts()`) backed by a small repository module — every call site was already inside an `async` function, so this is a mechanical `CHARTS` → `await getCharts()` swap. A one-off seed script migrates the existing list, validating every `BINANCE:` symbol against the real Binance Futures `exchangeInfo` endpoint before insert. A standalone, re-runnable verify script does the same check later for symbols added by hand. Separately, `setup-chart-renderer.ts` gains a small diagnostics helper reused by both a Telegram alert (fired when chart-batch rendering throws) and a new Playwright preflight check.

**Tech Stack:** TypeScript (strict, ESM, `tsx` runtime), Supabase (`@supabase/supabase-js`), Vitest, Playwright (`chromium`).

## Global Constraints

- No fallback to any hardcoded symbol list — `loadActiveChartSymbols()` throws on Supabase error or an empty result; each `npm run ...` invocation is a fresh process, so fail-fast beats scanning with a wrong/missing list.
- The Binance Futures tradeability check applies only to symbols starting with `BINANCE:`. Symbols starting with `OANDA:` (forex/commodities) never go through this check.
- At seed time, any `BINANCE:` symbol that fails the Binance Futures `exchangeInfo` check is dropped entirely — not inserted, not marked `is_active=false`.
- The existing weekend filter for `OANDA:` symbols (`dayOfWeek === 0 || dayOfWeek === 6`) must not change — only its data source changes from a hardcoded array to `loadActiveChartSymbols()`.
- New tables/migrations follow the existing `supabase/migrations/` naming and style (plain `create table if not exists`, no RLS — matches the most recent migrations such as `20260710000001_ohlc_candle_cache.sql`).
- Test files mirror `src/` under `tests/` (per `CLAUDE.md`), using the existing `vi.hoisted` + chained-mock pattern already used in `tests/charts/ohlc-cache-repository.test.ts` and `tests/charts/check-open-trades-runner-volman.test.ts`.
- When editing an existing file, follow that file's existing function-declaration-vs-arrow-function style rather than the blanket "prefer arrow functions" rule, to keep each file internally consistent. New standalone script files may use arrow functions freely.
- Reuse existing utilities instead of re-implementing: `toBinanceSymbol()` (`src/charts/ohlc-provider.ts`) for stripping the `BINANCE:` prefix, `getExchangeInfoFilters()` (`src/charts/binance-futures-client.ts`) for the Futures tradeability check, `notifyError()` (`src/shared/telegram-client.ts`) for Telegram alerts.

---

### Task 1: `chart_symbols_volman` table migration

**Files:**
- Create: `supabase/migrations/20260715000000_create_chart_symbols_volman.sql`

**Interfaces:**
- Produces: table `public.chart_symbols_volman(id bigint identity pk, name text, symbol text unique, category text, is_active boolean default true, created_at timestamptz default now())` — consumed by Task 2's repository.

- [ ] **Step 1: Write the migration file**

```sql
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
```

- [ ] **Step 2: Verify the file is well-formed SQL**

Run: `node -e "require('fs').readFileSync('supabase/migrations/20260715000000_create_chart_symbols_volman.sql', 'utf8')"`
Expected: no error printed (file exists and is readable). There is no local Postgres in this repo to apply the migration against — actual application happens against the real Supabase project outside this plan (see Task 8's manual run instructions).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260715000000_create_chart_symbols_volman.sql
git commit -m "feat: add chart_symbols_volman migration"
```

---

### Task 2: `chart-symbols-repository-volman.ts` repository

**Files:**
- Create: `src/charts/chart-symbols-repository-volman.ts`
- Test: `tests/charts/chart-symbols-repository-volman.test.ts`

**Interfaces:**
- Consumes: `getDb()` from `../shared/db.js` (returns a `SupabaseClient`).
- Produces: `loadActiveChartSymbols(): Promise<Array<{ name: string; symbol: string }>>` — consumed by Task 3's `getCharts()`.

- [ ] **Step 1: Write the failing test**

```typescript
import { beforeEach, describe, expect, test, vi } from "vitest";

const repoState = vi.hoisted(() => ({
  result: { data: null as unknown, error: null as unknown },
  from: vi.fn(),
}));

vi.mock("../../src/shared/db.js", () => ({
  getDb: () => ({ from: repoState.from }),
}));

const { loadActiveChartSymbols } = await import(
  "../../src/charts/chart-symbols-repository-volman.js"
);

describe("charts/chart-symbols-repository-volman", () => {
  beforeEach(() => {
    repoState.from.mockReset();
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      order: vi.fn(async () => repoState.result),
    };
    repoState.from.mockReturnValue(chain);
  });

  test("trả về danh sách symbol khi query thành công", async () => {
    repoState.result = {
      data: [
        { name: "BTC/USDT", symbol: "BINANCE:BTCUSDT" },
        { name: "EUR/USD", symbol: "OANDA:EURUSD" },
      ],
      error: null,
    };

    const result = await loadActiveChartSymbols();

    expect(repoState.from).toHaveBeenCalledWith("chart_symbols_volman");
    expect(repoState.from().select).toHaveBeenCalledWith("name, symbol");
    expect(repoState.from().eq).toHaveBeenCalledWith("is_active", true);
    expect(result).toEqual([
      { name: "BTC/USDT", symbol: "BINANCE:BTCUSDT" },
      { name: "EUR/USD", symbol: "OANDA:EURUSD" },
    ]);
  });

  test("throw khi Supabase trả error", async () => {
    repoState.result = { data: null, error: { message: "connection refused" } };

    await expect(loadActiveChartSymbols()).rejects.toThrow(/connection refused/);
  });

  test("throw khi data rỗng", async () => {
    repoState.result = { data: [], error: null };

    await expect(loadActiveChartSymbols()).rejects.toThrow(/không có symbol/);
  });

  test("throw khi data là null", async () => {
    repoState.result = { data: null, error: null };

    await expect(loadActiveChartSymbols()).rejects.toThrow(/không có symbol/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/charts/chart-symbols-repository-volman.test.ts`
Expected: FAIL — `Cannot find module '../../src/charts/chart-symbols-repository-volman.js'`

- [ ] **Step 3: Write minimal implementation**

```typescript
import { getDb } from "../shared/db.js";

export type ChartSymbolRow = {
  name: string;
  symbol: string;
};

export async function loadActiveChartSymbols(): Promise<ChartSymbolRow[]> {
  const { data, error } = await (getDb().from("chart_symbols_volman") as any)
    .select("name, symbol")
    .eq("is_active", true)
    .order("id", { ascending: true });

  if (error) {
    throw new Error(
      `Không tải được chart_symbols_volman: ${error.message ?? String(error)}`,
    );
  }
  if (!data || data.length === 0) {
    throw new Error("chart_symbols_volman không có symbol nào đang active");
  }

  return data as ChartSymbolRow[];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/charts/chart-symbols-repository-volman.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/charts/chart-symbols-repository-volman.ts tests/charts/chart-symbols-repository-volman.test.ts
git commit -m "feat: add chart_symbols_volman repository"
```

---

### Task 3: Convert `volman-charts.config.ts` to async, DB-backed `getCharts()`

**Files:**
- Modify: `src/charts/volman-charts.config.ts` (full rewrite — the hardcoded `BASE_CHARTS` array is removed entirely)
- Test: `tests/charts/volman-charts.config.test.ts`

**Interfaces:**
- Consumes: `loadActiveChartSymbols()` from `./chart-symbols-repository-volman.js` (Task 2).
- Produces: `getCharts(): Promise<ChartConfig[]>`, `getChartsForTimeframeMode(timeframeMode: ChartTimeframeMode, primaryTimeframe: ChartTimeframe): Promise<ChartConfig[]>` — consumed by Task 4's call sites. `buildChartHtml(c: ChartConfig): string` is unchanged.

- [ ] **Step 1: Write the failing test**

```typescript
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const repoState = vi.hoisted(() => ({
  loadActiveChartSymbols: vi.fn(),
}));

vi.mock("../../src/charts/chart-symbols-repository-volman.js", () => repoState);

describe("charts/volman-charts.config", () => {
  beforeEach(() => {
    vi.resetModules();
    repoState.loadActiveChartSymbols.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("getCharts() flatMaps mỗi base symbol ra 4 timeframe (D1/H4/H1/M15)", async () => {
    vi.setSystemTime(new Date("2024-01-17T12:00:00Z")); // Wednesday
    repoState.loadActiveChartSymbols.mockResolvedValue([
      { name: "BTC/USDT", symbol: "BINANCE:BTCUSDT" },
    ]);

    const { getCharts } = await import("../../src/charts/volman-charts.config.js");
    const charts = await getCharts();

    expect(charts).toHaveLength(4);
    expect(charts.map((c) => c.timeframe).sort()).toEqual(["D1", "H1", "H4", "M15"].sort());
    expect(charts.every((c) => c.symbol === "BINANCE:BTCUSDT")).toBe(true);
    expect(charts.find((c) => c.timeframe === "D1")?.name).toBe("BTC/USDT D1");
  });

  test("lọc symbol OANDA: vào cuối tuần (Chủ nhật), giữ nguyên symbol BINANCE:", async () => {
    vi.setSystemTime(new Date("2024-01-14T12:00:00Z")); // Sunday
    repoState.loadActiveChartSymbols.mockResolvedValue([
      { name: "BTC/USDT", symbol: "BINANCE:BTCUSDT" },
      { name: "EUR/USD", symbol: "OANDA:EURUSD" },
    ]);

    const { getCharts } = await import("../../src/charts/volman-charts.config.js");
    const charts = await getCharts();

    expect(charts.every((c) => c.symbol !== "OANDA:EURUSD")).toBe(true);
    expect(charts.some((c) => c.symbol === "BINANCE:BTCUSDT")).toBe(true);
  });

  test("không lọc symbol OANDA: vào ngày thường", async () => {
    vi.setSystemTime(new Date("2024-01-17T12:00:00Z")); // Wednesday
    repoState.loadActiveChartSymbols.mockResolvedValue([
      { name: "EUR/USD", symbol: "OANDA:EURUSD" },
    ]);

    const { getCharts } = await import("../../src/charts/volman-charts.config.js");
    const charts = await getCharts();

    expect(charts.some((c) => c.symbol === "OANDA:EURUSD")).toBe(true);
  });

  test("memoize — gọi getCharts() 2 lần chỉ query DB 1 lần", async () => {
    vi.setSystemTime(new Date("2024-01-17T12:00:00Z"));
    repoState.loadActiveChartSymbols.mockResolvedValue([
      { name: "BTC/USDT", symbol: "BINANCE:BTCUSDT" },
    ]);

    const { getCharts } = await import("../../src/charts/volman-charts.config.js");
    await getCharts();
    await getCharts();

    expect(repoState.loadActiveChartSymbols).toHaveBeenCalledTimes(1);
  });

  test("getChartsForTimeframeMode('single', 'H4') chỉ trả chart H4", async () => {
    vi.setSystemTime(new Date("2024-01-17T12:00:00Z"));
    repoState.loadActiveChartSymbols.mockResolvedValue([
      { name: "BTC/USDT", symbol: "BINANCE:BTCUSDT" },
    ]);

    const { getChartsForTimeframeMode } = await import(
      "../../src/charts/volman-charts.config.js"
    );
    const charts = await getChartsForTimeframeMode("single", "H4");

    expect(charts).toHaveLength(1);
    expect(charts[0].timeframe).toBe("H4");
  });

  test("getChartsForTimeframeMode('multi', 'H4') trả cả 4 timeframe", async () => {
    vi.setSystemTime(new Date("2024-01-17T12:00:00Z"));
    repoState.loadActiveChartSymbols.mockResolvedValue([
      { name: "BTC/USDT", symbol: "BINANCE:BTCUSDT" },
    ]);

    const { getChartsForTimeframeMode } = await import(
      "../../src/charts/volman-charts.config.js"
    );
    const charts = await getChartsForTimeframeMode("multi", "H4");

    expect(charts).toHaveLength(4);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/charts/volman-charts.config.test.ts`
Expected: FAIL — `getCharts` is not exported / `CHARTS` still exists as the only export (module hasn't been rewritten yet)

- [ ] **Step 3: Rewrite `volman-charts.config.ts`**

Replace the entire file content with:

```typescript
import type { ChartConfig, ChartTimeframe } from "./chart-types-common.js";
import type { ChartTimeframeMode } from "./volman-config-env.js";
import { loadActiveChartSymbols } from "./chart-symbols-repository-volman.js";

const TIMEFRAME_CONFIGS: Array<{
  timeframe: ChartTimeframe;
  interval: string;
}> = [
  { timeframe: "D1", interval: "D" },
  { timeframe: "H4", interval: "240" },
  { timeframe: "H1", interval: "60" },
  { timeframe: "M15", interval: "15" },
];

function chart(
  name: string,
  symbol: string,
  timeframe: ChartTimeframe,
  interval: string,
): ChartConfig {
  return {
    name: `${name} ${timeframe}`,
    symbol,
    interval,
    description: `${name} — ${timeframe}`,
    timeframe,
  };
}

let cachedCharts: ChartConfig[] | undefined;

export async function getCharts(): Promise<ChartConfig[]> {
  if (cachedCharts) return cachedCharts;

  const baseSymbols = await loadActiveChartSymbols();
  const dayOfWeek = new Date().getDay();
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

  cachedCharts = baseSymbols
    .filter((base) => !(isWeekend && base.symbol.startsWith("OANDA:")))
    .flatMap((base) =>
      TIMEFRAME_CONFIGS.map((timeframe) =>
        chart(base.name, base.symbol, timeframe.timeframe, timeframe.interval),
      ),
    );

  return cachedCharts;
}

export async function getChartsForTimeframeMode(
  timeframeMode: ChartTimeframeMode,
  primaryTimeframe: ChartTimeframe,
): Promise<ChartConfig[]> {
  const charts = await getCharts();
  if (timeframeMode === "single") {
    return charts.filter((chart) => chart.timeframe === primaryTimeframe);
  }
  return charts;
}

export function buildChartHtml(c: ChartConfig): string {
  return `<!DOCTYPE html>
<html><head><style>body{margin:0;background:#131722;}#tv_chart{width:100%;height:100vh;}</style></head>
<body>
<div id="tv_chart"></div>
<script src="https://s3.tradingview.com/tv.js"></script>
<script>
new TradingView.widget({
  container_id: "tv_chart",
  autosize: true,
  symbol: "${c.symbol}",
  interval: "${c.interval}",
  timezone: "Etc/UTC",
  theme: "dark",
  style: "1",
  locale: "en",
  hide_top_toolbar: false,
  hide_side_toolbar: false,
  hide_volume: false,
  allow_symbol_change: false,
  save_image: false,
  withdateranges: true,
  studies: [
    { id: "MAExp@tv-basicstudies", inputs: { length: 20 } }
  ]
});
</script>
</body></html>`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/charts/volman-charts.config.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/charts/volman-charts.config.ts tests/charts/volman-charts.config.test.ts
git commit -m "feat: load chart symbols from Supabase instead of hardcoded BASE_CHARTS"
```

---

### Task 4: Update every `CHARTS` / `getChartsForTimeframeMode` call site

**Files:**
- Modify: `src/charts/index.ts`
- Modify: `src/charts/check-open-trades-runner-volman.ts`
- Modify: `src/charts/check-pending-orders-runner-volman.ts`
- Modify: `src/charts/setup-backtest-runner.ts`
- Modify: `src/charts/setup-backtest-compare-runner.ts`
- Modify: `tests/charts/check-open-trades-runner-volman.test.ts`

**Interfaces:**
- Consumes: `getCharts()`, `getChartsForTimeframeMode()` from Task 3.
- Produces: no new exports — this task only updates callers.

- [ ] **Step 1: Update `src/charts/index.ts`**

Change the import (line 38):

```typescript
import { getCharts, getChartsForTimeframeMode } from "./volman-charts.config.js";
```

Change `getPairs()` (lines 63-70) from sync to async:

```typescript
async function getPairs(): Promise<Array<{ pair: string; symbol: string }>> {
  const seen = new Map<string, string>();
  for (const chart of await getCharts()) {
    const pair = chart.name.replace(` ${chart.timeframe}`, "");
    if (!seen.has(pair)) seen.set(pair, chart.symbol);
  }
  return Array.from(seen.entries()).map(([pair, symbol]) => ({ pair, symbol }));
}
```

In `analyzeCurrentWindow` (around lines 76-98), change:

```typescript
  const runtimeCharts = getChartsForTimeframeMode(
    timeframeMode,
    primaryTimeframe,
  );
```

to:

```typescript
  const runtimeCharts = await getChartsForTimeframeMode(
    timeframeMode,
    primaryTimeframe,
  );
```

and change:

```typescript
  const result = await analyzeAllChartsDeterministic(getPairs(), {
```

to:

```typescript
  const result = await analyzeAllChartsDeterministic(await getPairs(), {
```

In `handleAnalysisResult` (around line 182), change:

```typescript
  for (const chart of CHARTS) {
```

to:

```typescript
  for (const chart of await getCharts()) {
```

- [ ] **Step 2: Update `src/charts/check-open-trades-runner-volman.ts`**

Change the import (line 2):

```typescript
import { getCharts } from "./volman-charts.config.js";
```

Inside `evaluateOpenPosition` (line 27), change:

```typescript
  const chart = findChartForPair(CHARTS, position.pair, position.primaryTimeframe ?? "H4");
```

to:

```typescript
  const chart = findChartForPair(await getCharts(), position.pair, position.primaryTimeframe ?? "H4");
```

- [ ] **Step 3: Update `src/charts/check-pending-orders-runner-volman.ts`**

Change the import (line 11):

```typescript
import { getCharts } from "./volman-charts.config.js";
```

Inside `reviewPendingOrder` (line 42), change:

```typescript
  const chart = findChartForPair(CHARTS, order.pair, order.primaryTimeframe ?? "H4");
```

to:

```typescript
  const chart = findChartForPair(await getCharts(), order.pair, order.primaryTimeframe ?? "H4");
```

- [ ] **Step 4: Update `src/charts/setup-backtest-runner.ts`**

Change the import (line 3):

```typescript
import { getCharts } from "./volman-charts.config.js";
```

Inside `main()` (line 151), change:

```typescript
  for (const chart of CHARTS) {
```

to:

```typescript
  for (const chart of await getCharts()) {
```

- [ ] **Step 5: Update `src/charts/setup-backtest-compare-runner.ts`**

Change the import (line 3):

```typescript
import { getCharts } from "./volman-charts.config.js";
```

Inside `main()` (line 332), change:

```typescript
  for (const chart of CHARTS) {
```

to:

```typescript
  for (const chart of await getCharts()) {
```

- [ ] **Step 6: Update the existing test mock in `tests/charts/check-open-trades-runner-volman.test.ts`**

Change line 25 from:

```typescript
vi.mock("../../src/charts/volman-charts.config.js", () => ({ CHARTS: [] }));
```

to:

```typescript
vi.mock("../../src/charts/volman-charts.config.js", () => ({
  getCharts: vi.fn().mockResolvedValue([]),
}));
```

- [ ] **Step 7: Run the full test suite and typecheck**

Run: `npx vitest run tests/charts/check-open-trades-runner-volman.test.ts`
Expected: PASS (3 tests, unchanged)

Run: `npx tsc --noEmit`
Expected: no errors (confirms every `CHARTS` reference was actually replaced — a leftover `CHARTS` import would fail to resolve since it's no longer exported)

- [ ] **Step 8: Commit**

```bash
git add src/charts/index.ts src/charts/check-open-trades-runner-volman.ts src/charts/check-pending-orders-runner-volman.ts src/charts/setup-backtest-runner.ts src/charts/setup-backtest-compare-runner.ts tests/charts/check-open-trades-runner-volman.test.ts
git commit -m "refactor: switch all CHARTS call sites to await getCharts()"
```

---

### Task 5: `getPlaywrightDiagnostics()` helper in `setup-chart-renderer.ts`

**Files:**
- Modify: `src/charts/setup-chart-renderer.ts`
- Modify: `tests/charts/setup-chart-renderer.test.ts`

**Interfaces:**
- Consumes: `chromium` from `playwright` (already imported in this file).
- Produces: `getPlaywrightDiagnostics(): string` — consumed by Task 6 (Telegram alert) and Task 7 (preflight check).

- [ ] **Step 1: Write the failing test**

Add to the top of `tests/charts/setup-chart-renderer.test.ts`, alongside the existing imports:

```typescript
import { getPlaywrightDiagnostics } from "../../src/charts/setup-chart-renderer.js";
```

Add a new `describe` block:

```typescript
describe("getPlaywrightDiagnostics", () => {
  test("trả về chuỗi chứa PLAYWRIGHT_BROWSERS_PATH và chromium.executablePath", () => {
    const result = getPlaywrightDiagnostics();

    expect(result).toContain("PLAYWRIGHT_BROWSERS_PATH=");
    expect(result).toContain("chromium.executablePath=");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/charts/setup-chart-renderer.test.ts -t "getPlaywrightDiagnostics"`
Expected: FAIL — `getPlaywrightDiagnostics is not exported`

- [ ] **Step 3: Add the implementation**

In `src/charts/setup-chart-renderer.ts`, add this function right after the `logger` declaration (line 6) and before `buildCoordMap`:

```typescript
export function getPlaywrightDiagnostics(): string {
  const browsersPath =
    process.env.PLAYWRIGHT_BROWSERS_PATH ?? "(không set — dùng default cache path)";

  let executablePath: string;
  try {
    executablePath = chromium.executablePath();
  } catch (error) {
    executablePath = `lỗi lấy path: ${error instanceof Error ? error.message : String(error)}`;
  }

  return `PLAYWRIGHT_BROWSERS_PATH=${browsersPath}\nchromium.executablePath=${executablePath}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/charts/setup-chart-renderer.test.ts`
Expected: PASS (all existing tests + the new one)

- [ ] **Step 5: Commit**

```bash
git add src/charts/setup-chart-renderer.ts tests/charts/setup-chart-renderer.test.ts
git commit -m "feat: add getPlaywrightDiagnostics() helper for chart-render failure diagnostics"
```

---

### Task 6: Enrich the chart-render-batch failure alert with `notifyError` + diagnostics

**Files:**
- Modify: `src/shared/telegram-volman.ts`
- Modify: `tests/shared/telegram-volman.test.ts`

**Interfaces:**
- Consumes: `notifyError(scope: string, error: unknown): Promise<void>` from `./telegram-client.js` (already exists), `getPlaywrightDiagnostics(): string` from `../charts/setup-chart-renderer.js` (Task 5).
- Produces: no new exports — behavior-only change to the existing catch block.

- [ ] **Step 1: Write the failing test**

Add near the top of `tests/shared/telegram-volman.test.ts`, before the other imports (these `vi.mock` calls are hoisted by Vitest):

```typescript
const shouldFailRender = vi.hoisted(() => ({ value: false }));

vi.mock("../../src/charts/setup-chart-renderer.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/charts/setup-chart-renderer.js")>();
  return {
    ...actual,
    renderSetupChartsBatch: vi.fn(async (...args: Parameters<typeof actual.renderSetupChartsBatch>) => {
      if (shouldFailRender.value) {
        throw new Error("browserType.launch: Executable doesn't exist at /fake/chromium");
      }
      return actual.renderSetupChartsBatch(...args);
    }),
  };
});

const notifyErrorMock = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("../../src/shared/telegram-client.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/shared/telegram-client.js")>();
  return { ...actual, notifyError: notifyErrorMock };
});
```

Add a new test inside `describe("sendAllAnalysesVolman", ...)`:

```typescript
  test("gửi notifyError kèm diagnostics khi renderSetupChartsBatch throw", async () => {
    const setupWithChart: TradeSetup = {
      ...minimalSetup,
      chartContext: {
        candles: [],
        ma21: [],
        triggerIndex: 10,
        sliceStartIndex: 0,
        geometry: { boxes: [], markers: [] },
      },
    };
    const resultWithChart: AnalysisResult = { ...result, setups: [setupWithChart] };
    const mockNotifier = createMockNotifier();

    shouldFailRender.value = true;
    try {
      await sendAllAnalysesVolman(resultWithChart, mockNotifier);
    } finally {
      shouldFailRender.value = false;
    }

    expect(notifyErrorMock).toHaveBeenCalledTimes(1);
    const [scope, message] = notifyErrorMock.mock.calls[0];
    expect(scope).toBe("Render chart batch (Volman)");
    expect(String(message)).toContain("Executable doesn't exist");
    expect(String(message)).toContain("PLAYWRIGHT_BROWSERS_PATH=");
    // Fallback to text-only must still happen — the setup message is still sent.
    expect(mockNotifier.sentMessages.some((m) => m.includes("EURUSD"))).toBe(true);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/shared/telegram-volman.test.ts -t "gửi notifyError"`
Expected: FAIL — `notifyErrorMock` was called 0 times (current code only calls `logger.warn`)

- [ ] **Step 3: Update `src/shared/telegram-volman.ts`**

Change the imports (lines 14-15):

```typescript
import { sendMessage, telegramNotifier, notifyError } from "./telegram-client.js";
import {
  renderSetupChartsBatch,
  getPlaywrightDiagnostics,
  type SetupChartInput,
} from "../charts/setup-chart-renderer.js";
```

Change the catch block (around lines 469-477):

```typescript
  let chartBuffers: (Buffer | null)[] = [];
  try {
    chartBuffers = await renderSetupChartsBatch(chartInputs.map((c) => c.input));
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const diagnostics = getPlaywrightDiagnostics();
    logger.warn("Render chart batch failed, fallback to text-only", {
      error: errorMessage,
      diagnostics,
    });
    await notifyError("Render chart batch (Volman)", `${errorMessage}\n\n${diagnostics}`);
    chartBuffers = [];
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/shared/telegram-volman.test.ts`
Expected: PASS (all existing tests + the new one)

- [ ] **Step 5: Commit**

```bash
git add src/shared/telegram-volman.ts tests/shared/telegram-volman.test.ts
git commit -m "feat: alert Telegram with diagnostics when chart-render batch fails"
```

---

### Task 7: Playwright chromium preflight check

**Files:**
- Modify: `src/scripts/preflight-fetch.ts`

**Interfaces:**
- Consumes: `chromium` from `playwright`, `getPlaywrightDiagnostics()` from `../charts/setup-chart-renderer.js` (Task 5), `runCheck()` (already defined in this file).
- Produces: no new exports — adds one more check to `main()`'s existing `checks` array.

- [ ] **Step 1: Add the import**

At the top of `src/scripts/preflight-fetch.ts`, add:

```typescript
import { chromium } from "playwright";
import { getPlaywrightDiagnostics } from "../charts/setup-chart-renderer.js";
```

- [ ] **Step 2: Add the check**

Inside `main()`, after the Supabase check block (before `const results = await Promise.all(checks);`), add:

```typescript
  checks.push(
    runCheck("Playwright Chromium", async () => {
      try {
        const browser = await chromium.launch({
          args: ["--no-sandbox", "--disable-setuid-sandbox"],
        });
        await browser.close();
        return `Launch OK | ${getPlaywrightDiagnostics()}`;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`${message} | ${getPlaywrightDiagnostics()}`);
      }
    }),
  );
```

- [ ] **Step 3: Manually verify it runs**

Run: `npm run preflight:fetch`
Expected: output includes a `[PASS] Playwright Chromium: Launch OK | PLAYWRIGHT_BROWSERS_PATH=...` line (assuming Playwright's chromium is installed on this dev machine, matching the other `setup-chart-renderer.test.ts` tests that already launch a real browser).

This script has no automated test file today (same as its existing Twelve Data / Supabase checks) — manual verification via the run above is the established convention for this file.

- [ ] **Step 4: Commit**

```bash
git add src/scripts/preflight-fetch.ts
git commit -m "feat: add Playwright chromium check to preflight-fetch"
```

---

### Task 8: One-off seed script — migrate the existing symbol list into Supabase

**Files:**
- Create: `src/scripts/seed-chart-symbols.ts`

**Interfaces:**
- Consumes: `getDb()` from `../shared/db.js`, `toBinanceSymbol()` from `../charts/ohlc-provider.js`, `getExchangeInfoFilters()` from `../charts/binance-futures-client.js`.
- Produces: rows in `chart_symbols_volman` (Task 1's table). This script is not imported by any other module — it is a manually-run, one-off migration tool per the design spec, and can be deleted after a successful run.

- [ ] **Step 1: Write the script**

```typescript
import "../shared/env.js";
import { getDb } from "../shared/db.js";
import { toBinanceSymbol } from "../charts/ohlc-provider.js";
import { getExchangeInfoFilters } from "../charts/binance-futures-client.js";

type SeedSymbol = {
  name: string;
  symbol: string;
  category: "crypto" | "commodity" | "major" | "cross";
  active: boolean;
};

// Transcribed verbatim from the pre-migration BASE_CHARTS array in
// src/charts/volman-charts.config.ts (git history has the original file).
// BINANCE: entries are validated against live Binance Futures exchangeInfo
// below before insert — duplicates/typos/delisted tickers are dropped there,
// not filtered here.
const SEED_DATA: SeedSymbol[] = [
  { name: "BTC/USDT", symbol: "BINANCE:BTCUSDT", category: "crypto", active: true },
  { name: "DASH/USDT", symbol: "BINANCE:DASHUSDT", category: "crypto", active: true },
  { name: "ETH/USDT", symbol: "BINANCE:ETHUSDT", category: "crypto", active: true },
  { name: "LTC/USDT", symbol: "BINANCE:LTCUSDT", category: "crypto", active: true },
  { name: "DOT/USDT", symbol: "BINANCE:DOTUSDT", category: "crypto", active: true },
  { name: "XRP/USDT", symbol: "BINANCE:XRPUSDT", category: "crypto", active: true },
  { name: "ADA/USDT", symbol: "BINANCE:ADAUSDT", category: "crypto", active: true },
  { name: "BCH/USDT", symbol: "BINANCE:BCHUSDT", category: "crypto", active: true },
  { name: "SOL/USDT", symbol: "BINANCE:SOLUSDT", category: "crypto", active: true },
  { name: "AVA/USDT", symbol: "BINANCE:AVAUSDT", category: "crypto", active: true },
  { name: "ETC/USDT", symbol: "BINANCE:ETCUSDT", category: "crypto", active: true },
  { name: "NEO/USDT", symbol: "BINANCE:NEOUSDT", category: "crypto", active: true },
  { name: "DOGE/USDT", symbol: "BINANCE:DOGEUSDT", category: "crypto", active: true },
  { name: "BNB/USDT", symbol: "BINANCE:BNBUSDT", category: "crypto", active: true },
  { name: "ZEC/USDT", symbol: "BINANCE:ZECUSDT", category: "crypto", active: true },
  { name: "TRX/USDT", symbol: "BINANCE:TRXUSDT", category: "crypto", active: true },
  { name: "XLM/USDT", symbol: "BINANCE:XLMUSDT", category: "crypto", active: true },
  { name: "AAVE/USDT", symbol: "BINANCE:AAVEUSDT", category: "crypto", active: true },
  { name: "UNI/USDT", symbol: "BINANCE:UNIUSDT", category: "crypto", active: true },
  { name: "ARB/USDT", symbol: "BINANCE:ARBUSDT", category: "crypto", active: true },
  { name: "NEAR/USDT", symbol: "BINANCE:NEARUSDT", category: "crypto", active: true },
  { name: "SUI/USDT", symbol: "BINANCE:SUIUSDT", category: "crypto", active: true },
  { name: "PEPE/USDT", symbol: "BINANCE:PEPEUSDT", category: "crypto", active: true },
  { name: "WLD/USDT", symbol: "BINANCE:WLDUSDT", category: "crypto", active: true },
  { name: "TAO/USDT", symbol: "BINANCE:TAOUSDT", category: "crypto", active: true },
  { name: "ENA/USDT", symbol: "BINANCE:ENAUSDT", category: "crypto", active: true },
  { name: "PAXG/USDT", symbol: "BINANCE:PAXGUSDT", category: "crypto", active: true },
  { name: "LINK/USDT", symbol: "BINANCE:LINKUSDT", category: "crypto", active: true },
  { name: "AVAX/USDT", symbol: "BINANCE:AVAXUSDT", category: "crypto", active: true },
  { name: "ICP/USDT", symbol: "BINANCE:ICPUSDT", category: "crypto", active: true },
  { name: "TIA/USDT", symbol: "BINANCE:TIAUSDT", category: "crypto", active: true },
  { name: "ONDO/USDT", symbol: "BINANCE:ONDOUSDT", category: "crypto", active: true },
  { name: "FIL/USDT", symbol: "BINANCE:FILUSDT", category: "crypto", active: true },
  { name: "SEI/USDT", symbol: "BINANCE:SEIUSDT", category: "crypto", active: true },
  { name: "FET/USDT", symbol: "BINANCE:FETUSDT", category: "crypto", active: true },
  { name: "HBAR/USDT", symbol: "BINANCE:HBARUSDT", category: "crypto", active: true },
  { name: "IOTA/USDT", symbol: "BINANCE:IOTAUSDT", category: "crypto", active: true },
  { name: "BONK/USDT", symbol: "BINANCE:BONKUSDT", category: "crypto", active: true },
  { name: "LDO/USDT", symbol: "BINANCE:LDOUSDT", category: "crypto", active: true },
  { name: "INJ/USDT", symbol: "BINANCE:INJUSDT", category: "crypto", active: true },
  { name: "EIGEN/USDT", symbol: "BINANCE:EIGENUSDT", category: "crypto", active: true },
  { name: "POL/USDT", symbol: "BINANCE:POLUSDT", category: "crypto", active: true },
  { name: "APT/USDT", symbol: "BINANCE:APTUSDT", category: "crypto", active: true },
  { name: "OP/USDT", symbol: "BINANCE:OPUSDT", category: "crypto", active: true },
  { name: "PENGU/USDT", symbol: "BINANCE:PENGUUSDT", category: "crypto", active: true },
  { name: "ORDI/USDT", symbol: "BINANCE:ORDIUSDT", category: "crypto", active: true },
  { name: "ALGO/USDT", symbol: "BINANCE:ALGOUSDT", category: "crypto", active: true },
  { name: "JTO/USDT", symbol: "BINANCE:JTOUSDT", category: "crypto", active: true },
  { name: "PENDLE/USDT", symbol: "BINANCE:PENDLEUSDT", category: "crypto", active: true },
  { name: "APE/USDT", symbol: "BINANCE:APEUSDT", category: "crypto", active: true },
  { name: "ETHFI/USDT", symbol: "BINANCE:ETHFIUSDT", category: "crypto", active: true },
  { name: "PYTH/USDT", symbol: "BINANCE:PYTHUSDT", category: "crypto", active: true },
  { name: "SHIB/USDT", symbol: "BINANCE:SHIBUSDT", category: "crypto", active: true },
  { name: "GALA/USDT", symbol: "BINANCE:GALAUSDT", category: "crypto", active: true },
  { name: "ZRO/USDT", symbol: "BINANCE:ZROUSDT", category: "crypto", active: true },
  { name: "RENDER/USDT", symbol: "BINANCE:RENDERUSDT", category: "crypto", active: true },
  { name: "CAKE/USDT", symbol: "BINANCE:CAKEUSDT", category: "crypto", active: true },
  { name: "CRV/USDT", symbol: "BINANCE:CRVUSDT", category: "crypto", active: true },
  { name: "CHZ/USDT", symbol: "BINANCE:CHZUSDT", category: "crypto", active: true },
  { name: "RUNE/USDT", symbol: "BINANCE:RUNEUSDT", category: "crypto", active: true },
  { name: "ATOM/USDT", symbol: "BINANCE:ATOMUSDT", category: "crypto", active: true },
  { name: "DYDX/USDT", symbol: "BINANCE:DYDXUSDT", category: "crypto", active: true },
  { name: "STRK/USDT", symbol: "BINANCE:STRKUSDT", category: "crypto", active: true },
  { name: "WIF/USDT", symbol: "BINANCE:WIFUSDT", category: "crypto", active: true },
  { name: "VET/USDT", symbol: "BINANCE:VETUSDT", category: "crypto", active: true },
  { name: "THETA/USDT", symbol: "BINANCE:THETAUSDT", category: "crypto", active: true },
  { name: "EGLD/USDT", symbol: "BINANCE:EGLDUSDT", category: "crypto", active: true },
  { name: "FLOW/USDT", symbol: "BINANCE:FLOWUSDT", category: "crypto", active: true },
  { name: "SAND/USDT", symbol: "BINANCE:SANDUSDT", category: "crypto", active: true },
  { name: "MANA/USDT", symbol: "BINANCE:MANAUSDT", category: "crypto", active: true },
  { name: "AXS/USDT", symbol: "BINANCE:AXSUSDT", category: "crypto", active: true },
  { name: "ENJ/USDT", symbol: "BINANCE:ENJUSDT", category: "crypto", active: true },
  { name: "XTZ/USDT", symbol: "BINANCE:XTZUSDT", category: "crypto", active: true },
  { name: "KLAY/USDT", symbol: "BINANCE:KLAYUSDT", category: "crypto", active: true },
  { name: "GLMR/USDT", symbol: "BINANCE:GLMRUSDT", category: "crypto", active: true },
  { name: "MOVR/USDT", symbol: "BINANCE:MOVRUSDT", category: "crypto", active: true },
  { name: "MKR/USDT", symbol: "BINANCE:MKRUSDT", category: "crypto", active: true },
  { name: "COMP/USDT", symbol: "BINANCE:COMPUSDT", category: "crypto", active: true },
  { name: "SUSHI/USDT", symbol: "BINANCE:SUSHIUSDT", category: "crypto", active: true },
  { name: "1INCH/USDT", symbol: "BINANCE:1INCHUSDT", category: "crypto", active: true },
  { name: "BALANCER/USDT", symbol: "BINANCE:BALANCERUSDT", category: "crypto", active: true },
  { name: "GMX/USDT", symbol: "BINANCE:GMXUSDT", category: "crypto", active: true },
  { name: "PERP/USDT", symbol: "BINANCE:PERPUSDT", category: "crypto", active: true },
  { name: "SNX/USDT", symbol: "BINANCE:SNXUSDT", category: "crypto", active: true },
  { name: "GRT/USDT", symbol: "BINANCE:GRTUSDT", category: "crypto", active: true },
  { name: "BLUR/USDT", symbol: "BINANCE:BLURUSDT", category: "crypto", active: true },
  { name: "LOOKS/USDT", symbol: "BINANCE:LOOKSUSDT", category: "crypto", active: true },
  { name: "AGIX/USDT", symbol: "BINANCE:AGIXUSDT", category: "crypto", active: true },
  { name: "OCEAN/USDT", symbol: "BINANCE:OCEANUSDT", category: "crypto", active: true },
  { name: "FLOKI/USDT", symbol: "BINANCE:FLOKIUSDT", category: "crypto", active: true },
  { name: "DENT/USDT", symbol: "BINANCE:DENTUSDT", category: "crypto", active: true },
  { name: "SAFE/USDT", symbol: "BINANCE:SAFEUSDT", category: "crypto", active: true },
  { name: "MATIC/USDT", symbol: "BINANCE:MATICUSDT", category: "crypto", active: true },
  { name: "KCS/USDT", symbol: "BINANCE:KCSUSDT", category: "crypto", active: true },
  { name: "OKB/USDT", symbol: "BINANCE:OKBUSDT", category: "crypto", active: true },
  { name: "BGB/USDT", symbol: "BINANCE:BGBUSDT", category: "crypto", active: true },
  { name: "LEO/USDT", symbol: "BINANCE:LEOUSDT", category: "crypto", active: true },
  { name: "HT/USDT", symbol: "BINANCE:HTUSDT", category: "crypto", active: true },
  { name: "MANTA/USDT", symbol: "BINANCE:MANTAUSDT", category: "crypto", active: true },
  { name: "STARKNET/USDT", symbol: "BINANCE:STARKNETUSDT", category: "crypto", active: true },
  { name: "ROSE/USDT", symbol: "BINANCE:ROSEUSDT", category: "crypto", active: true },
  { name: "ARKM/USDT", symbol: "BINANCE:ARKMUSDT", category: "crypto", active: true },
  { name: "MNT/USDT", symbol: "BINANCE:MNTUSDT", category: "crypto", active: true },
  { name: "PIXEL/USDT", symbol: "BINANCE:PIXELUSDT", category: "crypto", active: true },
  { name: "ENS/USDT", symbol: "BINANCE:ENSUSDT", category: "crypto", active: true },
  { name: "RSR/USDT", symbol: "BINANCE:RSRUSDT", category: "crypto", active: true },
  { name: "CVX/USDT", symbol: "BINANCE:CVXUSDT", category: "crypto", active: true },
  { name: "FXS/USDT", symbol: "BINANCE:FXSUSDT", category: "crypto", active: true },
  { name: "GSWAP/USDT", symbol: "BINANCE:GSWAPUSDT", category: "crypto", active: true },
  { name: "ASTR/USDT", symbol: "BINANCE:ASTRUSDT", category: "crypto", active: true },
  { name: "DIA/USDT", symbol: "BINANCE:DIAUSDT", category: "crypto", active: true },
  { name: "WOO/USDT", symbol: "BINANCE:WOOUSDT", category: "crypto", active: true },
  { name: "DIMO/USDT", symbol: "BINANCE:DIMOUSDT", category: "crypto", active: true },
  { name: "RDNT/USDT", symbol: "BINANCE:RDNTUSDT", category: "crypto", active: true },
  { name: "BEAM/USDT", symbol: "BINANCE:BEAMUSDT", category: "crypto", active: true },
  { name: "STRAX/USDT", symbol: "BINANCE:STRAXUSDT", category: "crypto", active: true },
  { name: "RARE/USDT", symbol: "BINANCE:RAREUSDT", category: "crypto", active: true },
  { name: "LUNA/USDT", symbol: "BINANCE:LUNAUSDT", category: "crypto", active: true },
  { name: "LUNC/USDT", symbol: "BINANCE:LUNCUSDT", category: "crypto", active: true },
  { name: "ORMAI/USDT", symbol: "BINANCE:ORMAIUSDT", category: "crypto", active: true },
  { name: "AUCTION/USDT", symbol: "BINANCE:AUCTIONUSDT", category: "crypto", active: true },
  { name: "GMT/USDT", symbol: "BINANCE:GMTUSDT", category: "crypto", active: true },
  { name: "GNS/USDT", symbol: "BINANCE:GNSUSDT", category: "crypto", active: true },
  { name: "ALICE/USDT", symbol: "BINANCE:ALICEUSDT", category: "crypto", active: true },
  { name: "IDEX/USDT", symbol: "BINANCE:IDEXUSDT", category: "crypto", active: true },
  { name: "WEB3/USDT", symbol: "BINANCE:WEB3USDT", category: "crypto", active: true },
  { name: "POND/USDT", symbol: "BINANCE:PONDUSDT", category: "crypto", active: true },
  { name: "HFT/USDT", symbol: "BINANCE:HFTUSDT", category: "crypto", active: true },
  { name: "AIDOGE/USDT", symbol: "BINANCE:AIDOGEUSDT", category: "crypto", active: true },
  { name: "ARKHAM/USDT", symbol: "BINANCE:ARKHAMUSDT", category: "crypto", active: true },
  { name: "SCNSOL/USDT", symbol: "BINANCE:SCNSOLUSDT", category: "crypto", active: true },
  { name: "PUNDIX/USDT", symbol: "BINANCE:PUNDIXUSDT", category: "crypto", active: true },
  { name: "MOVEZ/USDT", symbol: "BINANCE:MOVEZUSDT", category: "crypto", active: true },
  { name: "SAGA/USDT", symbol: "BINANCE:SAGAUSDT", category: "crypto", active: true },
  { name: "NOTCOIN/USDT", symbol: "BINANCE:NOTCOINUSDT", category: "crypto", active: true },
  { name: "HMSTR/USDT", symbol: "BINANCE:HMSTRUSDT", category: "crypto", active: true },
  { name: "USUAL/USDT", symbol: "BINANCE:USUALUSDT", category: "crypto", active: true },
  { name: "NAVI/USDT", symbol: "BINANCE:NAVIUSDT", category: "crypto", active: true },
  { name: "GYEN/USDT", symbol: "BINANCE:GYENUSDT", category: "crypto", active: true },
  { name: "BAKE/USDT", symbol: "BINANCE:BAKEUSDT", category: "crypto", active: true },
  { name: "BURGER/USDT", symbol: "BINANCE:BURGERUSDT", category: "crypto", active: true },
  { name: "MSWAP/USDT", symbol: "BINANCE:MSWAPUSDT", category: "crypto", active: true },
  { name: "VOXEL/USDT", symbol: "BINANCE:VOXELUSDT", category: "crypto", active: true },
  { name: "C98/USDT", symbol: "BINANCE:C98USDT", category: "crypto", active: true },
  { name: "ALPACA/USDT", symbol: "BINANCE:ALPACAUSDT", category: "crypto", active: true },
  { name: "BIFI/USDT", symbol: "BINANCE:BIFIUSDT", category: "crypto", active: true },
  { name: "AUTO/USDT", symbol: "BINANCE:AUTOUSDT", category: "crypto", active: true },
  { name: "FARM/USDT", symbol: "BINANCE:FARMUSDT", category: "crypto", active: true },
  { name: "PCS/USDT", symbol: "BINANCE:PCSUSDT", category: "crypto", active: true },
  { name: "MDX/USDT", symbol: "BINANCE:MDXUSDT", category: "crypto", active: true },
  { name: "MBOX/USDT", symbol: "BINANCE:MBOXUSDT", category: "crypto", active: true },
  { name: "WING/USDT", symbol: "BINANCE:WINGUSDT", category: "crypto", active: true },
  { name: "LINA/USDT", symbol: "BINANCE:LINAUSDT", category: "crypto", active: true },
  { name: "SAFEMOON/USDT", symbol: "BINANCE:SAFEMOONUSDT", category: "crypto", active: true },
  { name: "BABYDOGE/USDT", symbol: "BINANCE:BABYDOGEUSDT", category: "crypto", active: true },
  { name: "KISHU/USDT", symbol: "BINANCE:KISHUUSDT", category: "crypto", active: true },
  { name: "DOGECOIN/USDT", symbol: "BINANCE:DOGECOINUSDT", category: "crypto", active: true },
  { name: "SHINU/USDT", symbol: "BINANCE:SHINUUSDT", category: "crypto", active: true },
  { name: "AKITA/USDT", symbol: "BINANCE:AKITAUSDT", category: "crypto", active: true },
  { name: "SAITAMA/USDT", symbol: "BINANCE:SAITAMAUSDT", category: "crypto", active: true },
  { name: "ITACHI/USDT", symbol: "BINANCE:ITACHIUSDT", category: "crypto", active: true },
  { name: "HOKKAIDU/USDT", symbol: "BINANCE:HOKKAIIUSDT", category: "crypto", active: true },
  { name: "APTOS/USDT", symbol: "BINANCE:APTOSUSDT", category: "crypto", active: true },
  { name: "STEPN/USDT", symbol: "BINANCE:STEPNUSDT", category: "crypto", active: true },
  { name: "EPIK/USDT", symbol: "BINANCE:EPIKUSDT", category: "crypto", active: true },
  { name: "HI/USDT", symbol: "BINANCE:HIUSDT", category: "crypto", active: true },
  { name: "BABAPE/USDT", symbol: "BINANCE:BABAPEUSDT", category: "crypto", active: true },
  { name: "SHOG/USDT", symbol: "BINANCE:SHOGUSDT", category: "crypto", active: true },
  { name: "CHEEMS/USDT", symbol: "BINANCE:CHEEMSUSDT", category: "crypto", active: true },
  { name: "RETIK/USDT", symbol: "BINANCE:RETIKUSDT", category: "crypto", active: true },
  { name: "NEIRO/USDT", symbol: "BINANCE:NEIROUSDT", category: "crypto", active: true },
  { name: "BNX/USDT", symbol: "BINANCE:BNXUSDT", category: "crypto", active: true },
  { name: "MERLIN/USDT", symbol: "BINANCE:MERLINUSDT", category: "crypto", active: true },
  { name: "PRCL/USDT", symbol: "BINANCE:PRCLUSDT", category: "crypto", active: true },
  { name: "MAV/USDT", symbol: "BINANCE:MAVUSDT", category: "crypto", active: true },
  { name: "MERL/USDT", symbol: "BINANCE:MERLUSDT", category: "crypto", active: true },
  { name: "MEDI/USDT", symbol: "BINANCE:MEDIUSDT", category: "crypto", active: true },
  { name: "NYAN/USDT", symbol: "BINANCE:NYANUSDT", category: "crypto", active: true },
  { name: "QUNT/USDT", symbol: "BINANCE:QUNTUSDT", category: "crypto", active: true },
  { name: "RATH/USDT", symbol: "BINANCE:RATHUSDT", category: "crypto", active: true },

  { name: "XAU/USD", symbol: "OANDA:XAUUSD", category: "commodity", active: true },
  { name: "XAG/USD", symbol: "OANDA:XAGUSD", category: "commodity", active: false },

  { name: "EUR/USD", symbol: "OANDA:EURUSD", category: "major", active: true },
  { name: "GBP/USD", symbol: "OANDA:GBPUSD", category: "major", active: true },
  { name: "USD/JPY", symbol: "OANDA:USDJPY", category: "major", active: true },
  { name: "AUD/USD", symbol: "OANDA:AUDUSD", category: "major", active: true },
  { name: "USD/CHF", symbol: "OANDA:USDCHF", category: "major", active: true },
  { name: "USD/CAD", symbol: "OANDA:USDCAD", category: "major", active: true },
  { name: "NZD/USD", symbol: "OANDA:NZDUSD", category: "major", active: true },

  { name: "EUR/GBP", symbol: "OANDA:EURGBP", category: "cross", active: false },
  { name: "EUR/JPY", symbol: "OANDA:EURJPY", category: "cross", active: false },
  { name: "GBP/JPY", symbol: "OANDA:GBPJPY", category: "cross", active: false },
  { name: "AUD/JPY", symbol: "OANDA:AUDJPY", category: "cross", active: false },
  { name: "EUR/AUD", symbol: "OANDA:EURAUD", category: "cross", active: false },
  { name: "GBP/AUD", symbol: "OANDA:GBPAUD", category: "cross", active: false },
  { name: "EUR/CAD", symbol: "OANDA:EURCAD", category: "cross", active: false },

  { name: "CAD/JPY", symbol: "OANDA:CADJPY", category: "cross", active: false },
  { name: "CHF/JPY", symbol: "OANDA:CHFJPY", category: "cross", active: false },
  { name: "GBP/CHF", symbol: "OANDA:GBPCHF", category: "cross", active: false },
  { name: "EUR/NZD", symbol: "OANDA:EURNZD", category: "cross", active: false },
  { name: "GBP/NZD", symbol: "OANDA:GBPNZD", category: "cross", active: false },
  { name: "NZD/JPY", symbol: "OANDA:NZDJPY", category: "cross", active: false },
  { name: "AUD/CAD", symbol: "OANDA:AUDCAD", category: "cross", active: false },
  { name: "AUD/NZD", symbol: "OANDA:AUDNZD", category: "cross", active: false },
];

async function main(): Promise<void> {
  const rows: Array<{ name: string; symbol: string; category: string; is_active: boolean }> = [];
  const skipped: Array<{ name: string; symbol: string; reason: string }> = [];

  for (const entry of SEED_DATA) {
    const futuresSymbol = toBinanceSymbol(entry.symbol);

    if (futuresSymbol === null) {
      // Not a BINANCE: symbol (forex/commodity via OANDA:) — no Futures check applies.
      rows.push({
        name: entry.name,
        symbol: entry.symbol,
        category: entry.category,
        is_active: entry.active,
      });
      continue;
    }

    const filters = await getExchangeInfoFilters(futuresSymbol);
    if (filters instanceof Error) {
      skipped.push({ name: entry.name, symbol: entry.symbol, reason: filters.message });
      continue;
    }

    rows.push({
      name: entry.name,
      symbol: entry.symbol,
      category: entry.category,
      is_active: entry.active,
    });
  }

  console.log("=== Seed chart_symbols_volman ===");
  console.log(`${rows.length} symbol(s) sẽ được insert/update.`);
  console.log(`${skipped.length} symbol(s) bị loại vì không pass Binance Futures exchangeInfo:`);
  for (const s of skipped) {
    console.log(`  - ${s.name} (${s.symbol}): ${s.reason}`);
  }

  const { error } = await (getDb().from("chart_symbols_volman") as any).upsert(rows, {
    onConflict: "symbol",
  });

  if (error) {
    console.error(`[FATAL] Upsert thất bại: ${error.message ?? String(error)}`);
    process.exitCode = 1;
    return;
  }

  console.log(`\nHoàn tất. Đã upsert ${rows.length} symbol vào chart_symbols_volman.`);
}

main().catch((error) => {
  console.error(`[FATAL] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
```

- [ ] **Step 2: Manually run the migration against Supabase**

Run: `npx tsx supabase/migrations/20260715000000_create_chart_symbols_volman.sql` — **not applicable**; instead apply the migration through your normal Supabase migration flow (e.g. Supabase CLI `supabase db push`, or paste the SQL into the Supabase SQL editor) before running the seed script, since the table must exist first.

Run: `npx tsx src/scripts/seed-chart-symbols.ts`
Expected: console output listing how many symbols were inserted and which `BINANCE:` symbols were skipped (expect `STARKNET/USDT`, `APTOS/USDT`, `DOGECOIN/USDT`, `HOKKAIDU/USDT`, and any other delisted/typo tickers to appear in the skipped list — confirm this manually against the printed reasons before proceeding).

- [ ] **Step 3: Verify in Supabase**

Open the Supabase Dashboard → Table Editor → `chart_symbols_volman`, and confirm:
- Row count roughly matches `SEED_DATA.length` minus the skipped count (duplicates like `BLUR/USDT` collapse to one row via the `symbol unique` + `upsert` behavior).
- `is_active = false` rows exist for `XAG/USD` and all `cross` category rows.
- None of the known-bad tickers (`STARKNET/USDT`, `APTOS/USDT`, `DOGECOIN/USDT`, `HOKKAIDU/USDT`) are present.

- [ ] **Step 4: Commit**

```bash
git add src/scripts/seed-chart-symbols.ts
git commit -m "chore: add one-off chart_symbols_volman seed script"
```

(Per the design decision, this file may be deleted in a follow-up commit once the seed has run successfully against production — that deletion is a manual cleanup step outside this plan, not a task here.)

---

### Task 9: Standalone `verify-chart-symbols` script

**Files:**
- Create: `src/scripts/verify-chart-symbols.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `loadActiveChartSymbols()` from `../charts/chart-symbols-repository-volman.js` (Task 2), `toBinanceSymbol()` from `../charts/ohlc-provider.js`, `getExchangeInfoFilters()` from `../charts/binance-futures-client.js`, `notifyError()` from `../shared/telegram-client.js`.
- Produces: console output + a Telegram alert on failure. No other module depends on this script.

- [ ] **Step 1: Write the script**

```typescript
import "../shared/env.js";
import { loadActiveChartSymbols } from "../charts/chart-symbols-repository-volman.js";
import { toBinanceSymbol } from "../charts/ohlc-provider.js";
import { getExchangeInfoFilters } from "../charts/binance-futures-client.js";
import { notifyError } from "../shared/telegram-client.js";

async function main(): Promise<void> {
  const symbols = await loadActiveChartSymbols();
  const cryptoSymbols = symbols.filter((s) => toBinanceSymbol(s.symbol) !== null);

  console.log("=== Verify chart symbols (Binance Futures) ===");
  console.log(`Checking ${cryptoSymbols.length} active crypto symbol(s)...`);

  const failures: Array<{ name: string; symbol: string; reason: string }> = [];

  for (const { name, symbol } of cryptoSymbols) {
    const futuresSymbol = toBinanceSymbol(symbol)!;
    const result = await getExchangeInfoFilters(futuresSymbol);
    if (result instanceof Error) {
      failures.push({ name, symbol, reason: result.message });
      console.log(`[FAIL] ${name} (${symbol}): ${result.message}`);
    } else {
      console.log(`[PASS] ${name} (${symbol})`);
    }
  }

  if (failures.length > 0) {
    const summary = failures.map((f) => `- ${f.name} (${f.symbol}): ${f.reason}`).join("\n");
    console.error(
      `\n${failures.length} symbol(s) không còn tradeable trên Binance Futures:\n${summary}`,
    );
    await notifyError(
      "Verify chart symbols",
      `${failures.length} symbol đang is_active=true nhưng không còn tradeable trên Binance Futures:\n${summary}\n\nVào Supabase Dashboard (bảng chart_symbols_volman) để tắt/sửa.`,
    );
    process.exitCode = 1;
    return;
  }

  console.log(`\nTất cả ${cryptoSymbols.length} symbol crypto đều hợp lệ trên Binance Futures.`);
}

main().catch((error) => {
  console.error(`[FATAL] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
```

- [ ] **Step 2: Add the npm script**

In `package.json`, add this line to `"scripts"`, right after `"preflight:fetch"`:

```json
    "verify:chart-symbols": "tsx src/scripts/verify-chart-symbols.ts",
```

- [ ] **Step 3: Manually verify it runs**

Run: `npm run verify:chart-symbols`
Expected (after Task 8's seed has run against the same Supabase project): output ending with `Tất cả N symbol crypto đều hợp lệ trên Binance Futures.` and exit code `0`.

To confirm the failure path works, temporarily flip one row's `symbol` in the Supabase Dashboard to a nonexistent ticker (e.g. `BINANCE:ZZZFAKEUSDT`), re-run the command, confirm it prints a `[FAIL]` line and exits non-zero, then revert the row.

This script has no automated test (same convention as `preflight-fetch.ts` and Task 8's seed script — manually-run operational tooling).

- [ ] **Step 4: Commit**

```bash
git add src/scripts/verify-chart-symbols.ts package.json
git commit -m "feat: add verify:chart-symbols script for post-seed Binance Futures checks"
```

---

## Self-Review Notes

- **Spec coverage:** Mục A→migration is Task 1. Mục B (repository) is Task 2. Mục C (`getCharts`/`getChartsForTimeframeMode`) is Task 3. Mục D (call-site updates) is Task 4. Mục E (seed script with Futures validation) is Task 8. Mục F (verify script) is Task 9. Mục G (chart-render alert) is Task 6, using the diagnostics helper built in Task 5. Mục H (preflight check) is Task 7, reusing the same Task 5 helper.
- **Type consistency:** `loadActiveChartSymbols()` returns `{ name: string; symbol: string }[]` everywhere it's used (Task 2 definition, Task 3's `getCharts()`, Task 8/9's imports). `getCharts()` / `getChartsForTimeframeMode()` signatures match between Task 3 (definition) and Task 4 (call sites). `getPlaywrightDiagnostics(): string` signature matches between Task 5 (definition) and Tasks 6/7 (consumers).
- **No placeholders:** every step has concrete code, exact file paths/line references, and runnable commands with expected output.
