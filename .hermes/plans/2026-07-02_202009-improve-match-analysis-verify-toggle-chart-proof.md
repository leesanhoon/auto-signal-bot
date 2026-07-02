# Improve Match Analysis, Verify Toggle, and Chart Proof Plan

> **For Hermes:** triển khai bằng các subagent độc lập theo từng task bên dưới. Không triển khai trong bước plan này.

**Goal:** Cải thiện độ chính xác phần phân tích trận đấu theo dữ liệu odds đã cung cấp, thêm biến env để bật/tắt bước verify, và chứng minh ảnh chart gửi Telegram đúng là chart mà AI dùng để nhận định.

**Architecture:** Tách thay đổi thành 3 luồng nhỏ: (1) harden pipeline phân tích odds bằng kiểm chứng dữ liệu snapshot/candidate và env toggle, (2) bổ sung metadata/provenance cho chart screenshots xuyên suốt analyze → verify → Telegram, (3) test hồi quy cho các contract quan trọng. Ưu tiên guardrail deterministic trước, prompt/schema sau, để giảm phụ thuộc vào model.

**Tech Stack:** Node.js/TypeScript, Vitest, OpenRouter, Telegram Bot API, Playwright screenshots.

---

## Current Context / Findings

- Match odds analysis nằm chính ở:
  - `src/betting/betting-gemini.ts`
    - build candidate pool từ snapshot odds: `buildCandidatePool`, `buildCandidatePoolText`.
    - analyze prompt yêu cầu model chỉ trả `candidateId`; code hydrate lại odds từ snapshot.
    - verify/revise dùng `AI_VERIFY_MODEL`, hiện luôn chạy nếu có pick hợp lệ.
  - `src/betting/odds-runner.ts`
    - `processMatch()` gọi `analyzeMatchOdds()` rồi `verifyMatchAnalysis()` / `reviseMatchAnalysis()`.
    - Chưa có env toggle verify.
  - `src/betting/odds-text-format.ts`
    - format dữ liệu input/output gửi Telegram.
- Chart analysis nằm chính ở:
  - `src/charts/screenshot.ts`
    - capture tạo `ScreenshotResult` gồm `chart`, `buffer`, `filepath`.
  - `src/charts/analyzer.ts`
    - `analyzeWithOpenRouter()` gửi chính các `screenshots` vào AI theo từng pair.
    - `confirmHighConfidenceSetups()` verify bằng screenshot H4 lấy từ cùng `screenshots` input.
  - `src/shared/telegram.ts`
    - `sendAllAnalyses()` gửi ảnh bằng `findScreenshot(setup.pair, result.screenshots)`; logic match hiện dựa trên `symbol.includes(normalized)` và timeframe H4.
- Rủi ro chart hiện tại:
  - AI phân tích package D1/H4/M15, nhưng Telegram caption chỉ ghi `pair H4` và không có filepath/chart symbol/timeframe/timestamp để đối chiếu.
  - `findScreenshot()` trong `src/shared/telegram.ts` duplicate logic với `findChartForPair()` ở `src/charts/screenshot.ts`; có thể lệch nếu symbol/pair format không khớp hoặc nhiều symbol chứa cùng chuỗi.
  - `TradeSetup` chưa có metadata `sourceChart...`/`analysisChart...` để chứng minh setup được sinh từ nhóm ảnh nào.
- Env hiện có trong `.env.example`:
  - `AI_VERIFY_MODEL=moonshotai/kimi-k2.6`
  - `AI_CHART_VERIFY_MODEL=moonshotai/kimi-k2.6`
  - Chưa có biến bật/tắt verify.

---

## Proposed Env Variables

Thêm 2 env toggle rõ nghĩa, default vẫn bật để giữ behavior hiện tại:

```env
BETTING_AI_VERIFY_ENABLED=true
CHART_AI_VERIFY_ENABLED=true
```

Quy ước parse boolean:
- `false`, `0`, `no`, `off` → tắt.
- unset hoặc giá trị khác → bật.

Lý do tách 2 biến:
- Verify odds trận đấu và verify chart trade là 2 pipeline khác nhau, chi phí/model/độ cần thiết khác nhau.
- Người dùng có thể muốn tắt verify odds nhưng vẫn verify chart, hoặc ngược lại.

