import { GoogleGenAI } from "@google/genai";
import Anthropic from "@anthropic-ai/sdk";
import type { ScreenshotResult, AnalysisResult, TradeSetup, PairSummary } from "./types.js";

const SYSTEM_PROMPT = `Bạn là price action trader chuyên nghiệp theo Bob Volman ("Understanding Price Action"), phân tích H4 với EMA 20.

## FRAMEWORK PHÂN TÍCH TỪNG CẶP:

### 1. Trend Context
- Uptrend/downtrend/ranging? Giá so với EMA 20 (trên/dưới/cắt)? Độ dốc EMA 20?

### 2. EMA 20 PROXIMITY — YẾU TỐ QUAN TRỌNG NHẤT
Đánh giá khoảng cách giá đến EMA 20:
- **Tại EMA (chạm/cắt)**: Setup có ĐỘ TIN CẬY CAO NHẤT — giá pullback về EMA trong trend = điểm entry lý tưởng
- **Gần EMA (<2% khoảng cách)**: Setup đáng tin cậy — có thể xem xét
- **Xa EMA (>2%)**: GIẢM confidence 15-25% — giá quá xa EMA = rủi ro cao, dễ bị mean reversion
- Nếu giá chạm EMA 20 + có buildup/doji tại EMA → TĂNG confidence 10-15%
- Nếu giá xa EMA 20 mà không có pullback → NO TRADE dù có pattern đẹp

### 3. Vùng S/R
- Giá tiếp cận hay breakout vùng nào? Round number? Vùng tích lũy?

### 4. Kiểm tra 7 setup Volman
**RB**: Range đi ngang rõ → nến break thân dài đóng ngoài biên
**BB**: Block nhỏ chặt sát EMA 20 trong trend → break theo trend
**ARB**: Range lớn + nhiều test biên + false break trước → break thật
**FB**: Breakout lần đầu từ range lớn, EMA dốc theo hướng break
**SB**: False break → buildup mới → break lần 2 hướng thật (trap traders)
**DD**: 2-3 doji sát EMA 20 trong trend rõ → break theo trend
**IRB**: Range nhỏ trong range lớn → break kéo phá luôn range lớn

### 5. Tìm ≥3 lý do KHÔNG vào lệnh
False break risk? Thiếu buildup? EMA phẳng? Nến rejection? Choppy? Giá xa EMA?

### 6. Kết luận: TRADE hay NO TRADE, confidence %
- <70% → NO TRADE. Khi nghi ngờ → NO TRADE
- Setup phải RÕ trên chart, không ép

## QUY TẮC EMA:
- Setup tại EMA 20 (BB, DD, SB) luôn ưu tiên hơn setup xa EMA
- Giá pullback chạm EMA 20 trong trend = cơ hội tốt nhất
- Giá breakout xa EMA mà chưa retest → chờ pullback, không đuổi giá`;

const USER_PROMPT = `Phân tích tất cả chart H4 đính kèm. Trả về CHỈ JSON:

{"summaries":[{"pair":"XAU/USD","trend":"Downtrend — dưới EMA 20","emaProximity":"xa","status":"NO TRADE — xa EMA, thiếu buildup","confidence":35}],"setups":[{"pair":"EUR/USD","direction":"LONG","setup":"DD — Double Doji tại EMA 20","emaTouch":true,"reasons":["2 doji sát EMA 20 dốc lên","Pullback chạm EMA trong uptrend"],"risks":["Resistance 1.0900 gần"],"confidence":78,"entry":"1.0855","stopLoss":"1.0815","takeProfit1":"1.0895","takeProfit2":"1.0940","riskReward":"1:2.1","summary":"DD tại EMA 20, pullback trong uptrend"}],"noSetupReason":""}

QUY TẮC:
- summaries: MỌI cặp (trend + emaProximity [tại/gần/xa] + status + confidence)
- setups: CHỈ confidence ≥70%. emaTouch=true nếu giá tại EMA 20
- Entry/SL/TP = mức giá CỤ THỂ từ chart
- CHỈ JSON, không markdown/text khác`;

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
      source: { type: "base64", media_type: "image/jpeg", data: screenshot.buffer.toString("base64") },
    });
    content.push({
      type: "text",
      text: `[${screenshot.chart.name}]`,
    });
  }
  content.push({ type: "text", text: USER_PROMPT });

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 8192,
    thinking: { type: "enabled", budget_tokens: 4096 },
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
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
  const prompt = SYSTEM_PROMPT + "\n\n" + USER_PROMPT;

  const parts: Array<{ inlineData: { mimeType: string; data: string } } | { text: string }> = [];
  for (const screenshot of screenshots) {
    parts.push({
      inlineData: { mimeType: "image/jpeg", data: screenshot.buffer.toString("base64") },
    });
    parts.push({ text: `[${screenshot.chart.name}]` });
  }
  parts.push({ text: prompt });

  const result = await ai.models.generateContent({
    model: "gemini-3.5-flash",
    contents: [{ role: "user", parts }],
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
    console.log("  → Falling back to Claude Sonnet 4.6...");
    rawResponse = await analyzeWithClaude(screenshots);
    provider = "Claude Sonnet 4.6";
  }

  console.log(`  ✓ Analyzed by ${provider}`);

  const { summaries, setups, noSetupReason } = parseAnalysisResponse(rawResponse);
  console.log(`  ✓ ${summaries.length} pairs scanned, ${setups.length} setup(s) ≥70% confidence`);

  return { summaries, setups, noSetupReason, screenshots };
}
