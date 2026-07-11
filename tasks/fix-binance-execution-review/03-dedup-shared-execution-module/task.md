# Task 03 — Dedup shared Binance execution module (SMC + Volman)

**ĐIỀU KIỆN TIÊN QUYẾT:** Chỉ bắt đầu task này sau khi CẢ HAI
`tasks/fix-binance-execution-review/01-fix-smc-execution-logic/done.md` và
`tasks/fix-binance-execution-review/02-fix-volman-execution-logic/done.md` đã tồn tại
(Lead đã APPROVED cả 2). Nếu 1 trong 2 file `done.md` chưa tồn tại, DỪNG LẠI, ghi
`blocked.md` giải thích lý do, không thực hiện task này.

Đọc `tasks/fix-binance-execution-review/context.md` và cả 2
`01-fix-smc-execution-logic/result.md`, `02-fix-volman-execution-logic/result.md` trước
khi bắt đầu — 2 file `binance-execution-smc.ts` và `binance-execution-volman.ts` tại thời
điểm này đã được fix Finding 1,2,3,4 + Finding phụ #1 theo đúng logic giống hệt nhau (chỉ
khác label Telegram và `riskUsdt`), là điều kiện AN TOÀN để gộp thành 1 module dùng chung.

## Mục tiêu

Loại bỏ duplication ~90% giữa 2 file bằng cách tạo 1 module core tham số hoá, KHÔNG được
đổi bất kỳ hành vi runtime nào — đây là refactor thuần tuý (behavior-preserving). Toàn bộ
test hiện có của cả 2 hệ (`tests/charts/binance-execution-smc.test.ts`,
`tests/charts/binance-execution-volman.test.ts`) phải PASS NGUYÊN VẸN sau khi dedup, KHÔNG
được sửa nội dung test để "cho pass" (chỉ được sửa import path nếu cấu trúc export đổi).

## Phạm vi được phép sửa/tạo

- Tạo mới: `src/charts/binance-execution-shared.ts`
- Sửa: `src/charts/binance-execution-smc.ts` (rút gọn thành wrapper mỏng gọi module chung)
- Sửa: `src/charts/binance-execution-volman.ts` (rút gọn thành wrapper mỏng gọi module chung)
- Sửa (chỉ nếu cần đổi import path do đổi cấu trúc export, KHÔNG đổi nội dung assertion):
  `tests/charts/binance-execution-smc.test.ts`, `tests/charts/binance-execution-volman.test.ts`

KHÔNG sửa `position-engine-smc.ts`, `position-engine-volman.ts`,
`positions-repository-smc.ts`, `positions-repository-volman.ts`, bất kỳ file migration
nào, `check-open-trades-runner-*.ts`.

## Thiết kế module chung

Tạo `src/charts/binance-execution-shared.ts` export 2 factory function nhận config object
tham số hoá theo hệ, trả về `openBinanceFuturesPosition` và `reconcileBinancePosition` cho
hệ đó. Chữ ký gợi ý (được điều chỉnh nếu cần cho khớp type thực tế của 2 hệ — ưu tiên giữ
đúng behavior hơn giữ đúng chữ ký mẫu này):

```ts
import type { TradeSetup } from "./chart-types-common.js"; // hoặc dùng generic <TSetup>

export type BinanceExecutionSystemConfig<TSetup, TOpenPosition, TDecisionOutcome> = {
  systemLabel: string; // "SMC" | "Volman" — dùng trong log tag và Telegram message
  loggerName: string; // "charts:binance-execution-smc" | "charts:binance-execution"
  calculateRiskRewardPlan: (setup: TSetup) => RiskRewardPlanLike | null;
  saveBinanceExecutionDetails: (positionId: number, details: BinanceExecutionDetailsLike) => Promise<void>;
  updateBinanceSlOrder: (positionId: number, orderId: number, stopLoss: string) => Promise<void>;
  getConfiguredRiskUsdt?: () => number | undefined; // chỉ Volman truyền, SMC bỏ qua (risk theo % như hiện tại)
};

export function createOpenBinanceFuturesPosition<...>(config: ...) {
  return async function openBinanceFuturesPosition(setup, positionId, chartSymbol) {
    // toàn bộ logic hiện tại của openBinanceFuturesPosition, thay các chỗ khác biệt
    // (systemLabel trong message, calculateRiskRewardPlan, riskUsdt, saveBinanceExecutionDetails)
    // bằng tham số từ config
  };
}

export function createReconcileBinancePosition<...>(config: ...) {
  return async function reconcileBinancePosition(position) {
    // toàn bộ logic hiện tại của reconcileBinancePosition, thay systemLabel trong message,
    // updateBinanceSlOrder bằng tham số từ config
  };
}
```

Lưu ý quan trọng khi viết logic bên trong 2 factory này: COPY logic đã fix từ
`binance-execution-smc.ts` (bản đã qua task 01, coi là nguồn chuẩn vì được viết/review
trước), KHÔNG viết lại từ đầu — chỉ thay các điểm khác biệt đã liệt kê ở
`tasks/fix-binance-execution-review/context.md` mục "File mapping SMC ↔ Volman" bằng biến
tham số hoá. Việc dùng `riskPercent` luôn lấy từ `getConfiguredBinanceRiskPercentPerTrade()`
(dùng chung cả 2 hệ, không tham số hoá); `riskUsdt` chỉ Volman có — nếu
`config.getConfiguredRiskUsdt` không được cung cấp (SMC), truyền `undefined` vào
`computeOrderQuantity` giống hệt hành vi hiện tại của bản SMC.