---

## Subagent Work Breakdown

### Subagent 1 — Betting Analysis Accuracy + Verify Toggle

**Objective:** Cải thiện độ chính xác phân tích trận đấu bằng guardrail deterministic và thêm `BETTING_AI_VERIFY_ENABLED` để bật/tắt verify/revise.

**Files:**
- Modify: `src/betting/betting-gemini.ts`
- Modify: `src/betting/odds-runner.ts`
- Modify: `.env.example`
- Test: `tests/betting/betting-gemini.test.ts`
- Test: `tests/betting/odds-runner.test.ts`

**Implementation Plan:**

1. Add boolean env helper for betting verify.
   - Prefer local helper in `src/betting/odds-runner.ts` first to avoid broad refactor.
   - Export for tests if needed:
     - `export function isBettingVerifyEnabled(): boolean`
   - Behavior:
     - unset → `true`
     - `false|0|no|off` → `false`

2. In `processMatch()`:
   - Keep `analyzeMatchOdds()` unchanged.
   - If no valid pick or recommendation is stand-aside, continue skipping verify as today.
   - If `BETTING_AI_VERIFY_ENABLED=false`, skip `verifyMatchAnalysis()` and `reviseMatchAnalysis()`.
   - Mark analysis metadata explicitly:
     - `verificationStatus = "skipped"` if existing type allows; if type does not allow, extend `MatchAiAnalysis` type first.
     - `verifiedComment = "Bỏ qua verify theo BETTING_AI_VERIFY_ENABLED=false."`
   - Do **not** mutate picks when verify disabled; output is primary analysis only.

3. Improve prompt/data grounding in `src/betting/betting-gemini.ts` without changing output schema too much:
   - In `buildAnalyzeSystemPrompt()` emphasize:
     - chỉ nhận định dựa trên snapshot odds/candidates đã gửi;
     - nếu thông tin thiếu hoặc odds mâu thuẫn thì đứng ngoài;
     - không dùng web để bịa lineup/news nếu không có nguồn rõ.
   - In `buildAnalyzeUserPrompt()` require:
     - `keyPoints` phải trích từ odds/market cụ thể trong snapshot;
     - `risks` phải nêu điều kiện làm invalid kèo;
     - `preferredScoreline` confidence thấp nếu không có correct score/liên hệ market rõ.

4. Add deterministic validation after parse/hydrate:
   - If `recommendation` is not stand-aside but `picks=[]`, force stand-aside (already exists; keep test).
   - Add a helper like `normalizeAnalysisAfterHydration(payload, parsed)` if it keeps code simpler.
   - Ensure every pick in final analysis exists in `buildCandidatePool(payload)` and odds `> 1.80` (already mostly covered); add tests for stale/invalid candidate IDs.
   - Optional: cap `confidence` to a conservative max (e.g. 55) when no valid picks survive.

5. Update `.env.example`:
   - Add `BETTING_AI_VERIFY_ENABLED=true` near betting AI timeout config.

**Acceptance Criteria:**
- `BETTING_AI_VERIFY_ENABLED=false` makes `processMatch()` call `analyzeMatchOdds()` but not `verifyMatchAnalysis()` / `reviseMatchAnalysis()`.
- Default/unset env preserves existing verify behavior.
- Invalid/duplicate/non-snapshot picks cannot appear in final Telegram analysis.
- Tests cover env parse and both enabled/disabled paths.

**Verification Commands:**
```bash
npm run test -- tests/betting/betting-gemini.test.ts tests/betting/odds-runner.test.ts
npm run build
```

---

### Subagent 2 — Chart Provenance: Ensure Telegram Image Is the AI-Analyzed Chart

**Objective:** Gắn metadata nguồn ảnh vào setup và dùng chính screenshot cùng batch phân tích để gửi Telegram, tránh gửi nhầm chart.

**Files:**
- Modify: `src/charts/chart-types.ts`
- Modify: `src/charts/analyzer.ts`
- Modify: `src/shared/telegram.ts`
- Optional Modify: `src/charts/screenshot.ts` only if adding helper reuse is cleaner.
- Test: `tests/charts/analyzer.test.ts`
- Test: `tests/shared/telegram.test.ts`

