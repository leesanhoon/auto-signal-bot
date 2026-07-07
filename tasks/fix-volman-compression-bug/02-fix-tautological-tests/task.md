# Task 02 — Replace tautological BB/RB/ARB/IRB tests with real assertions

## Điều kiện tiên quyết

Task 01 đã hoàn thành (5 file setup đã sửa `detectCompression` endIndex từ
`index` → `index - 1`). Nếu chưa, DỪNG và báo blocked.md.

## Vấn đề

Trong `tests/charts/setups.test.ts`, 4 test cho BB/RB/ARB/IRB (dòng ~134-227)
đều viết dạng:

```ts
expect(signal === null || signal!.setup === "BB").toBe(true);
```

Assertion này LUÔN pass bất kể `signal` là `null` hay có giá trị — nó không
thực sự kiểm tra detector có hoạt động hay không. Đây là lý do bug ở task 01
sống sót qua 4 vòng review mà không ai phát hiện.

## Yêu cầu

Sửa 4 test này (`describe("BB — Block Break", ...)`,
`describe("RB — Range Break", ...)`, `describe("ARB — Advanced Range Break", ...)`,
`describe("IRB — Inside Range Break", ...)`) để:

1. Dữ liệu nến (fixture) có block/range hình thành ở các nến TRƯỚC nến cuối
   cùng, và nến cuối cùng là nến breakout đóng cửa RÕ RÀNG vượt ra ngoài
   block/range đó (không chỉ chạm biên — phải vượt hẳn, vì sau fix task 01,
   block không còn bao gồm nến breakout nên breakout phải là nến riêng biệt
   sau block).
2. Assertion phải khẳng định signal THỰC SỰ khác null:
   ```ts
   expect(signal).not.toBeNull();
   expect(signal!.setup).toBe("BB"); // hoặc RB/ARB/IRB tương ứng
   expect(signal!.direction).toBe("LONG"); // hoặc SHORT, tùy fixture
   ```
   Có thể thêm assertion cho `entry`/`stopLoss` nếu fixture cho phép tính
   trước giá trị mong đợi rõ ràng.
3. Nếu detector vẫn trả `null` với fixture bạn viết, ĐỪNG hạ assertion về lại
   dạng tautological — thay vào đó điều chỉnh fixture (thử nhiều biến thể
   nến, kiểm tra ngưỡng trong file setup tương ứng: `bb.ts` cần
   `|slope|>0.2` + block cách EMA20 ≤0.25 ATR; `rb.ts`/`arb.ts` cần range
   ≥6 nến với kBlock=2.0; `irb.ts` cần RangeInner sát biên RangeOuter ≤0.3
   ATR) cho tới khi signal thực sự trả về. Nếu sau nhiều lần thử vẫn không
   được, viết `blocked.md` mô tả cụ thể đã thử gì và tại sao không ra tín
   hiệu — KHÔNG tự ý nới lỏng threshold trong code sản xuất.

## Verification

```bash
npm run build
npm run test -- --run
```

Toàn bộ test suite (bao gồm cả các test khác không liên quan) phải pass. Nếu
có test khác bị fail do thay đổi ở task 01, ghi rõ trong `result.md` và KHÔNG
tự sửa các file setup — báo lại cho Lead qua `blocked.md`.

## Ghi kết quả

Viết `result.md`:
- Fixture mới cho từng test (tóm tắt)
- Kết quả `npm run test -- --run` (số test pass/fail)
- Kết quả `npm run build`
