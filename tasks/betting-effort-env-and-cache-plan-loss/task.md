# Task: Cấu hình `reasoning.effort` qua env (betting + chart) + Fix mất dữ liệu "kế hoạch đặt cược" khi dùng cache (Hướng A)

## Quyết định đã chốt

- Cache "kế hoạch đặt cược" (parlay/kèo đơn): dùng **Hướng A** — thêm bảng cache riêng, lưu và tái sử dụng được, KHÔNG chọn phương án chỉ ghi chú giới hạn.
- Cấu hình `effort` qua env: dùng **DUY NHẤT 1 BIẾN ENV CHUNG** cho toàn bộ các nơi gọi AI có `reasoning` — cả phân tích trận đấu (`src/betting/betting-gemini.ts`) VÀ phân tích chart (`src/charts/analyzer.ts`, `src/charts/position-decision.ts`, `src/charts/check-pending-orders-runner.ts`). KHÔNG tạo nhiều biến env riêng theo từng hàm/module.

## Objective — Phần 1+2: 1 biến env `AI_REASONING_EFFORT` dùng chung cho mọi nơi gọi AI có `reasoning`

Hiện có 5 nơi gọi `callOpenRouter(...)` với `reasoning` (hoặc thiếu hẳn `reasoning`):

**Betting** (`src/betting/betting-gemini.ts`):
- `generateBettingPlan()` (dòng ~926) — hardcode `{ effort: "medium" }`.
- `generateCombinedAnalysis()` (dòng ~1199) — hardcode `{ effort: "medium" }`.
- `buildAnalyzeMatchOddsRequest()` (dòng 606) — hardcode `{ effort: "none", exclude: true }` (xem lưu ý riêng ở Instructions về việc có nên đổi nơi này không).

**Chart** (hiện **hoàn toàn chưa có** field `reasoning`):
- `src/charts/analyzer.ts::analyzeWithOpenRouter()` (dòng ~443) — phân tích chart chính (H4/D1/M15).
- `src/charts/position-decision.ts::decidePosition()` (dòng ~82-93) — quyết định HOLD/CLOSE/STOP.
- `src/charts/check-pending-orders-runner.ts::reviewPendingOrder()` — quyết định TRIGGERED/CANCELLED/PENDING.

Giá trị hợp lệ theo `OpenRouterRequest.reasoning.effort` (`src/shared/openrouter.ts` dòng 15-16): `"none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max"`.

**Yêu cầu**: dùng 1 biến env duy nhất, ví dụ `AI_REASONING_EFFORT`, đọc 1 lần, áp dụng cho tất cả các nơi trên (trừ `buildAnalyzeMatchOddsRequest()` nếu xác nhận không dùng thật — xem Instructions). Không tạo biến env riêng theo từng hàm/model — đơn giản hoá cấu hình, chỉ cần set 1 biến trong GitHub Actions Variables là ảnh hưởng toàn bộ.

## Objective — Phần 3: Fix mất dữ liệu "kế hoạch đặt cược" khi cache hit (Hướng A)

Khi cache 30 phút HIT (`loadRecentSnapshotsByGameIds` trong `src/betting/odds-runner.ts::runOddsCheck()`), message dùng `formatCachedAnalysisMessage()` (`src/betting/odds-text-format.ts` dòng 701-762) — chỉ dựng lại được **phân tích từng trận riêng lẻ** (lưu trong bảng `betting_analysis_snapshots`, schema 1-row-per-game). Phần **"KẾ HOẠCH ĐẶT CƯỢC"** — gợi ý ghép xiên (parlay) kết hợp NHIỀU trận + kèo đơn còn lại (`CombinedAnalysisPlan.parlays` / `remainingSingles`, `src/betting/betting-types.ts` dòng 88-93) — là dữ liệu **cấp toàn batch**, chưa từng được lưu ở đâu, nên biến mất hoàn toàn khi dùng cache. Luồng fresh (không cache) hiển thị đầy đủ qua `formatBettingPlanMessage(plan)` (`odds-text-format.ts` dòng 614+), ghép vào `fullMessage` tại `odds-runner.ts` dòng 159-170 — luồng cache hiện KHÔNG có phần tương đương.

## Bối cảnh cần đọc trước khi sửa

