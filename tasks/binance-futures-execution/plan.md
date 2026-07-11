# Plan — Binance USDS-M Futures live execution cho tín hiệu Volman

**Task ID:** `binance-futures-execution`
**Lead:** Sonnet 5 — đã đọc `src/charts/index.ts`, `check-open-trades-runner-volman.ts`, `check-pending-orders-runner-volman.ts`, `position-engine-volman.ts`, `positions-repository-volman.ts`, `ohlc-provider.ts`, `volman-charts.config.ts`, `src/shared/infra/{retry,rate-limit}.ts`, `deploy/windows/run-job.ps1`.

## Bối cảnh

Hệ thống Volman hiện tại chỉ lưu tín hiệu vào Supabase (`open_positions_volman`) và báo Telegram — **không gọi sàn nào**. Position "mở" trong DB khi setup có `orderType === "MARKET_NOW"` và confidence đủ ngưỡng, qua `saveOpenPosition()` (`src/charts/index.ts:212`). Mỗi lần job `analyze` chạy (tự động định kỳ qua Windows Task Scheduler trên mini PC — xem `deploy/windows/run-job.ps1`, **không cần đổi lịch chạy**), `runCheckOpenTrades()` so nến với SL/TP1/TP2 để ra quyết định `PARTIAL_TP1`/`MOVE_SL_TO_BE`/`TP2_CLOSE`/`STOP`.

Yêu cầu: với các cặp **crypto** (đã có mapping `BINANCE:XXXUSDT` trong `volman-charts.config.ts`, nhận diện qua `isBinanceSymbol()`/`toBinanceSymbol()` có sẵn trong `src/charts/ohlc-provider.ts`), bot phải **tự động đặt lệnh thật trên Binance USDS-M Futures** (isolated, 5x, risk 1% equity/lệnh mỗi vị thế), kèm SL + TP1 (partial) + TP2, không cần người xác nhận. Cặp forex/commodity (OANDA:*) **giữ nguyên 100%** hành vi hiện tại — không có thị trường futures tương ứng.

Vì đây là tiền thật + tự động hoàn toàn ngay từ đầu, có 1 kill-switch riêng mặc định **OFF** (`BINANCE_LIVE_TRADING_ENABLED=false`) — chỉ set `true` khi user đã build xong và test kỹ. `BINANCE_FUTURES_BASE_URL` configurable nên **khuyến nghị mạnh**: chạy end-to-end trên testnet (`https://testnet.binancefuture.com`, API key testnet riêng) trước khi trỏ về production — các lỗi filter (tickSize/stepSize/minNotional) chỉ lộ ra khi gọi API thật.

## Cập nhật sau khi test testnet end-to-end (2026-07-11)

Đã chạy thử 1 vòng đầy đủ (entry + SL + TP1 + TP2 + query status + cancel + đóng vị thế) trên Binance Futures Testnet, phát hiện và fix 1 bug nghiêm trọng: từ 2025-12-09 Binance migrate các lệnh điều kiện (`STOP_MARKET`, `TAKE_PROFIT_MARKET`...) sang **Algo Order API** (`/fapi/v1/algoOrder`), lệnh cũ qua `/fapi/v1/order` bị từ chối lỗi `-4120`. Đây là breaking change thật của Binance, ảnh hưởng **cả production** — nếu không fix, mọi lần mở vị thế thật sẽ luôn fail đặt SL/TP và kích hoạt fail-safe đóng khẩn cấp ngay sau khi vừa mở. Đã sửa trực tiếp `src/charts/binance-futures-client.ts` (chi tiết xem ghi chú đầu `01-binance-client-config/task.md`), verify lại testnet thành công, `npm run build && npm run test` pass (74/786).

## Preconditions (user phải đảm bảo trước khi bật live)

1. **Tài khoản Futures phải ở One-way mode** (không phải Hedge mode) — mọi lệnh trong plan này không gửi `positionSide`, sẽ fail với code -4061 nếu account đang ở Hedge mode. Code sẽ tự kiểm tra qua `GET /fapi/v1/positionSide/dual` và từ chối đặt lệnh + báo Telegram nếu sai mode (xem task 04).
2. **Đồng hồ mini PC phải sync NTP** — signed request dùng `recvWindow=10000`; nếu clock Windows lệch >10s sẽ dính lỗi -1021 hàng loạt. Kiểm tra: Settings → Time & Language → "Sync now", hoặc `w32tm /resync`.
3. **API key Binance** chỉ cần quyền *Enable Futures*, KHÔNG bật quyền withdraw; nên restrict IP về IP mini PC.

