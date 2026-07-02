# Task: 03 — Add generateCombinedAnalysis to betting-gemini.ts

## Objective
Thêm hàm `generateCombinedAnalysis()` vào `src/betting/betting-gemini.ts` — gọi 1 prompt AI duy nhất nhận raw odds N trận và trả về `CombinedAnalysisPlan` (phân tích + plan).

## Instructions

1. **Đọc** `src/betting/betting-gemini.ts` (đặc biệt các dòng ~1047–1177: `buildPlanSystemPrompt`, `buildPlanUserPrompt`, `generateBettingPlan`, `parseBettingPlanResponse`).

2. **Import** `CombinedAnalysisPlan` từ `./betting-types.js`:
   ```typescript
   import type { ..., CombinedAnalysisPlan } from "./betting-types.js";
   ```

3. **Import** `formatOddsAnalysisInput` từ `./odds-text-format.js` (đã có sẵn import ở đầu file).

4. **Thêm hằng số** gần đầu section "Betting Plan Generator" (dòng ~1047):
   ```typescript
   const COMBINED_TIMEOUT_MS = parsePositiveEnv("BETTING_AI_COMBINED_TIMEOUT_MS", 240_000); // 4 phút
   const COMBINED_TOKENS = 6_000;
   ```

5. **Thêm hàm `buildCombinedSystemPrompt(matchCount: number): string`**:
   - Kết hợp `buildAnalyzeSystemPrompt()` + `buildPlanSystemPrompt()`
   - Hướng dẫn AI vừa phân tích odds từng trận vừa lên kế hoạch xiên
   - Nội dung chính:
     ```
     Bạn là chuyên gia phân tích odds và lên kế hoạch đặt cược bóng đá.
     Dưới đây là raw odds cho {matchCount} trận đấu.

     YÊU CẦU:
     1. Phân tích từng trận: nhận định ngắn, tỉ số dự đoán, kèo nổi bật
     2. Lên kế hoạch cược với chiến lược vốn {vốn}
     ... (kế thừa quy tắc xiên/đơn từ buildPlanSystemPrompt)
     3. Tất cả field text bằng tiếng Việt có dấu, ngắn gọn
     ```

6. **Thêm hàm `buildCombinedUserPrompt(payloads: MatchOddsPayload[]): string`**:
   - Gửi raw odds FULL cho từng trận (dùng `formatOddsAnalysisInput()` cho mỗi trận)
   - Format: mỗi trận 1 block
     ```
     === TRẬN 1: Portugal vs Croatia (Th 6 03/07 06:00) ===
     h2h:H=1.72,D=3.96,A=5.55
     asia_handicap:H@-0.75=1.83,A@+0.75=1.97
     ...

     === TRẬN 2: Switzerland vs Algeria (Th 6 03/07 10:00) ===
     ...
     ```
   - Sau blocks, thêm "YÊU CẦU:" + JSON schema mẫu (giống buildPlanUserPrompt nhưng dùng `CombinedAnalysisPlan` schema)

   JSON schema:
   ```json
   {
     "summary": "Tổng quan các trận...",
     "matches": [
       {
         "matchIndex": 0,
         "matchLabel": "Portugal vs Croatia",
         "kickoff": "Th 6 03/07 06:00",
         "analysis": "Phân tích ngắn 1-2 câu",
         "preferredScoreline": "2-1",
         "scoreConfidence": 55,
         "topPicks": [
           {"market": "1X2", "selection": "Portugal thắng", "odds": 1.72, "suitability": "parlay", "reason": "lý do ngắn"}
         ],
         "keyPoints": ["điểm 1", "điểm 2"],
         "risks": ["rủi ro 1"]
       }
     ],
     "parlays": [...],
     "remainingSingles": [...]
   }
   ```

7. **Thêm hàm `parseCombinedAnalysisResponse(text: string, payloads: MatchOddsPayload[]): CombinedAnalysisPlan | null`**:
   - Parse JSON, validate cấu trúc
   - Kiểm tra: `parsed.matches` là array, mỗi match có `matchIndex`, `analysis`, `topPicks`, `preferredScoreline`, `scoreConfidence`
   - Nếu parse lỗi → log warning + return null
   - Dùng `extractJsonObject()` và `cleanResponse()` (đã có sẵn)

8. **Thêm hàm `generateCombinedAnalysis(payloads: MatchOddsPayload[]): Promise<CombinedAnalysisPlan | null>`**:
   - Tạo primary request + fallback request (giống `generateBettingPlan` đã sửa)
   - Gọi OpenRouter với timeout COMBINED_TIMEOUT_MS
   - Parse response bằng `parseCombinedAnalysisResponse()`
   - Log stage metrics + record usage (dùng `recordStageUsage` với stage="combined")
   - Return null nếu fail cả primary + fallback

   ```typescript
   export async function generateCombinedAnalysis(
     payloads: MatchOddsPayload[],
   ): Promise<CombinedAnalysisPlan | null> {
     if (payloads.length === 0) return null;
     const startedAt = Date.now();

     const primaryRequest: OpenRouterRequest = {
       model: ANALYZE_MODEL, // dùng ANALYZE_MODEL (pro) cho quality
       systemPrompt: buildCombinedSystemPrompt(payloads.length),
       userContent: [{ type: "text", text: buildCombinedUserPrompt(payloads) }],
       maxTokens: COMBINED_TOKENS,
       temperature: 0.3,
       responseFormat: { type: "json_object" },
       timeoutMs: COMBINED_TIMEOUT_MS,
       plugins: [{ id: "web", max_results: 3 }], // web search để có context mới
     };

     const fallbackRequest: OpenRouterRequest = {
       ...primaryRequest,
       model: PLAN_FALLBACK_MODEL,
       plugins: undefined,
     };

     // Try primary → fallback (giống pattern generateBettingPlan)
     // Log kết quả, record usage, return plan hoặc null
   }
   ```

**Lưu ý quan trọng**: dùng `Array.from(matches)` thay vì `matches.entries()` nếu cần iterate vì pre-existing lint lỗi Map/Set iteration.

## Acceptance Criteria
- [ ] `buildCombinedSystemPrompt(matchCount)` trả về prompt hoàn chỉnh
- [ ] `buildCombinedUserPrompt(payloads)` trả về raw odds + instructions + JSON schema
- [ ] `parseCombinedAnalysisResponse(text, payloads)` parse đúng JSON → `CombinedAnalysisPlan` hoặc null
- [ ] `generateCombinedAnalysis(payloads)` gọi OpenRouter, fallback, parse, log, return
- [ ] Build không lỗi mới

## Files to Touch
- `src/betting/betting-gemini.ts` — thêm functions mới

## Out of Scope
- Không sửa functions analyze/verify/revise hiện có
- Không sửa odds-runner (subtask 04 sẽ làm)