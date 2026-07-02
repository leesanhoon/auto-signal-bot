# Task: Thêm lại bước verify bằng Llama 3.3 70B Instruct qua OpenRouter

## Context

Code đã chuyển toàn bộ AI sang OpenRouter với 2 model:
- `AI_VISION_MODEL` (xiaomi/mimo-v2.5) — phân tích chart (ảnh)
- `AI_TEXT_MODEL` (deepseek/deepseek-v4-flash) — phân tích kèo bóng đá (text)

Bước verify trước đây dùng Gemini 2.5 Pro / Claude Sonnet 4.6 đã bị xoá. Giờ cần thêm lại bước verify cho cả chart lẫn betting bằng model thứ 3 qua OpenRouter: **Llama 3.3 70B Instruct** (`meta-llama/llama-3.3-70b-instruct`).

Env var mới: `AI_VERIFY_MODEL=meta-llama/llama-3.3-70b-instruct`

Client OpenRouter (`src/shared/openrouter.ts`) và hàm `callOpenRouter` đã sẵn sàng — chỉ cần gọi với model khác.

## Tham khảo: logic verify cũ đã bị xoá

Trước khi bị xoá, luồng verify hoạt động như sau (cần khôi phục logic tương đương):

### Chart verify (cũ ở `src/charts/analyzer.ts`)
1. `analyzeAllCharts()` trả về danh sách `setups` đã lọc theo confidence threshold.
2. `confirmHighConfidenceSetups(setups, screenshots)` loop từng setup:
   - Tìm screenshot H4 tương ứng (`findChartForPair(pair, "H4")`).
   - Chụp ảnh verify (`captureVerificationChartScreenshot(chart)`).
   - Gọi model verify với ảnh + prompt mô tả setup → trả JSON `{ confirmed, confidence, comment }`.
   - Gắn `verifiedConfirmed`, `verifiedConfidence`, `verifiedComment`, `verifiedBy` vào setup.
3. `src/charts/index.ts` gọi `confirmHighConfidenceSetups` sau `analyzeAllCharts`, chỉ auto-save position khi `setup.verifiedConfirmed === true`.

### Betting verify (cũ ở `src/betting/betting-gemini.ts`)
1. `analyzeMatchOdds(payload)` trả `MatchAiAnalysis`.
2. `verifyMatchAnalysis(payload, analysis)` gọi model verify (text-only) với odds snapshot + phân tích → trả `{ confirmed, confidence, comment }`.
3. Nếu `confirmed`: gắn `verifiedConfirmed=true`, `verifiedConfidence`, `verifiedComment` vào analysis.
4. Nếu `!confirmed`: gọi `reviseMatchAnalysis(payload, original, rejectionComment)` để tạo phân tích thay thế bảo thủ hơn, gắn `revisedAfterReject=true`.
5. `src/betting/odds-runner.ts` orchestrate luồng trên cho mỗi trận.

---

## 1. Thêm env var

`.env.example` — thêm dòng sau `AI_TEXT_MODEL`:
```
AI_VERIFY_MODEL=meta-llama/llama-3.3-70b-instruct
```

## 2. `src/shared/ai-usage.ts`

Thêm rate entry vào `DEFAULT_RATES.openrouter`:
```ts
"meta-llama/llama-3.3-70b-instruct": { inputPerMillionUsd: 0.12, outputPerMillionUsd: 0.34 },
```

## 3. `src/charts/analyzer.ts` — thêm lại verify

### Thêm const
```ts
const VERIFY_MODEL = process.env.AI_VERIFY_MODEL?.trim() || "meta-llama/llama-3.3-70b-instruct";
```

### Thêm lại các hàm (dùng `callOpenRouter` thay vì Gemini/Claude)

**`buildVerificationPrompt(setup: TradeSetup): string`** — giữ nguyên nội dung prompt cũ:
```ts
export function buildVerificationPrompt(setup: TradeSetup): string {
  return `Check this H4 EMA20 setup against the attached chart.

Setup:
- Pair: ${setup.pair}
- Direction: ${setup.direction}
- Pattern: ${setup.setup}
- Entry: ${setup.entry}
- Stop loss: ${setup.stopLoss}
- Take profit 1: ${setup.takeProfit1}
- Take profit 2: ${setup.takeProfit2}
- Proposed confidence: ${setup.confidence}%
- Reasons: ${setup.reasons.slice(0, 3).join(" | ")}

Return only JSON with keys confirmed, confidence, comment.
Keep comment short and specific.`;
}
```

**`parseVerificationResponse(text: string)`** — parse JSON `{ confirmed, confidence, comment }`:
```ts
function parseVerificationResponse(text: string): { confirmed: boolean; confidence: number; comment: string } | null {
  const cleaned = extractJsonObject(text);
  try {
    const parsed = JSON.parse(cleaned) as { confirmed?: unknown; confidence?: unknown; comment?: unknown };
    return {
      confirmed: Boolean(parsed.confirmed),
      confidence: clampConfidence(parsed.confidence),
      comment: String(parsed.comment || ""),
    };
  } catch {
    return null;
  }
}
```

