import "../shared/env.js";
import { captureAllCharts } from "./screenshot.js";
import { analyzeAllCharts } from "./analyzer.js";
import { saveOpenPosition, savePendingOrder } from "./positions-repository.js";
import { runCheckOpenTrades } from "./check-open-trades-runner.js";
import { runCheckPendingOrders } from "./check-pending-orders-runner.js";
import { sendAllAnalyses, notifyError } from "../shared/telegram.js";
import { createLogger } from "../shared/logger.js";
import { validateTradeSetupForOpen } from "./position-engine.js";
import { getConfiguredChartSignalConfidenceThreshold } from "./chart-config-env.js";
import type { TradeSetup } from "./chart-types.js";

const logger = createLogger("charts:index");
const AI_VISION_MODEL = process.env.AI_VISION_MODEL?.trim() || "xiaomi/mimo-v2.5";

function shouldAutoTrackAsOpen(setup: TradeSetup, threshold: number): boolean {
  return setup.orderType === "MARKET_NOW" && (setup.confidence ?? 0) >= threshold;
}

async function main(): Promise<void> {
  const startTime = Date.now();
  logger.info("Bob Volman multi-timeframe scanner starting");
  logger.info("Capturing all forex charts", {
    intervals: ["D1", "H4", "M15"],
    indicators: ["EMA 20", "volume"],
  });
  const screenshots = await captureAllCharts();
  if (screenshots.length === 0) throw new Error("No charts captured.");
  logger.info("Captured charts", { count: screenshots.length });

  logger.info("Analyzing charts", { model: AI_VISION_MODEL });
  const result = await analyzeAllCharts(screenshots);
  logger.info("Analysis complete");

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
          logger.info("Saved pending order", {
            pair: setup.pair,
            orderType: setup.orderType,
            primaryTimeframe: setup.primaryTimeframe,
          });
        } else {
          logger.info("Skipped duplicate pending order", {
            pair: setup.pair,
            orderType: setup.orderType,
          });
        }
      } catch (error) {
        logger.error("Failed to save pending order", { pair: setup.pair, error });
      }
    }
  }

  logger.info("Sending results to Telegram");
  await sendAllAnalyses(result);
  logger.info("Checking open positions");
  await runCheckOpenTrades();
  logger.info("Checking pending orders");
  await runCheckPendingOrders();
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  logger.info("Run complete", { scannedPairs: screenshots.length, elapsedSeconds: Number(elapsed) });
}

main().catch(async (error) => {
  logger.error("Fatal error", { error });
  await notifyError("Bob Volman multi-timeframe scanner", error);
  process.exit(1);
});
