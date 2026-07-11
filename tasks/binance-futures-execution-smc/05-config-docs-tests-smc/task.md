# Task 05: `.env.example` + unit test cho repository mapping + guard cross-system (SMC)

## Bối cảnh

**Phụ thuộc: task 01, 02, 03 phải xong trước.** Task này chỉ thêm tài liệu env var và test cho phần logic thuần (repository mapping + guard cross-system), không cần gọi Binance thật, không cần network.

Tham khảo file tương đương đã làm cho Volman: `tasks/binance-futures-execution/06-config-docs-tests/task.md` (đã APPROVED) — task này làm đúng việc tương tự cho phần SMC, không lặp lại các test đã có (`binance-futures-client.test.ts`, `binance-position-sizing.test.ts` là code dùng chung, đã test ở task 06 của plan gốc, KHÔNG viết lại).

## Việc cần làm

### File 1: `.env.example` (sửa — thêm 1 dòng vào cuối block Binance đã có)

Block Binance hiện tại kết thúc bằng dòng `# BINANCE_RATE_LIMIT_RPM=300   # mac dinh 300 request/phut`. Thêm ngay sau dòng đó (giữ nguyên mọi dòng cũ, không xoá/sửa gì):

```
# BINANCE_LIVE_TRADING_ENABLED_SMC: kill-switch RIENG cho he SMC, mac dinh false.
# Ca 2 switch (BINANCE_LIVE_TRADING_ENABLED va bien nay) deu phai true moi trade That cho SMC.
BINANCE_LIVE_TRADING_ENABLED_SMC=false
```

### File 2: `tests/charts/positions-repository-smc.test.ts` (sửa — thêm test case mới vào `describe` block đã có, KHÔNG sửa test cũ)

Đọc file hiện tại trước để bám đúng pattern mock (`repoState`, `chain`, `repoState.from.mockReturnValue(chain)` trong `beforeEach`). Thêm test mới vào cuối `describe("charts/positions-repository-smc", ...)`:

```ts
  test("saveBinanceExecutionDetails updates the correct binance_* columns", async () => {
    repoState.chainResult = { data: null, error: null };

    await positionsRepository.saveBinanceExecutionDetails(42, {
      binanceSymbol: "BTCUSDT",
      binanceLeverage: 5,
      binanceQuantity: 0.01,
      binanceEntryOrderId: 111,
      binanceSlOrderId: 222,
      binanceTp1OrderId: 333,
      binanceTp2OrderId: 444,
      binanceExecutionStatus: "placed",
    });

    expect(repoState.from).toHaveBeenCalledWith("open_positions_smc");
    expect(repoState.update).toHaveBeenCalledWith({
      binance_symbol: "BTCUSDT",
      binance_leverage: 5,
      binance_quantity: 0.01,
      binance_entry_order_id: 111,
      binance_sl_order_id: 222,
      binance_tp1_order_id: 333,
      binance_tp2_order_id: 444,
      binance_execution_status: "placed",
    });
  });

  test("saveBinanceExecutionDetails throws when update fails", async () => {
    repoState.chainResult = { data: null, error: { message: "db down" } };

    await expect(
      positionsRepository.saveBinanceExecutionDetails(42, {
        binanceSymbol: "BTCUSDT",
        binanceLeverage: 5,
        binanceQuantity: 0.01,
        binanceEntryOrderId: 111,
        binanceSlOrderId: null,
        binanceTp1OrderId: null,
        binanceTp2OrderId: null,
        binanceExecutionStatus: "failed",
      }),
    ).rejects.toThrow("saveBinanceExecutionDetails failed");
  });

  test("loadOpenPositions maps binance_* columns onto OpenPosition", async () => {
    repoState.selectResult = {
      data: [
        {
          id: 1,
          pair: "BTC/USDT",
          direction: "LONG",
          entry: "50000",
          stop_loss: "49000",
          take_profit_1: "51000",
          take_profit_2: "52000",
          partial_close_percent: 50,
          opened_at: "2026-01-01T00:00:00Z",
          binance_symbol: "BTCUSDT",
          binance_leverage: 5,
          binance_quantity: 0.01,
          binance_entry_order_id: 111,
          binance_sl_order_id: 222,
          binance_tp1_order_id: 333,
          binance_tp2_order_id: 444,
          binance_execution_status: "placed",
        },
      ],
      error: null,
    };

    const positions = await positionsRepository.loadOpenPositions();

    expect(positions[0].binanceSymbol).toBe("BTCUSDT");
    expect(positions[0].binanceLeverage).toBe(5);
    expect(positions[0].binanceQuantity).toBe(0.01);
    expect(positions[0].binanceEntryOrderId).toBe(111);
    expect(positions[0].binanceSlOrderId).toBe(222);
    expect(positions[0].binanceTp1OrderId).toBe(333);
    expect(positions[0].binanceTp2OrderId).toBe(444);
    expect(positions[0].binanceExecutionStatus).toBe("placed");
  });
```

