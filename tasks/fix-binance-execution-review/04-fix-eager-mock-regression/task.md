# Task 04 — fix-eager-mock-regression

## Bối cảnh

Subtask `01`, `02`, `03` của `tasks/fix-binance-execution-review/` đã `done`. Sau khi
subtask `03` (dedup shared module) hoàn tất, Lead chạy FULL test suite (`npx vitest run`,
không giới hạn file) trước khi commit và phát hiện regression:

```
npx vitest run
→ Test Files  2 failed | 74 passed (76)
→ Tests  17 failed | 796 passed (813)
```

2 file test bị vỡ (KHÔNG nằm trong phạm vi sửa của task này, KHÔNG được đụng vào):
- `tests/charts/smc-index.test.ts` — 17/17 test fail.
- `tests/charts/index.test.ts` — crash tại import, 14 test không chạy được.

Lỗi cụ thể (2 lỗi tương tự nhau):

```
Error: [vitest] No "calculateRiskRewardPlan" export is defined on the
"../../src/charts/position-engine-volman.js" mock. Did you forget to return it from "vi.mock"?
 ❯ src/charts/binance-execution-volman.ts:12:3
```

```
Error: [vitest] No "calculateRiskRewardPlan" export is defined on the
"../../src/charts/position-engine-smc.js" mock. Did you forget to return it from "vi.mock"?
 ❯ src/charts/binance-execution-smc.ts:11:3
```

## Root cause

Object `config` ở top-level 2 file `src/charts/binance-execution-smc.ts` và
`src/charts/binance-execution-volman.ts` dùng object-shorthand
(`calculateRiskRewardPlan,` / `saveBinanceExecutionDetails,` / `updateBinanceSlOrder,`).
Cú pháp shorthand này đọc giá trị của named-import binding NGAY LÚC MODULE ĐƯỢC IMPORT
(eager evaluation ở top-level), không phải lúc hàm thật sự được gọi. Khi test mock ESM
namespace của module nguồn (`position-engine-smc.js` / `position-engine-volman.js`) mà
không cung cấp đủ named export đó, việc đọc eager này throw lỗi ngay khi import — kể cả
khi hàm không hề được gọi trong test case đó.

## Việc cần làm — CHỈ sửa đúng 2 file production sau, KHÔNG sửa file nào khác

### File 1: `src/charts/binance-execution-smc.ts`

Đọc toàn bộ file trước khi sửa. Hiện tại (dòng 1-25):

```ts
import { createOpenBinanceFuturesPosition, createReconcileBinancePosition } from "./binance-execution-shared.js";
import { calculateRiskRewardPlan } from "./position-engine-smc.js";
import { saveBinanceExecutionDetails, updateBinanceSlOrder } from "./positions-repository-smc.js";
import type { PositionDecisionOutcome } from "./position-engine-smc.js";
import type { OpenPosition } from "./positions-repository-smc.js";
import type { TradeSetup } from "./chart-types-smc.js";

const config = {
  systemLabel: "SMC",
  loggerName: "charts:binance-execution-smc",
  calculateRiskRewardPlan,
  saveBinanceExecutionDetails,
  updateBinanceSlOrder,
  guardFailPrefix: "*Binance Futures (SMC)*",
  ...
};
```

Đổi 3 dòng shorthand trong object `config` thành arrow-function thunk lazy (gọi lại hàm
gốc bằng đúng tên/tham số, KHÔNG đổi logic gì khác):

```ts
const config = {
  systemLabel: "SMC",
  loggerName: "charts:binance-execution-smc",
  calculateRiskRewardPlan: (setup: TradeSetup) => calculateRiskRewardPlan(setup),
  saveBinanceExecutionDetails: (positionId: number, details: BinanceExecutionDetails) =>
    saveBinanceExecutionDetails(positionId, details),
  updateBinanceSlOrder: (positionId: number, orderId: number, stopLoss: string) =>
    updateBinanceSlOrder(positionId, orderId, stopLoss),
  guardFailPrefix: "*Binance Futures (SMC)*",
  ...
};
```

`BinanceExecutionDetails` type phải import từ `./binance-execution-shared.js` (đã export
type đó ở đó — kiểm tra lại; nếu tên khác thì dùng đúng tên export thực tế trong file, xem
`src/charts/binance-execution-shared.ts` dòng ~36-45 `export type BinanceExecutionDetails`
và dòng 75-94 `BinanceExecutionSystemConfig`). Thêm vào import statement dòng 1:

```ts
import {
  createOpenBinanceFuturesPosition,
  createReconcileBinancePosition,
  type BinanceExecutionDetails,
} from "./binance-execution-shared.js";
```

KHÔNG đổi phần còn lại của file (mọi field khác trong `config`, 2 dòng export cuối file,
`export type { PositionDecisionOutcome, OpenPosition };`).

### File 2: `src/charts/binance-execution-volman.ts`

Áp dụng đúng pattern tương tự — đổi 3 field trong object `config` (dòng 9-25) từ shorthand
sang arrow-function thunk lazy, dùng đúng type tham số theo chữ ký hàm thật sự trong
`src/charts/position-engine-volman.ts` (`calculateRiskRewardPlan`) và
`src/charts/positions-repository-volman.ts` (`saveBinanceExecutionDetails`,
`updateBinanceSlOrder`). Type tham số setup dùng `TradeSetup` từ
`./chart-types-volman.js` (đã import sẵn ở đầu file). Import thêm
`type BinanceExecutionDetails` từ `./binance-execution-shared.js` như file 1 nếu file này
chưa có sẵn import đó.

