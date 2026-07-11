# Task 03: Tính khối lượng lệnh (position sizing) theo risk 1%

## Bối cảnh

Mỗi lệnh Binance Futures phải size theo **1% rủi ro tài khoản** (`getConfiguredBinanceRiskPercentPerTrade()` từ task 01, mặc định 1): `risk_usdt = balance * risk% / 100`, `quantity = risk_usdt / |entry - stopLoss|`, sau đó làm tròn xuống theo `stepSize` của symbol (từ `getExchangeInfoFilters()` — task 01) và kiểm tra `minQty`/`minNotional`.

**Phụ thuộc:** task 01 phải xong trước (cần export `BinanceSymbolFilters` type từ `src/charts/binance-futures-client.ts`).

## Việc cần làm

Tạo file `src/charts/binance-position-sizing.ts`:

```ts
import type { BinanceSymbolFilters } from "./binance-futures-client.js";

export type PositionSizingInput = {
  balanceUsdt: number;
  riskPercent: number;
  entry: number;
  stopLoss: number;
  leverage: number;
  filters: BinanceSymbolFilters;
};

export type PositionSizingResult = {
  quantity: number;
  notional: number;
  marginRequired: number;
};

function roundDownToStep(value: number, stepSize: number): number {
  if (!(stepSize > 0)) return value;
  const steps = Math.floor(value / stepSize);
  const rounded = steps * stepSize;
  // Tránh sai số float (vd 0.1 + 0.2), làm tròn về số chữ số thập phân của stepSize
  const decimals = stepSize.toString().split(".")[1]?.length ?? 0;
  return Number(rounded.toFixed(decimals));
}

export function computeOrderQuantity(
  input: PositionSizingInput,
): PositionSizingResult | Error {
  const { balanceUsdt, riskPercent, entry, stopLoss, leverage, filters } = input;

  if (!(balanceUsdt > 0)) {
    return new Error("Balance USDT khong hop le (<= 0)");
  }
  if (!(riskPercent > 0)) {
    return new Error("Risk percent khong hop le (<= 0)");
  }
  if (!Number.isFinite(entry) || !Number.isFinite(stopLoss)) {
    return new Error("Entry/stopLoss khong hop le");
  }

  const riskDistance = Math.abs(entry - stopLoss);
  if (riskDistance <= 0) {
    return new Error("Khoang cach entry-stopLoss bang 0, khong the tinh size");
  }

  const riskUsdt = (balanceUsdt * riskPercent) / 100;
  const rawQuantity = riskUsdt / riskDistance;
  const quantity = roundDownToStep(rawQuantity, filters.stepSize);

  if (quantity <= 0 || quantity < filters.minQty) {
    return new Error(
      `Quantity tinh duoc (${quantity}) nho hon minQty (${filters.minQty}) cua symbol — bo qua lenh nay`,
    );
  }

  const notional = quantity * entry;
  if (notional < filters.minNotional) {
    return new Error(
      `Notional (${notional.toFixed(2)} USDT) nho hon minNotional (${filters.minNotional}) cua symbol — bo qua lenh nay`,
    );
  }

  const marginRequired = notional / leverage;
  if (marginRequired > balanceUsdt) {
    return new Error(
      `Margin can (${marginRequired.toFixed(2)} USDT) vuot qua balance kha dung (${balanceUsdt.toFixed(2)} USDT)`,
    );
  }

  return { quantity, notional, marginRequired };
}
```

## Ràng buộc

- Đây là hàm THUẦN (pure function) — không gọi network, không import DB/logger/Binance client thật ngoại trừ type `BinanceSymbolFilters`.
- KHÔNG sửa file nào khác ngoài tạo file mới này.
- Không throw — mọi lỗi trả về qua `Error` object, đúng convention repo.

## Cách verify

```bash
npm run build
```

## Output

Ghi vào `tasks/binance-futures-execution/03-position-sizing/result.md`:
- Đường dẫn file đã tạo
- Kết quả `npm run build`
- Tự tính tay 1 ví dụ minh hoạ (vd balance=1000, risk=1%, entry=100, stopLoss=98, leverage=5, stepSize=0.001, minQty=0.001, minNotional=5) và ghi ra kết quả mong đợi để dễ review.

Nếu bị chặn (ví dụ task 01 chưa có `BinanceSymbolFilters` export đúng tên) → ghi `blocked.md`.