Lưu ý: object `data` mẫu trong test `loadOpenPositions` ở trên chỉ liệt kê các cột chắc chắn cần có. Nếu hàm `loadOpenPositions()` thực tế (sau task 01) yêu cầu thêm cột bắt buộc khác (không optional) mà thiếu sẽ làm dòng bị `map` sai/lỗi runtime, hãy đọc lại các test case khác đã có trong cùng file (ví dụ test cho `loadOpenPositions` đã tồn tại, nếu có) để bổ sung đúng field còn thiếu vào `data`, giữ nguyên các field đã liệt kê ở trên.

### File 3: `tests/charts/binance-execution-smc.test.ts` (tạo mới — test guard cross-system)

Test hành vi guard trong `openBinanceFuturesPosition()` (`src/charts/binance-execution-smc.ts`, tạo ở task 03) mà KHÔNG cần mock toàn bộ luồng đặt lệnh thành công (tránh phụ thuộc chi tiết implementation của các bước sau guard). Dùng 2 case:

1. `getPositionAmount` trả về khác 0 → hàm phải return sớm, KHÔNG gọi `placeMarketOrder`, và `sendMessage` được gọi với message chứa `"Bỏ qua mở vị thế thật"`.
2. `getPositionAmount` trả về `0` → guard phải cho qua (không return sớm ở bước guard) — verify gián tiếp bằng cách để bước NGAY SAU guard (`getExchangeInfoFilters`) trả về `Error`, rồi assert `sendMessage` được gọi với message chứa `"Không thể mở vị thế thật"` (nhánh catch tổng, KHÔNG phải message của guard) — chứng minh code đã đi qua khỏi bước guard.

