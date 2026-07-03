import "../shared/env.js";
import { readdir, readFile } from "fs/promises";
import { join, extname } from "path";
import type { ScreenshotResult, ChartConfig, ChartTimeframe } from "./chart-types.js";
import { analyzeAllCharts } from "./analyzer.js";
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

  const screenshots: ScreenshotResult[] = [];
  for (const file of files) {
    const filepath = join(TEST_DIR, file);
    const buffer = await readFile(filepath);
    const name = file.replace(extname(file), "").replace(/[-_]/g, " ");
    const timeframe = inferTimeframe(file);
    const chart: ChartConfig = { name: `${name} ${timeframe}`, symbol: name, interval: timeframe === "D1" ? "D" : timeframe === "M15" ? "15" : "240", description: `Test — ${name} — ${timeframe}`, timeframe };
    screenshots.push({ chart, buffer: Buffer.from(buffer), filepath, lastPrice: null });
    logger.info("Loaded chart fixture", { file, timeframe });
  }

  logger.info("Analyzing fixtures with AI");
  const result = await analyzeAllCharts(screenshots);

  logger.info("Analysis result start");

  if (result.summaries.length > 0) {
    logger.info("Summary overview");
    for (const s of result.summaries) {
      const icon = s.confidence >= 70 ? "🟢" : s.confidence >= 40 ? "🟡" : "🔴";
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
        description: getPatternDescription(setup.setup),
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

function getPatternDescription(setup: string): string {
  const s = setup.toUpperCase();
  if (s.includes("RB") && !s.includes("ARB") && !s.includes("IRB"))
    return "📦 Range Break — Giá phá vỡ vùng tích lũy đi ngang (range). Range rõ ràng với biên trên/dưới, EMA 20 phẳng rồi bắt đầu dốc theo hướng break.";
  if (s.includes("ARB"))
    return "📦🔄 Advanced Range Break — Range lớn với nhiều lần test biên phức tạp, có false break trước khi break thật. EMA 20 chuyển hướng xác nhận.";
  if (s.includes("IRB"))
    return "📦📦 Inside Range Break — Range nhỏ trong range lớn. Breakout từ range nhỏ kéo giá phá luôn range lớn (2 box lồng nhau).";
  if (s.includes("BB"))
    return "🧱 Block Break — Block tích lũy nhỏ, chặt, sát EMA 20 trong trend rõ. Giá xây block rồi break theo hướng trend chính.";
  if (s.includes("FB"))
    return "💥 First Break — Lần breakout đầu tiên từ range/block LỚN. Vùng tích lũy dài, EMA 20 bắt đầu dốc, nến break thân dài.";
  if (s.includes("SB"))
    return "🔄 Second Break — False break lần 1 thất bại → buildup mới → break lần 2 theo hướng thật. Trap traders sai hướng, độ tin cậy cao.";
  if (s.includes("DD"))
    return "🎯 Double Doji — Pullback về EMA 20 trong trend rõ, 2-3 doji liên tiếp tạo squeeze. Break ra khỏi vùng doji theo hướng trend chính.";
  return "";
}

main().catch((error) => {
  logger.error("Error", { error });
  process.exit(1);
});
