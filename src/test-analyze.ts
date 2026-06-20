import "./env.js";
import { readdir, readFile } from "fs/promises";
import { join, extname } from "path";
import type { ScreenshotResult, ChartConfig } from "./types.js";
import { analyzeAllCharts } from "./analyzer.js";

const TEST_DIR = join(process.cwd(), "test-charts");

async function main(): Promise<void> {
  console.log("🧪 Bob Volman Test — Analyzing sample charts...\n");

  const files = (await readdir(TEST_DIR))
    .filter((f) => [".png", ".jpg", ".jpeg"].includes(extname(f).toLowerCase()))
    .sort();

  if (files.length === 0) {
    console.error(`No images found in ${TEST_DIR}`);
    console.log("Đặt các file ảnh chart mẫu (.png/.jpg) vào folder test-charts/ rồi chạy lại.");
    process.exit(1);
  }

  console.log(`📸 Found ${files.length} test chart(s):\n`);

  const screenshots: ScreenshotResult[] = [];
  for (const file of files) {
    const filepath = join(TEST_DIR, file);
    const buffer = await readFile(filepath);
    const name = file.replace(extname(file), "").replace(/[-_]/g, " ");
    const chart: ChartConfig = { name, symbol: name, interval: "240", description: `Test — ${name}` };
    screenshots.push({ chart, buffer: Buffer.from(buffer), filepath });
    console.log(`  📄 ${file}`);
  }

  console.log("\n🤖 Analyzing with AI...\n");
  const result = await analyzeAllCharts(screenshots);

  console.log("\n" + "=".repeat(60));
  console.log("📊 KẾT QUẢ PHÂN TÍCH");
  console.log("=".repeat(60));

  if (result.summaries.length > 0) {
    console.log("\n--- TỔNG QUAN ---");
    for (const s of result.summaries) {
      const icon = s.confidence >= 70 ? "🟢" : s.confidence >= 40 ? "🟡" : "🔴";
      console.log(`${icon} ${s.pair} (${s.confidence}%) — ${s.trend}`);
      console.log(`   ${s.status}\n`);
    }
  }

  if (result.setups.length > 0) {
    console.log("--- SETUP CHI TIẾT ---");
    for (const setup of result.setups) {
      console.log(`\n${"─".repeat(50)}`);
      console.log(`🎯 ${setup.pair} — ${setup.direction} (${setup.confidence}%)`);
      console.log(`📋 Pattern: ${setup.setup}`);
      console.log(`   ${getPatternDescription(setup.setup)}`);
      console.log(`\n   Entry     : ${setup.entry}`);
      console.log(`   Stop Loss : ${setup.stopLoss}`);
      console.log(`   TP1       : ${setup.takeProfit1}`);
      console.log(`   TP2       : ${setup.takeProfit2}`);
      console.log(`   R:R       : ${setup.riskReward}`);
      console.log(`\n   ✅ Lý do:`);
      for (const r of setup.reasons) console.log(`      • ${r}`);
      console.log(`   ⚠️  Rủi ro:`);
      for (const r of setup.risks || []) console.log(`      • ${r}`);
      console.log(`\n   💡 ${setup.summary}`);
    }
  } else {
    console.log(`\n⏸ Không tìm thấy setup ≥70%`);
    if (result.noSetupReason) console.log(`   Lý do: ${result.noSetupReason}`);
  }

  console.log("\n" + "=".repeat(60));
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
  console.error("Error:", error);
  process.exit(1);
});
