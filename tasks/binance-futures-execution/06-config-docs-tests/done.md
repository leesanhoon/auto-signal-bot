# Done — 06-config-docs-tests

**Status:** APPROVED

`.env.example` có đủ block Binance với kill-switch mặc định `false`, ghi chú testnet URL. 2 file test mới (`binance-futures-client.test.ts`, `binance-position-sizing.test.ts`) cover đủ case theo task.md kể cả `roundToTickSize`/`splitTpQuantities`.

`npm run build && npm run test` pass.
