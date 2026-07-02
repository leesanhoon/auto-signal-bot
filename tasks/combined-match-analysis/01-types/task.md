# Task: 01 — Add CombinedAnalysisPlan type

## Objective
Thêm type `CombinedAnalysisPlan` vào `src/betting/betting-types.ts` để hỗ trợ response từ combined AI call.

## Instructions

1. **Đọc file** `src/betting/betting-types.ts` để hiểu các type hiện có: `BettingPlan`, `BettingPlanMatch`, `BettingPlanPick`, `BettingParlay`, `BettingParlayLeg`, `BettingPlanSingle`, `MatchAiAnalysis`.

2. **Thêm type `CombinedAnalysisPlanMatch`** — extends `BettingPlanMatch` với thêm analysis fields:
   ```typescript
   export type CombinedAnalysisPlanMatch = {
     matchIndex: number;
     matchLabel: string;
     kickoff: string;
     analysis: string;           // Phân tích ngắn 1-2 câu
     preferredScoreline: string;
     scoreConfidence: number;
     topPicks: BettingPlanPick[];
     keyPoints: string[];        // 1-3 điểm chính
     risks: string[];            // 1-3 rủi ro
   };
   ```

3. **Thêm type `CombinedAnalysisPlan`** — extends `BettingPlan`:
   ```typescript
   export type CombinedAnalysisPlan = {
     summary: string;                    // Tổng quan tất cả trận (tiếng Việt)
     matches: CombinedAnalysisPlanMatch[];
     parlays: BettingParlay[];
     remainingSingles: BettingPlanSingle[];
   };
   ```

4. **Đảm bảo không break export** — các type cũ vẫn export được.

## Acceptance Criteria
- [ ] `CombinedAnalysisPlan` type hoàn chỉnh với `summary`, `matches` (mảng `CombinedAnalysisPlanMatch`), `parlays` (mảng `BettingParlay`), `remainingSingles` (mảng `BettingPlanSingle`)
- [ ] `CombinedAnalysisPlanMatch` có đủ: `matchIndex`, `matchLabel`, `kickoff`, `analysis`, `preferredScoreline`, `scoreConfidence`, `topPicks`, `keyPoints`, `risks`
- [ ] Build không lỗi mới: `npx tsc --noEmit`

## Files to Touch
- `src/betting/betting-types.ts` — thêm 2 type mới

## Out of Scope
- Không sửa bất kỳ type hiện có nào (BettingPlan, MatchAiAnalysis, ...)
- Không sửa file khác