`binance-execution-smc.ts` sau khi sửa chỉ còn:

```ts
import { createOpenBinanceFuturesPosition, createReconcileBinancePosition } from "./binance-execution-shared.js";
import { calculateRiskRewardPlan } from "./position-engine-smc.js";
import { saveBinanceExecutionDetails, updateBinanceSlOrder } from "./positions-repository-smc.js";
// ... type imports cần thiết

const config = {
  systemLabel: "SMC",
  loggerName: "charts:binance-execution-smc",
  calculateRiskRewardPlan,
  saveBinanceExecutionDetails,
  updateBinanceSlOrder,
};

export const openBinanceFuturesPosition = createOpenBinanceFuturesPosition(config);
export const reconcileBinancePosition = createReconcileBinancePosition(config);
```

`binance-execution-volman.ts` tương tự, thêm `getConfiguredRiskUsdt:
getConfiguredBinanceRiskUsdPerTrade` vào config, `systemLabel: "Volman"` (kiểm tra kỹ
alert prefix hiện tại của Volman — có chỗ dùng `*Binance Futures*` KHÔNG có hậu tố
`(Volman)` và có chỗ dùng `*Binance Futures (Volman)*`, xem code thực tế đã đọc trong
`result.md` của task 02 — PHẢI giữ đúng từng chuỗi message hiện tại, không được đổi text
alert khi gộp module, kể cả khi 2 hệ dùng label không nhất quán).

## Bước thực hiện

1. Đọc kỹ nội dung hiện tại (SAU khi task 01+02 đã fix) của cả 2 file
   `binance-execution-smc.ts` và `binance-execution-volman.ts`.
2. Liệt kê CHÍNH XÁC từng điểm khác biệt còn lại giữa 2 file (import path, `systemLabel`
   trong từng chuỗi message — copy nguyên văn từng chuỗi khác nhau, `loggerName`,
   `riskUsdt`, tên module `position-engine-*`/`positions-repository-*`/`chart-types-*`).
3. Viết `src/charts/binance-execution-shared.ts` theo thiết kế trên, dùng generic type
   parameters nếu cần để giữ type-safety cho `TradeSetup`/`OpenPosition`/
   `PositionDecisionOutcome` khác nhau giữa 2 hệ (import type từ cả
   `position-engine-smc.ts`/`position-engine-volman.ts` là KHÔNG được — sẽ tạo coupling
   ngược; dùng generic hoặc structural type tối thiểu cần thiết cho logic bên trong).
4. Viết lại `binance-execution-smc.ts` và `binance-execution-volman.ts` thành wrapper mỏng.
5. `npm run build` — sửa mọi lỗi TypeScript phát sinh từ việc parametrize hoá (thường gặp:
   generic constraint, optional field access).
6. `npx vitest run tests/charts/binance-execution-smc.test.ts tests/charts/binance-execution-volman.test.ts`
   — PHẢI pass 100% với ĐÚNG test case đã có từ task 01/02, KHÔNG sửa assertion. Nếu 1 test
   fail do đổi cấu trúc export (vd nếu trước đây file test mock trực tiếp internal của file
   cũ mà giờ logic chuyển sang `binance-execution-shared.ts`), sửa import/mock path trong
   test cho khớp cấu trúc mới nhưng KHÔNG được đổi ý nghĩa test hoặc assertion.
7. Chạy thêm toàn bộ test suite liên quan để đảm bảo không phá vỡ chỗ khác:
   `npx vitest run tests/charts/binance-execution-smc.test.ts tests/charts/binance-execution-volman.test.ts tests/charts/positions-repository-smc.test.ts tests/charts/positions-repository-volman.test.ts tests/charts/binance-futures-client.test.ts`

## Acceptance criteria

- `npm run build` pass.
- Toàn bộ test ở bước 7 pass, không skip/xoá test nào.
- `binance-execution-smc.ts` và `binance-execution-volman.ts` sau khi sửa KHÔNG còn chứa
  logic nghiệp vụ trùng lặp — chỉ còn phần khai báo `config` + export 2 hàm từ factory.
- Mọi chuỗi message Telegram/log giữ NGUYÊN VĂN so với trước khi dedup (verify bằng cách
  so sánh từng chuỗi trong diff — không được rewording).
- Diff chỉ nằm trong các file được phép sửa/tạo ở đầu task này.

## Out of scope

- KHÔNG thay đổi hành vi/logic nghiệp vụ (đã fix xong ở task 01/02, task này chỉ gộp code).
- KHÔNG thêm test case mới cho hành vi mới (không có hành vi mới).
- KHÔNG sửa `position-engine-*.ts`, `positions-repository-*.ts`, migration.
- KHÔNG commit/push.

## Output

Ghi kết quả vào `tasks/fix-binance-execution-review/03-dedup-shared-execution-module/result.md`:
liệt kê điểm khác biệt đã tham số hoá, output đầy đủ `npm run build` và toàn bộ lệnh
`npx vitest run` ở bước 6-7, và list diff file (bao gồm file mới tạo). Nếu bị chặn (vd
điều kiện tiên quyết chưa đủ, hoặc phát hiện 2 file task 01/02 để lại KHÔNG còn giống hệt
nhau về logic khiến việc gộp rủi ro đổi behavior), ghi `blocked.md` thay vì đoán hoặc tự ý
đổi hành vi để gộp cho gọn.
