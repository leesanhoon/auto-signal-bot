import type { AnalysisResult, TradeSetup, PairSummary, ScreenshotResult } from "./types.js";

function getTelegramConfig() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    throw new Error("TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID environment variables are required");
  }
  return { token, chatId, api: `https://api.telegram.org/bot${token}` };
}

async function sendPhoto(photoBuffer: Buffer, caption: string): Promise<void> {
  const { chatId, api } = getTelegramConfig();
  const formData = new FormData();
  formData.append("chat_id", chatId);
  formData.append("photo", new Blob([new Uint8Array(photoBuffer)], { type: "image/png" }), "chart.png");
  formData.append("caption", caption.slice(0, 1024));

  const response = await fetch(`${api}/sendPhoto`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Telegram sendPhoto failed: ${error}`);
  }
}

async function sendMessage(text: string): Promise<void> {
  const { chatId, api } = getTelegramConfig();
  const response = await fetch(`${api}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    if (body.includes("can't parse entities")) {
      const retry = await fetch(`${api}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text }),
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

function getPatternInfo(setup: string): string {
  const s = setup.toUpperCase();
  if (s.includes("RB") && !s.includes("ARB") && !s.includes("IRB"))
    return "📦 _Range Break — Phá vỡ vùng tích lũy đi ngang, EMA 20 phẳng rồi dốc theo hướng break_";
  if (s.includes("ARB"))
    return "📦🔄 _Advanced Range Break — Range lớn, nhiều lần test biên + false break trước khi break thật_";
  if (s.includes("IRB"))
    return "📦📦 _Inside Range Break — Range nhỏ trong range lớn, breakout kéo phá luôn range lớn_";
  if (s.includes("BB"))
    return "🧱 _Block Break — Block nhỏ chặt sát EMA 20, break theo hướng trend chính_";
  if (s.includes("FB"))
    return "💥 _First Break — Breakout lần đầu từ range lớn, nến break thân dài_";
  if (s.includes("SB"))
    return "🔄 _Second Break — False break lần 1 → buildup → break lần 2 hướng thật_";
  if (s.includes("DD"))
    return "🎯 _Double Doji — 2-3 doji sát EMA 20 trong trend rõ, break theo trend_";
  return "";
}

function buildCopyableSetup(setup: TradeSetup): string {
  const arrow = setup.direction === "LONG" ? "🟢" : "🔴";
  const confidence = setup.confidence ?? 0;
  const confBar = confidence >= 80 ? "🟢🟢🟢" : confidence >= 70 ? "🟡🟡" : "🔴";
  const patternInfo = getPatternInfo(setup.setup);
  return [
    `${arrow} *${setup.pair} — ${setup.direction}* (${confidence}% ${confBar})`,
    `📋 *${setup.setup}*`,
    patternInfo,
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

  for (const setup of result.setups) {
    const screenshot = findScreenshot(setup.pair, result.screenshots);

    if (screenshot) {
      try {
        const caption = `📊 ${setup.pair} H4 — ${setup.direction}`;
        await sendPhoto(screenshot.buffer, caption);
        console.log(`  ✓ Sent chart: ${setup.pair}`);
      } catch (error) {
        console.error(`  ✗ Failed to send chart ${setup.pair}:`, error);
      }
    }

    await sendMessage(buildCopyableSetup(setup));
    console.log(`  ✓ Sent setup: ${setup.pair} ${setup.direction}`);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  await sendMessage(`✅ *Scan hoàn tất* — ${result.setups.length} setup(s)\n\n⚠️ _Đây chỉ là phân tích tham khảo, không phải lời khuyên đầu tư._`);
}
