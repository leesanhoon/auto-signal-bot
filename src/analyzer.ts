import { GoogleGenerativeAI } from "@google/generative-ai";
import Anthropic from "@anthropic-ai/sdk";
import type { ScreenshotResult, AnalysisResult, TradeSetup } from "./types.js";

const ANALYSIS_PROMPT = `Bạn là một price action trader chuyên nghiệp theo phương pháp Bob Volman (sách "Understanding Price Action" và "Forex Price Action Scalps"), áp dụng trên khung H4 với EMA 20.

Tôi gửi bạn tất cả chart H4. Phân tích TỪNG cặp theo đúng framework dưới đây.

## FRAMEWORK PHÂN TÍCH (theo thứ tự bắt buộc):

### Bước 1: Trend Context
- Uptrend, downtrend, hay ranging?
- Giá nằm ở đâu so với EMA 20? (trên/dưới/đang cắt)
- Độ dốc EMA 20 cho thấy momentum gì?

### Bước 2: Xác định vùng S/R quan trọng
- Giá đang tiếp cận hay đã breakout vùng nào?
- Round number gần nhất?
- Có vùng tích lũy (block) rõ ràng không?

### Bước 3: Kiểm tra 6 setup của Volman
Với MỖI setup, nêu rõ tiêu chí nào ĐẠT và tiêu chí nào CHƯA ĐẠT:
- **FB (First Break)**: Break đầu tiên sau buildup sát EMA 20. Cần: buildup chặt + EMA đúng hướng + nến break có thân dài
- **SB (Second Break)**: Break thứ hai sau false break nhỏ từ FB. Cần: FB thất bại nhẹ + buildup lại + break lần 2 quyết định hơn
- **BB (Block Break)**: Phá vỡ block (vùng đi ngang dày đặc). Cần: block rõ ràng ≥3 nến + buildup sát biên + break dứt khoát
- **RB (Range Break)**: Phá vỡ range. Cần: range rõ ràng + buildup ở biên + nến break đóng ngoài range
- **IRB (Inside Range Break)**: Break từ range nhỏ trong range lớn. Cần: range lồng nhau rõ ràng + squeeze
- **ARB (Advanced Range Break)**: Break phức tạp nhiều lần test biên. Cần: multiple tests + false breaks + buildup cuối cùng

### Bước 4: TÌM ÍT NHẤT 3 LÝ DO KHÔNG NÊN VÀO LỆNH
Đây là bước quan trọng nhất — phá vỡ confirmation bias:
- False break risk: giá có thể đang tạo false break?
- Selling/buying pressure ngược: có áp lực ngược chiều rõ ràng?
- Thiếu buildup: nến trước break có quá lớn/hỗn loạn?
- Gần S/R ngược chiều: TP có bị chặn bởi S/R gần?
- EMA 20 phẳng: không có momentum rõ ràng?
- Nến bấc dài: dấu hiệu rejection/exhaustion?
- Thị trường choppy: nến lên xuống không có cấu trúc?
- Spread/volatility bất thường?

### Bước 5: Kết luận
- TRADE hay NO TRADE
- Mức độ tự tin (%)
- Nếu <70% tự tin → NO TRADE
- Nếu TRADE: nêu điều kiện xác nhận thêm nếu có

## QUY TẮC VÀNG:
- Khi nghi ngờ, LUÔN chọn NO TRADE
- Capital preservation quan trọng hơn catching every move
- Burden of proof nằm ở phía TRADE, không phải NO TRADE
- Chỉ output setup khi tự tin ≥70%

## YÊU CẦU OUTPUT — CHỈ JSON, không text khác:

{
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
      "confidence": 75,
      "entry": "1.0855",
      "stopLoss": "1.0815",
      "takeProfit1": "1.0895",
      "takeProfit2": "1.0940",
      "riskReward": "1:2.1",
      "summary": "FB setup rõ ràng. Buildup chặt sát EMA 20 dốc lên, false break xác nhận. Rủi ro: resistance 1.0900 gần."
    }
  ],
  "noSetupReason": ""
}

Nếu KHÔNG có cặp nào đạt ≥70% tự tin:
{
  "setups": [],
  "noSetupReason": "Không có setup đạt tiêu chuẩn. EUR/USD thiếu buildup, GBP/USD choppy, XAU/USD EMA phẳng không có momentum. Chờ đợi."
}

QUAN TRỌNG:
- Mỗi setup PHẢI có trường "risks" (ít nhất 3 lý do không nên vào)
- Mỗi setup PHẢI có trường "confidence" (% tự tin, chỉ output nếu ≥70%)
- CHỈ trả về JSON hợp lệ, không markdown, không text khác
- Entry, SL, TP phải là mức giá CỤ THỂ đọc từ chart`;

function parseAnalysisResponse(text: string): { setups: TradeSetup[]; noSetupReason: string } {
  const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  try {
    const parsed = JSON.parse(cleaned);
    const setups = (parsed.setups || []).filter((s: TradeSetup) => (s.confidence ?? 0) >= 70);
    return {
      setups,
      noSetupReason: parsed.noSetupReason || "",
    };
  } catch {
    return { setups: [], noSetupReason: "Lỗi parse AI response. Raw: " + text.slice(0, 300) };
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
    max_tokens: 8192,
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
    console.log("  → Using Gemini 2.5 Pro...");
    rawResponse = await analyzeWithGemini(screenshots);
    provider = "Gemini 2.5 Pro";
  } catch (geminiError) {
    console.warn(`  ⚠ Gemini failed: ${geminiError instanceof Error ? geminiError.message : geminiError}`);
    console.log("  → Falling back to Claude Sonnet 4.6...");
    rawResponse = await analyzeWithClaude(screenshots);
    provider = "Claude Sonnet 4.6";
  }

  console.log(`  ✓ Analyzed by ${provider}`);

  const { setups, noSetupReason } = parseAnalysisResponse(rawResponse);
  console.log(`  ✓ Found ${setups.length} setup(s) with confidence ≥70%`);

  return { setups, noSetupReason, screenshots };
}
