# Done — 01-binance-client-config

**Status:** APPROVED

Đối chiếu `task.md` với code thật (`src/charts/binance-futures-config-env.ts`, `src/charts/binance-futures-client.ts`):
- HMAC-SHA256 signing đúng chuẩn Binance Futures REST.
- `withRetry`/`withConfiguredRateLimit` tái dùng đúng, không thêm dependency mới.
- `isHedgeModeEnabled()` implement đúng theo yêu cầu bổ sung (gọi `/fapi/v1/positionSide/dual`).
- Kill-switch `BINANCE_LIVE_TRADING_ENABLED` mặc định `false`.
- `recvWindow=10000` đúng theo cập nhật plan (NTP drift tolerance).

`npm run build` pass.
