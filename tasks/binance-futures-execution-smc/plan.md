# Plan — Binance USDS-M Futures live execution cho tín hiệu SMC

**Task ID:** `binance-futures-execution-smc`
**Lead:** Sonnet 5 — đã đọc `tasks/binance-futures-execution/plan.md` (đặc biệt "Preconditions", "Quy tắc fail-safe bất biến", "Cập nhật sau khi test testnet"), 6 task.md của task đó, `src/charts/{smc-index,positions-repository-smc,check-open-trades-runner-smc,position-engine-smc,position-decision-smc,smc-charts.config,smc-config-env,chart-types-smc}.ts`, `src/charts/binance-execution-volman.ts`, `src/charts/binance-futures-client.ts`, `binance-futures-config-env.ts`, `binance-position-sizing.ts`, `deploy/windows/register-tasks.ps1`.

## Bối cảnh

Task `binance-futures-execution` (đã APPROVED, đã test end-to-end trên Binance Futures Testnet) đã tích hợp đặt lệnh thật trên Binance USDS-M Futures cho hệ **Volman**: `src/charts/binance-execution-volman.ts` orchestrate entry (SL/TP1/TP2 conditional qua Algo Order API), `check-open-trades-runner-volman.ts` reconcile order status thật thay vì đọc lại nến, `positions-repository-volman.ts` có 8 cột `binance_*`, kill-switch `BINANCE_LIVE_TRADING_ENABLED` (mặc định `false`).

Hệ **SMC** hiện chỉ lưu tín hiệu vào `open_positions_smc` (Supabase) + báo Telegram, không gọi sàn nào (`src/charts/smc-index.ts` → `handleAnalysisResult()` → `saveOpenPosition()` khi `shouldAutoTrackAsOpen()`, cấu trúc giống hệt Volman). SMC dùng `analyzeAllChartsSmc()` (`smc/smc-pipeline.ts`) làm engine phân tích khác Volman, nhưng phần "position lifecycle" (risk/reward plan, management patch, decision outcome) có kiến trúc **giống hệt Volman về type/shape** (`PositionDecisionOutcome`, `RiskRewardPlan`, `OpenPositionManagementPatch` trong `position-engine-smc.ts` trùng cấu trúc với bản Volman). `smc-charts.config.ts` cũng có mapping `BINANCE:XXXUSDT` dùng chung `isBinanceSymbol()`/`toBinanceSymbol()` trong `ohlc-provider.ts`.

Yêu cầu: tích hợp Binance Futures live execution cho SMC giống Volman — isolated, 5x, risk 1%/lệnh, SL+TP1(partial)+TP2 tự động, chỉ cho cặp Binance, forex/commodity giữ nguyên. `binance-futures-client.ts`, `binance-position-sizing.ts`, `binance-futures-config-env.ts` là **system-agnostic** (không biết Volman hay SMC) — dùng nguyên, không sửa filter/sizing math.

Job `analyze:smc` (`smc-index.ts`) đã được schedule trong `deploy/windows/register-tasks.ps1` (task `analyze-smc`, mỗi 15 phút suốt ngày, dòng 67-68) — **không cần đổi lịch**.

**Lưu ý phí — trade-off đã biết, không xử lý đợt này:** hệ SMC được validate backtest (`project_smc_m15_combo_b`) với giả định **maker fee** (entry limit), cho kết quả +0.39–0.56R/trade qua 5 window. Hệ thống live hiện tại (giống Volman) chỉ tự động mở vị thế khi `setup.orderType === "MARKET_NOW"` — tức taker fee, vì pending/limit order đã bị tắt toàn hệ thống (xem `tasks/disable-pending-orders/plan.md`, signals-only mode). Nghĩa là **live trading SMC sẽ chịu taker fee cao hơn giả định backtest**, edge thực tế mỏng hơn +0.39–0.56R đã backtest. Đây là rủi ro đã biết, KHÔNG re-enable pending/limit order trong đợt này — chỉ ghi nhận, để user tự quyết định threshold/position sizing nếu muốn bù trừ.

## Kiến trúc quyết định

### 1. Xung đột SL cross-system trên cùng symbol (vấn đề nghiêm trọng nhất)