**Implementation Plan:**

1. Extend chart types with provenance metadata.
   - Add type:
     - `ChartAnalysisSource` with `symbol`, `timeframe`, `name`, `filepath`.
   - Extend `TradeSetup` with optional:
     - `sourceCharts?: ChartAnalysisSource[]`
     - `telegramChart?: ChartAnalysisSource`
   - Keep optional to avoid breaking existing stored positions/tests.

2. In `src/charts/analyzer.ts`, after parsing each pair result:
   - Build `sourceCharts` from `group.screenshots.map(...)`.
   - Attach `sourceCharts` to each setup returned for that pair.
   - Prefer exact `pair === result.pair`; if model returns variant like `EURUSD`, normalize by stripping `/`, spaces, case.

3. In `confirmHighConfidenceSetups()`:
   - Select verify screenshot from the same `screenshots` input and preferably from `setup.sourceCharts` H4.
   - Attach `telegramChart` to setup with the selected H4 screenshot metadata.
   - If no H4 exists, attach the fallback chart metadata actually used.

4. Replace or harden `findScreenshot()` in `src/shared/telegram.ts`:
   - First try `setup.telegramChart.filepath` exact match against `result.screenshots`.
   - Then try H4 from `setup.sourceCharts` exact `symbol+timeframe+filepath`.
   - Only then fallback to current pair matching.
   - Add warning/log when fallback is used, so mismatch can be detected.

5. Improve Telegram caption for auditability:
   - From: `📊 ${setup.pair} H4 — ${setup.direction} (${confidence}% 🔥)`
   - To include actual chart source:
     - `📊 ${setup.pair} ${screenshot.chart.timeframe} — ${setup.direction} (${confidence}% 🔥)`
     - second line: `Nguồn ảnh: ${screenshot.chart.symbol} | ${basename(screenshot.filepath)}`
   - Avoid leaking full local path if not needed; filename is enough for user verification.

**Acceptance Criteria:**
- Every setup from `analyzeAllCharts()` has `sourceCharts` listing D1/H4/M15 screenshots used for that pair when available.
- Telegram sends the screenshot referenced by `setup.telegramChart`/`sourceCharts`, not just a fuzzy pair match.
- Caption shows actual timeframe and chart symbol/filename.
- Tests prove when two similar symbols exist, exact provenance wins over fuzzy fallback.

**Verification Commands:**
```bash
npm run test -- tests/charts/analyzer.test.ts tests/shared/telegram.test.ts
npm run build
```

---

### Subagent 3 — Chart Verify Toggle and Threshold Consistency

**Objective:** Thêm `CHART_AI_VERIFY_ENABLED` để bật/tắt verify chart và chỉnh threshold consistency trong chart runner.

**Files:**
- Modify: `src/charts/index.ts`
- Modify: `src/charts/chart-config-env.ts`
- Modify: `.env.example`
- Test: create or extend a chart runner test if practical; otherwise cover helper in `tests/charts/analyzer.test.ts` or new `tests/charts/chart-config-env.test.ts`.

**Implementation Plan:**

1. Add shared boolean helper in `src/charts/chart-config-env.ts`:
   - `export function getConfiguredChartVerifyEnabled(): boolean`
   - Same parse convention as betting: unset/default `true`; `false|0|no|off` disables.

2. In `src/charts/index.ts`:
   - Import `getConfiguredChartVerifyEnabled()`.
   - Gate the block that calls `confirmHighConfidenceSetups()`:
     - Only verify if `chartVerifyEnabled && highConfSetups.length > 0`.
   - Log clearly when skipped:
     - `Skipped chart verification because CHART_AI_VERIFY_ENABLED=false`.
   - When skipped, do not set `verifiedConfirmed=true`; this keeps `shouldAutoTrackAsOpen()` false and avoids auto-saving unverified positions.

3. Fix threshold inconsistency while touching the runner:
   - `analyzer.parseAnalysisResponse()` keeps setups with `confidence >= threshold`.
   - `index.ts` currently verifies only `(confidence ?? 0) > threshold`.
   - Change to `>= threshold` so a 70% setup at threshold is verified and handled consistently.

