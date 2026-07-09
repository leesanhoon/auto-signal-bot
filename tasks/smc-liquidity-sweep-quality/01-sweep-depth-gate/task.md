# Task 01: Minimum Sweep Depth Gate

**Đọc trước:** [`../plan.md`](../plan.md) — bắt buộc, chứa bối cảnh backtest và ràng buộc chung.

## Mục tiêu

`detectLiquiditySweep` hiện coi bất kỳ overshoot nào qua swing HIGH/LOW là sweep hợp lệ, kể cả khi chỉ vượt 1 tick. Với swing window nhỏ (`left=2, right=2`), phần lớn "sweep" phát hiện được thực chất là nhiễu giá bình thường, không phải cú quét thanh khoản thật. Cần thêm ngưỡng độ sâu tối thiểu (tính theo ATR cục bộ) **tại call site trong pipeline**, không sửa hàm detect gốc.

## Vị trí cần sửa

`src/charts/smc/smc-pipeline.ts`, trong `buildSmcCandidatesAtIndex`, đoạn xử lý sweep (khoảng dòng 284-323):

```ts
const sweep = detectLiquiditySweep(scopedCandles, swings, index);
if (sweep) {
  const direction = sweep.direction;
  const entry = scopedCandles[index].close;
  const sessionAdjusted = applySessionPenalty(
    detectSession(scopedCandles[index].time),
    68,
    68,
    ["Liquidity sweep và reclaim xác nhận hướng giao dịch."],
  );
  const atrProxy = calculateLocalAtr(scopedCandles, index);
  ...
```

## Việc cần làm

1. Tính "độ sâu sweep" (khoảng cách wick vượt qua swing level):
   - SHORT: `sweepDepth = candle.high - sweep.sweptLevel` (candle ở đây là `scopedCandles[index]`).
   - LONG: `sweepDepth = sweep.sweptLevel - candle.low`.
2. Tính `atrProxy = calculateLocalAtr(scopedCandles, index)` — **di chuyển dòng này lên trước** (nó đã tồn tại sẵn trong code, hiện đang được tính sau `sessionAdjusted`; chỉ cần đổi thứ tự để dùng được cho gate trước khi build signal, không đổi cách tính).
3. Thêm điều kiện: nếu `atrProxy > 0` và `sweepDepth < atrProxy * 0.1` (ngưỡng tối thiểu 10% ATR) → coi là sweep quá nông, **không push vào candidates** (return sớm khỏi khối xử lý sweep, tương tự cách các khối khác dùng `if (fvg) { ... }` — dùng `if (sweep) { ... }` bọc toàn bộ logic hiện tại, chỉ thêm điều kiện lồng bên trong để bỏ qua khi quá nông, không tạo signal).
   - Nếu `atrProxy <= 0` (không tính được ATR, ví dụ không đủ dữ liệu) → **không loại**, giữ hành vi cũ (không đủ thông tin để đánh giá độ sâu thì không nên chặn cứng).
4. Không đổi ngưỡng confidence 68 mặc định hay session penalty — subtask này chỉ quyết định có tạo signal hay không, không đổi cách tính điểm.
5. Ghi chú: hệ số `0.1` (10% ATR) là ngưỡng khởi điểm hợp lý dựa trên review, **không tự ý đổi số khác**. Nếu sau khi implement thấy cần điều chỉnh (ví dụ dựa trên test case cụ thể không match), ghi rõ trong `result.md` để Lead xem xét, không tự quyết.

## Việc KHÔNG được làm

- Không sửa `detectLiquiditySweep` trong `smc-structure.ts` — hàm này giữ nguyên, chỉ detect "có sweep hay không" thuần tuý.
- Không đổi 2 setup còn lại (BOS/CHOCH+OB, FVG Continuation).
- Không đổi công thức `calculateLocalAtr`.
- Không đổi confidence/grade/score mặc định của setup Sweep khi sweep đủ sâu (giữ nguyên 68/B như cũ, chỉ session penalty áp dụng như hiện tại).

## Test cần thêm/sửa

Trong `tests/charts/smc/smc-pipeline.test.ts`:
1. Dựng dữ liệu nến sao cho `detectLiquiditySweep` trả về sweep với `sweepDepth` **lớn hơn** `atrProxy * 0.1` → assert signal `SMC_LIQUIDITY_SWEEP` vẫn xuất hiện trong candidates, confidence như cũ (68, trừ session penalty nếu áp dụng).
2. Dựng dữ liệu nến sao cho sweep có `sweepDepth` **nhỏ hơn** `atrProxy * 0.1` (mock `detectLiquiditySweep` trả về sweep với `sweptLevel` rất sát `candle.high`/`candle.low`) → assert **không có** signal `SMC_LIQUIDITY_SWEEP` nào trong candidates (dùng `analyzeSmcSignalsAtIndex`, filter theo setup, assert mảng rỗng hoặc undefined).
3. Case `atrProxy` không tính được (ví dụ đủ ít candle để `calculateLocalAtr` trả về 0) → assert vẫn giữ hành vi cũ (không bị loại vì lý do "quá nông").

## Acceptance Criteria

- `npm run build` pass.
- `npm test` pass, không giảm số test hiện có.
- Sweep quá nông (< 10% ATR) không bao giờ tạo ra signal `SMC_LIQUIDITY_SWEEP` (verify bằng test).
- Sweep đủ sâu vẫn hoạt động y hệt hành vi cũ (không đổi confidence/grade/score cho case hợp lệ).

## Kết quả cần ghi vào `result.md`

- Đoạn code trước–sau.
- Test case đã thêm, giải thích từng case.
- Output `npm run build` và `npm test` (số test pass trước/sau).
- Nếu bị chặn hoặc thấy ngưỡng 10% ATR không hợp lý khi test thực tế → ghi rõ trong `result.md`, không tự ý đổi số.
