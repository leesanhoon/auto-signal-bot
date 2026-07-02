# Context: Combined Match Analysis

## Project
- Root: `H:\LeeSanHoon\auto-signal-bot`
- TypeScript (ESNext modules), chạy `tsx` trực tiếp (không build)
- Script chạy: `npm run match-odds` → `src/betting/betting-index.ts` → `odds-runner.ts`

## Key files
### Betting types
- `src/betting/betting-types.ts` — `MatchOddsPayload`, `MatchAiAnalysis`, `BettingPlan`, `BettingPlanPick`, `BettingParlay`, `BettingPlanSingle`

### Odds text formatting
- `src/betting/odds-text-format.ts` — `formatOddsText()`, `formatOddsDataMessage()`, `formatMainOddsSummary()`, `formatMatchAnalysisMessage()`, `formatBettingPlanMessage()`, `formatOddsFallbackMessage()`
- Các hàm helper: `findMarket()`, `findOutcome()`, `fmtNum()`, `fmtSignedPoint()`

### AI prompts
- `src/betting/betting-gemini.ts`:
  - `buildAnalyzeSystemPrompt()`, `buildAnalyzeUserPrompt()` — phân tích từng trận
  - `buildPlanSystemPrompt()`, `buildPlanUserPrompt()` — kế hoạch tổng thể (dùng analyses đã có)
  - `generateBettingPlan(payloads, analyses)` — gọi OpenRouter tạo plan
  - Hàm parse: `parseBettingPlanResponse()`, `parseMatchAnalysisResponseInternal()`, `parseDirectPicks()`
  - `callOpenRouterWithCount()`, `runOpenRouterStage()` — gọi API với retry + fallback
  - `recordStageUsage()`, `logStageMetrics()` — logging

### Odds runner (sẽ viết lại)
- `src/betting/odds-runner.ts` — `runOddsCheck()`: luồng chính hiện tại
  - Load matches → fetch odds → gửi từng trận → processMatch (analyze + verify + revise) → save DB → generatePlan → gửi kết quả
- `src/betting/betting-index.ts` — entry point đơn giản: gọi `runOddsCheck()`

## Important conventions
- Tất cả text về Telegram dùng tiếng Việt có dấu
- Format Telegram dùng Markdown: `*bold*`, `_italic_`, `` `code` ``
- JSON responses dùng `candidateId` (P01, P02...) để refer đến odds snapshot
- Các emoji quen dùng: 🏟, ⭐, 🎯, ⚽, 🔎, ⚠️, 📊, 📋, 🔗, 📌
- Mỗi match có `gameId` (string từ API-Football) dùng để save DB
- `suitability` field mới: `"parlay" | "single" | "both"` — đã có trong type
- Map/Set iteration cần `Array.from()` hoặc spread vì tsconfig target=ES2022 (pre-existing lint)

## Env vars (relevant)
- `OPENROUTER_API_KEY` — bắt buộc
- `AI_TEXT_MODEL` — mặc định `deepseek/deepseek-v4-pro`
- `AI_TEXT_FALLBACK_MODEL` — mặc định `deepseek/deepseek-v4-flash`
- `BETTING_AI_PLAN_TIMEOUT_MS` — mặc định 180000 (180s)