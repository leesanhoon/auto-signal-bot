# Task: 04 — Rewrite odds-runner.ts to combined flow

## Objective
Viết lại `src/betting/odds-runner.ts` để dùng combined flow: gửi raw odds → 1 AI call → gửi kết quả duy nhất. **Bỏ hoàn toàn** `processMatch()`, verify, revise.

## Prerequisites
Subtask này DEPENDS ON: 01-types, 02-odds-format, 03-ai-combined. Chỉ chạy sau khi 3 subtask kia hoàn thành.

## Instructions

1. **Đọc** `tasks/combined-match-analysis/context.md` để hiểu tổng quan.

2. **Đọc** `src/betting/odds-runner.ts` hiện tại (full file, ~360 dòng).

3. **Đọc** `src/betting/betting-index.ts` — entry point.

4. **Đọc** các type và function mới từ các subtask trước:
   - `CombinedAnalysisPlan`, `CombinedAnalysisPlanMatch` (từ 01-types)
   - `formatCombinedOddsMessage()` (từ 02-odds-format)
   - `generateCombinedAnalysis()`, `parseCombinedAnalysisResponse()` (từ 03-ai-combined)

5. **Viết lại `runOddsCheck()`**:

   ```typescript
   import { formatCombinedOddsMessage, formatMatchAnalysisMessage, formatBettingPlanMessage } from "./odds-text-format.js";
   import { generateCombinedAnalysis } from "./betting-gemini.js";
   import { saveBettingAnalysisSnapshot } from "./betting-analysis-repository.js";
   // ... giữ nguyên các import khác

   export async function runOddsCheck(): Promise<void> {
     logger.info(`🏆 ${LABEL} - Starting combined analysis...\n`);
     
     // 1. Load matches + fetch odds (giữ nguyên)
     const matches = pickNearestUpcomingDateMatches(await loadUpcomingMatches());
     // ... validate matches.length > 0
     
     const bookmakerKey = getConfiguredBookmaker();
     const { payload, failures } = await buildOddsPayload(matches);
     // ... handle failures
     
     // 2. Gửi raw odds formatted (THAY CHO gửi từng trận + analyze từng trận)
     const oddsMessage = formatCombinedOddsMessage(payload);
     await sendMessage(oddsMessage);
     
     // 3. Gọi 1 AI call duy nhất (THAY CHO từng processMatch + generatePlan)
     const plan = await generateCombinedAnalysis(payload);
     
     if (plan) {
       // 4. Gửi kết quả phân tích tổng hợp
       //    - Từng match analysis
       //    - Betting plan (parlays + singles)
       //    - Summary
       
       // Gửi section 1: Summary + từng match analysis
       const summaryLines = [`📋 *TỔNG QUAN*\n${plan.summary}`, ""];
       for (const match of plan.matches) {
         const payload = payloads[match.matchIndex];
         if (!payload) continue;
         // Dùng formatMatchAnalysisMessage nhưng chỉ lấy phần analysis (không có verify)
         // Hoặc tự build message ngắn:
         const picksText = match.topPicks
           .map(p => `• *${p.selection}* [@${p.odds}]${p.suitability === "parlay" ? " 🔗XIÊN" : p.suitability === "single" ? " 📌ĐƠN" : ""}\n  _${p.market}_ — ${p.reason}`)
           .join("\n");
         summaryLines.push(
           `🏟 *${payload.home} vs ${payload.away}*\n📝 ${match.analysis}\n🎯 *Kèo: ${match.preferredScoreline}* (${match.scoreConfidence}%)\n${picksText}`
         );
       }
       await sendMessage(summaryLines.join("\n\n"));
       
       // Gửi section 2: Betting plan (giống formatBettingPlanMessage hiện tại)
       const planMessage = formatBettingPlanMessage(plan);
       await sendMessage(`📋 *KẾ HOẠCH ĐẶT CƯỢC*\n${planMessage}`);
       
       // 5. Save DB (nếu có analysis per match — optional, có thể bỏ nếu user ko cần)
       for (const match of plan.matches) {
         const p = payloads[match.matchIndex];
         if (!p) continue;
         try {
           await saveBettingAnalysisSnapshot({
             gameId: p.gameId,
             date: vnDateStr(p.kickoffUnix * 1000),
             home: p.home,
             away: p.away,
             kickoffUnix: p.kickoffUnix,
             odds: p.odds,
             correctScore: p.correctScore ?? null,
             analysis: {
               match: match.matchLabel,
               preferredScoreline: match.preferredScoreline,
               scoreConfidence: match.scoreConfidence,
               recommendation: match.analysis, // dùng analysis text làm recommendation
               confidence: match.topPicks.reduce((max, p) => Math.max(max, p.odds > 0 ? 70 : 0), 50), // ước lượng
               picks: match.topPicks.map(p => ({ market: p.market, selection: p.selection, odds: p.odds, reason: p.reason })),
               keyPoints: match.keyPoints,
               risks: match.risks,
               summary: match.analysis,
               verificationStatus: "skipped",
             },
             verifiedConfirmed: null,
             verifiedConfidence: null,
             verifiedComment: null,
             revisedAfterReject: false,
           });
         } catch (saveError) {
           logger.warn(`  ⚠ Save failed for ${p.home} vs ${p.away}: ${saveError}`);
         }
       }
     } else {
       // Fallback: AI không trả được plan → gửi raw odds
       await sendMessage(`⚠️ AI không phân tích được. Dữ liệu odds thô:\n\n${formatCombinedOddsMessage(payload)}`);
     }
     
     logger.info(`\n✅ Da phan tich xong ${payload.length} tran (combined mode).`);
   }
   ```