SL đặt là `STOP_MARKET closePosition=true` — một lệnh gắn với **symbol trên sàn**, không phân biệt "đây là SL của Volman hay của SMC". Tài khoản one-way mode chỉ có 1 net position/symbol. Nếu cả Volman và SMC cùng lúc mở vị thế trên cùng symbol (vd BTCUSDT):
- 2 lệnh cùng chiều → Binance gộp thành 1 position (qty cộng dồn) → khi 1 hệ đặt SL/TP theo qty/giá kế hoạch của riêng nó, SL/TP đó sẽ đóng nhầm phần của hệ kia.
- 2 lệnh ngược chiều → position bị trừ ròng (netting), quantity chạy sai hoàn toàn so với sizing mỗi hệ tính riêng.
- Dù cùng hay ngược chiều: SL/TP `closePosition=true` khi trigger đóng **toàn bộ net position của symbol**, tức đóng luôn phần vị thế "logic" mà hệ kia đang track trong DB riêng của nó (`open_positions_volman` / `open_positions_smc`) — 2 nguồn sự thật (2 bảng DB) không còn khớp với 1 vị thế thật trên sàn.

**Giải pháp chọn: Guard "1 symbol chỉ 1 vị thế tại 1 thời điểm, hệ nào mở trước thì giữ".** Trước khi đặt entry, gọi `getPositionAmount(binanceSymbol)` (đã có sẵn trong `binance-futures-client.ts`) — nếu khác 0 (đã có net position mở trên symbol đó, bất kể do hệ nào đặt), **bỏ qua entry, KHÔNG đặt lệnh thật**, chỉ giữ signal ở dạng track-only trong DB riêng của hệ đang cố mở (giống hành vi hiện tại khi Binance live trading tắt), báo Telegram rõ lý do. Guard phải đối xứng ở **cả 2 hệ**: task này thêm guard vào `binance-execution-smc.ts` (mới) **và** thêm đúng 1 đoạn check tương tự vào `binance-execution-volman.ts` (đã tồn tại, KHÔNG đổi logic gì khác) — nếu không đối xứng, guard chỉ bảo vệ 1 chiều (SMC không giẫm lên Volman nhưng Volman vẫn giẫm lên SMC).

Lý do chọn thay vì SL quantity-based `reduceOnly`: quantity-based đòi hỏi track đúng qty còn lại của **riêng từng hệ** sau mỗi partial TP, cộng dồn đúng thứ tự fill trên 1 symbol dùng chung bởi 2 hệ độc lập — phức tạp, dễ lệch khi 2 hệ cùng update gần như đồng thời (race condition giữa 2 cron job chạy độc lập, không có lock chung), rủi ro vượt quá lợi ích (chỉ để cho phép 2 hệ cùng trade song song 1 symbol, việc không bắt buộc). Guard đơn giản, dễ verify, đúng tinh thần fail-safe của plan gốc — đánh đổi là bỏ lỡ signal nếu hệ kia đang giữ vị thế, chấp nhận được vì tần suất trùng symbol thấp và signal bị bỏ qua vẫn được log + Telegram, không mất dữ liệu.

### 2. Tái sử dụng vs. tạo file song song

`binance-futures-client.ts`, `binance-position-sizing.ts` **dùng nguyên, không sửa** — pure/system-agnostic (REST client, sizing math không biết gì về Volman/SMC). `binance-futures-config-env.ts` cũng dùng nguyên phần đã có (leverage/margin/risk%/base URL/API key) — chỉ **thêm 1 hàm mới** `isBinanceLiveTradingEnabledSmc()` cho kill-switch riêng (mục 5), không sửa hàm nào đã có.

`binance-execution-volman.ts` import cứng `position-engine-volman.js`/`positions-repository-volman.js` — không thể tái dùng trực tiếp cho SMC vì type `TradeSetup`, `RiskRewardPlan`, `OpenPosition`, hàm `calculateRiskRewardPlan`/`saveBinanceExecutionDetails` đều thuộc module riêng của từng hệ (dù cùng shape). Hai lựa chọn: (a) generalize thành 1 module chung nhận dependencies qua tham số/interface, hay (b) tạo file song song `binance-execution-smc.ts` theo đúng pattern `*-volman.ts`/`*-smc.ts` đã dùng xuyên suốt repo (`positions-repository-*`, `position-engine-*`, `check-open-trades-runner-*`...).

