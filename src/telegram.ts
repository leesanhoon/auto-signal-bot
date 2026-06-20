import { readFile } from "fs/promises";
import type { AnalysisResult, TradeSetup, PairSummary, ScreenshotResult } from "./types.js";
import { annotateChart } from "./annotate.js";

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
  throw new Error(
    "TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID environment variables are required",
  );
}

async function sendPhoto(photoBuffer: Buffer, caption: string): Promise<void> {
  const formData = new FormData();
  formData.append("chat_id", TELEGRAM_CHAT_ID!);
  formData.append("photo", new Blob([new Uint8Array(photoBuffer)], { type: "image/png" }), "chart.png");
  formData.append("caption", caption.slice(0, 1024));

  const response = await fetch(`${TELEGRAM_API}/sendPhoto`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Telegram sendPhoto failed: ${error}`);
  }
}

async function sendMessage(text: string): Promise<void> {
  const response = await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text,
      parse_mode: "Markdown",
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    if (body.includes("can't parse entities")) {
      const retry = await fetch(`${TELEGRAM_API}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text }),
      });
      if (!retry.ok) {
        const retryErr = await retry.text();
        throw new Error(`Telegram sendMessage failed: ${retryErr}`);
      }
      return;
    }
    throw new Error(`Telegram sendMessage failed: ${body}`);
  }
}

function buildSummaryTable(summaries: PairSummary[]): string {
  const lines: string[] = [
    "📊 *TỔNG QUAN TẤT CẢ CẶP TIỀN*",
    "",
  ];

  for (const s of summaries) {
    const icon = s.confidence >= 70 ? "🟢" : s.confidence >= 40 ? "🟡" : "🔴";
    lines.push(`${icon} *${s.pair}* — ${s.confidence}%`);
    lines.push(`   ${s.trend}`);
    lines.push(`   ${s.status}`);
    lines.push("");
  }

  const tradeCount = summaries.filter((s) => s.confidence >= 70).length;
  if (tradeCount > 0) {
    lines.push(`✅ *${tradeCount}* cặp có setup đạt yêu cầu (≥70%)`);
  } else {
    lines.push("⏸ Không có cặp nào đạt yêu cầu (≥70%)");
  }

  return lines.join("\n");
}

function buildCopyableSetup(setup: TradeSetup): string {
  const arrow = setup.direction === "LONG" ? "🟢" : "🔴";
  const confidence = setup.confidence ?? 0;
  const confBar = confidence >= 80 ? "🟢🟢🟢" : confidence >= 70 ? "🟡🟡" : "🔴";
  return [
    `${arrow} *${setup.pair} — ${setup.direction}* (${confidence}% ${confBar})`,
    `📋 _${setup.setup}_`,
    "",
    "```",
    `Direction : ${setup.direction}`,
    `Entry     : ${setup.entry}`,
    `Stop Loss : ${setup.stopLoss}`,
    `TP1       : ${setup.takeProfit1}`,
    `TP2       : ${setup.takeProfit2}`,
    `R:R       : ${setup.riskReward}`,
    "```",
    "",
    `✅ *Lý do vào lệnh:*`,
    ...setup.reasons.map((r) => `  • ${r}`),
    "",
    `⚠️ *Rủi ro cần lưu ý:*`,
    ...(setup.risks || []).map((r) => `  • ${r}`),
    "",
    `💡 ${setup.summary}`,
  ].join("\n");
}

function findScreenshot(pair: string, screenshots: ScreenshotResult[]): ScreenshotResult | undefined {
  const normalized = pair.replace("/", "").toUpperCase();
  return screenshots.find((s) => s.chart.symbol.toUpperCase().includes(normalized));
}

export async function sendAllAnalyses(result: AnalysisResult): Promise<void> {
  const timestamp = new Date().toLocaleString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
  });

  // No setups — just notify that scan completed
  if (result.setups.length === 0) {
    await sendMessage(
      `🚀 *Bob Volman H4 Scanner*\n📅 ${timestamp}\n📊 Đã quét *${result.summaries.length}* cặp tiền\n\n⏸ Không có setup đạt yêu cầu (≥70%)\n\n_"Không trade cũng là một quyết định đúng." — Bob Volman_`,
    );
    console.log("  → No high-confidence setups. Notification sent.");
    return;
  }

  // Header — only when there are setups
  await sendMessage(
    `🚀 *Bob Volman H4 Scanner*\n📅 ${timestamp}\n📊 Đã quét *${result.summaries.length}* cặp — tìm thấy *${result.setups.length}* setup`,
  );

  // Detailed setups with annotated charts
  for (const setup of result.setups) {
    const screenshot = findScreenshot(setup.pair, result.screenshots);

    if (screenshot) {
      try {
        const originalBuffer = await readFile(screenshot.filepath);
        const annotatedBuffer = await annotateChart(originalBuffer, setup);
        const caption = `📊 ${setup.pair} H4 — ${setup.direction}`;
        await sendPhoto(annotatedBuffer, caption);
        console.log(`  ✓ Sent annotated chart: ${setup.pair}`);
      } catch (error) {
        console.error(`  ✗ Failed to annotate/send chart ${setup.pair}:`, error);
      }
    }

    await sendMessage(buildCopyableSetup(setup));
    console.log(`  ✓ Sent setup: ${setup.pair} ${setup.direction}`);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  await sendMessage(`✅ *Scan hoàn tất* — ${result.setups.length} setup(s)\n\n⚠️ _Đây chỉ là phân tích tham khảo, không phải lời khuyên đầu tư._`);
}