1. `src/betting/betting-gemini.ts` dòng 19-27 — pattern đọc env hiện có (`AI_TEXT_MODEL`, `parsePositiveEnv(...)`), tái sử dụng đúng style.
2. `src/shared/openrouter.ts` dòng 15-16 — union type hợp lệ cho `effort`.
3. `src/charts/analyzer.ts`, `src/charts/position-decision.ts`, `src/charts/check-pending-orders-runner.ts` — xác nhận model dùng (`AI_VISION_MODEL`, default `xiaomi/mimo-v2.5`) và cấu trúc `callOpenRouter(...)` hiện tại ở mỗi nơi, để thêm `reasoning` vào đúng chỗ mà không phá vỡ request khác (`maxTokens`, `temperature`, `responseFormat`).
4. `src/betting/betting-types.ts` — `CombinedAnalysisPlan` (dòng 88-93) vs `MatchAiAnalysis` (dòng 9-29) — phân biệt rõ dữ liệu cấp-batch (plan) và cấp-từng-trận (snapshot).
5. `src/betting/betting-analysis-repository.ts` — pattern `saveBettingAnalysisSnapshot`/`loadRecentSnapshotsByGameIds` đã có, và bug `created_at` đã fix ở [tasks/fix-betting-cache-created-at-bug/task.md](../fix-betting-cache-created-at-bug/task.md) — bảng/hàm mới cho plan cache PHẢI áp dụng đúng bài học đó (luôn refresh `created_at` mỗi lần lưu, kể cả khi upsert đè lên row cũ).
6. `src/betting/odds-runner.ts::runOddsCheck()` — luồng fresh (dòng 143-173) và luồng cache (dòng 127-141) — cần sửa cả 2 để lưu/đọc plan cache đúng lúc.
7. `src/betting/odds-text-format.ts::formatBettingPlanMessage()` (dòng 614+) — hàm format sẵn có, TÁI SỬ DỤNG để hiển thị plan dù lấy từ cache hay từ AI mới — không viết hàm format mới.

## Instructions

### Phần 1+2: 1 biến env `AI_REASONING_EFFORT` dùng chung

1. Tạo helper DÙNG CHUNG trong `src/shared/ai-env.ts` (file mới), KHÔNG lặp lại logic này riêng ở từng module:
   ```ts
   const VALID_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
   export type ReasoningEffort = (typeof VALID_EFFORTS)[number];

   /** Đọc 1 biến env chung AI_REASONING_EFFORT, dùng cho mọi request AI có reasoning (betting + chart). */
   export function getConfiguredReasoningEffort(fallback: ReasoningEffort): ReasoningEffort {
     const raw = process.env.AI_REASONING_EFFORT?.trim();
     if (!raw) return fallback;
     if ((VALID_EFFORTS as readonly string[]).includes(raw)) return raw as ReasoningEffort;
     return fallback; // giá trị không hợp lệ → coi như không set, dùng fallback của nơi gọi
   }
   ```
   Vì đây là 1 biến DÙNG CHUNG cho nhiều nơi có default khác nhau tuỳ nhu cầu (betting cần default nặng hơn chart), hàm nhận `fallback` làm tham số thay vì hardcode 1 default chung — mỗi nơi gọi tự truyền fallback phù hợp với chính nó khi KHÔNG set `AI_REASONING_EFFORT`. Khi CÓ set, toàn bộ 5 nơi đều dùng chung đúng 1 giá trị đó (đây là ý nghĩa "1 biến env cho tất cả" — set 1 lần, áp dụng toàn hệ thống, không set thì mỗi nơi giữ hành vi mặc định cũ của riêng nó).
   Nếu giá trị set không hợp lệ, log 1 lần cảnh báo ở nơi gọi đầu tiên đọc được (hoặc chấp nhận không log nếu việc thêm log riêng ở 5 nơi gây trùng lặp — ưu tiên đơn giản, có thể bỏ qua log nếu thấy phức tạp không cần thiết).

