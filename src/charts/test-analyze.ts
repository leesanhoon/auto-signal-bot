import "../shared/env.js";
import { readdir } from "fs/promises";
import { join, extname } from "path";
import type { ChartTimeframe } from "./chart-types-common.js";
import { analyzeAllChartsDeterministic } from "./deterministic-pipeline.js";
import { createLogger } from "../shared/logger.js";

const TEST_DIR = join(process.cwd(), "test-charts");
const logger = createLogger("charts:test-analyze");

function inferTimeframe(fileName: string): ChartTimeframe {
  const upper = fileName.toUpperCase();
  if (upper.includes("D1")) return "D1";
  if (upper.includes("M15")) return "M15";
  return "H4";
}

async function main(): Promise<void> {
  logger.info("Bob Volman test analyzing sample charts");

  const files = (await readdir(TEST_DIR))
    .filter((f) => [".png", ".jpg", ".jpeg"].includes(extname(f).toLowerCase()))
    .sort();

  if (files.length === 0) {
    logger.error("No images found", { testDir: TEST_DIR });
    logger.info("Place sample chart images in test-charts and run again");
    process.exit(1);
  }

  logger.info("Found test charts", { count: files.length });

  const pairs: Array<{ pair: string; symbol: string }> = [];
  for (const file of files) {
    const filepath = join(TEST_DIR, file);
    const name = file.replace(extname(file), "").replace(/[-_]/g, " ");
    const timeframe = inferTimeframe(file);
    pairs.push({ pair: `${name} ${timeframe}`, symbol: name });
    logger.info("Loaded chart fixture", { file, timeframe });
  }

  logger.info("Analyzing fixtures with deterministic pipeline");
  const result = await analyzeAllChartsDeterministic(pairs);

  logger.info("Analysis result start");

  if (result.summaries.length > 0) {
    logger.info("Summary overview");
    for (const s of result.summaries) {
      const icon = s.confidence >= 70 ? "green" : s.confidence >= 40 ? "yellow" : "red";
      logger.info("Summary item", { icon, pair: s.pair, confidence: s.confidence, trend: s.trend, status: s.status });
    }
  }

  if (result.setups.length > 0) {
    logger.info("Setup details");
    for (const setup of result.setups) {
      logger.info("Setup item", {
        pair: setup.pair,
        direction: setup.direction,
        confidence: setup.confidence,
        pattern: setup.setup,
        entry: setup.entry,
        stopLoss: setup.stopLoss,
        takeProfit1: setup.takeProfit1,
        takeProfit2: setup.takeProfit2,
        riskReward: setup.riskReward,
        reasons: setup.reasons,
        risks: setup.risks,
        summary: setup.summary,
      });
    }
  } else {
    logger.info("No setup found above threshold", { threshold: 70, reason: result.noSetupReason || undefined });
  }

  logger.info("Analysis result complete");
}

main().catch((error) => {
  logger.error("Error", { error });
  process.exit(1);
});
