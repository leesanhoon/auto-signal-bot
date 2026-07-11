# Review — Binance Futures Execution (Lead Review, độc lập với done.md của Worker)

**Ngày review:** 2026-07-11
**Phạm vi:** toàn bộ working-tree changes chưa commit liên quan Binance execution.

## Kết luận

`npm run build` pass, `npm run test` pass 74/74 file — 792/792 test. Không có secret hardcode trong code/test (chỉ đọc từ `process.env`, test dùng chuỗi giả `"test_key"`/`"test_secret"`). Migration SQL an toàn, idempotent (`add column if not exists`, chỉ thêm cột nullable, không đổi/xóa dữ liệu cũ, không cần rollback script vì additive-only).

Fail-safe logic trong `src/charts/binance-execution-volman.ts` đúng theo quy tắc bất biến trong `plan.md`:
- Entry fill trước, SL/TP đặt sau; nếu SL/TP fail → hủy hết `placedProtectionOrders`, đóng khẩn cấp bằng `reduceOnly`, kiểm tra kết quả đóng và phân biệt rõ 2 message Telegram ("đã đóng an toàn" vs "🚨🚨 KHẨN CẤP — vị thế không có SL, đóng tay ngay") — dòng 128-219.
- Dời SL về breakeven: đặt SL mới trước (dòng 352), chỉ hủy SL cũ sau khi đặt mới thành công (dòng 353-356); nếu đặt mới fail thì giữ nguyên SL cũ, không ghi `newStopLoss` sai vào DB (dòng 358-372) — đúng plan dòng 34.
- Lỗi ghi DB sau khi vị thế đã có đủ SL/TP trên sàn không kích hoạt đóng khẩn cấp, chỉ alert Telegram (dòng 221-243) — đúng plan dòng 35.
- `execution_status = "failed"` được `reconcileBinancePosition` đóng DB tương ứng (dòng 271-286), tránh vị thế treo mãi mãi.

Kết luận: **code phần Binance execution (task 01, 03, 04, 05, 06) đạt yêu cầu, sẵn sàng commit về mặt kỹ thuật.** Tuy nhiên có các vấn đề cần user quyết định/xử lý trước khi commit, liệt kê bên dưới.

## Vấn đề tìm thấy

### 1. [HIGH — Scope creep, không thuộc Binance execution] `.env.example` bị đổi `CHART_TIMEFRAME_MODE`/`CHART_PRIMARY_TIMEFRAME`

File: `.env.example` dòng 17-24 (bản diff).
Thay đổi `CHART_TIMEFRAME_MODE=multi` → `single`, `CHART_PRIMARY_TIMEFRAME=M15` → `H4`. Đây là thay đổi **production target config**, không liên quan gì tới Binance execution — không nằm trong scope bất kỳ task nào trong `plan.md` (`## Ngoài phạm vi` không đề cập, và mô tả 6 subtask chỉ nói thêm block `BINANCE_*` vào `.env.example`).

**Action:** Tách riêng thay đổi này ra khỏi commit Binance execution. Nếu đây là thay đổi có chủ ý (đổi timeframe production sang H4), nó cần review/quyết định riêng và nên đi cùng commit khác có message rõ ràng, không lẫn vào feature Binance.

### 2. [HIGH — Scope creep, thuộc task khác đã "done" riêng] `setup-backtest.ts`, `setup-backtest-runner.ts`, `setup-backtest-compare-runner.ts` (mới), `tests/charts/setup-backtest.test.ts`

Các thay đổi này (thêm `FillMode`, `pendingOrder` simulation, `printReport` in thêm `PENDING ORDER STATS`, script mới `setup-backtest-compare-runner.ts`, script `npm run backtest:compare` trong `package.json`) thuộc về task **`tasks/backtest-pending-order-simulation/`** — một plan hoàn toàn khác, đã có `plan.md` + `done.md` riêng trong thư mục đó, không liên quan tới Binance execution.

`package.json` cũng bị thêm script `"backtest:compare"` (dòng 20) — cùng nguồn gốc, không thuộc scope `plan.md` của Binance execution.

**Action:** Đây không phải lỗi chức năng (task đó tự nó có vẻ đã hoàn tất và có review riêng), nhưng đang bị lẫn chung working tree với Binance execution. **Commit tách biệt** theo từng task-id để lịch sử git rõ ràng và để nếu cần rollback 1 trong 2 feature thì không đụng vào feature kia. Không cần Worker sửa gì thêm — chỉ là vấn đề tổ chức commit.

