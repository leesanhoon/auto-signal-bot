# Task 04 — SMC: BOS/CHOCH chỉ fire tại nến break ĐẦU TIÊN

**Vấn đề:** `src/charts/smc/smc-structure.ts`, hàm `detectStructureBreak` (dòng 82-142) trả event cho MỌI nến có `close` vượt swing level gần nhất. Vì swing level chỉ được thay khi có swing mới (cần 2 nến xác nhận), một break xảy ra 10 nến trước vẫn bị detect lại ở từng nến sau đó nếu giá vẫn ngoài level → `analyzeSmcWindow` (quét 20 nến cuối) sinh candidate trùng lặp cho break cũ, signal trả về ở nến mới nhất có thể phản ánh break đã cũ.

**Mục tiêu:** chỉ trả event khi nến `breakIndex` là nến ĐẦU TIÊN đóng cửa vượt level (nến liền trước chưa vượt).

**KHÔNG làm:** không đổi cách chọn swing gần nhất, không đổi logic BOS/CHOCH classification, không đụng `detectLiquiditySweep` / `detectFairValueGap` / `findRecentOrderBlock`.

## Bước 1 — Sửa `detectStructureBreak` trong `src/charts/smc/smc-structure.ts`

Sau khi xác định `direction` và `level` (sau dòng ~127 `if (direction === null || level === null) return null;`), thêm điều kiện first-close-through:

```ts
  // Chỉ nhận break tại nến ĐẦU TIÊN đóng cửa vượt level — nến trước đó
  // còn đóng trong range thì đây mới là break mới, không phải break cũ kéo dài.
  if (breakIndex > 0) {
    const prevClose = candles[breakIndex - 1].close;
    const prevAlreadyBroken =
      direction === "LONG" ? prevClose > level : prevClose < level;
    if (prevAlreadyBroken) return null;
  }
```

Lưu ý edge case: nếu swing vừa được xác nhận ngay tại vùng break thì `breakIndex - 1` có thể chưa tồn tại swing đó — điều kiện trên vẫn đúng vì chỉ so close với level giá.

## Bước 2 — Tests

Test structure hiện có nằm dưới `tests/charts/smc/` (tìm file test cho `smc-structure`). Thêm:

1. Nến `i` đầu tiên đóng trên swing high → event trả về tại `i` (giữ hành vi cũ).
2. Nến `i+1` tiếp tục đóng trên level (close[i] đã > level) → `detectStructureBreak(candles, swings, i+1)` trả `null`.
3. Case SHORT tương ứng: nến thứ hai liên tiếp đóng dưới swing low → `null`.
4. Pullback rồi break lại: close[i] > level, close[i+1] < level (quay vào range), close[i+2] > level → event được trả tại `i+2`.

Có thể phải cập nhật test hiện có nếu chúng dựng chuỗi nến mà nhiều nến liên tiếp cùng vượt level và assert event ở nến sau — sửa fixture cho đúng hành vi mới, ghi rõ trong result.md test nào bị đổi và vì sao.

Cũng chạy lại backtest tests (`tests/charts/smc/` có test backtest nếu tồn tại) — hành vi này ảnh hưởng số lượng signal trong backtest, các assert đếm signal có thể cần cập nhật. KHÔNG nới lỏng assert vô nghĩa; cập nhật con số theo kết quả mới sau khi tự kiểm tra tính hợp lý.

## Verification

```bash
npm run build
npm run test
```

Ghi kết quả vào `tasks/smc-volman-review-fixes/04-smc-first-break-condition/result.md`. Nếu blocked → `blocked.md`.
