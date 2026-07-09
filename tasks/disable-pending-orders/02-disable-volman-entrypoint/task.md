# Task 02 — Disable pending-order creation & dọn lại check trong Volman entrypoint

## Bối cảnh
File `src/charts/index.ts` là entrypoint của `npm run analyze` (Bob Volman / deterministic + SMC-via-flag system). Hiện tại:
1. Nó vẫn gọi `savePendingOrder(setup)` để tạo pending order mới khi setup đủ ngưỡng confidence nhưng không auto-open (dòng ~211).
2. Dòng gọi `runCheckPendingOrders()` (dòng 316) **đã bị comment sẵn từ một commit trước** (`tasks/smc-standalone-cicd/plan.md` có ghi chú đây là lỗi vô tình, không phải chủ đích) và để lại 1 dòng rác `// + pendingNotifications == 0` (dòng 317).

User hiện chủ động muốn tắt **cả tạo lẫn check** pending order ở signals-only mode. Vì vậy dòng `runCheckPendingOrders()` bị comment giờ trở thành **chủ đích, không phải bug** — cần dọn lại rõ ràng để không ai hiểu nhầm là lỗi cần fix. **Không đổi database/schema.**

**KHÔNG được đụng:** `runCheckOpenTrades()`, logic auto-open (`saveOpenPosition`/`validateTradeSetupForOpen`) — giữ nguyên y hệt.
**KHÔNG được đụng:** `src/charts/positions-repository.ts`, `src/charts/check-pending-orders-runner.ts`, `src/charts/position-decision.ts` — chỉ sửa call site trong `index.ts`.

## Thay đổi cần làm trong `src/charts/index.ts`

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

### 2. Block tạo pending order trong `handleAnalysisResult` (khoảng dòng 206-230)

Nguyên bản:
```ts
    } else if (
      (setup.confidence ?? 0) >= threshold &&
      setup.orderType !== "MARKET_NOW"
    ) {
      try {
        const saved = await savePendingOrder(setup);
        if (saved) {
          logger.info("Saved pending order", {
            pair: setup.pair,
            orderType: setup.orderType,
            primaryTimeframe: setup.primaryTimeframe,
          });
        } else {
          logger.info("Skipped duplicate pending order", {
            pair: setup.pair,
            orderType: setup.orderType,
          });
        }
      } catch (error) {
        logger.error("Failed to save pending order", {
          pair: setup.pair,
          error,
        });
      }
    }
```

Đổi thành (comment nguyên block, giữ format cùng convention với subtask 01):
```ts
    } else if (
      (setup.confidence ?? 0) >= threshold &&
      setup.orderType !== "MARKET_NOW"
    ) {
      // DISABLED: signals-only mode, không tạo pending order nữa. Xem tasks/disable-pending-orders/plan.md
      // try {
      //   const saved = await savePendingOrder(setup);
      //   if (saved) {
      //     logger.info("Saved pending order", {
      //       pair: setup.pair,
      //       orderType: setup.orderType,
      //       primaryTimeframe: setup.primaryTimeframe,
      //     });
      //   } else {
      //     logger.info("Skipped duplicate pending order", {
      //       pair: setup.pair,
      //       orderType: setup.orderType,
      //     });
      //   }
      // } catch (error) {
      //   logger.error("Failed to save pending order", {
      //     pair: setup.pair,
      //     error,
      //   });
      // }
    }
```

### 3. Dọn lại block check pending orders trong `main()` (dòng 313-317)

Nguyên bản:
```ts
  logger.info("Checking open positions");
  const openTradeNotifications = await runCheckOpenTrades();
  logger.info("Checking pending orders");
  // const pendingNotifications = await runCheckPendingOrders();
  // + pendingNotifications == 0
```

Đổi thành (xóa dòng rác, comment rõ đây là chủ đích):
```ts
  logger.info("Checking open positions");
  const openTradeNotifications = await runCheckOpenTrades();
  // DISABLED: signals-only mode, không check/resolve pending order nữa. Xem tasks/disable-pending-orders/plan.md
  // const pendingNotifications = await runCheckPendingOrders();
```

Điều kiện heartbeat ở dòng 319 (`if (!result && openTradeNotifications === 0) {`) **đã đúng sẵn, không cần sửa** — nó không phụ thuộc `pendingNotifications`.

Sau khi sửa, chạy `grep -n "pendingNotifications" src/charts/index.ts` để xác nhận không còn reference nào tới biến đã bị comment.

## Sửa test — `tests/charts/index.test.ts`

1. **Mock wiring (dòng 86-88, đã comment sẵn):** giữ nguyên, không cần đổi — đã đúng convention.
2. **`mocks.savePendingOrder.mockResolvedValue(true)` (dòng 189):** xóa dòng này (không cần mock nữa vì code không còn gọi).
3. **`// mocks.runCheckPendingOrders.mockResolvedValue(0);` (dòng 194):** xóa dòng comment rác này.
4. **Các dòng `// expect(mocks.runCheckPendingOrders).toHaveBeenCalledTimes(1);`** (dòng 214, 239, 265, 288): xóa hẳn các dòng comment này (không còn ý nghĩa giữ lại — hành vi đã ổn định là "không gọi").
5. **Dòng 338, 356 `// mocks.runCheckPendingOrders.mockResolvedValue(0);`**: xóa tương tự.
6. Trong ít nhất 1 test đại diện (test đầu tiên, dòng ~205 `"không trong window..."`), **thêm assertion mới** xác nhận rõ ràng hành vi disabled:
   ```ts
   expect(mocks.savePendingOrder).not.toHaveBeenCalled();
   ```
   (Không cần assert `runCheckPendingOrders` vì module đã không còn được mock/import — không có cách gọi nó từ code nữa.)
7. Đọc toàn bộ file để đảm bảo không còn dòng nào tham chiếu `savePendingOrder`/`runCheckPendingOrders` gây nhầm lẫn hoặc lỗi biên dịch test.

## Xác nhận hoàn thành

```bash
npx tsc --noEmit
npx vitest run tests/charts/index.test.ts
```

Cả 2 lệnh phải pass. Ghi evidence (output cuối) vào `result.md` trong cùng thư mục subtask này.

## Không được làm
- Không sửa `src/charts/check-pending-orders-runner.ts`, `src/charts/positions-repository.ts`, `src/charts/position-decision.ts`.
- Không sửa `src/charts/smc-index.ts` (đó là subtask 01, người khác làm).
- Không đổi database/migration.
- Không refactor thêm ngoài scope trên.