### 3. [MEDIUM] Thiếu test cho `binance-execution-volman.ts` — chỉ có test cho sizing math và 1 nhánh lỗi env của client, chưa test luồng fail-safe

`tests/charts/binance-futures-client.test.ts` chỉ cover 3 case "thiếu API key/secret" — hoàn toàn chưa test:
- HMAC signing đúng (mục tiêu chính task 06 "unit test cho signing").
- Chuẩn hóa `algoStatus: "TRIGGERED"` → `"FILLED"` trong `getOrderStatus` (`binance-futures-client.ts:315-317`) — logic quan trọng vì Binance đổi API sang Algo Order, nếu sai thì `reconcileBinancePosition` không bao giờ nhận diện được SL/TP đã khớp.
- Tolerant lỗi `-4046` (margin type) và `-2011` (cancel order not found) — 2 nhánh dòng 197 và 295.

`binance-execution-volman.ts` (file quan trọng nhất chứa toàn bộ fail-safe logic) **không có file test riêng nào**. Toàn bộ luồng "SL/TP đặt fail → hủy lệnh treo → đóng khẩn cấp → verify kết quả đóng → phân biệt 2 message Telegram" chỉ được xác nhận qua đọc code + 1 lần chạy tay trên testnet (ghi trong `plan.md` dòng 14-16), chưa có test tự động để bảo vệ khi refactor sau này.

**Action (không bắt buộc phải chặn commit, nhưng nên làm sớm):** Bổ sung test cho `getOrderStatus` (TRIGGERED→FILLED), `setMarginType`/`cancelOrder` tolerant-error branches, và ít nhất 1 test cho `openBinanceFuturesPosition` mock hóa `binance-futures-client` để verify fail-safe path (giả lập `placeStopMarketOrder` trả Error → verify `cancelOrder` được gọi cho mọi `placedProtectionOrders`, `placeMarketOrder({reduceOnly:true})` được gọi, và `saveBinanceExecutionDetails` ghi `status: "failed"`).

### 4. [LOW — cần user tự lưu ý, không phải bug] `BINANCE_FUTURES_BASE_URL` default trỏ production

`binance-futures-config-env.ts:45` và `.env.example` dòng cuối: default là `https://fapi.binance.com` (production), không phải testnet. Plan có "khuyến nghị mạnh" chạy testnet trước (dòng 12, 41-42 comment trong code) nhưng không **bắt buộc** bằng code — nếu user copy `.env.example` sang `.env` và điền API key thật mà quên đổi URL, lệnh đầu tiên sẽ vào thẳng production. Rủi ro này đã được giảm bằng kill-switch `BINANCE_LIVE_TRADING_ENABLED=false` mặc định (đúng, xác nhận không có rủi ro vô tình bật live nếu user không tự set `true`) — nhưng khi user set `true` để test, nếu quên đổi base URL thì test "trên testnet" thực chất chạy trên production.

**Action:** Không bắt buộc sửa code (đúng như plan mô tả trade-off có chủ đích). Chỉ khuyến nghị: khi hướng dẫn user set up `.env` thật, nhắc lại rõ ràng phải đổi `BINANCE_FUTURES_BASE_URL` sang testnet trước, đúng như comment đã có sẵn.

### 5. [INFO] `tasks/binance-futures-execution-smc/` — plan song song, chưa có code/done.md

Thư mục này chỉ có `plan.md` + các `task.md` con, chưa có `result.md`/`done.md`, không có code nào trong `src/` liên quan tới SMC execution. Không ảnh hưởng review này, chỉ là công việc dự kiến làm sau (bản SMC song song với bản Volman đã xong). Không cần xử lý gì trước khi commit Binance/Volman.

## Xác nhận theo checklist yêu cầu

- Fail-safe logic thứ tự: **đạt**.
- `.env.example` kill-switch default: **đạt** (`BINANCE_LIVE_TRADING_ENABLED=false`); base URL default production — xem mục 4 (rủi ro thấp, không phải bug).
- Secret hardcode: **không có**.
- `setup-backtest*.ts` thuộc scope Binance execution: **không** — thuộc `tasks/backtest-pending-order-simulation/`, xem mục 2.
- `tasks/backtest-pending-order-simulation/`, `tasks/binance-futures-execution-smc/` lẫn vào working tree: **đúng, không liên quan Binance execution**, xem mục 2 và mục 5.
- Migration SQL an toàn: **đạt**.
- Test coverage nhánh fail-safe: **chưa đủ** — xem mục 3.