## Kiến trúc quyết định

**Nguyên tắc cốt lõi: Binance là nguồn sự thật khi đóng lệnh, không phải nến.**
SL/TP là lệnh thật đặt ngay lúc entry (`STOP_MARKET closePosition=true`, `TAKE_PROFIT_MARKET reduceOnly`). Mỗi lần check-open-trades chạy, với position có gắn `binance_symbol`, ta hỏi **order status thật trên Binance** thay vì đọc lại nến — tránh 2 nguồn sự thật xung đột nhau. Nhờ vậy không cần sửa `position-engine-volman.ts` (logic R:R/patch derivation dùng lại y nguyên) — chỉ thêm 1 nguồn `PositionDecisionOutcome` mới song song nguồn cũ (nến, vẫn dùng cho forex/commodity).

Không đổi lịch cron/Task Scheduler. Không xử lý forex/commodity (giữ nguyên track + Telegram, không gọi Binance). Không tự tạo API key hay tự chạy migration lên production — user tự làm, Worker chỉ chuẩn bị code.

**Quy tắc fail-safe bất biến (áp dụng cho task 04/05):**
- Không bao giờ để vị thế "trần" (không SL) mà không có cảnh báo 🚨 rõ ràng tới Telegram.
- Khi đóng khẩn cấp: phải **hủy mọi lệnh conditional đã đặt được** (SL `closePosition=true` còn treo sẽ đóng nhầm vị thế tương lai của cùng symbol) và **kiểm tra kết quả lệnh đóng** — nếu chính lệnh đóng fail, báo Telegram là vị thế ĐANG KHÔNG CÓ BẢO VỆ, yêu cầu xử lý tay, tuyệt đối không báo "đã đóng".
- Khi dời SL về breakeven: đặt SL mới **trước**, hủy SL cũ **sau** — nếu đặt SL mới fail thì SL cũ vẫn còn, vị thế luôn có bảo vệ.
- Lỗi ghi DB (Supabase) không được kích hoạt đóng khẩn cấp — vị thế trên sàn vẫn khỏe mạnh, chỉ cần alert để user đối chiếu tay.

## Subtasks

| # | Thư mục | Mô tả | Files chính | Phụ thuộc | Ưu tiên |
|---|---------|-------|--------------|-----------|---------|
| 01 | `01-binance-client-config` | REST client ký HMAC + rate-limit/retry, env config | `binance-futures-config-env.ts`, `binance-futures-client.ts` | — | HIGH |
| 02 | `02-db-migration-repository` | Migration thêm cột Binance execution + repository functions | `supabase/migrations/*.sql`, `positions-repository-volman.ts` | — | HIGH |
| 03 | `03-position-sizing` | Tính qty theo risk 1% + helpers làm tròn giá theo `tickSize`, chia qty TP1/TP2 theo `stepSize` | `binance-position-sizing.ts` | 01 | MED |
| 04 | `04-entry-execution` | Đặt entry+SL+TP1+TP2 lúc mở lệnh (check one-way mode, round giá/qty theo filters), fail-safe khi lỗi giữa chừng (hủy lệnh treo + verify lệnh đóng), wiring vào `index.ts` | `binance-execution-volman.ts`, `index.ts` | 01, 02, 03 | HIGH |
| 05 | `05-position-reconciliation` | Đối chiếu order status mỗi lần check-open-trades, dời SL về BE sau TP1 (đặt SL mới trước rồi mới hủy SL cũ), đóng DB khi SL/TP2 filled hoặc execution `failed` | `binance-execution-volman.ts`, `check-open-trades-runner-volman.ts` | 01, 02 | HIGH |
| 06 | `06-config-docs-tests` | `.env.example`, unit test cho signing + sizing/rounding math | `.env.example`, `tests/charts/binance-*.test.ts` | 01, 03 | MED |

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
- **Không ghi nhận giá khớp thật (`avgPrice`/slippage)** — trade-off có chủ đích cho v1: DB đóng vị thế theo giá kế hoạch (SL/TP đã lưu), không theo giá fill thật trên sàn. PnL trong DB có thể lệch nhẹ so với PnL thật do slippage. Nâng cấp sau nếu cần.
- Không xử lý trường hợp user can thiệp tay trên sàn (tự đóng vị thế, tự hủy lệnh) — reconcile chỉ dựa trên order ID bot đã đặt; nếu can thiệp tay, user tự đối chiếu DB.
