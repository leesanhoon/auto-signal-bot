# Task 01 — Disable pending-order creation & check trong SMC entrypoint

## Bối cảnh
File `src/charts/smc-index.ts` là entrypoint của `npm run analyze:smc` (SMC standalone system). Hiện tại nó:
1. Tạo pending order mới (`savePendingOrder`) khi setup có confidence đủ ngưỡng nhưng không auto-open và không phải `MARKET_NOW`.
2. Gọi `runCheckPendingOrders()` mỗi lần chạy để resolve các pending order đang chờ (TRIGGERED/CANCELLED/EXPIRED), gửi Telegram notification cho từng transition.

User hiện chỉ muốn nhận signal thô, không muốn hệ thống tự quản lý pending order nữa. **Không đổi database/schema.** Chỉ comment code ở entrypoint này để bật lại được sau.

**KHÔNG được đụng:** `runCheckOpenTrades()` (quản lý open position, khác hoàn toàn pending order) — giữ nguyên y hệt.
**KHÔNG được đụng:** `src/charts/positions-repository.ts`, `src/charts/check-pending-orders-runner.ts`, `src/charts/position-decision.ts` — các file này giữ nguyên 100%, chỉ sửa call site trong `smc-index.ts`.

## Thay đổi cần làm trong `src/charts/smc-index.ts`

### 1. Import (dòng 2 và 4)
Đổi:
```ts
import { saveOpenPosition, savePendingOrder } from "./positions-repository.js";
```
thành:
```ts
import { saveOpenPosition /*, savePendingOrder */ } from "./positions-repository.js";
```

Đổi:
```ts
import { runCheckPendingOrders } from "./check-pending-orders-runner.js";
```
thành:
```ts
// import { runCheckPendingOrders } from "./check-pending-orders-runner.js"; // DISABLED: signals-only mode, xem tasks/disable-pending-orders/plan.md
```

### 2. Block tạo pending order (trong `handleAnalysisResult`, khoảng dòng 132-143)

Nguyên bản:
```ts
    } else if ((setup.confidence ?? 0) >= threshold && setup.orderType !== "MARKET_NOW") {
      try {
        const saved = await savePendingOrder(setup);
        if (saved) {
          logger.info("Saved pending order", { pair: setup.pair, orderType: setup.orderType, primaryTimeframe: setup.primaryTimeframe });
        } else {
          logger.info("Skipped duplicate pending order", { pair: setup.pair, orderType: setup.orderType });
        }
      } catch (error) {
        logger.error("Failed to save pending order", { pair: setup.pair, error });
      }
    }
```

Đổi thành (comment nguyên block, KHÔNG xóa code, thêm 1 dòng giải thích):
```ts
    } else if ((setup.confidence ?? 0) >= threshold && setup.orderType !== "MARKET_NOW") {
      // DISABLED: signals-only mode, không tạo pending order nữa. Xem tasks/disable-pending-orders/plan.md
      // try {
      //   const saved = await savePendingOrder(setup);
      //   if (saved) {
      //     logger.info("Saved pending order", { pair: setup.pair, orderType: setup.orderType, primaryTimeframe: setup.primaryTimeframe });
      //   } else {
      //     logger.info("Skipped duplicate pending order", { pair: setup.pair, orderType: setup.orderType });
      //   }
      // } catch (error) {
      //   logger.error("Failed to save pending order", { pair: setup.pair, error });
      // }
    }
```

### 3. Block check pending orders trong `main()` (khoảng dòng 206-213)

Nguyên bản:
```ts
  logger.info("Checking open positions");
  const openTradeNotifications = await runCheckOpenTrades();
  logger.info("Checking pending orders");
  const pendingNotifications = await runCheckPendingOrders();

  if (!result && openTradeNotifications === 0 && pendingNotifications === 0) {
    await maybeSendHeartbeat(runContext, candleKey, heartbeatReason, latestCacheCandleKey);
  }
```

Đổi thành:
```ts
  logger.info("Checking open positions");
  const openTradeNotifications = await runCheckOpenTrades();
  // DISABLED: signals-only mode, không check/resolve pending order nữa. Xem tasks/disable-pending-orders/plan.md
  // logger.info("Checking pending orders");
  // const pendingNotifications = await runCheckPendingOrders();

  if (!result && openTradeNotifications === 0) {
    await maybeSendHeartbeat(runContext, candleKey, heartbeatReason, latestCacheCandleKey);
  }
```

**Quan trọng:** biến `pendingNotifications` không còn tồn tại. Tìm MỌI chỗ khác trong file còn tham chiếu `pendingNotifications` (ví dụ trong `logger.info("Run complete", {...})` ở cuối `main()`) và xóa field đó khỏi object log, hoặc comment dòng đó theo cùng convention. Chạy `grep -n "pendingNotifications" src/charts/smc-index.ts` sau khi sửa để xác nhận không còn reference nào chưa xử lý (comment hoặc xóa field, không được để code tham chiếu biến không tồn tại).

## Sửa test — `tests/charts/smc-index.test.ts`

Đọc toàn bộ file, tìm mọi assertion liên quan `savePendingOrder` hoặc `runCheckPendingOrders`/`mocks.runCheckPendingOrders`. Với mỗi test:
- Nếu test đang assert `savePendingOrder` được gọi khi tạo pending order → sửa thành assert **KHÔNG** được gọi (`expect(mocks.savePendingOrder).not.toHaveBeenCalled()`), giữ nguyên phần setup/mock khác của test.
- Nếu test đang assert `runCheckPendingOrders` được gọi 1 lần mỗi run (heartbeat suppression logic) → sửa thành assert **KHÔNG** được gọi, và sửa lại điều kiện heartbeat test cho khớp logic mới (`!result && openTradeNotifications === 0` — không còn phụ thuộc `pendingNotifications`).
- Không xóa test case, chỉ sửa assertion + tên test nếu cần cho đúng ý nghĩa mới (ví dụ đổi tên `"calls runCheckPendingOrders once per run"` → `"does not call runCheckPendingOrders (disabled)"`).
- Không đụng các test khác không liên quan (open positions, analysis, cache...).

## Xác nhận hoàn thành

```bash
npx tsc --noEmit
npx vitest run tests/charts/smc-index.test.ts
```

Cả 2 lệnh phải pass. Ghi evidence (output cuối) vào `result.md` trong cùng thư mục subtask này.

## Không được làm
- Không sửa `src/charts/check-pending-orders-runner.ts`, `src/charts/positions-repository.ts`, `src/charts/position-decision.ts`.
- Không sửa `src/charts/index.ts` (đó là subtask 02, người khác làm).
- Không đổi database/migration.
- Không refactor thêm ngoài scope trên.
