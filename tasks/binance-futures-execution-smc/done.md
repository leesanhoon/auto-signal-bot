# APPROVED — binance-futures-execution-smc

Ngày review: 2026-07-11
Reviewer: Lead (Sonnet 5)

Đã đọc `plan.md` (mục "Kiến trúc quyết định" 1-7, "Quy tắc fail-safe bất biến") và 5 `task.md`/`result.md`, đối chiếu với code thực tế. Verify lại `npm run build` (pass, no TS error) và `npm run test` (75 test files, 797/797 pass) tại thời điểm review — kết quả khớp với báo cáo của Worker.

## Bằng chứng đã kiểm tra

### 1. Guard cross-system đối xứng (mục #1)
- `src/charts/binance-execution-volman.ts` dòng 69-90: guard `getPositionAmount` chèn đúng ngay sau khối `if (hedgeMode) {...}` (dòng 69-73), trước `getExchangeInfoFilters` (dòng 92) — đúng vị trí task 02 yêu cầu.
- `src/charts/binance-execution-smc.ts` dòng 67-93: guard tương tự, cùng vị trí (sau hedge-mode check, trước filters).
- Cả 2 nơi đều: chỉ bỏ qua entry khi `existingPositionAmt !== 0` và không phải `Error` (lỗi mạng không bị coi là "có vị thế" — đúng ràng buộc task 02), đều gọi `sendMessage` với message rõ hệ nào bị chặn (`(Volman)` / `(SMC)`), đều `return` không đặt lệnh thật. Guard đối xứng thật, không chỉ 1 chiều.

### 2. Kill-switch riêng SMC (mục #5)
- `src/charts/binance-futures-config-env.ts` dòng 56-58: `isBinanceLiveTradingEnabledSmc()` thêm đúng cuối file, dùng lại `readBooleanEnv`, không sửa hàm cũ.
- `src/charts/smc-index.ts` dòng 161: `if (isBinanceLiveTradingEnabled() && isBinanceLiveTradingEnabledSmc())` — cả 2 switch phải `true`, đúng logic AND yêu cầu.

### 3. Quy tắc fail-safe bất biến (mục #6) — kiểm tra trong `binance-execution-smc.ts`
- Không để vị thế trần: khối `catch (protectionError)` (dòng 167-227) luôn có nhánh gửi Telegram 🚨 khi đặt SL/TP fail, phân biệt rõ "đã đóng khẩn cấp" vs "🚨🚨 KHẨN CẤP — đóng cũng fail, VỊ THẾ KHÔNG CÓ SL, đóng tay ngay" tùy `closeResult instanceof Error`.
- Dời SL về BE: dòng 360-365 (`reconcileBinancePosition`) — đặt `newSl` TRƯỚC, chỉ `cancelOrder` SL cũ SAU khi `newSl` không phải Error. Nếu đặt SL mới fail, giữ nguyên SL cũ, không hủy — đúng thứ tự bắt buộc.
- Lỗi DB không kích hoạt đóng khẩn cấp: dòng 231-251, khối `catch (dbError)` chỉ `logger.error` + `sendMessage` cảnh báo, không gọi lệnh đóng nào.
- Mọi giá qua `roundToTickSize` (dòng 97-101, dòng 358), mọi qty TP1/TP2 qua `splitTpQuantities` (dòng 118-122).
- Check `isHedgeModeEnabled()` trước khi đặt bất kỳ lệnh nào (dòng 67-73), trước cả guard cross-system và mọi lệnh khác.

### 4. `reconcileBinancePosition` type + failed→CLOSE
- Trả đúng `PositionDecisionOutcome` (import type dòng 26, return type khai báo dòng 272).
- `binanceExecutionStatus === "failed"` trả `decision: "CLOSE"` (dòng 279-294) — đúng yêu cầu không để treo bản ghi DB.
- `check-open-trades-runner-smc.ts` dòng 20-22: route đúng — có `position.binanceSymbol` thì gọi `reconcileBinancePosition`, ngược lại giữ luồng đọc nến cũ.

### 5. Migration
- `supabase/migrations/20260712000000_add_binance_execution_columns_smc.sql`: chỉ `alter table open_positions_smc`, đúng 8 cột, đúng kiểu dữ liệu, đúng convention `add column if not exists` — khớp 100% với migration mẫu Volman (`20260711000000_add_binance_execution_columns.sql`), chỉ khác tên bảng.
- `positions-repository-smc.ts`: `OpenPosition` type có đủ 8 field `binance*` (dòng 49-56), `loadOpenPositions` select + map đủ 8 cột (dòng 223, 263-270, 305-312), `saveBinanceExecutionDetails` + `updateBinanceSlOrder` ghi đúng cột — mirror đúng pattern Volman.