4. Update `.env.example`:
   - Add `CHART_AI_VERIFY_ENABLED=true` near chart model envs.

**Acceptance Criteria:**
- Default behavior remains current: chart verify runs for high-confidence setups.
- `CHART_AI_VERIFY_ENABLED=false` skips verify and therefore skips auto-track as open.
- Confidence exactly equal to threshold is treated consistently as high confidence.

**Verification Commands:**
```bash
npm run test -- tests/charts/analyzer.test.ts
npm run build
```

---

### Subagent 4 — End-to-End Regression and Documentation Review

**Objective:** Chạy kiểm thử tổng thể, rà soát output Telegram và cập nhật docs/env sample để người dùng vận hành dễ.

**Files:**
- Modify: `.env.example`
- Optional Modify: `README.md` if repo has run/config docs and it is appropriate.
- Review-only: touched files from Subagent 1–3.

**Implementation Plan:**

1. Run focused tests from previous tasks:
```bash
npm run test -- tests/betting/betting-gemini.test.ts tests/betting/odds-runner.test.ts tests/charts/analyzer.test.ts tests/shared/telegram.test.ts
```

2. Run full test suite:
```bash
npm run test
```

3. Run build:
```bash
npm run build
```

4. Review Telegram output contract:
   - Betting output should not claim verify if `BETTING_AI_VERIFY_ENABLED=false`.
   - Chart photo caption should show actual source symbol/timeframe/filename.
   - No full secrets/env values printed.

5. Update `.env.example` comments if needed:
```env
# Verification toggles
BETTING_AI_VERIFY_ENABLED=true
CHART_AI_VERIFY_ENABLED=true
```

**Acceptance Criteria:**
- Full tests pass.
- Build passes.
- Env variables documented in `.env.example`.
- No implementation leaks secrets or full local paths unnecessarily.

---

## Suggested Task Queue Files If Using AGENTS.md Protocol

Nếu muốn chạy đúng protocol Lead/Worker trong repo, Lead có thể tạo các task directories sau sau khi user approve triển khai:

```text
tasks/betting-verify-toggle-and-guards/
  plan.md
  task.md
  context.md

tasks/chart-provenance-telegram-proof/
  plan.md
  task.md
  context.md

tasks/chart-verify-toggle-threshold/
  plan.md
  task.md
  context.md

tasks/regression-docs-review/
  plan.md
  task.md
  context.md
```

Mỗi worker chỉ được chạm files đã nêu trong task tương ứng. Lead review `result.md`, yêu cầu sửa qua `review.md`, chỉ viết `done.md` khi test/build đạt.

---

## Risks / Tradeoffs

- Nếu tắt verify, tín hiệu odds/chart sẽ nhanh và rẻ hơn nhưng kém an toàn hơn. Telegram nên thể hiện trạng thái verify skipped để tránh hiểu nhầm.
- Gắn provenance vào `TradeSetup` có thể ảnh hưởng các snapshot/position cũ nếu schema lưu DB strict; vì hiện type optional nên rủi ro thấp, nhưng cần kiểm tra repository save paths.
- Fuzzy pair matching vẫn cần fallback cho setup cũ không có metadata, nhưng mọi setup mới nên dùng exact provenance trước.
- Prompt cải thiện giúp giảm lỗi model, nhưng guardrail deterministic mới là phần quan trọng nhất để không dùng pick ngoài snapshot.

---

## Open Questions Before Implementation

1. Bạn muốn một biến verify chung (`AI_VERIFY_ENABLED`) hay tách riêng như plan đề xuất (`BETTING_AI_VERIFY_ENABLED`, `CHART_AI_VERIFY_ENABLED`)? Plan đang đề xuất tách riêng để dễ kiểm soát.
2. Với chart Telegram, bạn muốn caption chỉ hiện filename hay hiện cả `symbol + timeframe + filename`? Plan đề xuất `symbol + timeframe + filename`.
3. Khi betting verify bị tắt, Telegram có nên hiển thị dòng “Verify: đã tắt” trong message không? Plan đề xuất có, để tránh nhầm là đã được xác nhận.