**Chọn (b) — file song song.** Generalize (a) đòi hỏi sửa `binance-execution-volman.ts` đã APPROVED + test kỹ trên testnet (rủi ro regression cho hệ đang chạy production), trong khi lợi ích (giảm trùng lặp ~250 dòng) không đủ bù rủi ro đụng vào code đã verify thật bằng tiền. File song song giữ nguyên `binance-execution-volman.ts` gần như 100% (chỉ thêm đúng đoạn guard đối xứng ở mục 1), nhất quán tuyệt đối với convention toàn repo, dễ review độc lập, dễ rollback riêng từng hệ nếu có sự cố.

### 3. Migration DB

`open_positions_smc` cần đúng 8 cột `binance_*` như `open_positions_volman` (`binance_symbol`, `binance_leverage`, `binance_quantity`, `binance_entry_order_id`, `binance_sl_order_id`, `binance_tp1_order_id`, `binance_tp2_order_id`, `binance_execution_status`), cùng kiểu dữ liệu, cùng convention `add column if not exists`. File migration mới, KHÔNG sửa migration cũ của Volman. Worker chỉ tạo file, KHÔNG tự `apply_migration` lên production (giống task gốc).

### 4. Phí maker vs taker

Xem "Bối cảnh" — ghi nhận rủi ro, không xử lý đợt này, không re-enable pending orders.

### 5. Kill-switch riêng cho SMC

Thêm `isBinanceLiveTradingEnabledSmc()` đọc env `BINANCE_LIVE_TRADING_ENABLED_SMC` (mặc định `false`, cùng pattern `readBooleanEnv` đã có). **Cả 2 switch phải `true` mới trade SMC thật**: `isBinanceLiveTradingEnabled()` (master, dùng chung) VÀ `isBinanceLiveTradingEnabledSmc()` (riêng SMC). Lý do: user có thể muốn bật live cho Volman (đã test kỹ) mà chưa bật cho SMC (chưa test), hoặc ngược lại, mà không cần tắt cả 2 hệ cùng lúc — tách switch cho phép kiểm soát độc lập, đúng tinh thần "tiền thật, mặc định OFF, chỉ bật khi đã test kỹ" của plan gốc áp dụng riêng cho từng hệ. Switch master vẫn giữ vai trò kill-switch tổng (tắt 1 phát là tắt hết, kể cả khi quên tắt switch riêng).

### 6. Kế thừa quy tắc fail-safe bất biến (nguyên vẹn, không đổi)

Áp dụng y hệt plan gốc cho task 03/04 của plan này:
- Không bao giờ để vị thế "trần" (không SL) mà không cảnh báo 🚨 Telegram rõ ràng.
- Đóng khẩn cấp: hủy mọi lệnh conditional đã đặt được trước, kiểm tra kết quả lệnh đóng — lệnh đóng fail thì báo "ĐANG KHÔNG CÓ BẢO VỆ", không báo "đã đóng".
- Dời SL về breakeven: đặt SL mới **trước**, hủy SL cũ **sau**.
- Lỗi ghi DB không kích hoạt đóng khẩn cấp — chỉ alert.
- Mọi giá qua `roundToTickSize`, mọi qty TP1/TP2 qua `splitTpQuantities`.
- Check one-way mode (`isHedgeModeEnabled()`) trước khi đặt bất kỳ lệnh nào.
- `execution_status = "failed"` trong reconcile phải trả `CLOSE` để đóng bản ghi DB tương ứng (không để treo mãi).

### 7. Lịch chạy

`analyze-smc` đã được schedule trong `deploy/windows/register-tasks.ps1` (dòng 67-68, mỗi 15 phút suốt ngày) — xác nhận **không đổi lịch**, không tạo task Windows mới.

## Subtasks