```ts
import { beforeEach, describe, expect, test, vi } from "vitest";

const clientState = vi.hoisted(() => ({
  isHedgeModeEnabled: vi.fn(),
  getPositionAmount: vi.fn(),
  getExchangeInfoFilters: vi.fn(),
  getAvailableBalanceUsdt: vi.fn(),
  setMarginType: vi.fn(),
  setLeverage: vi.fn(),
  placeMarketOrder: vi.fn(),
  placeStopMarketOrder: vi.fn(),
  placeTakeProfitMarketOrder: vi.fn(),
  cancelOrder: vi.fn(),
}));

const sendMessageMock = vi.hoisted(() => vi.fn());

vi.mock("../../src/charts/binance-futures-client.js", () => clientState);

vi.mock("../../src/charts/ohlc-provider.js", () => ({
  toBinanceSymbol: (chartSymbol: string) =>
    chartSymbol.startsWith("BINANCE:") ? chartSymbol.replace("BINANCE:", "") : null,
}));

vi.mock("../../src/charts/binance-futures-config-env.js", () => ({
  getConfiguredBinanceLeverage: () => 5,
  getConfiguredBinanceMarginType: () => "ISOLATED",
  getConfiguredBinanceRiskPercentPerTrade: () => 1,
}));

vi.mock("../../src/charts/position-engine-smc.js", () => ({
  calculateRiskRewardPlan: () => ({
    entry: 50000,
    stopLoss: 49000,
    takeProfit1: 51000,
    takeProfit2: 52000,
    partialClosePercent: 50,
  }),
}));

vi.mock("../../src/charts/positions-repository-smc.js", () => ({
  saveBinanceExecutionDetails: vi.fn(),
}));

vi.mock("../../src/shared/telegram-client.js", () => ({
  sendMessage: sendMessageMock,
}));

const { openBinanceFuturesPosition } = await import(
  "../../src/charts/binance-execution-smc.js"
);

const baseSetup = {
  pair: "BTC/USDT",
  direction: "LONG" as const,
};

beforeEach(() => {
  Object.values(clientState).forEach((fn) => fn.mockReset());
  sendMessageMock.mockReset();
  clientState.isHedgeModeEnabled.mockResolvedValue(false);
});

describe("charts/binance-execution-smc guard cross-system", () => {
  test("bo qua entry khi symbol da co vi the mo (khac 0)", async () => {
    clientState.getPositionAmount.mockResolvedValue(0.02);

    await openBinanceFuturesPosition(baseSetup as any, 1, "BINANCE:BTCUSDT");

    expect(clientState.placeMarketOrder).not.toHaveBeenCalled();
    expect(sendMessageMock).toHaveBeenCalledTimes(1);
    expect(sendMessageMock.mock.calls[0][0]).toContain("Bỏ qua mở vị thế thật");
  });

  test("cho qua guard khi symbol chua co vi the mo (bang 0)", async () => {
    clientState.getPositionAmount.mockResolvedValue(0);
    clientState.getExchangeInfoFilters.mockResolvedValue(new Error("network down"));

    await openBinanceFuturesPosition(baseSetup as any, 1, "BINANCE:BTCUSDT");

    expect(sendMessageMock).toHaveBeenCalledTimes(1);
    expect(sendMessageMock.mock.calls[0][0]).toContain("Không thể mở vị thế thật");
  });
});
```

Nếu `openBinanceFuturesPosition` thực tế (sau task 03) có chữ ký tham số khác thứ tự/tên so với `(setup, positionId, chartSymbol)`, hoặc message guard/catch tổng dùng câu chữ khác với `"Bỏ qua mở vị thế thật"` / `"Không thể mở vị thế thật"`, đọc lại `src/charts/binance-execution-smc.ts` thực tế và sửa test cho khớp đúng — KHÔNG sửa source code để khớp test.

## Ràng buộc

- KHÔNG viết test gọi Binance API thật (không có network call thật trong test suite).
- KHÔNG sửa test case cũ nào đã có trong `positions-repository-smc.test.ts` — chỉ thêm test mới vào cuối `describe` block.
- KHÔNG sửa `binance-execution-smc.ts`, `binance-execution-volman.ts`, hay bất kỳ file source nào — task này chỉ thêm test + docs.
- KHÔNG tạo thêm file test nào khác ngoài 1 file mới (`binance-execution-smc.test.ts`) + sửa 1 file test đã có.

## Cách verify

```bash
npm run build
npm run test
```
Toàn bộ test (cũ + mới) phải pass.

## Output

Ghi vào `tasks/binance-futures-execution-smc/05-config-docs-tests-smc/result.md`:
- Đoạn đã thêm vào `.env.example`
- Diff/nội dung test đã thêm vào `positions-repository-smc.test.ts`
- Nội dung file `binance-execution-smc.test.ts` đã tạo
- Kết quả `npm run build && npm run test`

Nếu bị chặn (ví dụ tên hàm/message thực tế trong `binance-execution-smc.ts` hoặc `positions-repository-smc.ts` sau task 01/03 khác với mô tả ở trên, và không tự suy ra được cách sửa test tương ứng) → ghi `blocked.md`, không tự đoán hoặc sửa source code để né lỗi test.