**`verifySetup(setup, imageBuffer): Promise<{ confirmed, confidence, comment, verifiedBy }>`**:
- Gọi `callOpenRouter` với `model: VERIFY_MODEL`, ảnh chart H4, prompt từ `buildVerificationPrompt`.
- Lưu ý: Llama 3.3 70B là text model, **không hỗ trợ vision**. Nên bước verify chart chỉ gửi **text mô tả setup** (prompt), không gửi ảnh. Bỏ phần `image_url` trong `userContent`.
- Parse response, gọi `recordOpenRouterUsage`.
- Trả `{ ...parsed, verifiedBy: VERIFY_MODEL }`.

**`confirmHighConfidenceSetups(setups, screenshots): Promise<TradeSetup[]>`**:
- Loop từng setup, gọi `verifySetup`, gắn `verifiedConfirmed/verifiedConfidence/verifiedComment/verifiedBy` vào setup.
- Wrap trong try/catch — nếu verify fail, giữ setup nguyên (không gắn verified fields).
- Export hàm này.

### Thêm import
```ts
import { findChartForPair } from "./screenshot.js";
```
(Không cần `captureVerificationChartScreenshot` vì Llama không nhận ảnh.)

## 4. `src/charts/index.ts` — gọi verify sau analysis

### Thêm import
```ts
import { analyzeAllCharts, confirmHighConfidenceSetups } from "./analyzer.js";
```

### Thêm logic verify (sau `analyzeAllCharts`, trước auto-save)

```ts
const threshold = getConfiguredChartSignalConfidenceThreshold();
const highConfSetups = result.setups.filter((s) => (s.confidence ?? 0) > threshold);
if (highConfSetups.length > 0) {
  logger.info("Verifying high-confidence setups", { count: highConfSetups.length, model: AI_VERIFY_MODEL });
  const verified = await confirmHighConfidenceSetups(highConfSetups, screenshots);
  const verifiedByPair = new Map(verified.map((s) => [s.pair, s]));
  result.setups = result.setups.map((s) => verifiedByPair.get(s.pair) ?? s);
  logger.info("Verification complete");
}
```

### Đổi điều kiện auto-save

Từ:
```ts
if ((setup.confidence ?? 0) >= threshold) {
```

Thành:
```ts
if (setup.verifiedConfirmed === true) {
```

### Thêm const
```ts
const AI_VERIFY_MODEL = process.env.AI_VERIFY_MODEL?.trim() || "meta-llama/llama-3.3-70b-instruct";
```

## 5. `src/betting/betting-gemini.ts` — thêm lại verify + revise

### Thêm const
```ts
const VERIFY_MODEL = process.env.AI_VERIFY_MODEL?.trim() || "meta-llama/llama-3.3-70b-instruct";
```

### Thêm lại prompts

**`VERIFY_PROMPT`** — giữ nguyên nội dung cũ (tiếng Việt không dấu):
```ts
const VERIFY_PROMPT = `Ban la nguoi tham dinh doc lap cho mot phan tich odds bong da.

Nhiem vu:
- Danh gia xem phan tich ben duoi co hop ly va nhat quan voi snapshot odds hay khong.
- Chi dua tren odds snapshot va ket luan duoc cung cap.
- Khong dung kien thuc ben ngoai.
- Tra ve duy nhat JSON hop le voi keys:
  - confirmed: boolean
  - confidence: number
  - comment: string

Quy tac:
- confirmed = true neu ket luan co luan ly, nhat quan, va khong mau thuan lon voi odds.
- confirmed = false neu ket luan yeu, mau thuan, hoac khong co edge ro rang.
- confidence la do chac chan cua viec tham dinh, tu 0-100.
- comment ngan gon, noi ro vi sao dong y hoac bac bo.
- Khong duoc them markdown, giai thich thua, hay key ngoai danh sach.`;
```

**`REVISE_PROMPT`** — giữ nguyên nội dung cũ.

### Thêm lại hàm

**`parseVerificationResponse(text)`** — parse `{ confirmed, confidence, comment }` (giống chart verify).

**`verifyMatchAnalysis(payload, analysis)`**:
- Gọi `callOpenRouter` với `model: VERIFY_MODEL`, text-only (odds snapshot + phân tích cần thẩm định).
- Parse response, gọi `recordOpenRouterUsage`.
- Trả `{ confirmed, confidence, comment }`.

**`reviseMatchAnalysis(payload, original, rejectionComment)`**:
- Gọi `callOpenRouter` với `model: VERIFY_MODEL` (hoặc `MODEL` — dùng model text chính), text-only.
- Parse response thành `MatchAiAnalysis`.
- Nếu parse fail, trả `buildFallbackRevisedAnalysis(payload, original, rejectionComment)`.

**`buildFallbackRevisedAnalysis(payload, original, rejectionComment)`** — giữ nguyên logic cũ (tạo analysis bảo thủ với confidence thấp).

### Export
```ts
export { verifyMatchAnalysis, reviseMatchAnalysis };
```