2. **Betting** (`src/betting/betting-gemini.ts`):
   - `generateBettingPlan()`: thay `reasoning: { effort: "medium" }` bằng `reasoning: { effort: getConfiguredReasoningEffort("medium") }`.
   - `generateCombinedAnalysis()`: thay `reasoning: { effort: "medium" }` bằng `reasoning: { effort: getConfiguredReasoningEffort("medium") }`.
   - `buildAnalyzeMatchOddsRequest()` (dòng 606, hiện `{ effort: "none", exclude: true }`): CHỈ đổi sang dùng biến chung nếu xác nhận hàm này còn được gọi thật trong luồng production (kiểm tra lại — theo review trước, `analyzeMatchOdds`/`generateBettingPlan` có thể không được gọi ở đâu khác ngoài chính file này, chỉ `generateCombinedAnalysis` được `odds-runner.ts` dùng thật). Nếu không dùng thật, ghi rõ vào `result.md`, không bắt buộc sửa, không xoá code.
   - **KHÔNG đổi default hiện tại (`"medium"`)** khi không set `AI_REASONING_EFFORT` — chỉ thêm khả năng cấu hình, không gây thay đổi hành vi bất ngờ.
   - Cập nhật `tests/betting/betting-gemini.test.ts` cho khớp cách đọc mới (mock `process.env.AI_REASONING_EFFORT` để test cấu hình hoạt động đúng, và test case không set env vẫn ra default `"medium"` như cũ).

3. **Chart** (`src/charts/analyzer.ts`, `src/charts/position-decision.ts`, `src/charts/check-pending-orders-runner.ts`):
   - Cả 3 nơi hiện chưa có `reasoning` — thêm `reasoning: { effort: getConfiguredReasoningEffort(<default riêng>) }` vào `callOpenRouter({...})` ở cả 3, không đổi field khác (`maxTokens`, `temperature`, `responseFormat`, `model`).
   - Default riêng cho chart (khi không set `AI_REASONING_EFFORT`): model vision hiện dùng `xiaomi/mimo-v2.5` (`AI_VISION_MODEL`) — không phải model reasoning nặng như DeepSeek bên betting, nên chọn default thấp hơn, ví dụ `"low"` hoặc `"none"`, để tránh tăng chi phí/độ trễ không cần thiết. Xác nhận trước model này có hỗ trợ `reasoning.effort` hay không (đọc tài liệu OpenRouter hoặc gọi thử) — nếu API bỏ qua field không hỗ trợ một cách an toàn (không lỗi), việc thêm field không rủi ro dù model không dùng tới.
   - Vì đây là biến env DÙNG CHUNG, khi người dùng set `AI_REASONING_EFFORT=high` chẳng hạn, cả 2 khu vực (betting VÀ chart) đều tăng effort cùng lúc — đây là hành vi ĐÚNG Ý theo yêu cầu (1 biến điều khiển tất cả), không phải bug.

### Phần 3: Plan cache (Hướng A)

1. Tạo migration `supabase/migrations/<timestamp>_betting_plan_cache.sql`:
   ```sql
   create table if not exists public.betting_plan_cache (
     date text primary key,
     game_ids text[] not null,
     plan jsonb not null,
     created_at timestamptz not null default now()
   );
   ```
   Nếu thấy cần chính xác hơn (tránh nhầm giữa các batch khác tập trận trong cùng ngày), cân nhắc thêm cột hash của `game_ids` đã sort làm 1 phần khoá thay vì chỉ `date` — quyết định dựa trên việc `runOddsCheck()` có luôn xử lý đúng 1 tập trận cố định trong ngày hay có thể thay đổi giữa các lần chạy (đọc `pickNearestUpcomingDateMatches`/`loadUpcomingMatches` để xác nhận).

2. Thêm trong `betting-analysis-repository.ts` (hoặc file mới `betting-plan-cache-repository.ts`):
   ```ts
   export async function savePlanCache(date: string, gameIds: string[], plan: CombinedAnalysisPlan): Promise<void> {
     // upsert theo date (hoặc date+hash gameIds), LUÔN kèm created_at: new Date().toISOString()
   }

   export async function loadRecentPlanCache(gameIds: string[], withinMs: number): Promise<CombinedAnalysisPlan | null> {
     // đọc theo date hiện tại (hoặc theo gameIds nếu dùng hash) + gte created_at
     // so sánh game_ids đã lưu với gameIds đang cần — nếu không khớp (tập trận đổi khác), coi như cache miss, trả null
     // lỗi DB → trả null, không throw
   }
   ```

