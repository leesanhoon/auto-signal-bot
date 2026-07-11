# Task 06: `.env.example` + unit test cho signing/sizing

## Bối cảnh

**Phụ thuộc: task 01, 03 phải xong trước.** Task này chỉ thêm tài liệu env var và test cho phần logic thuần (không cần gọi Binance thật, không cần network).

## Việc cần làm

### File 1: `.env.example` (sửa — thêm block mới)

Thêm vào cuối file (sau dòng `CHART_TRADING_SYSTEM = smc`), đúng convention đặt tên đã dùng trong file (uppercase snake_case, comment tiếng Việt ngắn gọn phía trên mỗi nhóm):

```
# Binance USDS-M Futures — thực thi lệnh thật cho tín hiệu Volman (chỉ cặp crypto)
# BINANCE_LIVE_TRADING_ENABLED: kill-switch, mac dinh false. CHI set true khi da test ky.
BINANCE_API_KEY=your_binance_futures_api_key_here
BINANCE_API_SECRET=your_binance_futures_api_secret_here
BINANCE_LIVE_TRADING_ENABLED=false
BINANCE_LEVERAGE=5
BINANCE_MARGIN_TYPE=ISOLATED
BINANCE_RISK_PERCENT_PER_TRADE=1
# Test end-to-end voi testnet TRUOC khi live: doi thanh https://testnet.binancefuture.com (API key testnet rieng)
BINANCE_FUTURES_BASE_URL=https://fapi.binance.com
# BINANCE_RATE_LIMIT_RPM=300   # mac dinh 300 request/phut
```

### File 2: `tests/charts/binance-position-sizing.test.ts` (tạo mới)

Viết test dùng `vitest` (xem cú pháp mẫu bất kỳ file `tests/charts/*.test.ts` khác trong repo để đúng import style — thường là `import { describe, it, expect } from "vitest";`). Test tối thiểu các case sau cho `computeOrderQuantity` (từ `src/charts/binance-position-sizing.ts`):

1. Case hợp lệ: `balanceUsdt=1000, riskPercent=1, entry=100, stopLoss=98, leverage=5, filters={stepSize:0.001, minQty:0.001, tickSize:0.01, minNotional:5}` → kỳ vọng `quantity` xấp xỉ `5 / 2 = 2.5` (làm tròn xuống theo stepSize 0.001 → 2.5 đã khớp step), `notional` xấp xỉ `250`, không phải `Error`.
2. Case risk distance = 0 (`entry === stopLoss`) → phải trả về `Error`.
3. Case quantity tính ra nhỏ hơn `minQty` → phải trả về `Error`.
4. Case notional nhỏ hơn `minNotional` → phải trả về `Error`.
5. Case margin cần thiết vượt quá balance khả dụng → phải trả về `Error`.

Thêm test cho 2 helper rounding (cùng file, describe block riêng):

6. `roundToTickSize`: `roundToTickSize(64123.4567, 0.1) === 64123.5`; `roundToTickSize(0.123456, 0.0001) === 0.1235`; tickSize không hợp lệ (`0` hoặc âm) → trả về giá nguyên bản; kết quả không có dư số float (vd `roundToTickSize(1.005, 0.01)` phải là số khớp đúng 2 chữ số thập phân).
7. `splitTpQuantities`: `splitTpQuantities(0.007, 50, 0.001)` → `{tp1Quantity: 0.003, tp2Quantity: 0.004}` (tp1 làm tròn XUỐNG, phần dư dồn về tp2); tổng `tp1Quantity + tp2Quantity` luôn bằng đúng `totalQuantity`; case `partialClosePercent=100` → tp2Quantity = 0.

### File 3: `tests/charts/binance-futures-client.test.ts` (tạo mới)

Test cho phần signing (HMAC) — vì hàm `signedRequest` là private không export, chỉ cần test các hàm PUBIC không cần network thật:
- Test rằng khi `BINANCE_API_KEY`/`BINANCE_API_SECRET` không được set (`delete process.env.BINANCE_API_KEY` trước test), gọi bất kỳ hàm nào cần signed request (ví dụ `getAvailableBalanceUsdt()`) phải trả về `Error` với message chứa `"chua duoc cau hinh"`, KHÔNG throw.

Ví dụ cấu trúc test:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { getAvailableBalanceUsdt } from "../../src/charts/binance-futures-client.js";

describe("binance-futures-client", () => {
  beforeEach(() => {
    delete process.env.BINANCE_API_KEY;
    delete process.env.BINANCE_API_SECRET;
  });

  it("tra ve Error khi chua co API key/secret", async () => {
    const result = await getAvailableBalanceUsdt();
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toContain("chua duoc cau hinh");
  });
});
```

## Ràng buộc

- KHÔNG viết test gọi Binance API thật (không có network call thật trong test suite).
- KHÔNG sửa file test nào khác ngoài 2 file mới tạo ở trên.
- Giữ nguyên format `.env.example` hiện có (không xoá/sửa các dòng khác).

## Cách verify

```bash
npm run build
npm run test
```
Toàn bộ test (cũ + mới) phải pass.

## Output

Ghi vào `tasks/binance-futures-execution/06-config-docs-tests/result.md`:
- Đoạn đã thêm vào `.env.example`
- Nội dung 2 file test đã tạo
- Kết quả `npm run build && npm run test`

Nếu bị chặn (ví dụ không rõ cú pháp test chuẩn của repo) → đọc 1 file `tests/charts/*.test.ts` bất kỳ để bám theo, không tự bịa cấu trúc khác. Nếu vẫn không chắc → ghi `blocked.md`.
