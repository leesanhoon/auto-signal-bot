# Task 01: Xoá setup SMC_LIQUIDITY_SWEEP khỏi pipeline

**Đọc trước:** [`../plan.md`](../plan.md) — bắt buộc.

## Mục tiêu

Xoá đoạn code trong `src/charts/smc/smc-pipeline.ts` biến kết quả `detectLiquiditySweep` thành 1 `CandidateSource`/`SmcSignal` giao dịch được — để setup này không bao giờ còn xuất hiện trong output của `analyzeSmcWindow`/`analyzeSmcSignalsAtIndex`/`analyzeAllChartsSmc`.

## Vị trí cần sửa

### 1. `src/charts/smc/smc-pipeline.ts`

**a. Xoá import không còn dùng** (đầu file, trong khối import từ `./smc-structure.js`):

```ts
import {
  detectFairValueGap,
  detectLiquiditySweep,   // <-- xoá dòng này
  detectStructureBreak,
  findRecentOrderBlock,
  findSwingPoints,
} from "./smc-structure.js";
```

**b. Xoá helper `createEntryZone`** (chỉ dùng riêng cho khối sweep, không còn nơi nào dùng sau khi xoá khối sweep — kiểm tra lại bằng grep sau khi xoá khối sweep để chắc chắn không còn lời gọi nào trước khi xoá hàm):

```ts
function createEntryZone(entry: number, atr: number): { low: number; high: number } {
  const padding = Math.max(atr * 0.12, Math.abs(entry) * 0.00002, 0.0001);
  return { low: entry - padding, high: entry + padding };
}
```

**c. Xoá toàn bộ khối xử lý Sweep trong `buildSmcCandidatesAtIndex`** — khối bắt đầu từ `const sweep = detectLiquiditySweep(scopedCandles, swings, index);` cho đến dấu đóng ngoặc `}` khớp với `if (sweep) {`, nằm giữa khối xử lý OB (kết thúc trước đó) và khối xử lý FVG (`const fvg = detectFairValueGap(...)` bắt đầu sau đó). Xoá **toàn bộ khối này**, bao gồm:
   - Tính `direction`, `entry`, `atrProxy`, `sweepDepth`, `isSweepTooShallow`.
   - Gate `isAgainstHtfBias` lồng bên trong.
   - Tính `rejection`, `rvol`, `hasConfirmation`, `baseConfidence`, `confirmationTrace`.
   - `sessionAdjusted`, `stopBuffer`, `entryZone`, `stopLoss`, `risk`, `takeProfit1`, `takeProfit2`.
   - `buildSignal(...)` gọi với `"SMC_LIQUIDITY_SWEEP"`.
   - `candidates.push(...)`.

   **Cẩn thận**: đọc kỹ ranh giới `{`/`}` trước khi xoá — khối OB kết thúc bằng 2 dấu `}` đóng (đóng `if (!isAgainstHtfBias...)` rồi đóng `if (ob) {`), sau đó có 1 dòng trống, rồi mới đến `const sweep = ...`. Khối Sweep kết thúc bằng đóng `if (!isAgainstHtfBias(...))`, đóng `if (!isSweepTooShallow)`, đóng `if (sweep) {` — 3 dấu `}` liên tiếp — rồi mới đến dòng trống và `const fvg = detectFairValueGap(...)`. Chỉ xoá đúng đoạn ở giữa 2 mốc này, không đụng vào code OB phía trước hay FVG phía sau.

**d. Sau khi xoá, chạy `npm run build`** — nếu còn cảnh báo unused variable/import nào khác liên quan (ví dụ `SmcDirection` hay type nào chỉ dùng cho sweep — thường không có vì các type này dùng chung), xử lý dứt điểm.

### 2. `tests/charts/smc/smc-pipeline.test.ts`

