# Lead Review — smc-backtest-fixes (rev 2)

Verdict: **APPROVED cho phần backtest fixes** — Worker không có deviation.
Còn 1 issue cấu hình do thay đổi ngoài task (user tự thêm pairs), xử lý riêng bên dưới.
Ngày: 2026-07-10
Reviewer: Lead

## Kết quả review Worker (tasks 01–03)

- **Task 01**: `fillSignal` từ `triggerIndex + 1`; TP chỉ xét khi `i > fillIndex`, SL vẫn xét trên nến fill; assumptions cập nhật đúng. ✅
- **Task 02**: `MAX_HOLD_BARS = 96`, outcome `expired_hold` exit tại close với RR đúng công thức, slot giải phóng qua `exitIndex`; runner hiển thị `expiredHold` đủ 4 vị trí. ✅
- **Task 03**: 6 test cũ sửa đúng, 4 test mới (a–d) đủ. Lead tự chạy verify: build pass, **749/749 tests pass**. ✅
- Kết quả sau fix: win rate 84.5% → ~46%, avgRR 1.68 → ~0.41, avgBarsHeld 1.2 → ~2.5 — đúng kỳ vọng khi loại look-ahead bias. Đây là baseline trung thực.

Ghi chú rev 2: bản review đầu quy các thay đổi `smc-charts.config.ts`, `volman-charts.config.ts`, `package.json` là deviation của Worker — **rút lại**, user xác nhận tự thay đổi các file này.

## Issue còn lại (thuộc thay đổi config của user, cần fix trước khi chạy thật)

Lead đã verify từng symbol mới với Binance API (`/api/v3/exchangeInfo`):

| Symbol trong config | Kết quả Binance | Ghi chú |
|---|---|---|
| DASHUSDT, BCHUSDT, AVAUSDT, ETCUSDT, NEOUSDT | TRADING ✅ | OK |
| XMRUSDT | **BREAK** ⚠️ | Đã ngừng giao dịch (delisted) — nên bỏ |
| SANUSDT | **INVALID** ❌ | Có lẽ định là SANDUSDT (The Sandbox) |
| LNKUSDT | **INVALID** ❌ | Có lẽ định là LINKUSDT (Chainlink) |
| NERUSDT | **INVALID** ❌ | Có lẽ định là NEARUSDT (NEAR) |
| ALGUSDT | **INVALID** ❌ | Có lẽ định là ALGOUSDT (Algorand) |
| AAVUSDT | **INVALID** ❌ | Có lẽ định là AAVEUSDT (Aave) |

5 symbol invalid + 1 delisted sẽ fail fetch ở backtest và pipeline analyze chạy thật (GitHub workflows) — runner chỉ log warn rồi skip, nên dễ bị bỏ sót.

**Action đề xuất** (áp dụng cho cả `smc-charts.config.ts` và `volman-charts.config.ts`, tên hiển thị sửa tương ứng):

- `SAN/USDT` → `SAND/USDT` / `BINANCE:SANDUSDT`
- `LNK/USDT` → `LINK/USDT` / `BINANCE:LINKUSDT`
- `NER/USDT` → `NEAR/USDT` / `BINANCE:NEARUSDT`
- `ALG/USDT` → `ALGO/USDT` / `BINANCE:ALGOUSDT`
- `AAV/USDT` → `AAVE/USDT` / `BINANCE:AAVEUSDT`
- Bỏ `XMR/USDT` (BREAK)
- `AVA/USDT`: AVAUSDT là Travala.com — nếu ý định là Avalanche thì đổi thành `AVAX/USDT` / `BINANCE:AVAXUSDT`

## Lưu ý acceptance criterion SHIB

SHIB đã bị loại khỏi config nên criterion "SHIB không còn bị khoá slot" không kiểm chứng trực tiếp được trên backtest thật; tuy nhiên test d (expired_hold giải phóng slot) đã chứng minh cơ chế ở mức unit test. Chấp nhận.

## Kết luận

- Backtest fixes: **DONE** — sẵn sàng ghi done.md sau khi config symbols được sửa.
- Không commit cho tới khi user xác nhận danh sách pairs cuối cùng.