```ts
const config = {
  systemLabel: "Volman",
  loggerName: "charts:binance-execution",
  calculateRiskRewardPlan: (setup: TradeSetup) => calculateRiskRewardPlan(setup),
  saveBinanceExecutionDetails: (positionId: number, details: BinanceExecutionDetails) =>
    saveBinanceExecutionDetails(positionId, details),
  updateBinanceSlOrder: (positionId: number, orderId: number, stopLoss: string) =>
    updateBinanceSlOrder(positionId, orderId, stopLoss),
  getConfiguredRiskUsdt: getConfiguredBinanceRiskUsdPerTrade,
  guardFailPrefix: "*Binance Futures (Volman)*",
  ...
};
```

KHÔNG đổi phần còn lại của file.

## Xác nhận chữ ký hàm khớp type constraint

`BinanceExecutionSystemConfig<TSetup, TOpenPosition, TDecisionOutcome>` trong
`src/charts/binance-execution-shared.ts` dòng ~78-83 yêu cầu:

```ts
calculateRiskRewardPlan: (setup: TSetup) => RiskRewardPlan | null;
saveBinanceExecutionDetails: (positionId: number, details: BinanceExecutionDetails) => Promise<void>;
updateBinanceSlOrder: (positionId: number, orderId: number, stopLoss: string) => Promise<void>;
```

Thunk arrow function trong cả 2 file PHẢI khớp đúng chữ ký này (tham số + kiểu trả về) —
nếu `npm run build` báo lỗi type mismatch, kiểm tra lại chữ ký hàm gốc trong
`position-engine-smc.ts` / `position-engine-volman.ts` /
`positions-repository-smc.ts` / `positions-repository-volman.ts` và sửa type tham số cho
khớp chính xác (không dùng `any`).

## Ngoài phạm vi (KHÔNG được làm)

- KHÔNG sửa `tests/charts/smc-index.test.ts`.
- KHÔNG sửa `tests/charts/index.test.ts`.
- KHÔNG sửa bất kỳ file nào khác ngoài `src/charts/binance-execution-smc.ts` và
  `src/charts/binance-execution-volman.ts`.
- KHÔNG đổi behavior runtime nào khác — đây thuần túy là đổi cách đọc reference
  (eager → lazy), không đổi logic nghiệp vụ.
- KHÔNG thêm test mới (2 test file `binance-execution-smc.test.ts` /
  `binance-execution-volman.test.ts` hiện tại đã cover đủ hành vi qua `openBinanceFuturesPosition`
  / `reconcileBinancePosition` — không cần test riêng cho việc đổi thunk vì nó không đổi
  observable behavior).

## Các bước thực hiện

1. Đọc `src/charts/binance-execution-smc.ts` toàn bộ.
2. Đọc `src/charts/binance-execution-volman.ts` toàn bộ.
3. Đọc `src/charts/binance-execution-shared.ts` để xác nhận đúng tên export
   `BinanceExecutionDetails` và chữ ký `BinanceExecutionSystemConfig`.
4. Sửa `src/charts/binance-execution-smc.ts` theo đúng mô tả ở trên.
5. Sửa `src/charts/binance-execution-volman.ts` theo đúng mô tả ở trên.
6. Chạy `npm run build` — phải PASS, không có lỗi TypeScript.
7. Chạy `npx vitest run` (BẮT BUỘC full suite toàn bộ project, KHÔNG chỉ định file cụ
   thể) — phải cho kết quả toàn bộ file/test PASS, đặc biệt các file sau phải pass:
   - `tests/charts/binance-execution-smc.test.ts`
   - `tests/charts/binance-execution-volman.test.ts`
   - `tests/charts/smc-index.test.ts` (17 test trước đó fail, giờ phải pass hết)
   - `tests/charts/index.test.ts` (14 test trước đó không chạy được do crash import, giờ
     phải pass hết)
8. Nếu bất kỳ test nào khác (ngoài 4 file trên) fail SAU KHI sửa mà TRƯỚC ĐÓ (theo báo cáo
   ở trên) đang pass, đây là regression mới — dừng lại, ghi `blocked.md` mô tả rõ, không tự
   đoán sửa thêm ngoài phạm vi.

## Acceptance criteria

- `npm run build` PASS.
- `npx vitest run` (full suite, không giới hạn file) → `0 failed`, toàn bộ test files pass.
  Ghi rõ số liệu chính xác từ output thật (ví dụ "Test Files 76 passed (76); Tests 813
  passed (813)") vào `result.md`, không được làm tròn hay ước lượng.
- Chỉ 2 file `src/charts/binance-execution-smc.ts` và
  `src/charts/binance-execution-volman.ts` bị thay đổi (verify bằng `git status` /
  `git diff --stat`, dán output vào `result.md`).
- Không file test nào bị sửa.

## Output bắt buộc

Ghi kết quả vào `tasks/fix-binance-execution-review/04-fix-eager-mock-regression/result.md`
gồm:
- Diff/nội dung đã sửa ở 2 file (hoặc tóm tắt rõ ràng thay đổi).
- Output đầy đủ của `npm run build`.
- Output đầy đủ của `npx vitest run` (full suite) — bao gồm dòng tổng kết
  `Test Files ... | Tests ...`.
- Output của `git diff --stat` xác nhận đúng phạm vi file bị đổi.

Nếu bị chặn (ví dụ type mismatch không tự giải quyết được, hoặc phát hiện file khác cũng
cần sửa để build/test pass), ghi rõ vào
`tasks/fix-binance-execution-review/04-fix-eager-mock-regression/blocked.md`, không tự ý
mở rộng phạm vi sửa.
