import "../shared/env.js";
import { loadClosedPositions } from "./positions-repository-volman.js";
import { runForexBacktest } from "./forex-backtest.js";
import { createLogger } from "../shared/logger.js";

const logger = createLogger("charts:forex-backtest");

async function main(): Promise<void> {
  logger.info("Forex backtest starting");
  const positions = await loadClosedPositions();
  if (positions.length === 0) {
    logger.info("No closed positions found");
    return;
  }

  const report = runForexBacktest(positions);
  logger.info("Forex backtest complete", {
    trades: report.trades,
    directionAccuracy: report.directionAccuracy,
    entryHitRate: report.entryHitRate,
    averageRealizedRiskReward: report.averageRealizedRiskReward,
  });

  logger.info(
    [
      "Forex backtest",
      `Trades: ${report.trades}`,
      `Direction accuracy: ${report.directionAccuracy}%`,
      `Entry hit rate: ${report.entryHitRate}%`,
      `Average realized R: ${report.averageRealizedRiskReward.toFixed(2)}R`,
    ].join("\n"),
  );
}

main().catch((error) => {
  logger.error("Fatal error", { error });
  process.exit(1);
});
