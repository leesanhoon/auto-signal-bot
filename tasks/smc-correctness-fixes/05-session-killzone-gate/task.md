# Task 05: Gate Confidence by Session/Killzone

**Đọc trước:** [`../plan.md`](../plan.md) — bắt buộc. **Chạy sau khi subtask 04 đã approved.**

## Mục tiêu

Nhiều trader SMC coi killzone (London / London-NY overlap) là điều kiện chất lượng cho entry — thanh khoản thấp ngoài giờ (Asia sớm, off-hours) dễ tạo tín hiệu giả. Hiện tại `detectSession` đã được gọi cho cả 3 setup (dòng ~193, ~230, ~266 trong `smc-pipeline.ts`) và gắn `session`/`sessionLabel` vào signal, nhưng không ảnh hưởng gì đến confidence/score.

## Vị trí cần sửa

`src/charts/smc/smc-pipeline.ts`, cả 3 nơi dùng `...detectSession(scopedCandles[index].time)` trong `buildSmcCandidatesAtIndex` (BOS/CHOCH+OB, Liquidity Sweep, FVG Continuation).

`detectSession` (trong `smc-session.ts`, KHÔNG được sửa file này) trả về 5 giá trị `session`: `"ASIA"`, `"LONDON"`, `"LONDON_NY_OVERLAP"`, `"NEWYORK"`, `"OFF_HOURS"`.

## Việc cần làm

1. Viết một hàm nhỏ (private, trong `smc-pipeline.ts`) `sessionConfidencePenalty(session: string): number` trả về:
   - `"LONDON"` hoặc `"LONDON_NY_OVERLAP"` → `0` (killzone chính, không phạt).
   - `"NEWYORK"` → `0` (vẫn là phiên chính, không phạt).
   - `"ASIA"` → `-5`.
   - `"OFF_HOURS"` → `-10`.
2. Sau khi tính `confidence`/`score` cuối cùng cho mỗi setup (BOS/CHOCH+OB, Liquidity Sweep, FVG Continuation) — tức là SAU khi đã áp dụng các điều chỉnh của subtask 03 (premium/discount) cho setup OB — cộng thêm penalty từ `sessionConfidencePenalty` vào cả `confidence` và `score`, dùng `Math.max(0, ...)` để không âm.
3. Grade tính lại bằng `gradeFromScore(score)` sau khi áp dụng penalty (áp dụng cho cả 3 setup, không chỉ setup OB).
4. Thêm dòng vào `ruleTrace` khi có penalty áp dụng, ví dụ: `"Session {sessionLabel}: thanh khoản thấp, đã hạ điểm {penalty}."` Khi penalty = 0, không cần thêm dòng.
5. Áp dụng đồng nhất cho **cả 3 setup** (khác với subtask 03 chỉ áp dụng setup OB) — vì session là yếu tố chung, không phụ thuộc loại setup.

## Việc KHÔNG được làm

- Không đổi `smc-session.ts` / `detectSession`.
- Không loại bỏ hoàn toàn setup ở session xấu (chỉ hạ điểm, tương tự nguyên tắc ở subtask 03 — để tầng confluence/tổng hợp tự quyết định cuối).
- Không đổi thứ tự áp dụng: penalty session phải là bước **cuối cùng** sau khi đã có confidence/score từ setup gốc + điều chỉnh premium/discount (nếu có, cho setup OB) — không áp dụng trước rồi bị override bởi bước khác.

## Test cần thêm/sửa

Trong `tests/charts/smc/smc-pipeline.test.ts`:
1. Dựng dữ liệu nến với `time` rơi vào giờ UTC thuộc `OFF_HOURS` (ví dụ 22h-23h UTC) cho một setup bất kỳ (ví dụ Liquidity Sweep) → assert confidence/score bị trừ đúng 10 so với giá trị gốc không có session penalty, grade tính lại đúng.
2. Dựng dữ liệu nến rơi vào `LONDON_NY_OVERLAP` (12h-16h UTC) → assert confidence/score KHÔNG bị trừ (giữ nguyên giá trị gốc).
3. Case `ASIA` (0h-7h UTC) → assert trừ đúng 5 điểm.
4. Rà soát test case cũ đang hard-code giá trị confidence cụ thể (ví dụ 80, 68, 74) — kiểm tra `time` của dữ liệu test đó rơi vào session nào; nếu rơi vào ASIA/OFF_HOURS sẽ bị lệch assertion, cần cập nhật lại `time` trong fixture để rơi vào LONDON/NY (penalty = 0) để giữ các assertion cũ không đổi, TRỪ những test case cố ý test session penalty ở bước 1-3. Ghi rõ trong `result.md` case nào đã chỉnh `time` và vì sao.

## Acceptance Criteria

- `npm run build` pass.
- `npm test` pass, không giảm số test.
- Setup phát sinh ở OFF_HOURS luôn có confidence thấp hơn cùng setup đó phát sinh ở LONDON/NY overlap (verify bằng test).

## Kết quả cần ghi vào `result.md`

- Đoạn code trước–sau.
- Test case đã thêm/sửa, giải thích từng case.
- Danh sách test case cũ phải chỉnh `time` fixture do ảnh hưởng bởi penalty mới.
- Output build/test.
- Nếu bị chặn → ghi `blocked.md`.
