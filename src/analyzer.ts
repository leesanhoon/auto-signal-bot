import { GoogleGenerativeAI } from "@google/generative-ai";
import Anthropic from "@anthropic-ai/sdk";
import type { ScreenshotResult, AnalysisResult, TradeSetup, PairSummary } from "./types.js";

const ANALYSIS_PROMPT = `Bạn là một price action trader chuyên nghiệp theo phương pháp Bob Volman (sách "Understanding Price Action" và "Forex Price Action Scalps"), áp dụng trên khung H4 với EMA 20.

Tôi gửi bạn tất cả chart H4. Phân tích TỪNG cặp theo framework dưới đây.

## FRAMEWORK PHÂN TÍCH (áp dụng cho TỪNG cặp):

### Bước 1: Trend Context
- Uptrend, downtrend, hay ranging?
- Giá nằm ở đâu so với EMA 20? (trên/dưới/đang cắt)
- Độ dốc EMA 20 cho thấy momentum gì?

### Bước 2: Xác định vùng S/R quan trọng
- Giá đang tiếp cận hay đã breakout vùng nào?
- Round number gần nhất?
- Có vùng tích lũy (block) rõ ràng không?

### Bước 3: Kiểm tra 6 setup của Volman
Với MỖI setup khả thi, nêu rõ tiêu chí nào ĐẠT và tiêu chí nào CHƯA ĐẠT:
- **FB (First Break)**: Break đầu tiên sau buildup sát EMA 20
- **SB (Second Break)**: Break thứ hai sau false break nhỏ từ FB
- **BB (Block Break)**: Phá vỡ block (vùng đi ngang dày đặc)
- **RB (Range Break)**: Phá vỡ range rõ ràng
- **IRB (Inside Range Break)**: Break từ range nhỏ trong range lớn
- **ARB (Advanced Range Break)**: Break phức tạp nhiều lần test biên

### Bước 4: TÌM ÍT NHẤT 3 LÝ DO KHÔNG NÊN VÀO LỆNH
Bước quan trọng nhất — phá vỡ confirmation bias:
- False break risk? Selling/buying pressure ngược?
- Thiếu buildup? Gần S/R ngược chiều?
- EMA 20 phẳng? Nến bấc dài (rejection)?
- Thị trường choppy? Volatility bất thường?

### Bước 5: Kết luận cho từng cặp
- TRADE hay NO TRADE
- Mức độ tự tin (%)
- Nếu <70% → NO TRADE

## QUY TẮC VÀNG:
- Khi nghi ngờ, LUÔN chọn NO TRADE
- Capital preservation > catching every move
- Chỉ output setup chi tiết khi tự tin ≥70%

## YÊU CẦU OUTPUT — CHỈ JSON, không text khác:

{
  "summaries": [
    { "pair": "XAU/USD", "trend": "Downtrend — dưới EMA 20 dốc xuống", "status": "NO TRADE — choppy, thiếu buildup", "confidence": 35 },
    { "pair": "EUR/USD", "trend": "Uptrend — trên EMA 20 dốc lên", "status": "TRADE — FB setup rõ ràng", "confidence": 78 },
    { "pair": "GBP/USD", "trend": "Ranging — EMA 20 phẳng", "status": "NO TRADE — không có momentum", "confidence": 20 }
  ],
  "setups": [
    {
      "pair": "EUR/USD",
      "direction": "LONG",
      "setup": "FB — First Break tại EMA 20",
      "reasons": [
        "Buildup 5 nến nhỏ sát EMA 20 dốc lên",
        "Nến break thân dài đóng trên resistance 1.0850",
        "False break xuống EMA trước đó bị reject mạnh"
      ],
      "risks": [
        "Resistance 1.0900 ở gần — có thể giới hạn upside",
        "Volume giảm dần trong buildup",
        "Round number 1.0900 có thể tạo selling pressure"
      ],
      "confidence": 78,
      "entry": "1.0855",
      "stopLoss": "1.0815",
      "takeProfit1": "1.0895",
      "takeProfit2": "1.0940",
      "riskReward": "1:2.1",
      "summary": "FB setup rõ ràng. Buildup chặt sát EMA 20 dốc lên, false break xác nhận."
    }
  ],
  "noSetupReason": ""
}

QUY TẮC OUTPUT:
- "summaries": MỌI cặp tiền đều phải có summary (trend + status + confidence)
- "setups": CHỈ những cặp có confidence ≥70%
- Nếu không cặp nào ≥70%: "setups" = [], "noSetupReason" = lý do ngắn gọn
- Entry, SL, TP phải là mức giá CỤ THỂ đọc từ chart
- CHỈ trả về JSON hợp lệ, không markdown, không text khác`;

function parseAnalysisResponse(text: string): { summaries: PairSummary[]; setups: TradeSetup[]; noSetupReason: string } {
  const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  try {
    const parsed = JSON.parse(cleaned);
    const setups = (parsed.setups || []).filter((s: TradeSetup) => (s.confidence ?? 0) >= 70);
    return {
      summaries: parsed.summaries || [],
      setups,
      noSetupReason: parsed.noSetupReason || "",
    };
  } catch {
    return { summaries: [], setups: [], noSetupReason: "Lỗi parse AI response. Raw: " + text.slice(0, 300) };
  }
}

async function analyzeWithGemini(screenshots: ScreenshotResult[]): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not set");

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-pro" });

  const parts: Array<{ inlineData: { mimeType: "image/png"; data: string } } | { text: string }> = [];
  for (const screenshot of screenshots) {
    parts.push({
      inlineData: { mimeType: "image/png", data: screenshot.buffer.toString("base64") },
    });
    parts.push({
      text: `[Chart: ${screenshot.chart.name} — ${screenshot.chart.description}]`,
    });
  }
  parts.push({ text: ANALYSIS_PROMPT });

  const result = await model.generateContent(parts);
  return result.response.text();
}

async function analyzeWithClaude(screenshots: ScreenshotResult[]): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  const client = new Anthropic({ apiKey });

  const content: Anthropic.MessageCreateParams["messages"][0]["content"] = [];
  for (const screenshot of screenshots) {
    content.push({
      type: "image",
      source: { type: "base64", media_type: "image/png", data: screenshot.buffer.toString("base64") },
    });
    content.push({
      type: "text",
      text: `[Chart: ${screenshot.chart.name} — ${screenshot.chart.description}]`,
    });
  }
  content.push({ type: "text", text: ANALYSIS_PROMPT });

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 16384,
    messages: [{ role: "user", content }],
  });

  return response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

export async function analyzeAllCharts(
  screenshots: ScreenshotResult[],
): Promise<AnalysisResult> {
  let rawResponse: string;
  let provider: string;

  try {
    console.log("  → Trying Gemini 2.5 Pro...");
    rawResponse = await analyzeWithGemini(screenshots);
    provider = "Gemini 2.5 Pro";
  } catch (geminiError) {
    console.warn(`  ⚠ Gemini failed: ${geminiError instanceof Error ? geminiError.message : geminiError}`);
    console.log("  → Falling back to Claude Sonnet 4.6...");
    rawResponse = await analyzeWithClaude(screenshots);
    provider = "Claude Sonnet 4.6";
  }

  console.log(`  ✓ Analyzed by ${provider}`);

  const { summaries, setups, noSetupReason } = parseAnalysisResponse(rawResponse);
  console.log(`  ✓ ${summaries.length} pairs scanned, ${setups.length} setup(s) ≥70% confidence`);

  return { summaries, setups, noSetupReason, screenshots };
}