### 6. Không deviation ngoài scope
- `binance-execution-volman.ts`: diff so với bản trước chỉ là đoạn guard 1 khối (dòng 74-85), không chạm logic khác đã APPROVED trước đó (đã kiểm tra bằng `grep` các hàm/logic cũ vẫn nguyên vị trí).
- Mỗi subtask chỉ sửa đúng file trong `task.md` của nó — không có file lạ phát sinh ngoài danh sách plan.

### 7. Test subtask 05 — test thật, không phải test giả
- `tests/charts/binance-execution-smc.test.ts`: 2 test guard, assert cụ thể `placeMarketOrder` KHÔNG được gọi khi có vị thế cũ (dòng 70), assert nội dung message Telegram đúng ngữ cảnh (dòng 72, 82) — không phải test luôn pass bất kể logic.
- `tests/charts/positions-repository-smc.test.ts` dòng 318-420: test mapping camelCase↔snake_case đủ 8 cột `binance_*`, assert từng field cụ thể — test thật.

## Verification chạy lại tại thời điểm review

```
npm run build   → PASS (tsc, không lỗi)
npm run test    → 75 test files, 797/797 tests PASS
```

## Kết luận

Cả 5 subtask (01-05) đúng plan.md + task.md, không có deviation, guard cross-system đối xứng thật, kill-switch AND đúng, fail-safe rules được implement đầy đủ và chính xác, migration + repository mirror đúng Volman, test là test hành vi thật. APPROVED.

## Cập nhật sau khi test Binance Futures Testnet (2026-07-11, cùng ngày)

Theo yêu cầu user "test lại trên testnet" + "test thử flow quản lý vòng đời của lệnh", đã chạy live-fire thật (không mock) trên Binance Futures Testnet, phát hiện **2 bug nghiêm trọng có thật** không thể phát hiện bằng unit test/review tĩnh — cả 2 đều ảnh hưởng chung Volman VÀ SMC (code dùng chung/mirror). Chi tiết đầy đủ + bằng chứng: `tasks/binance-futures-execution-smc/05-config-docs-tests-smc/testnet-verification.md`.

1. **`reconcileBinancePosition` không phát hiện được lệnh SL/TP đã khớp thật** — `getOrderStatus()` chỉ map `algoStatus: "TRIGGERED"` → `"FILLED"`, nhưng Binance thực tế trả `"FINISHED"` cho lệnh đã khớp hoàn toàn. Vị thế sẽ treo `HOLD` vĩnh viễn trong DB dù đã đóng/partial-close thật trên sàn. **Đã FIX** (`binance-futures-client.ts`: `ALGO_TRIGGERED_STATUSES` thêm `"FINISHED"`) + verify live PASS (phát hiện đúng ngay poll đầu) + 4 regression test mới trong `tests/charts/binance-futures-client.test.ts`.

2. **Dời SL về breakeven sau TP1 luôn thất bại vĩnh viễn** — Binance từ chối (`-4130`) đặt SL mới khi SL cũ cùng chiều còn tồn tại, mâu thuẫn với giả định gốc trong code ("Binance cho phép 2 lệnh closePosition=true cùng tồn tại"). Vị thế vẫn an toàn (SL gốc còn hiệu lực) nhưng tính năng khoá lời sau TP1 không hoạt động. Xác nhận với user: đây không phải quy tắc bắt buộc của Bob Volman hay SMC (chỉ là risk-management chung độc lập với 2 phương pháp). User chọn hướng fix: đảo thứ tự **hủy SL cũ trước, đặt SL mới sau** (chấp nhận khoảng trống ngắn <1s không có SL, kèm retry 3 lần + alert Telegram khẩn cấp nếu vẫn fail). **Đã FIX** ở cả `binance-execution-smc.ts` và `binance-execution-volman.ts` + build/test pass, nhưng **chưa có 1 lần live-fire full-round xác nhận thành công** do thị trường testnet quá biến động trong phiên test (3 lần thử đều bị timing/rejection cản trở).

**Trạng thái approve**: vẫn giữ APPROVED cho scope gốc của plan (5 subtask), nhưng khuyến nghị mạnh chạy thêm 1 lần verify sống cho fix #2 (dời SL về BE) khi thị trường ổn định hơn, trước khi set `BINANCE_LIVE_TRADING_ENABLED=true`/`BINANCE_LIVE_TRADING_ENABLED_SMC=true` cho production thật.
