# Task 02 — Bỏ trùng lặp "Giá / Giá thật hiện tại"

## Bối cảnh

Telegram hiện hiện dòng: `📍 Giá: 3.50700 (Giá thật hiện tại: 3.50700)` — 2 con số GIỐNG HỆT NHAU,
gây khó hiểu ("Giá" và "Giá thật hiện tại" khác nhau chỗ nào?).

Nguyên nhân: [src/charts/analyzer-volman.ts:39-41](../../../src/charts/analyzer-volman.ts) trong
`applyPriceSanityChecks()`:

```ts
const currentPriceContext = setup.currentPriceContext
  ? `${setup.currentPriceContext} | Giá thật hiện tại: ${formatPrice(lastPrice)}`
  : `Giá thật hiện tại: ${formatPrice(lastPrice)}`;
```

Setup mới build từ `buildTradeSetupFromSignal()` ([src/charts/signal-assembly.ts](../../../src/charts/signal-assembly.ts))
KHÔNG set `currentPriceContext` ban đầu (field này chỉ tồn tại sau khi `applyPriceSanityChecks` chạy).
Nên `setup.currentPriceContext` luôn `undefined` lúc vào hàm này → luôn rơi vào nhánh else, tạo ra
`currentPriceContext = "Giá thật hiện tại: X"` với `X = lastPrice` — chính là giá trị đã hiển thị ở
`setup.lastPrice`.

Sau đó [src/shared/telegram-volman.ts:120-131](../../../src/shared/telegram-volman.ts):

```ts
const hasLastPrice = setup.lastPrice !== undefined && setup.lastPrice !== null;
const hasPriceContext = setup.currentPriceContext;
if (hasLastPrice && hasPriceContext) {
  priceLine = `📍 *Giá:* ${formatLastPrice(setup.lastPrice as number)} (${setup.currentPriceContext})`;
}
```

→ ghép cả 2 thành 1 dòng trùng lặp. `currentPriceContext` CHỈ thực sự có giá trị bổ sung khi giá đã
chạm/vượt TP (dòng 82-86 trong `analyzer-volman.ts`, thêm hậu tố `| Giá đã chạm/vượt TP X.`) — trường
hợp còn lại nó luôn là bản sao của `lastPrice`.

## Việc cần làm

### `src/charts/analyzer-volman.ts`

Đổi logic để `currentPriceContext` CHỈ được set khi có thông tin THỰC SỰ khác `lastPrice` (vd giá đã
chạm/vượt TP), không tự động nhồi "Giá thật hiện tại: X" vào field này nữa — vì `lastPrice` đã hiển thị
số đó riêng ở `TradeSetup.lastPrice` rồi.

Sửa dòng 39-41 (bỏ nhánh mặc định luôn tạo text trùng lặp):

```ts
const currentPriceContext = setup.currentPriceContext;
```

Sửa 2 nhánh return bên dưới cho khớp — chỗ nào đang gán `currentPriceContext` (biến vừa đổi ở trên)
vào field `currentPriceContext` của setup mới thì giữ nguyên tên biến, KHÔNG đổi cấu trúc object khác.

Đoạn "Giá đã chạm/vượt TP" (dòng 82-86) giữ nguyên logic ghép chuỗi, chỉ đổi điểm bắt đầu:

```ts
if (setup.direction === "LONG" && lastPrice >= takeProfit1) {
  updatedSetup.currentPriceContext = updatedSetup.currentPriceContext
    ? `${updatedSetup.currentPriceContext} | Giá đã chạm/vượt TP ${formatPrice(takeProfit1)}.`
    : `Giá đã chạm/vượt TP ${formatPrice(takeProfit1)}.`;
} else if (setup.direction === "SHORT" && lastPrice <= takeProfit1) {
  updatedSetup.currentPriceContext = updatedSetup.currentPriceContext
    ? `${updatedSetup.currentPriceContext} | Giá đã chạm/vượt TP ${formatPrice(takeProfit1)}.`
    : `Giá đã chạm/vượt TP ${formatPrice(takeProfit1)}.`;
}
```

(Trước đó code dùng `+=` giả định `currentPriceContext` luôn có sẵn chuỗi "Giá thật hiện tại: X" để nối
vào — giờ field có thể là `undefined`, không được dùng `+=` trên `undefined`.)

### `src/shared/telegram-volman.ts`

Logic `priceLine` (dòng 120-131) đã đúng cấu trúc rẽ nhánh (hasLastPrice/hasPriceContext) — KHÔNG cần
sửa gì thêm ở đây, vì sau khi sửa `analyzer-volman.ts`, `currentPriceContext` giờ chỉ có giá trị khi
THỰC SỰ có thông tin bổ sung (TP hit), nên priceLine sẽ tự động hiện đúng:
- Không có TP hit: `📍 *Giá:* 3.50700` (không còn phần ngoặc trùng lặp).
- Có TP hit: `📍 *Giá:* 3.50700 (Giá đã chạm/vượt TP 3.60000.)`.

## Ràng buộc — KHÔNG được làm

- KHÔNG đổi logic sanity check (loại setup khi giá vượt SL, MARKET_NOW lệch xa...) — chỉ đổi cách
  build `currentPriceContext`.
- KHÔNG đổi `TradeSetup.currentPriceContext` type (vẫn optional string).
- KHÔNG sửa `telegram-volman.ts` trừ khi verify cho thấy cần — mặc định KHÔNG cần đổi file này.

## Verify

1. `npm run build` — pass.
2. `npm run test` — full suite pass. Đặc biệt [tests/charts/analyzer-volman.test.ts](../../../tests/charts/analyzer-volman.test.ts)
   dòng 43 (`expect(checked.setup?.currentPriceContext).toContain("Giá thật hiện tại")`) SẼ FAIL vì
   hành vi cũ (luôn có "Giá thật hiện tại: X") không còn nữa — đây là kỳ vọng đúng, sửa assertion đó
   để verify hành vi mới (trường hợp không có TP hit, `currentPriceContext` phải là `undefined`).
   Dòng 127-129 (test TP hit case) vẫn phải đúng (`toContain("Giá đã chạm/vượt TP...")`,
   `not.toContain("TP1")`, `not.toContain("TP2")`) — verify kỹ case này không bị vỡ.
3. Verify thủ công: build 1 `TradeSetup` giả với `lastPrice` chưa chạm TP, chạy qua
   `applyPriceSanityChecks`, xác nhận `currentPriceContext === undefined` và `priceLine` trong Telegram
   chỉ còn `📍 *Giá:* X` (không có ngoặc).

## Ghi kết quả

Ghi `result.md`: diff, kết quả build/test (bao gồm test nào bị sửa và lý do), ví dụ priceLine thực tế
trước/sau cho cả 2 case (không TP hit / có TP hit).