## 6. `src/betting/odds-runner.ts` — orchestrate verify/revise

### Thêm import
```ts
import { analyzeMatchOdds, verifyMatchAnalysis, reviseMatchAnalysis } from "./betting-gemini.js";
```

### Đổi luồng xử lý mỗi trận (trong vòng lặp `for (const match of payload)`)

Từ:
```ts
const analysis = await analyzeMatchOdds(match);
await saveBettingAnalysisSnapshot({
  ...fields,
  verifiedConfirmed: null,
  verifiedConfidence: null,
  verifiedComment: null,
  revisedAfterReject: false,
});
```

Thành:
```ts
let analysis = await analyzeMatchOdds(match);
const verification = await verifyMatchAnalysis(match, analysis);

if (verification.confirmed) {
  analysis.verifiedConfirmed = true;
  analysis.verifiedConfidence = verification.confidence;
  analysis.verifiedComment = verification.comment;
  logger.info(`  ✓ Verify ${match.home} vs ${match.away}: confirmed (${verification.confidence}%)`);
} else {
  logger.info(`  ✗ Verify ${match.home} vs ${match.away}: rejected (${verification.confidence}%) - ${verification.comment}`);
  analysis = await reviseMatchAnalysis(match, analysis, verification.comment);
  analysis.verifiedConfirmed = false;
  analysis.verifiedConfidence = verification.confidence;
  analysis.verifiedComment = `Nhan dinh da duoc dieu chinh sau khi bi tu choi: ${verification.comment}`;
  analysis.revisedAfterReject = true;
  logger.info(`  ↻ Revised ${match.home} vs ${match.away} thanh nhan dinh moi`);
}

await saveBettingAnalysisSnapshot({
  ...fields,
  analysis,
  verifiedConfirmed: analysis.verifiedConfirmed ?? null,
  verifiedConfidence: analysis.verifiedConfidence ?? null,
  verifiedComment: analysis.verifiedComment ?? null,
  revisedAfterReject: analysis.revisedAfterReject ?? false,
});
```

## 7. GitHub Actions workflows

**`.github/workflows/analyze.yml`** — thêm env:
```yaml
AI_VERIFY_MODEL: ${{ vars.AI_VERIFY_MODEL }}
```

**`.github/workflows/match-odds.yml`** — thêm env:
```yaml
AI_VERIFY_MODEL: ${{ vars.AI_VERIFY_MODEL }}
```

## 8. Tests

### `tests/charts/analyzer.test.ts`
- Thêm lại test cho `confirmHighConfidenceSetups`:
  - Mock `callOpenRouter` trả `{ text: '{"confirmed":true,"confidence":91,"comment":"aligned"}', usage: { promptTokens: 0, completionTokens: 0 } }`.
  - Assert setup được gắn `verifiedConfirmed: true`, `verifiedConfidence: 91`, `verifiedBy: "meta-llama/llama-3.3-70b-instruct"`.

### `tests/charts/position-decision.test.ts`
- Không thay đổi (position decision không có verify).

### Betting tests
- Thêm test cho `verifyMatchAnalysis` nếu muốn (optional).

## Tóm tắt file cần sửa

| File | Hành động |
|------|-----------|
| `.env.example` | Thêm `AI_VERIFY_MODEL` |
| `src/shared/ai-usage.ts` | Thêm rate cho llama model |
| `src/charts/analyzer.ts` | Thêm verify functions + export |
| `src/charts/index.ts` | Gọi verify, đổi điều kiện auto-save |
| `src/betting/betting-gemini.ts` | Thêm verify/revise functions + export |
| `src/betting/odds-runner.ts` | Orchestrate verify/revise flow |
| `.github/workflows/analyze.yml` | Thêm `AI_VERIFY_MODEL` env |
| `.github/workflows/match-odds.yml` | Thêm `AI_VERIFY_MODEL` env |
| `tests/charts/analyzer.test.ts` | Thêm test verify |

## Lưu ý quan trọng

- **Llama 3.3 70B Instruct là text-only model** — không hỗ trợ vision/image input. Bước verify chart chỉ gửi text mô tả setup (pair, direction, entry, SL, TP, reasons), **không gửi ảnh chart**. Khác với verify cũ (Gemini 2.5 Pro nhận ảnh).
- Giữ nguyên logic nghiệp vụ từ code cũ, chỉ đổi provider (OpenRouter) và model (Llama).
- Tất cả gọi AI đều qua `callOpenRouter` từ `src/shared/openrouter.ts` (đã có sẵn).
- Tất cả tracking đều qua `recordOpenRouterUsage` (đã có sẵn).

## Verification
1. `npm run build` — không lỗi type.
2. `npm test` — tất cả tests pass.
3. Chạy thử chart analysis: log phải hiện "Verifying high-confidence setups" với model llama, kết quả có `verifiedConfirmed`/`verifiedBy`.
4. Chạy thử odds-runner: log phải hiện verify confirmed/rejected cho mỗi trận, revise nếu bị reject.
