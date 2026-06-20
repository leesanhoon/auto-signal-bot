import { GoogleGenAI, ThinkingLevel } from "@google/genai";
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

### Bước 3: Kiểm tra 7 setup của Volman — MÔ TẢ VISUAL CHI TIẾT

**RB (Range Break)** — Nhận diện trên chart:
- Một vùng đi ngang rõ ràng (range) tạo thành hình chữ nhật với biên trên và biên dưới rõ ràng
- Giá dao động trong range này nhiều lần, test biên trên và dưới
- EMA 20 nằm phẳng trong range hoặc bắt đầu dốc về phía breakout
- Điểm entry: nến break thân dài đóng ngoài biên range
- Giá sau khi break range thường di chuyển mạnh theo hướng breakout

**BB (Block Break)** — Nhận diện trên chart:
- Một block (vùng tích lũy dày đặc) nhỏ hơn range, thường là vùng đi ngang chặt sát EMA 20
- Block có thể là hình chữ nhật nhỏ nằm trong trend lớn hơn
- EMA 20 thường bắt đầu dốc, giá xây block sát EMA rồi break
- Điểm entry: khi giá phá vỡ biên block theo hướng trend chính
- Khác RB: block NHỎ hơn và CHẶT hơn, nằm trong context trend rõ

**ARB (Advanced Range Break)** — Nhận diện trên chart:
- Range lớn nhưng có thêm nhiều lần test biên phức tạp
- Có thể có false break nhỏ trước khi break thật
- Giá test biên range nhiều lần, tạo buildup phức tạp gần biên
- Thường xuất hiện trong trend chuyển tiếp — có thể thấy 2 box (range nhỏ trong range lớn)
- EMA 20 bắt đầu chuyển hướng, xác nhận breakout

**FB (First Break)** — Nhận diện trên chart:
- Sau một range/block lớn, giá breakout lần đầu tiên
- Range trước đó phải rõ ràng (vùng tích lũy dài, highlight vàng trên chart)
- EMA 20 bắt đầu dốc theo hướng breakout
- Nến break thân dài, đóng ngoài biên range
- Khác BB: FB break ra từ RANGE LỚN (nhiều nến tích lũy dài), không phải block nhỏ

**SB (Second Break)** — Nhận diện trên chart:
- Giá break lên/xuống qua vùng S/R nhưng thất bại (false break)
- Tạo buildup mới sát vùng S/R, EMA 20 cắt qua vùng buildup
- Rồi break LẦN 2 theo hướng ngược lại (hướng thật)
- Trên chart: thấy 2 đường trendline hội tụ tạo hình tam giác/wedge sát vùng S/R
- Mũi tên ↓ hoặc ↑ đánh dấu entry tại lần break thứ 2
- Lần break thứ 2 có độ tin cậy cao vì đã trap traders sai hướng

**DD (Double Doji / Doji Break)** — Nhận diện trên chart:
- Trong uptrend/downtrend rõ, giá pullback về EMA 20
- Tại vùng EMA 20: xuất hiện 2-3 nến doji liên tiếp (thân rất nhỏ, bấc dài 2 bên)
- Các doji nằm SÁT EMA 20, tạo nên vùng "squeeze" (nén giá)
- Có thể thấy 2 đường trendline hội tụ qua các doji (tam giác nhỏ)
- Entry: khi nến tiếp theo break ra khỏi vùng doji theo hướng trend chính
- EMA 20 phải đang DỐC rõ — doji là dấu hiệu tạm nghỉ, không phải đảo chiều

**IRB (Inside Range Break)** — Nhận diện trên chart:
- Range nhỏ nằm trong range lớn
- Breakout từ range nhỏ kéo giá phá luôn range lớn
- Có thể thấy 2 hình chữ nhật lồng nhau trên chart

### Bước 4: TÌM ÍT NHẤT 3 LÝ DO KHÔNG NÊN VÀO LỆNH
Bước quan trọng nhất — phá vỡ confirmation bias:
- False break risk? Selling/buying pressure ngược?
- Thiếu buildup? Gần S/R ngược chiều?
- EMA 20 phẳng? Nến bấc dài (rejection)?
- Thị trường choppy? Volatility bất thường?
- Range quá hẹp hoặc quá rộng?
- Giá đã di chuyển quá xa từ EMA 20?

### Bước 5: Kết luận cho từng cặp
- TRADE hay NO TRADE
- Mức độ tự tin (%)
- Nếu <70% → NO TRADE

## QUY TẮC VÀNG:
- Khi nghi ngờ, LUÔN chọn NO TRADE
- Capital preservation > catching every move
- Chỉ output setup chi tiết khi tự tin ≥70%
- Setup phải RÕ RÀNG trên chart — nếu phải "ép" để thấy thì KHÔNG PHẢI setup

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
      "summary": "FB setup rõ ràng. Buildup chặt sát EMA 20 dốc lên, false break xác nhận.",
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
    thinking: { type: "enabled", budget_tokens: 8192 },
    messages: [{ role: "user", content }],
  });

  return response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

async function analyzeWithGemini(screenshots: ScreenshotResult[]): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not set");

  const ai = new GoogleGenAI({ apiKey });

  const parts: Array<{ inlineData: { mimeType: string; data: string } } | { text: string }> = [];
  for (const screenshot of screenshots) {
    parts.push({
      inlineData: { mimeType: "image/png", data: screenshot.buffer.toString("base64") },
    });
    parts.push({
      text: `[Chart: ${screenshot.chart.name} — ${screenshot.chart.description}]`,
    });
  }
  parts.push({ text: ANALYSIS_PROMPT });

  const result = await ai.models.generateContent({
    model: "gemini-3.5-flash",
    contents: [{ role: "user", parts }],
    config: { thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM } },
  });

  return result.text ?? "";
}

export async function analyzeAllCharts(
  screenshots: ScreenshotResult[],
): Promise<AnalysisResult> {
  let rawResponse: string;
  let provider: string;

  try {
    console.log("  → Trying Gemini 3.5 Flash...");
    rawResponse = await analyzeWithGemini(screenshots);
    provider = "Gemini 3.5 Flash";
  } catch (geminiError) {
    console.warn(`  ⚠ Gemini failed: ${geminiError instanceof Error ? geminiError.message : geminiError}`);
    const modelName = "Claude Sonnet 4.6";
    console.log(`  → Falling back to ${modelName}...`);
    rawResponse = await analyzeWithClaude(screenshots);
    provider = modelName;
  }

  console.log(`  ✓ Analyzed by ${provider}`);

  const { summaries, setups, noSetupReason } = parseAnalysisResponse(rawResponse);
  console.log(`  ✓ ${summaries.length} pairs scanned, ${setups.length} setup(s) ≥70% confidence`);

  return { summaries, setups, noSetupReason, screenshots };
}
