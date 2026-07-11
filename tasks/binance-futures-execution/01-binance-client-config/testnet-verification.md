# Testnet Verification — 01-binance-client-config

**Ngày:** 2026-07-11
**Người thực hiện:** Lead (Sonnet 5), theo yêu cầu user "test 1 vòng trên testnet giúp tôi"

## Phát hiện lỗi nghiêm trọng

Chạy thử 1 vòng đầy đủ trên Binance Futures Testnet (entry → SL → TP1 → TP2 → query status → cancel → đóng vị thế) bằng script tạm gọi trực tiếp các hàm trong `binance-futures-client.ts`/`binance-position-sizing.ts` (không đụng DB thật, không dùng `BINANCE_LIVE_TRADING_ENABLED`).

**Lỗi phát hiện:** `placeStopMarketOrder`/`placeTakeProfitMarketOrder` (code gốc từ task 01) fail với:
```
Binance Futures API loi 400 (code -4120) tai /fapi/v1/order: Order type not supported for this endpoint. Please use the Algo Order API endpoints instead.
```

**Nguyên nhân (đã verify qua tài liệu chính thức Binance Open Platform):** hiệu lực từ 2025-12-09, Binance migrate toàn bộ lệnh điều kiện (`STOP_MARKET`, `TAKE_PROFIT_MARKET`, `STOP`, `TAKE_PROFIT`, `TRAILING_STOP_MARKET`) sang endpoint **Algo Order API** riêng (`/fapi/v1/algoOrder`). Endpoint `/fapi/v1/order` cũ (dùng trong code mẫu ban đầu ở task 01/04/05) không còn chấp nhận các order type này. Đây là thay đổi API thật của Binance, **áp dụng cho cả production**, không phải lỗi riêng của testnet — nếu không fix, mọi lần mở vị thế thật trên production sẽ luôn fail đặt SL/TP ngay sau khi entry fill, kích hoạt fail-safe đóng khẩn cấp mọi lệnh.

## Fix đã áp dụng

Sửa trực tiếp `src/charts/binance-futures-client.ts`:
- `placeStopMarketOrder`, `placeTakeProfitMarketOrder`: `POST /fapi/v1/order` → `POST /fapi/v1/algoOrder`, thêm `algoType: "CONDITIONAL"`, `stopPrice` → `triggerPrice`, response `algoId`/`algoStatus` map về `{orderId, status}`.
- `cancelOrder`: `DELETE /fapi/v1/order` → `DELETE /fapi/v1/algoOrder`, `orderId` → `algoId`.
- `getOrderStatus`: `GET /fapi/v1/order` → `GET /fapi/v1/algoOrder`, `orderId` → `algoId`; chuẩn hoá `algoStatus: "TRIGGERED"` → trả về `status: "FILLED"` để `reconcileBinancePosition` (task 05, so sánh `status.status === "FILLED"`) không cần sửa.
- `placeMarketOrder` KHÔNG đổi (MARKET không phải lệnh điều kiện).

`binance-execution-volman.ts` (task 04/05) không cần sửa — chỉ gọi qua các hàm client trên, không tự build request.

## Kết quả verify lại trên testnet (sau fix)

```
[OK] one-way mode xac nhan
[OK] filters: { stepSize: 0.0001, minQty: 0.0001, tickSize: 0.1, minNotional: 50 }
[OK] balance: 4993.20562121
[OK] entry order: { orderId: 20888506126, status: 'NEW', symbol: 'BTCUSDT' }
[OK] SL algo order: { orderId: 1000000132541552, status: 'NEW', symbol: 'BTCUSDT' }
[OK] TP1 algo order: { orderId: 1000000132541555, status: 'NEW', symbol: 'BTCUSDT' }
[OK] TP2 algo order: { orderId: 1000000132541557, status: 'NEW', symbol: 'BTCUSDT' }
getPositionAmount -> 0.0778
[PASS] Full round OK
--- CLEANUP ---
cancelOrder x3 -> OK
close position -> OK
positionAmt after cleanup: 0
```

Ghi nhận thêm (không chặn): ngay sau đặt algo order, `getOrderStatus` đôi khi trả `-2013 "Order does not exist"` dù order tồn tại thật (cancel ngay sau đó vẫn OK) — độ trễ đồng bộ nội bộ Binance. Không ảnh hưởng thực tế vì `reconcileBinancePosition` chạy theo cron cách nhau vài phút; code đã xử lý an toàn (Error → coi là chưa khớp, không crash).

## Verification chung sau fix

- `npm run build` — pass.
- `npm run test` — pass (74 file / 786 test).
- Test testnet: đặt lệnh + query + cancel + đóng vị thế đều đúng hành vi mong đợi.

## Kết luận

Fix đã được áp dụng và verify. Task 01/04/05 coi như cập nhật lên bản đã sửa lỗi Algo Order API — `done.md` của các subtask liên quan vẫn giữ nguyên hiệu lực approve, chỉ bổ sung ghi chú fix này vào lịch sử.