**a. Xoá các test case sau** (không còn ý nghĩa vì setup không tồn tại nữa):
- `"Liquidity sweep in OFF_HOURS is penalized by 10 points"`
- `"Liquidity sweep keeps prior behavior when sweep depth exceeds 10% ATR"`
- `"Liquidity sweep is skipped when sweep depth is shallower than 10% ATR"`
- `"Liquidity sweep is not blocked by depth gate when ATR proxy is unavailable"`
- `"Liquidity sweep in ASIA is penalized by 5 points"`
- `"Liquidity sweep in LONDON_NY_OVERLAP keeps base confidence with no session penalty"`
- `"Liquidity sweep has increased confidence when rejection wick and high RVOL both confirmed"`
- `"Liquidity sweep without rejection wick keeps lower confidence"`
- `"Liquidity sweep with rejection wick but low RVOL keeps lower confidence"`
- `"FVG signal is not lost when shallow sweep is present at same index"` (test này verify tương tác với sweep-depth-gate đã xoá — không còn áp dụng được)
- `"Liquidity sweep SHORT is blocked when HTF bias is LONG (directional gate)"`
- `"Combined: Sweep SHORT blocked by LONG bias, but FVG LONG allowed at same index when cùng hướng"` (test này verify không lặp bug `return` liên quan đến sweep gate đã xoá — không còn áp dụng được vì khối sweep không còn tồn tại để gây bug đó)

**b. Xoá mock plumbing không còn dùng** (kiểm tra bằng grep `detectLiquiditySweep` trong file — nếu sau khi xoá 12 test trên không còn chỗ nào tham chiếu, xoá luôn):
- `detectLiquiditySweep: vi.fn()` trong object `mocks` (đầu file).
- `detectLiquiditySweep: mocks.detectLiquiditySweep,` trong factory `vi.mock("../../../src/charts/smc/smc-structure.js", ...)`.
- `mocks.detectLiquiditySweep.mockReturnValue(null);` trong `beforeEach`.

**c. Thêm 1 test mới xác nhận hành vi tắt hẳn**: dựng dữ liệu/mock sao cho `detectLiquiditySweep` (nếu còn import được từ module thật, không qua mock) hoặc dữ liệu nến thực tế có sweep hợp lệ — gọi `analyzeSmcSignalsAtIndex`/`analyzeSmcWindow` và assert **không bao giờ** có signal nào với `setup === "SMC_LIQUIDITY_SWEEP"` trong kết quả, dù dữ liệu đầu vào có pattern sweep rõ ràng. (Nếu đã xoá hết mock `detectLiquiditySweep` ở bước b, test này chỉ cần assert đơn giản: `signals.every(s => s.setup !== "SMC_LIQUIDITY_SWEEP")` trên bất kỳ tập test case nào hiện có — không cần dựng riêng.)

**d. Rà soát các test còn lại** không thuộc nhóm sweep (OB, FVG, HTF gate, combined test khác nếu có) — xác nhận vẫn pass nguyên trạng, không có test nào ngầm phụ thuộc vào việc setup Sweep tồn tại (ví dụ đếm số lượng candidates cụ thể mà trước đây có tính cả sweep).

## Việc KHÔNG được làm

- Không sửa `smc-structure.ts`, `tests/charts/smc/smc-structure.test.ts` — `detectLiquiditySweep` vẫn giữ nguyên, chỉ không được gọi từ pipeline nữa.
- Không sửa `smc-types.ts`, `smc-signal-assembly.ts`, `smc-backtest.ts`, `smc-liquidity-context.ts`, `smc-session.ts`, `smc-confluence.ts`, `smc-htf-context.ts`.
- Không thêm feature flag/env var để bật/tắt setup — xoá thẳng code theo đúng quyết định trong `plan.md`.
- Không đổi logic setup OB/FVG.

## Acceptance Criteria

- `npm run build` pass, không có unused import/variable nào còn sót (kiểm tra bằng đọc lại toàn bộ file sau khi xoá, không chỉ tin tsc — tsc mặc định không luôn báo unused local trừ khi bật `noUnusedLocals`, phải tự rà soát).
- `npm test` pass. Số test giảm đúng bằng số test đã xoá ở mục 2a (liệt kê rõ trong `result.md`), không giảm/tăng ngoài dự kiến.
- Grep `"SMC_LIQUIDITY_SWEEP"` và `detectLiquiditySweep` trong `smc-pipeline.ts` sau khi sửa → không còn kết quả nào (đã xoá sạch khỏi file này).
- Test mới (mục 2c) pass, xác nhận không bao giờ có signal Sweep.

## Kết quả cần ghi vào `result.md`

- Đoạn code đã xoá (trước/sau).
- Danh sách chính xác test case đã xoá, kèm lý do (không còn áp dụng được).
- Test mới đã thêm.
- Output `npm run build` và `npm test` (số test trước/sau, chênh lệch đúng bằng số xoá).
- Nếu bị chặn (ví dụ phát hiện `createEntryZone` vẫn còn dùng ở đâu đó ngoài dự kiến) → ghi rõ trong `result.md`, không tự ý giữ lại code chết mà không báo cáo.
