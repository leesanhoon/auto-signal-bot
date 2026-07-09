# Task 01: SMC Standalone Entrypoint

**Đọc trước:** [`../plan.md`](../plan.md) — bắt buộc, chứa toàn bộ bảng bằng chứng khảo sát.

## Mục tiêu

Tạo `src/charts/smc-index.ts` — bản sao tinh gọn của `src/charts/index.ts` nhưng **chỉ cho SMC**, không còn nhánh rẽ `tradingSystem === "smc" ? ... : ...` nào, cache/window dùng đúng M15.

## Việc cần làm

### 1. Tạo `src/charts/smc-index.ts`

Cấu trúc dựa theo `src/charts/index.ts` hiện có (đọc file này trước để hiểu luồng gốc), nhưng lược bỏ hoàn toàn nhánh Bob Volman:

```ts
import "../shared/env.js";
import { saveOpenPosition, savePendingOrder } from "./positions-repository.js";
import { runCheckOpenTrades } from "./check-open-trades-runner.js";
import { runCheckPendingOrders } from "./check-pending-orders-runner.js";
import { sendAllAnalyses, sendMessage, notifyError } from "../shared/telegram.js";
import { createLogger } from "../shared/logger.js";
import { validateTradeSetupForOpen } from "./position-engine.js";
import {
  getConfiguredChartPrimaryTimeframe,
  getConfiguredChartRunContext,
  getConfiguredChartSignalConfidenceThreshold,
  getConfiguredChartTimeframeMode,
  shouldSendHeartbeatOnManualRun,
  shouldSendHeartbeatOutsideCloseWindow,
  shouldUseLatestCacheForManualRun,
} from "./chart-config-env.js";
import type { AnalysisResult, TradeSetup } from "./chart-types.js";
import { getLastClosedCandleKey, isWithinTimeframeCandleCloseWindow } from "./chart-cache.js";
import {
  loadChartAnalysisCache,
  loadLatestChartAnalysisCache,
  saveChartAnalysisCache,
} from "./chart-cache-repository.js";
import { analyzeAllChartsSmc } from "./smc/smc-pipeline.js";
import { CHARTS, getChartsForTimeframeMode } from "./charts.config.js";
import { buildChartAnalysisCacheKey } from "./analyzer.js";

const logger = createLogger("charts:smc-index");
const CANDLE_CLOSE_WINDOW_MS = 20 * 60 * 1000;
const SMC_CACHE_LABEL = "smc";

type AnalysisOrigin =
  | { source: "live"; candleKey: string }
  | { source: "cached"; candleKey: string };

function shouldAutoTrackAsOpen(setup: TradeSetup, threshold: number): boolean {
  return setup.orderType === "MARKET_NOW" && (setup.confidence ?? 0) >= threshold;
}

function getPairs(): Array<{ pair: string; symbol: string }> {
  const seen = new Map<string, string>();
  for (const chart of CHARTS) {
    const pair = chart.name.replace(` ${chart.timeframe}`, "");
    if (!seen.has(pair)) seen.set(pair, chart.symbol);
  }
  return Array.from(seen.entries()).map(([pair, symbol]) => ({ pair, symbol }));
}

/**
 * Khớp đúng công thức trong smc-pipeline.ts (hàm analysisTimeframe nội bộ):
 * timeframeMode === "single" ? primaryTimeframe : "M15".
 * Bắt buộc 2 nơi phải luôn khớp nhau — cache key/window ở đây phải phản ánh
 * đúng timeframe mà analyzeAllChartsSmc thực sự dùng để phân tích.
 */
function smcAnalysisTimeframe(
  timeframeMode: ReturnType<typeof getConfiguredChartTimeframeMode>,
  primaryTimeframe: ReturnType<typeof getConfiguredChartPrimaryTimeframe>,
): ReturnType<typeof getConfiguredChartPrimaryTimeframe> {
  return timeframeMode === "single" ? primaryTimeframe : "M15";
}

async function analyzeCurrentWindow(
  candleKey: string,
  timeframeMode: ReturnType<typeof getConfiguredChartTimeframeMode>,
  primaryTimeframe: ReturnType<typeof getConfiguredChartPrimaryTimeframe>,
): Promise<AnalysisResult> {
  const runtimeCharts = getChartsForTimeframeMode(timeframeMode, primaryTimeframe);
  logger.info("Using SMC engine", {
    timeframeMode,
    primaryTimeframe,
    intervals: Array.from(new Set(runtimeCharts.map((chart) => chart.timeframe))),
  });
  const result = await analyzeAllChartsSmc(getPairs(), { timeframeMode, primaryTimeframe });
  await saveChartAnalysisCache(candleKey, result);
  return result;
}

async function loadAnalysisForRun(
  candleBaseKey: string,
  analysisTimeframe: ReturnType<typeof getConfiguredChartPrimaryTimeframe>,
  timeframeMode: ReturnType<typeof getConfiguredChartTimeframeMode>,
  primaryTimeframe: ReturnType<typeof getConfiguredChartPrimaryTimeframe>,
  runContext: ReturnType<typeof getConfiguredChartRunContext>,
): Promise<{
  result: AnalysisResult | null;
  origin: AnalysisOrigin | null;
  heartbeatReason: "no-cache" | "no-event" | null;
}> {
  const cacheKey = buildChartAnalysisCacheKey(candleBaseKey, SMC_CACHE_LABEL, timeframeMode, primaryTimeframe);
  const cached = await loadChartAnalysisCache(cacheKey);
  if (cached) {
    return { result: cached, origin: { source: "cached", candleKey: cacheKey }, heartbeatReason: null };
  }

  const withinCloseWindow = isWithinTimeframeCandleCloseWindow(analysisTimeframe, new Date(), CANDLE_CLOSE_WINDOW_MS);
  if (withinCloseWindow) {
    const liveResult = await analyzeCurrentWindow(cacheKey, timeframeMode, primaryTimeframe);
    return { result: liveResult, origin: { source: "live", candleKey: cacheKey }, heartbeatReason: null };
  }

  if (runContext === "manual" && shouldUseLatestCacheForManualRun()) {
    const latest = await loadLatestChartAnalysisCache(SMC_CACHE_LABEL, timeframeMode, primaryTimeframe);
    if (latest) {
      return { result: latest.result, origin: { source: "cached", candleKey: latest.candleKey }, heartbeatReason: null };
    }
    return { result: null, origin: null, heartbeatReason: shouldSendHeartbeatOnManualRun() ? "no-cache" : null };
  }

  return { result: null, origin: null, heartbeatReason: shouldSendHeartbeatOutsideCloseWindow() ? "no-event" : null };
}

async function handleAnalysisResult(result: AnalysisResult, origin: AnalysisOrigin): Promise<void> {
  const threshold = getConfiguredChartSignalConfidenceThreshold();
  for (const setup of result.setups) {
    if (shouldAutoTrackAsOpen(setup, threshold)) {
      try {
        const validation = validateTradeSetupForOpen(setup);
        if (!validation.accepted) {
          logger.info("Skipped open position due to risk/reward gate", { pair: setup.pair, reason: validation.reason });
          continue;
        }
        const saved = await saveOpenPosition(setup);
        if (saved) {
          setup.autoTracked = true;
          logger.info("Auto-saved open position", { pair: setup.pair });
        } else {
          logger.info("Skipped duplicate open position", { pair: setup.pair });
        }
      } catch (error) {
        logger.error("Failed to auto-save open position", { pair: setup.pair, error });
      }
    } else if ((setup.confidence ?? 0) >= threshold && setup.orderType !== "MARKET_NOW") {
      try {
        const saved = await savePendingOrder(setup);
        if (saved) {
          logger.info("Saved pending order", { pair: setup.pair, orderType: setup.orderType, primaryTimeframe: setup.primaryTimeframe });
        } else {
          logger.info("Skipped duplicate pending order", { pair: setup.pair, orderType: setup.orderType });
        }
      } catch (error) {
        logger.error("Failed to save pending order", { pair: setup.pair, error });
      }
    }
  }

  logger.info("Sending results to Telegram", { source: origin.source, candleKey: origin.candleKey });
  await sendAllAnalyses(result, undefined, { source: origin.source, candleKey: origin.candleKey, systemLabel: "smc" });
}

function buildSmcHeartbeatMessage(
  runContext: ReturnType<typeof getConfiguredChartRunContext>,
  reason: "no-cache" | "no-event",
  candleKey: string,
  latestCacheCandleKey: string | null,
): string {
  const runLabel = runContext === "manual" ? "Manual run" : "Auto run";
  const reasonLine = reason === "no-cache"
    ? "Không có cache phân tích hợp lệ để dùng lại trong lượt chạy ngoài cửa sổ đóng nến."
    : "Không có event trade/pending nào phát sinh trong lượt chạy này.";
  const lines = [
    "🚀 *SMC Multi-Timeframe Scanner heartbeat*",
    `*Run:* ${runLabel}`,
    `*Last closed candle:* ${candleKey}`,
    `*Reason:* ${reason}`,
  ];
  if (latestCacheCandleKey) lines.push(`*Latest cache:* ${latestCacheCandleKey}`);
  lines.push(`_${reasonLine}_`);
  return lines.join("\n");
}

async function maybeSendHeartbeat(
  runContext: ReturnType<typeof getConfiguredChartRunContext>,
  candleKey: string,
  heartbeatReason: "no-cache" | "no-event" | null,
  latestCacheCandleKey?: string | null,
): Promise<void> {
  if (!heartbeatReason) return;
  await sendMessage(buildSmcHeartbeatMessage(runContext, heartbeatReason, candleKey, latestCacheCandleKey ?? null));
}

export async function main(): Promise<void> {
  const startTime = Date.now();
  const runContext = getConfiguredChartRunContext();
  const timeframeMode = getConfiguredChartTimeframeMode();
  const primaryTimeframe = getConfiguredChartPrimaryTimeframe();
  const analysisTimeframe = smcAnalysisTimeframe(timeframeMode, primaryTimeframe);

  logger.info("SMC scanner starting", { runContext, timeframeMode, primaryTimeframe, analysisTimeframe });

  const candleBaseKey = getLastClosedCandleKey(analysisTimeframe);
  const candleKey = buildChartAnalysisCacheKey(candleBaseKey, SMC_CACHE_LABEL, timeframeMode, primaryTimeframe);
  let latestCacheCandleKey: string | null = null;

  const analysisState = await loadAnalysisForRun(candleBaseKey, analysisTimeframe, timeframeMode, primaryTimeframe, runContext);
  const { result, origin, heartbeatReason } = analysisState;
  if (origin?.source === "cached") latestCacheCandleKey = origin.candleKey;

  if (result && origin) {
    await handleAnalysisResult(result, origin);
  } else {
    logger.warn(
      `⏭ Bỏ qua analyze — ngoài cửa sổ chạy cho last closed ${analysisTimeframe} candle (${candleBaseKey}), vẫn kiểm tra trade/pending`,
    );
  }

  logger.info("Checking open positions");
  const openTradeNotifications = await runCheckOpenTrades();
  logger.info("Checking pending orders");
  const pendingNotifications = await runCheckPendingOrders();

  if (!result && openTradeNotifications === 0 && pendingNotifications === 0) {
    await maybeSendHeartbeat(runContext, candleKey, heartbeatReason, latestCacheCandleKey);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  logger.info("Run complete", {
    setupCount: result?.analysisStats?.setupCount ?? result?.setups.length ?? 0,
    elapsedSeconds: Number(elapsed),
    runContext,
    timeframeMode,
    primaryTimeframe,
    analysisTimeframe,
    openTradeNotifications,
    pendingNotifications,
  });
}

if (!process.env.VITEST) {
  main().catch(async (error) => {
    logger.error("Fatal error", { error });
    await notifyError("SMC multi-timeframe scanner", error);
    process.exit(1);
  });
}
```

