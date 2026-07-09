# Task 04: Use Liquidity Pool Targets for Take-Profit

**Đọc trước:** [`../plan.md`](../plan.md) — bắt buộc. **Chạy sau khi subtask 03 đã approved.**

## Mục tiêu

Chuẩn SMC: TP nên nhắm vào liquidity pool thực tế gần nhất theo đúng hướng (equal highs/lows, prior day/week high/low), không phải chỉ bội số R cố định. Hiện tại `liquidityTargets` (equal levels, prior week high/low) được tính và gắn vào signal (setup BOS/CHOCH+OB, dòng ~148-166 trong `smc-pipeline.ts`) nhưng TP1/TP2 thực tế vẫn luôn là `entry ± risk*2` / `entry ± risk*3`, hoàn toàn không dùng các target này.

## Vị trí cần sửa

`src/charts/smc/smc-pipeline.ts`, đoạn xử lý BOS/CHOCH+OB (khoảng dòng 134-198), sau khi đã tính `liquidityTargets`:

```ts
const liquidityTargets: SmcSignal["liquidityTargets"] = [];
if (matchingEqualLevel) { liquidityTargets.push({ label: matchingEqualLevel.kind, price: matchingEqualLevel.price, target: "TP2" }); }
if (priorWeekLevel !== null) { liquidityTargets.push({ label: ..., price: priorWeekLevel, target: "TP3" }); }
```

## Việc cần làm

1. Sau khi có `takeProfit1`, `takeProfit2` mặc định (2R/3R) và `liquidityTargets`, kiểm tra target có `target: "TP2"` (equal level) trong `liquidityTargets`:
   - Điều kiện hợp lệ để override TP2: giá target phải nằm **đúng phía** theo hướng lệnh (LONG: `target.price > entry`; SHORT: `target.price < entry`) VÀ khoảng cách từ entry đến target phải **lớn hơn risk** (tức R/R > 1, để không đặt TP gần hơn SL/entry).
   - Nếu hợp lệ: gán `takeProfit2 = target.price` thay vì `entry ± risk*3`.
   - Nếu không hợp lệ (sai phía, hoặc quá gần): giữ nguyên `takeProfit2` mặc định (`entry ± risk*3`) — đây là fallback bắt buộc, không được để TP2 undefined hoặc NaN.
2. Tương tự cho target `target: "TP3"` (prior week level) — nếu hợp lệ theo cùng điều kiện phía + khoảng cách, set `takeProfit3 = target.price`. Nếu không hợp lệ, không set `takeProfit3` (giữ `undefined` như hành vi hiện tại — setup OB hiện không có TP3 mặc định).
3. **Không đổi `takeProfit1`** trong subtask này — TP1 luôn giữ 2R cố định (chốt lời sớm để bảo toàn vốn theo capital management hiện có, xem `buildCapitalManagement` trong `smc-signal-assembly.ts`).
4. Cập nhật `ruleTrace` khi TP2/TP3 bị override, ví dụ: `"TP2 điều chỉnh theo equal high/low tại {price} (thay vì 3R mặc định)."`.
5. Đảm bảo field `riskReward` trong `liquidityTargets` (được tính ở `smc-signal-assembly.ts:buildLiquidityTargets`/`calculateRiskReward`) không cần sửa — nó tự tính lại dựa trên `takeProfit2`/`takeProfit3` mới nếu áp dụng đúng, chỉ cần verify không bị lỗi (đọc code hiện tại trước khi kết luận có cần sửa hay không).

## Việc KHÔNG được làm

- Không đổi TP1.
- Không đổi setup Liquidity Sweep / FVG Continuation (chúng không có `liquidityTargets` tính sẵn — ngoài phạm vi).
- Không tự thêm loại liquidity target mới ngoài equal level (TP2) và prior week level (TP3) đã có sẵn.
- Không override TP nếu target nằm sai phía hoặc quá gần entry — phải luôn có fallback về giá trị R cố định.

## Test cần thêm/sửa

Trong `tests/charts/smc/smc-pipeline.test.ts`:
1. Dựng dữ liệu có equal level (EQH cho SHORT hoặc EQL cho LONG) nằm đúng phía và xa hơn risk → assert `takeProfit2` bằng đúng giá equal level, không phải `entry ± risk*3`.
2. Dựng dữ liệu có equal level nhưng nằm sai phía (hoặc quá gần entry, R/R ≤ 1) → assert `takeProfit2` fallback về `entry ± risk*3` như cũ.
3. Case không có `matchingEqualLevel` → assert hành vi giữ nguyên như hiện tại (không thay đổi).
4. Case có prior week level hợp lệ → assert `takeProfit3` được set đúng giá; case không hợp lệ → assert `takeProfit3` vẫn `undefined`.

## Acceptance Criteria

- `npm run build` pass.
- `npm test` pass, không giảm số test.
- Không có test case nào cho ra `takeProfit2 <= entry` (LONG) hoặc `takeProfit2 >= entry` (SHORT) — tức không bao giờ đặt TP sai phía.

## Kết quả cần ghi vào `result.md`

- Đoạn code trước–sau.
- Test case đã thêm, giải thích từng case (đặc biệt case fallback).
- Output build/test.
- Nếu bị chặn → ghi `blocked.md`.