| # | Thư mục | Mô tả | Files chính | Phụ thuộc | Ưu tiên |
|---|---------|-------|--------------|-----------|---------|
| 01 | `01-db-migration-repository-smc` | Migration thêm 8 cột `binance_*` vào `open_positions_smc` + repository functions (mirror task 02 của plan gốc, đổi bảng) | `supabase/migrations/*.sql`, `positions-repository-smc.ts` | — | HIGH |
| 02 | `02-config-and-cross-system-guard` | Kill-switch riêng SMC + guard đối xứng chống xung đột SL cross-system (sửa cả 2 hệ) | `binance-futures-config-env.ts`, `binance-execution-volman.ts` | — | HIGH |
| 03 | `03-entry-execution-smc` | Tạo `binance-execution-smc.ts` (entry + guard), wiring vào `smc-index.ts` | `binance-execution-smc.ts`, `smc-index.ts` | 01, 02 | HIGH |
| 04 | `04-position-reconciliation-smc` | Đối chiếu order status Binance mỗi lần check-open-trades cho SMC, dời SL về BE sau TP1 | `binance-execution-smc.ts`, `check-open-trades-runner-smc.ts` | 01, 02 | HIGH |
| 05 | `05-config-docs-tests-smc` | `.env.example` thêm biến SMC, unit test cho repository mapping + guard logic | `.env.example`, `tests/charts/binance-execution-smc.test.ts`, `tests/charts/positions-repository-smc.test.ts` | 02, 03, 04 | MED |

## Thứ tự thực thi

01 và 02 làm trước, độc lập nhau (song song được — 01 chỉ đụng file `-smc`, 02 chỉ đụng `binance-futures-config-env.ts` + `binance-execution-volman.ts`, không giao nhau). 03 và 04 đều cần 01+02 xong; 03 và 04 cùng sửa file `binance-execution-smc.ts` — **PHẢI làm tuần tự, không song song** (03 tạo file trước với hàm `openBinanceFuturesPosition`, 04 chỉ được thêm hàm `reconcileBinancePosition` vào cuối file đã có, không được động vào phần 03 đã viết — giống cách task 04/05 của plan gốc xử lý `binance-execution-volman.ts`). 05 làm sau cùng, cần 02+03+04 xong.

## Verification chung

- `npm run build` — TypeScript strict mode không vỡ.
- `npm run test` — toàn bộ test hiện có (bao gồm 74/786 test của plan gốc) vẫn pass + test mới ở subtask 05.
- **Không tự `apply_migration`/deploy lên Supabase production** — Worker chỉ tạo file migration.
- Trước khi user set `BINANCE_LIVE_TRADING_ENABLED_SMC=true`: khuyến nghị mạnh test lại trên testnet (`BINANCE_FUTURES_BASE_URL=https://testnet.binancefuture.com`) dù client đã verify với Volman — luồng SMC là code path mới (file mới, wiring mới) chưa từng gọi Binance thật.
- Guard cross-system (subtask 02) nên được verify thủ công: mở 1 vị thế test trên 1 symbol qua 1 hệ (vd Volman testnet), sau đó kích hệ kia (SMC) trade cùng symbol → xác nhận SMC bị guard chặn + có Telegram alert, KHÔNG đặt lệnh thật.

## Ngoài phạm vi (không làm đợt này)

- Không đổi lịch cron/Task Scheduler.
- Không xử lý forex/commodity — giữ nguyên hành vi hiện tại (chỉ track + Telegram).
- Không re-enable pending/limit order (`tasks/disable-pending-orders/plan.md` vẫn có hiệu lực) dù backtest SMC giả định maker fee — chỉ ghi nhận rủi ro taker fee ở "Bối cảnh".
- Không xây SL quantity-based `reduceOnly` cho phép 2 hệ cùng trade 1 symbol song song — đã chọn guard đơn giản (mục Kiến trúc quyết định #1).
- Không generalize `binance-execution-volman.ts` thành module dùng chung — giữ file song song theo convention repo.
- Không ghi nhận giá khớp thật (`avgPrice`/slippage) — kế thừa trade-off v1 của plan gốc.
- Không xử lý trường hợp user can thiệp tay trên sàn.
- Không tự tạo API key Binance hay tự deploy migration lên production.