**Lưu ý khi implement** (không phải copy máy móc — phải kiểm tra thực tế trước khi viết):
- Kiểm tra chữ ký thật của `runCheckPendingOrders()` (file `check-pending-orders-runner.ts`) — xác nhận nó trả về `number` (số lượng notification) giống `runCheckOpenTrades()`, để dùng đúng trong điều kiện `pendingNotifications === 0`. Nếu chữ ký khác, điều chỉnh code cho khớp thực tế, không ép theo mẫu trên.
- Kiểm tra `sendAllAnalyses`'s tham số thứ 3 (`deliveryContext`) có field `systemLabel` hợp lệ nhận `"smc"` hay không (xem cách `index.ts` gốc gọi hàm này) — giữ đúng field đã tồn tại, không tự đặt tên mới.
- Import `buildHeartbeatMessage` từ `telegram.js` **không dùng nữa** trong file mới (thay bằng `buildSmcHeartbeatMessage` viết riêng ở trên) — không import hàm không dùng.

### 2. Sửa `src/shared/telegram.ts` — KHÔNG bắt buộc, chỉ làm nếu vẫn muốn giữ khả năng gọi `buildHeartbeatMessage` cho mục đích khác

Vì đã viết `buildSmcHeartbeatMessage` riêng ở bước 1, **không cần sửa `buildHeartbeatMessage` gốc** — hàm đó vẫn giữ nguyên phục vụ Bob Volman qua `index.ts` như cũ. Bỏ qua bước này trừ khi review sau này yêu cầu hợp nhất lại (không nằm trong scope subtask 01).