6. **Xoá code không dùng**:
   - Xoá `processMatch()` (toàn bộ function)
   - Xoá `isBettingVerifyEnabled()` 
   - Xoá `makeConservativeRejectedAnalysis()`
   - Xoá `shouldReviseReason()`
   - Xoá `formatKickoff()`
   - Import không còn dùng: `analyzeMatchOdds`, `isStandAsideAnalysis`, `reviseMatchAnalysis`, `verifyMatchAnalysis`, `VerificationReasonCode`, `type MatchAiAnalysis` (giữ nếu cần cho save)
   - Import mới: `formatCombinedOddsMessage`, `generateCombinedAnalysis` (và các type cần)

7. **Giữ nguyên** `src/betting/betting-index.ts` — không cần sửa.

## Important Notes
- Dùng `Array.from(set)` thay vì `[...set]` để tránh lint lỗi
- Kiểm tra `plan.matches[matchIndex]` có tồn tại trước khi dùng
- Nếu `plan.matches` rỗng nhưng `plan.parlays` có data → vẫn gửi betting plan
- Nếu `plan === null` → fallback message
- Tất cả message Telegram dùng Markdown: `*bold*`, `_italic_`

## Acceptance Criteria
- [ ] `runOddsCheck()` fetch odds → gửi 1 message raw odds formatted → 1 AI call → gửi kết quả
- [ ] Không còn log "Skip verify/revise" (vì không còn processMatch)
- [ ] Không còn gọi `analyzeMatchOdds`, `verifyMatchAnalysis`, `reviseMatchAnalysis`
- [ ] Fallback message khi AI fail
- [ ] Build không lỗi mới
- [ ] `npm run match-odds` chạy được và gửi message hợp lý

## Files to Touch
- `src/betting/odds-runner.ts` — viết lại

## Verification
```bash
cd H:/LeeSanHoon/auto-signal-bot
npx tsc --noEmit
```
Chỉ chấp nhận pre-existing lint errors (Set/Map iteration), không lỗi mới.

## Out of Scope
- Không sửa betting-gemini.ts (subtask 03 đã làm)
- Không sửa odds-text-format.ts (subtask 02 đã làm)
- Không sửa betting-types.ts (subtask 01 đã làm)
- Không sửa betting-index.ts