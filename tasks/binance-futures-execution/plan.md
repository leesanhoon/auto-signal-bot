# Plan — Binance USDS-M Futures live execution cho tín hiệu Volman

**Task ID:** `binance-futures-execution`
**Lead:** Sonnet 5 — đã đọc `src/charts/index.ts`, `check-open-trades-runner-volman.ts`, `check-pending-orders-runner-volman.ts`, `position-engine-volman.ts`, `positions-repository-volman.ts`, `ohlc-provider.ts`, `volman-charts.config.ts`, `src/shared/infra/{retry,rate-limit}.ts`, `deploy/windows/run-job.ps1`.

## Bối cảnh

Hệ thống Volman hiện tại chỉ lưu tín hiệu vào Supabase (`open_positions_volman`) và báo Telegram — **không gọi sàn nào**. Position "mở" trong DB khi setup có `orderType === "MARKET_NOW"` và confidence đủ ngưỡng, qua `saveOpenPosition()` (`src/charts/index.ts:212`). Mỗi lần job `analyze` chạy (tự động định kỳ qua Windows Task Scheduler trên mini PC — xem `deploy/windows/run-job.ps1`, **không cần đổi lịch chạy**), `runCheckOpenTrades()` so nến với SL/TP1/TP2 để ra quyết định `PARTIAL_TP1`/`MOVE_SL_TO_BE`/`TP2_CLOSE`/`STOP`.

Yêu cầu: với các cặp **crypto** (đã có mapping `BINANCE:XXXUSDT` trong `volman-charts.config.ts`, nhận diện qua `isBinanceSymbol()`/`toBinanceSymbol()` có sẵn trong `src/charts/ohlc-provider.ts`), bot phải **tự động đặt lệnh thật trên Binance USDS-M Futures** (isolated, 5x, risk 1% equity/lệnh mỗi vị thế), kèm SL + TP1 (partial) + TP2, không cần người xác nhận. Cặp forex/commodity (OANDA:*) **giữ nguyên 100%** hành vi hiện tại — không có thị trường futures tương ứng.

Vì đây là tiền thật + tự động hoàn toàn ngay từ đầu (live, không qua testnet), có 1 kill-switch riêng mặc định **OFF** (`BINANCE_LIVE_TRADING_ENABLED=false`) — chỉ set `true` khi user đã build xong và test kỹ.

## Kiến trúc quyết định

**Nguyên tắc cốt lõi: Binance là nguồn sự thật khi đóng lệnh, không phải nến.**
SL/TP là lệnh thật đặt ngay lúc entry (`STOP_MARKET closePosition=true`, `TAKE_PROFIT_MARKET reduceOnly`). Mỗi lần check-open-trades chạy, với position có gắn `binance_symbol`, ta hỏi **order status thật trên Binance** thay vì đọc lại nến — tránh 2 nguồn sự thật xung đột nhau. Nhờ vậy không cần sửa `position-engine-volman.ts` (logic R:R/patch derivation dùng lại y nguyên) — chỉ thêm 1 nguồn `PositionDecisionOutcome` mới song song nguồn cũ (nến, vẫn dùng cho forex/commodity).

Không đổi lịch cron/Task Scheduler. Không xử lý forex/commodity (giữ nguyên track + Telegram, không gọi Binance). Không tự tạo API key hay tự chạy migration lên production — user tự làm, Worker chỉ chuẩn bị code.

## Subtasks

| # | Thư mục | Mô tả | Files chính | Phụ thuộc | Ưu tiên |
|---|---------|-------|--------------|-----------|---------|
| 01 | `01-binance-client-config` | REST client ký HMAC + rate-limit/retry, env config | `binance-futures-config-env.ts`, `binance-futures-client.ts` | — | HIGH |
| 02 | `02-db-migration-repository` | Migration thêm cột Binance execution + repository functions | `supabase/migrations/*.sql`, `positions-repository-volman.ts` | — | HIGH |
| 03 | `03-position-sizing` | Tính qty theo risk 1%, làm tròn theo exchange filters | `binance-position-sizing.ts` | 01 | MED |
| 04 | `04-entry-execution` | Đặt entry+SL+TP1+TP2 lúc mở lệnh, fail-safe khi lỗi giữa chừng, wiring vào `index.ts` | `binance-execution-volman.ts`, `index.ts` | 01, 02, 03 | HIGH |
| 05 | `05-position-reconciliation` | Đối chiếu order status mỗi lần check-open-trades, dời SL về BE sau TP1, đóng DB khi SL/TP2 filled | `binance-execution-volman.ts`, `check-open-trades-runner-volman.ts` | 01, 02 | HIGH |
| 06 | `06-config-docs-tests` | `.env.example`, unit test cho signing + sizing math | `.env.example`, `tests/charts/binance-*.test.ts` | 01, 03 | MED |

## Thứ tự thực thi

01, 02 làm trước và độc lập nhau (song song được). 03 cần 01 xong. 04 cần 01+02+03 xong. 05 cần 01+02 xong (làm song song với 04). 06 làm sau cùng, cần 01+03 xong.

## Verification chung

- `npm run build` — TypeScript strict mode không vỡ.
- `npm run test` — toàn bộ test hiện có vẫn pass + test mới ở subtask 06.
- **Không tự `apply_migration`/deploy lên Supabase production** — Worker chỉ tạo file migration, chạy thử bằng `list_migrations`/`execute_sql` nếu cần kiểm tra cú pháp, việc apply thật do user quyết định.
- Trước khi user set `BINANCE_LIVE_TRADING_ENABLED=true`: chạy thử `npm run analyze` local với `BINANCE_LIVE_TRADING_ENABLED=false` để xem code path không lỗi (dry-run, không gọi Binance thật vì kill-switch tắt).

## Ngoài phạm vi (không làm đợt này)

- Không đổi lịch cron/Task Scheduler (đã tự động qua mini PC).
- Không xử lý forex/commodity — giữ nguyên hành vi hiện tại.
- Không xây dashboard/UI riêng — vẫn dùng Telegram + Supabase như hệ thống hiện có.
- Không tự tạo API key Binance hay tự deploy migration lên production.
