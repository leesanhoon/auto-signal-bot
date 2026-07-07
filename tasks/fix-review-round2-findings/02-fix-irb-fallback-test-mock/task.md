# Task 02 — Replace mock-based IRB fallback test with real-data test (HIGH)

## Vấn đề

`tests/charts/irb-fallback.test.ts` dùng `vi.mock("../../src/charts/indicators.js", ...)`
để mock chính hàm `detectCompression` — hàm mà nhánh fallback trong
`src/charts/setups/irb.ts` (dòng ~95-108, ~114-127) đang gọi để tính
`fallbackInner`. Test hiện tại chỉ xác nhận `detectIrb` GỌI mock với đúng
tham số (`toHaveBeenCalledWith(...)`) và trả về signal mà mock được lập trình
sẵn để trả — KHÔNG xác nhận `detectCompression` THẬT (dùng dữ liệu EMA/ATR
thật) thực sự tính đúng cửa sổ compression và khiến nhánh fallback trả tín
hiệu hợp lệ.

Đây CHÍNH XÁC là kiểu lỗi test đã khiến bug off-by-one gốc (endIndex=index
thay vì index-1) sống sót qua 4 vòng review trước đó — mock/tautological
assertion che giấu việc detector chưa từng thực sự chạy được với dữ liệu thật.

## Yêu cầu

Viết lại `tests/charts/irb-fallback.test.ts`:

1. **KHÔNG mock `detectCompression`** hay bất kỳ hàm nào trong
   `src/charts/indicators.ts`. Dùng `calculateEma`/`calculateAtr` thật (như
   cách `tests/charts/setups.test.ts` đang làm cho các test BB/RB/ARB/IRB
   khác).

2. Dựng fixture nến THẬT mô phỏng đúng case fallback branch cần xử lý:
   RangeOuter hình thành, RangeInner sát biên RangeOuter, RangeInner breakout
   xảy ra ở nến `index - 2` (không phải `index - 1` hay `index`, vì
   `rangeInner` được tính với `endIndex = index - 1` nên nến breakout thật sự
   của RangeInner phải nằm TRƯỚC `index - 1`), rồi RangeOuter breakout xảy ra
   ở nến `index`. Có thể tham khảo cách dựng fixture IRB "happy path" hiện có
   trong `tests/charts/setups.test.ts` rồi điều chỉnh timing breakout cho
   đúng case fallback.

3. Assertion: `expect(signal).not.toBeNull(); expect(signal!.setup).toBe("IRB");`
   cộng thêm assertion `direction`/`entry` nếu tính trước được giá trị mong
   đợi rõ ràng từ fixture.

4. Nếu sau nhiều lần thử fixture vẫn không kích hoạt được nhánh fallback thật
   (không mock), viết `blocked.md` mô tả cụ thể đã thử gì, giá trị
   `ruleTrace` trả về là gì ở mỗi lần thử (thêm log tạm để debug nếu cần, rồi
   xóa trước khi nộp) — KHÔNG quay lại dùng mock để "cho test pass".

## KHÔNG làm

- Không đổi logic trong `src/charts/setups/irb.ts` (trừ khi task 05/08 khác
  yêu cầu — task này CHỈ sửa test).
- Không giữ lại cả 2 version test (mock + real) — thay thế hoàn toàn bằng bản
  dùng dữ liệu thật.

## Verification

```bash
npm run build
npm run test -- --run tests/charts/irb-fallback.test.ts
```

## Ghi kết quả

`result.md`: fixture mới, assertion mới, kết quả build + test. Nếu blocked,
viết `blocked.md` thay vì `result.md`.