3. Sửa `runOddsCheck()` (`odds-runner.ts`):
   - Khi cache hit (đủ snapshot cho tất cả gameIds): gọi thêm `loadRecentPlanCache(gameIds, 30 * 60 * 1000)`. Nếu có plan cache hợp lệ → ghép `formatCachedAnalysisMessage(...)` với `formatBettingPlanMessage(cachedPlan)` thành 1 message đầy đủ tương đương luồng fresh (tham khảo cách `fullMessage` được ghép ở luồng fresh, dòng 159-170). Nếu KHÔNG có plan cache (dữ liệu cũ trước khi có bảng này, hoặc game_ids không khớp) → vẫn gửi được phần phân tích từng trận, nhưng thêm 1 dòng chú thích ngắn gọn báo thiếu phần kèo ghép, TRÁNH im lặng thiếu dữ liệu mà không báo.
   - Khi cache miss (gọi AI lại, có `plan` mới): sau `saveCombinedAnalysisSnapshots(payload, plan)`, gọi thêm `savePlanCache(target.dateStr hoặc ngày phù hợp, gameIds, plan)` (xác định đúng biến ngày đang dùng trong hàm — có thể cần lấy từ `vnDateStr()` giống cách `saveCombinedAnalysisSnapshots` đang làm).

## Acceptance Criteria

- [ ] `npm run build` pass.
- [ ] Test cho `getConfiguredReasoningEffort()` (trong `src/shared/ai-env.ts`): giá trị hợp lệ dùng đúng; giá trị không hợp lệ → dùng fallback truyền vào; không set `AI_REASONING_EFFORT` → dùng fallback.
- [ ] Test xác nhận `generateBettingPlan`/`generateCombinedAnalysis` dùng đúng effort đọc từ `AI_REASONING_EFFORT` (mock `process.env.AI_REASONING_EFFORT`), và khi không set vẫn giữ default `"medium"` như cũ.
- [ ] Test xác nhận `analyzeWithOpenRouter`/`decidePosition`/`reviewPendingOrder` đều đọc CÙNG 1 biến `AI_REASONING_EFFORT` (set 1 lần trong test, xác nhận cả 3 nơi phản ánh đúng giá trị đó) — khẳng định rõ đây là 1 biến dùng chung, không phải 3 biến độc lập.
- [ ] Test cho `savePlanCache`/`loadRecentPlanCache`: lưu/đọc đúng `plan`; `created_at` refresh mỗi lần lưu; trả `null` khi lỗi DB, khi hết hạn `withinMs`, hoặc khi `game_ids` không khớp tập đang cần.
- [ ] Test cho `runOddsCheck()`: cache hit đầy đủ (snapshot + plan cache) → message gửi đi CÓ phần kèo ghép/kèo đơn tương đương luồng fresh; cache hit thiếu plan cache → vẫn gửi được phân tích từng trận kèm chú thích thiếu; cache miss → lưu cả snapshot lẫn plan cache mới.
- [ ] `npm test -- --runInBand` pass toàn bộ, không phá vỡ test hiện có (đặc biệt `tests/betting/odds-runner.test.ts`, `tests/betting/betting-analysis-repository.test.ts`).

## Files to Touch

- `src/betting/betting-gemini.ts` — dùng `getConfiguredReasoningEffort()` cho betting.
- `src/charts/analyzer.ts`, `src/charts/position-decision.ts`, `src/charts/check-pending-orders-runner.ts` — dùng `getConfiguredReasoningEffort()` cho chart.
- `src/shared/ai-env.ts` (mới, BẮT BUỘC — không tách riêng theo module) — helper `getConfiguredReasoningEffort()` đọc 1 biến `AI_REASONING_EFFORT` duy nhất.
- `tests/betting/betting-gemini.test.ts` — cập nhật test effort.
- `tests/charts/analyzer.test.ts`, test tương ứng cho `position-decision.ts`/`check-pending-orders-runner.ts` (kiểm tra file test đã tồn tại chưa trước khi tạo mới).
- `src/betting/betting-analysis-repository.ts` hoặc `betting-plan-cache-repository.ts` (mới) — save/load plan cache.
- `supabase/migrations/<timestamp>_betting_plan_cache.sql` — mới.
- `src/betting/odds-runner.ts` — dùng plan cache trong `runOddsCheck()`.
- `tests/betting/odds-runner.test.ts` — thêm test case plan cache.