## Việc KHÔNG được làm

- Không sửa `src/charts/index.ts` — Bob Volman giữ nguyên 100%.
- Không sửa `check-open-trades-runner.ts`, `check-pending-orders-runner.ts`, `positions-repository.ts`, `position-engine.ts`, `chart-cache.ts`, `chart-cache-repository.ts`, `smc/*`, `analyzer.js`, `charts.config.ts` — chỉ import, không đổi.
- Không thêm biến env mới (`CHART_TRADING_SYSTEM` không cần trong file này vì luôn là SMC).
- Không xoá `buildHeartbeatMessage` gốc trong `telegram.ts` (Bob Volman vẫn cần).

## Acceptance Criteria

- `npm run build` pass, không lỗi type.
- File mới không import `analyzeAllChartsDeterministic`, không import `getConfiguredChartTradingSystem`, không có chuỗi `"bob-volman"` hay so sánh `tradingSystem === ...` nào.
- Đọc lại toàn bộ file, xác nhận `runCheckPendingOrders()` được gọi thật (không comment).

## Kết quả cần ghi vào `result.md`

- Nội dung đầy đủ file `smc-index.ts` đã tạo.
- Xác nhận đã kiểm tra chữ ký thật của `runCheckPendingOrders`/`sendAllAnalyses` và có điều chỉnh gì so với mẫu hay không.
- Output `npm run build`.
- Nếu bị chặn → ghi `blocked.md`.
