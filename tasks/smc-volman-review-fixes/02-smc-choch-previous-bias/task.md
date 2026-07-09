# Task 02 — SMC: truyền `previousBias` để CHOCH hoạt động

**Vấn đề:** `src/charts/smc/smc-pipeline.ts:175` gọi `detectStructureBreak(scopedCandles, swings, index)` KHÔNG truyền tham số thứ 4 `previousBias`. Trong `src/charts/smc/smc-structure.ts:82-142`, khi `previousBias` undefined thì `kind` luôn là `"BOS"` → setup `SMC_CHOCH_OB` (confidence base 72) là dead code, mọi cú đảo chiều bị gắn nhãn `SMC_BOS_OB` (confidence base 80).

**Mục tiêu:** Tính bias trước đó từ chính LTF candles và truyền vào, để break ngược bias được phân loại CHOCH.

**KHÔNG làm:** không sửa `detectStructureBreak`, không sửa đường FVG (dòng ~288-335), không đổi công thức confidence.

## Bước 1 — Tính previousBias trong `buildSmcCandidatesAtIndex`

File `src/charts/smc/smc-pipeline.ts`, trong hàm `buildSmcCandidatesAtIndex` (dòng ~162), trước lời gọi `detectStructureBreak` ở dòng ~175:

- Import `detectTimeframeBias` từ `./smc-confluence.js` (hàm đã tồn tại ở `src/charts/smc/smc-confluence.ts:12`, signature `detectTimeframeBias(candles: Candle[], lookback = 30): SmcDirection | null`).
- Tính bias từ các nến TRƯỚC nến hiện tại (tránh dùng chính nến break):

```ts
const priorCandles = scopedCandles.slice(0, index); // exclude candle at `index`
const previousBias = detectTimeframeBias(priorCandles) ?? undefined;
```

- Đổi dòng ~175 thành:

```ts
const structure = detectStructureBreak(scopedCandles, swings, index, previousBias);
```

Lưu ý hiệu năng: `detectTimeframeBias` tự gọi `findSwingPoints` bên trong — chấp nhận trong scope này, không tối ưu.

## Bước 2 — Tests

File test SMC nằm dưới `tests/charts/smc/`. Thêm test cho pipeline (file mới hoặc file pipeline test hiện có):

1. **CHOCH được tạo:** dựng chuỗi nến downtrend rõ (các structure break SHORT trong 30 nến trước), sau đó nến cuối đóng cửa vượt swing high gần nhất + có nến bearish trước đó làm order block → `analyzeSmcSignalsAtIndex` trả signal với `setup === "SMC_CHOCH_OB"` và `structureEvent.kind === "CHOCH"`.
2. **BOS giữ nguyên:** chuỗi nến uptrend, break tiếp swing high cùng chiều → setup `SMC_BOS_OB`, `kind === "BOS"`.
3. Confidence: case CHOCH có base 72 (thấp hơn BOS 80) — assert `confidence`/`score` phản ánh đúng (nhớ trừ session penalty nếu thời gian nến rơi vào ASIA/OFF_HOURS; chọn `time` của nến trong khung LONDON 07-12 UTC để penalty = 0).

Có thể tham khảo cách các test SMC hiện có dựng candles giả (xem `tests/charts/smc/`).

## Verification

```bash
npm run build
npm run test
```

Ghi kết quả vào `tasks/smc-volman-review-fixes/02-smc-choch-previous-bias/result.md`. Nếu blocked → `blocked.md`.
