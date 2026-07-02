# Plan: Combined Match Analysis + Betting Plan (Single AI Pass)

## Mục tiêu
Thay đổi luồng phân tích: **bỏ phân tích từng trận riêng lẻ**, thay bằng **1 prompt AI duy nhất** nhận raw odds cả N trận và trả về phân tích + kế hoạch đặt cược trong 1 lần.

## Kiến trúc

### Flow hiện tại (cần thay thế)
```
fetch odds → gửi Telegram từng trận → AI analyze từng trận → verify/revise → save DB → generate plan từ all analyses
```

### Flow mới
```
fetch odds (N trận) → gửi 1 message Telegram: raw odds formatted → 1 prompt AI: raw odds all trận → AI trả JSON: { matches[], parlays[], remainingSingles[], summary } → gửi 1 message kết quả → save
```

### Thay đổi file

| File | Thay đổi |
|------|---------|
| `src/betting/betting-types.ts` | Thêm type `CombinedAnalysisPlan` (kế thừa BettingPlan + thêm analysis per match) |
| `src/betting/odds-text-format.ts` | Thêm `formatCombinedOddsMessage()` — format odds cả N trận đẹp + gọn |
| `src/betting/betting-gemini.ts` | Thêm `buildCombinedSystemPrompt()`, `buildCombinedUserPrompt()`, `generateCombinedAnalysis()`. Prompt tích hợp: raw odds + phân tích + plan trong 1 lần |
| `src/betting/odds-runner.ts` | Viết lại `runOddsCheck()` — bỏ processMatch, verify, revise; dùng combined flow |

### Data flow
```
payloads: MatchOddsPayload[]
  → formatCombinedOddsMessage(payloads) → gửi Telegram (raw odds đẹp)
  → generateCombinedAnalysis(payloads) → 1 call OpenRouter
    → AI trả về CombinedAnalysisPlan
      → formatMatchAnalysisMessage(kết hợp) + formatBettingPlanMessage → gửi Telegram
      → saveBettingAnalysisSnapshot cho từng trận (nếu có analysis)
```

### Output schema (AI response)
```json
{
  "summary": "Tổng quan các trận...",
  "matches": [
    {
      "matchIndex": 0,
      "matchLabel": "Portugal vs Croatia",
      "kickoff": "Th 6 03/07 06:00",
      "analysis": "Phân tích ngắn 1-2 câu về trận này...",
      "preferredScoreline": "2-1",
      "scoreConfidence": 55,
      "topPicks": [
        {"market": "1X2", "selection": "Portugal thắng", "odds": 1.72, "suitability": "both", "reason": "ngắn"}
      ],
      "keyPoints": ["...", "..."],
      "risks": ["..."]
    }
  ],
  "parlays": [
    {
      "type": "xiên 3",
      "legs": [
        {"matchIndex": 0, "matchLabel": "...", "pick": {"market": "...", "selection": "...", "odds": 1.72, "reason": "..."}},
        {"matchIndex": 1, "matchLabel": "...", "pick": {"market": "...", "selection": "...", "odds": 1.95, "reason": "..."}},
        {"matchIndex": 2, "matchLabel": "...", "pick": {"market": "...", "selection": "...", "odds": 2.08, "reason": "..."}}
      ],
      "combinedOdds": 6.97,
      "stake": 50000,
      "potentialWin": 348500
    }
  ],
  "remainingSingles": [
    {"matchIndex": 0, "matchLabel": "...", "betType": "Tỷ số chính xác", "pick": {"market": "Tỷ số chính xác", "selection": "2-0", "odds": 6.5, "reason": "..."}, "stake": 300000, "potentialWin": 1950000}
  ]
}
```

## Subtasks

| ID | Owner | Parallelizable | Dependencies | Allowed files | Output |
|----|-------|----------------|--------------|---------------|--------|
| 01-types | worker | yes | none | src/betting/betting-types.ts | tasks/combined-match-analysis/01-types/result.md |
| 02-odds-format | worker | yes | none | src/betting/odds-text-format.ts | tasks/combined-match-analysis/02-odds-format/result.md |
| 03-ai-combined | worker | yes | none | src/betting/betting-gemini.ts | tasks/combined-match-analysis/03-ai-combined/result.md |
| 04-odds-runner | worker | no (last) | 01-types, 02-odds-format, 03-ai-combined | src/betting/odds-runner.ts, src/betting/betting-index.ts | tasks/combined-match-analysis/04-odds-runner/result.md |

## Testing Strategy
- Chạy `npm run match-odds` và verify output Telegram
- Kiểm tra parse JSON không lỗi
- Kiểm tra save DB thành công
- Verify không còn log "Skip verify/revise" (vì đã bỏ verify step)

## Edge Cases
- 0 match → gửi message "Không có trận nào"
- AI trả JSON lỗi parse → fallback message raw odds
- AI timeout → fallback message raw odds