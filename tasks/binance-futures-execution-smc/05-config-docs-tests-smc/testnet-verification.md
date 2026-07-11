# Testnet Verification — binance-futures-execution-smc (toàn plan)

**Ngày:** 2026-07-11
**Người thực hiện:** Lead (Sonnet 5), theo yêu cầu user "Test lại trên Binance Futures Testnet trước khi bật live"

## Chuẩn bị

- `open_positions_volman` đã có sẵn 8 cột `binance_*` (từ lần verify Volman trước). `open_positions_smc` **chưa có** — đã apply migration `supabase/migrations/20260712000000_add_binance_execution_columns_smc.sql` lên Supabase production qua MCP (`alter table ... add column if not exists`, additive, không mất dữ liệu).
- `.env` đã sẵn `BINANCE_FUTURES_BASE_URL=https://testnet.binancefuture.com`, `BINANCE_LIVE_TRADING_ENABLED=false` — tái dùng key testnet đã cấu hình từ lần verify Volman.
- Confirm trước với user: apply migration + insert/xoá 1 dòng test vào `open_positions_smc` production — user đồng ý ("Đồng ý, làm đầy đủ").
- Insert 1 dòng test vào `open_positions_smc` (`setup='TESTNET_VERIFICATION_DELETE_ME'`, pair `BTC/USDT`, entry/SL/TP1/TP2 đặt quanh giá BTCUSDT testnet thật tại thời điểm test: ~64175) để có `positionId` thật cho `saveBinanceExecutionDetails`/`reconcileBinancePosition` ghi vào.
- Trước khi chạy: xác nhận `getPositionAmount("BTCUSDT")` = 0 và `isHedgeModeEnabled()` = false trên tài khoản testnet (an toàn để test).

## Script verify

Script tạm (`scripts/tmp-testnet-verify-smc.ts`, đã xoá sau khi xong) gọi TRỰC TIẾP các hàm thật đã implement (không mock):
1. `openBinanceFuturesPosition(setup, positionId, chartSymbol)` từ `binance-execution-smc.ts` (subtask 03) với setup LONG BTCUSDT.
2. `loadOpenPositions()` từ `positions-repository-smc.ts` (subtask 01) — verify DB đã ghi đúng cột.
3. `reconcileBinancePosition(position)` từ `binance-execution-smc.ts` (subtask 04) — verify đọc đúng trạng thái lệnh từ Binance.
4. Cleanup: `cancelOrder` x3 (SL/TP1/TP2) + `placeMarketOrder(reduceOnly: true)` đóng vị thế.

Chạy bằng `npx tsx --env-file=.env scripts/tmp-testnet-verify-smc.ts` (dự án không tự load `.env` khi chạy `tsx` trực tiếp — production dùng `deploy/windows/run-job.ps1` để nạp `.env` vào process env trước khi gọi npm script; local script tạm cần `--env-file` của Node 20+).

## Kết quả

```
--- STEP 1: openBinanceFuturesPosition (SMC) tren testnet ---
--- STEP 2: doc lai DB, kiem tra cot binance_* da duoc ghi ---
{
  ...
  "binanceSymbol": "BTCUSDT",
  "binanceLeverage": 5,
  "binanceQuantity": 0.0773,
  "binanceEntryOrderId": 20918362294,
  "binanceSlOrderId": 1000000132659992,
  "binanceTp1OrderId": 1000000132659995,
  "binanceTp2OrderId": 1000000132659998,
  "binanceExecutionStatus": "placed"
}
--- STEP 3: reconcileBinancePosition (kiem tra doc order status) ---
reconcile outcome: {
  "decision": "HOLD",
  "confidence": 100,
  "comment": "Vị thế đang mở trên Binance Futures, chưa có lệnh SL/TP nào khớp",
  "managementAction": "NONE",
  ...
}
--- STEP 4: CLEANUP - huy SL/TP1/TP2, dong vi the testnet ---
cancelOrder(1000000132659992) -> OK
cancelOrder(1000000132659995) -> OK
cancelOrder(1000000132659998) -> OK
positionAmt truoc khi dong: 0.0773
close position -> OK
positionAmt sau khi dong: 0
--- DONE ---
```

**[PASS]** Toàn bộ round-trip: entry market order → SL + TP1 + TP2 (Algo Order API, đã kế thừa fix từ testnet-verification.md của Volman vì dùng chung `binance-futures-client.ts`) → ghi DB đúng 8 cột `binance_*` → `reconcileBinancePosition` đọc đúng trạng thái → hủy lệnh + đóng vị thế sạch, `positionAmt` về đúng 0.

## Dọn dẹp sau test

- 3 algo order (SL/TP1/TP2) đã cancel, vị thế testnet đã đóng bằng market reduceOnly — xác nhận `positionAmt` = 0 sau cùng.
- Dòng test trong `open_positions_smc` (`id=1`, `setup='TESTNET_VERIFICATION_DELETE_ME'`) đã xoá khỏi Supabase production.
- File script tạm `scripts/tmp-testnet-verify-smc.ts` và `scripts/tmp-check-pos.ts` đã xoá khỏi repo.

## Không phát hiện lỗi mới

Khác với lần verify Volman đầu tiên (phát hiện lỗi Algo Order API `-4120`), lần này KHÔNG phát hiện lỗi mới — vì `binance-execution-smc.ts` dùng chung `binance-futures-client.ts` đã được fix và verify trước đó, chỉ khác phần orchestration (types/imports SMC-specific) đã chạy đúng ngay lần đầu.

## Verify bổ sung: Guard cross-system (Volman ↔ SMC) trên testnet thật

Theo yêu cầu user "thử run cả 2 hệ thống để xem có vấn đề gì xảy ra không" — chạy live-fire cả 2 chiều trên testnet (không mock), dùng 1 dòng test trong `open_positions_volman` (id=1) và 1 dòng trong `open_positions_smc` (id=2), cả 2 đã xoá sạch sau test.

**Phase A — Volman mở trước, SMC thử mở sau (cùng BTCUSDT):**
```
A1: Volman openBinanceFuturesPosition -> thanh cong, binanceEntryOrderId=20920453916
A2: SMC openBinanceFuturesPosition -> BI CHAN
    WARN "Bo qua entry Binance — symbol da co vi the mo (co the do he khac)"
    existingPositionAmt: 0.0155
    SMC DB sau khi thu mo: binanceSymbol=null, binanceExecutionStatus=null
[PASS] SMC khong dat lenh that nao, DB khong bi ghi.
Cleanup Volman: cancel 3 order + dong vi the -> positionAmt ve 0.
```

**Phase B — SMC mở trước, Volman thử mở sau (cùng BTCUSDT):**
```
B1: SMC openBinanceFuturesPosition -> thanh cong, binanceEntryOrderId=20920468299
B2: Volman openBinanceFuturesPosition -> BI CHAN
    WARN "Bo qua entry Binance — symbol da co vi the mo (co the do he khac)"
    existingPositionAmt: 0.0772
    Volman DB sau khi thu mo: binanceEntryOrderId van la 20920453916 (id cu tu Phase A, KHONG co order moi)
[PASS] Volman khong dat entry order moi.
Cleanup SMC: cancel 3 order + dong vi the -> positionAmt ve 0.
```

**Kết luận guard:** đối xứng thật cả 2 chiều trên testnet thật (không chỉ đúng trên unit test mock) — hệ nào mở trước giữ vị thế, hệ sau bị chặn hoàn toàn, không đặt bất kỳ lệnh nào lên sàn, không ghi DB sai. Đúng đúng theo thiết kế "Kiến trúc quyết định #1" trong `plan.md`.

## BUG NGHIÊM TRỌNG phát hiện qua test vòng đời quản lý lệnh (2026-07-11, sau khi user yêu cầu "test thử flow quản lý vòng đời của lệnh")

**Phát hiện:** Mở vị thế thật trên testnet với TP1 đặt sát giá hiện tại (buộc khớp thật qua dao động giá tự nhiên). Sau khi TP1 khớp thật — xác nhận bằng `getPositionAmount` giảm đúng từ `0.0225` xuống `0.0113` (đúng bằng TP1 quantity) — `reconcileBinancePosition` được poll 18 lần trong 90 giây vẫn trả về `HOLD`/`"chưa có lệnh SL/TP nào khớp"`, KHÔNG phát hiện được TP1 đã khớp thật.

**Nguyên nhân gốc:** `getOrderStatus()` trong `binance-futures-client.ts` gọi `/fapi/v1/algoOrder` (GET) và map `algoStatus` sang `status: "FILLED"` chỉ khi `algoStatus === "TRIGGERED"` (biến `ALGO_TRIGGERED_STATUSES = new Set(["TRIGGERED"])`, comment ghi rõ đây là giả định từ lần verify Volman trước). Nhưng test thật cho thấy order đã khớp hoàn toàn trả về `algoStatus: "FINISHED"`, không phải `"TRIGGERED"` — nên `reconcileBinancePosition` (dùng chung logic ở cả Volman lẫn SMC) **không bao giờ phát hiện được SL/TP1/TP2 đã khớp thật trên sàn**, vị thế trong DB sẽ treo ở trạng thái `open`/`HOLD` vĩnh viễn dù đã đóng/partial-close thật trên Binance.

**Mức độ ảnh hưởng:** Nghiêm trọng — bug nằm ở `binance-futures-client.ts` (dùng chung), ảnh hưởng **CẢ Volman (đã APPROVED, production) lẫn SMC**. Đây không phải bug riêng của plan này, mà là bug tồn tại từ lần implement/verify Volman trước đó, chỉ bị lộ ra khi test kỹ vòng đời quản lý lệnh (test trước đó của Volman và SMC chỉ verify "đặt lệnh thành công", chưa test "phát hiện lệnh đã khớp").

**Verify loại trừ false-positive:** Query trực tiếp `getOrderStatus` cho 3 order đã bị CANCEL (chưa từng khớp) → cả 3 đều trả về `algoStatus: "CANCELED"` (khác hẳn `"FINISHED"`) — xác nhận thêm `"FINISHED"` vào tập trạng thái coi-là-khớp không có rủi ro nhầm lệnh bị hủy thành lệnh đã khớp.

**Fix áp dụng:** `src/charts/binance-futures-client.ts` — `ALGO_TRIGGERED_STATUSES = new Set(["TRIGGERED", "FINISHED"])`, kèm comment giải thích phát hiện + verify.

**Regression test:** Thêm 4 test case vào `tests/charts/binance-futures-client.test.ts` (mock `fetch`, không gọi mạng thật) — verify `getOrderStatus` map đúng: `FINISHED`→`FILLED`, `TRIGGERED`→`FILLED`, `CANCELED` giữ nguyên, `WORKING` giữ nguyên. Không phụ thuộc vào việc chờ giá dao động trên testnet để re-verify trong tương lai.

**Verify lại sau fix:** `npm run build` pass, `npm run test` 801/801 pass (797 + 4 test mới). Thử tái verify bằng live-fire (TP1 đặt sát giá $0.3-3, poll nhiều lần) nhưng giá BTCUSDT testnet đứng yên bất thường trong ~10 phút liên tục, không đủ dao động để trigger lại lệnh thật trong phiên test này — dừng chờ organic price movement, dựa vào (1) bằng chứng thật đã thu được TRƯỚC fix (chứng minh bug tồn tại), (2) verify trực tiếp chuỗi trạng thái `algoStatus` qua API thật (không phải đoán), và (3) regression test tự động để đảm bảo an toàn khi merge.

**Khuyến nghị mạnh:** Trước khi bật `BINANCE_LIVE_TRADING_ENABLED=true` cho Volman (nếu đang dùng) hoặc `BINANCE_LIVE_TRADING_ENABLED_SMC=true` cho SMC, nên chạy lại 1 lần verify sống (mở vị thế nhỏ, chờ TP1/SL khớp tự nhiên hoặc reprice sát giá) để xác nhận `reconcileBinancePosition` giờ phát hiện đúng theo thời gian thực — do lần này không tái verify được 100% bằng live fill (chỉ verify qua unit test + xác nhận chuỗi trạng thái thật), nên rủi ro dư thừa (dù thấp) vẫn còn tồn tại cho tới khi có 1 lần live-fire full round xác nhận sau fix.

## Re-verify sau fix (2026-07-11, cùng ngày, thị trường biến động hơn)

Thử live-fire lại theo yêu cầu user "thử lại khi giá dao động". Giá BTCUSDT testnet dao động mạnh trở lại (dao động ~$50 trong vài chục giây ở một số thời điểm), cho phép bắt được TP1 khớp thật sau 3 lần thử (2 lần đầu bị Binance từ chối đặt lệnh với `-2021 Order would immediately trigger` do giá di chuyển nhanh hơn thời gian round-trip API).

**[PASS] TP1 fill detection đã fix đúng:**
```
[poll 1] decision=HOLD managementAction=PARTIAL_TP1
  comment="TP1 đã khớp trên Binance Futures, dời SL về breakeven THẤT BẠI — ..."
```
`reconcileBinancePosition` phát hiện TP1 khớp NGAY Ở LẦN POLL ĐẦU TIÊN (trước fix: không phát hiện được sau 90-120s poll liên tục). Xác nhận fix `ALGO_TRIGGERED_STATUSES` hoạt động đúng trên dữ liệu thật.

## BUG THỨ 2 phát hiện qua cùng lần re-verify: dời SL về breakeven luôn thất bại trên Binance thật

**Phát hiện:** Khi `reconcileBinancePosition` cố đặt SL mới ở giá breakeven (theo đúng thứ tự bắt buộc trong plan.md: "đặt SL mới TRƯỚC, hủy SL cũ SAU"), Binance từ chối với:
```
Binance Futures API loi 400 (code -4130) tai /fapi/v1/algoOrder:
An open stop or take profit order with GTE and closePosition in the direction is existing.
```

**Nguyên nhân:** Binance **KHÔNG cho phép 2 lệnh `STOP_MARKET closePosition=true` cùng chiều tồn tại đồng thời trên cùng symbol** — mâu thuẫn trực tiếp với giả định đã ghi trong code (`binance-execution-smc.ts` dòng ~351, comment: "Binance cho phep 2 lenh STOP_MARKET closePosition=true cung ton tai"). Giả định này chưa từng được verify thật trước đây (kể cả lần verify Volman gốc) — chỉ là suy đoán khi thiết kế thứ tự "đặt trước, hủy sau" để tránh khoảng trống không có SL.

**Hệ quả:** Vì đặt SL mới LUÔN bị từ chối trong khi SL cũ còn tồn tại, và code chỉ hủy SL cũ SAU KHI đặt SL mới thành công (không bao giờ xảy ra) → **cơ chế dời SL về breakeven sau TP1 sẽ không bao giờ thành công trên Binance thật, dù retry bao nhiêu lần** (mỗi lần check đều lặp lại đúng lỗi này). Vị thế vẫn AN TOÀN (SL gốc — không phải breakeven — vẫn còn hiệu lực, không có khoảng trống unprotected), nhưng tính năng "dời SL về BE để khoá lời sau TP1" không hoạt động trong thực tế.

**Phạm vi ảnh hưởng:** Logic giống hệt nhau tồn tại ở CẢ `binance-execution-smc.ts` (task 04 của plan này) LẪN `binance-execution-volman.ts` (đã APPROVED, production) — cả 2 hệ đều bị ảnh hưởng.

**CHƯA FIX** — đây là quyết định kiến trúc cần cân nhắc trade-off (không phải sửa 1 dòng đơn giản), cụ thể:
- Đảo thứ tự (hủy SL cũ TRƯỚC, đặt SL mới SAU) sẽ tạo ra 1 khoảng trống thật (round-trip API, thường <1s) mà vị thế KHÔNG có SL nào trên sàn — vi phạm trực tiếp quy tắc fail-safe bất biến đã ghi trong `plan.md` gốc.
- Cần xác nhận với user hướng xử lý trước khi sửa: chấp nhận khoảng trống ngắn (và mitigate bằng cách nào), hay đổi hẳn cơ chế SL sang quantity-based `reduceOnly` (thay đổi kiến trúc lớn hơn, ảnh hưởng cả guard cross-system).

## Dọn dẹp sau re-verify

Tất cả lệnh test đã cancel, vị thế đã đóng (`positionAmt` = 0), dòng test id=5 đã xoá khỏi `open_positions_smc`, toàn bộ script tạm đã xoá khỏi repo.

## Fix bug #2 (BE-SL) — quyết định của user + implementation

User xác nhận: dời SL về breakeven **không phải quy tắc bắt buộc** của Bob Volman hay SMC (cả 2 chỉ là phương pháp phát hiện entry, không quy định quản lý lệnh sau khi vào) — đây là kỹ thuật risk-management chung được `position-engine-*.ts` thêm độc lập. User chọn hướng fix: **hủy SL cũ TRƯỚC, đặt SL mới SAU** (chấp nhận khoảng trống ngắn không có SL, kèm retry + alert khẩn cấp).

**Fix áp dụng (cả `binance-execution-smc.ts` VÀ `binance-execution-volman.ts`, cùng logic):**
1. Hủy SL cũ trước. Nếu hủy thất bại → giữ nguyên SL cũ (vẫn còn hiệu lực), trả `HOLD`, thử lại lần check sau — không tạo khoảng trống nào trong trường hợp này.
2. Nếu hủy thành công → vị thế đang KHÔNG có SL nào trên sàn. Retry đặt SL mới tối đa 3 lần trong cùng 1 lần gọi (không đợi cycle check tiếp theo).
3. Nếu cả 3 lần đều thất bại → gửi Telegram khẩn cấp 🚨🚨 "VỊ THẾ ĐANG KHÔNG CÓ SL — đặt tay NGAY", `newStopLoss: null` (DB không ghi sai giá BE khi thực tế không có SL nào).
4. Nếu thành công → ghi DB `binanceSlOrderId` mới + `stopLoss` = giá BE.

**Verify sau fix:**
- `npm run build` pass, `npm run test` 801/801 pass.
- **Live-fire re-verify: KHÔNG hoàn thành được trong phiên này** — đã thử 3 lần bắt TP1 khớp thật với offset tăng dần ($5 → $35) để tiếp tục sang bước verify BE-SL, nhưng thị trường testnet BTCUSDT whipsaw rất nhanh trong phiên (dao động $50-150 trong vài chục giây, đổi hướng liên tục) khiến 2/3 lần bị Binance từ chối `-2021 Order would immediately trigger` (giá vượt qua trigger trong lúc round-trip API), lần thứ 3 đặt được TP1 nhưng giá quay đầu ngược hướng trước khi khớp, timeout sau 120s poll.
- **Mức độ tin cậy của fix**: dựa trên (a) code review kỹ — logic đối xứng, đúng thứ tự hủy-trước-đặt-sau, có retry + escalation alert đúng như quyết định của user, (b) build+test pass, (c) đã verify TRỰC TIẾP root cause của bug -4130 (Binance từ chối 2 SL closePosition=true cùng chiều) qua chính lần thử BE move đầu tiên (bug #2 được phát hiện chính từ live test thật), nên hướng fix (đảo thứ tự) chắc chắn giải quyết đúng nguyên nhân — nhưng **chưa có 1 lần live-fire full-round xác nhận cancel→place thành công thật trên Binance** do thị trường không hợp tác trong phiên test.

**Khuyến nghị:** Trước khi set `BINANCE_LIVE_TRADING_ENABLED=true` (Volman) hoặc `BINANCE_LIVE_TRADING_ENABLED_SMC=true` (SMC), nên chạy lại 1 lần verify sống khi thị trường ít biến động cực đoan hơn (dễ bắt TP1 khớp với offset nhỏ, ổn định hơn để theo dõi trọn vẹn chuỗi hủy→đặt→verify SL mới).

## Kết luận

Plan `binance-futures-execution-smc` đã verify trên Binance Futures Testnet — luồng entry/SL/TP1/TP2/reconcile riêng của SMC, guard cross-system giữa 2 hệ Volman/SMC, và test vòng đời quản lý lệnh. Quá trình test phát hiện **2 bug nghiêm trọng có thật, cả 2 đều ảnh hưởng chung cả Volman và SMC**:
1. **Reconcile không phát hiện lệnh đã khớp** — đã FIX (`ALGO_TRIGGERED_STATUSES` thêm `"FINISHED"`) + verify live PASS (phát hiện đúng ngay poll đầu tiên) + có 4 regression test.
2. **Dời SL về breakeven luôn thất bại** do giới hạn thật của Binance (-4130) — đã FIX (đảo thứ tự hủy-trước-đặt-sau theo quyết định của user) + build/test pass + root cause đã verify trực tiếp, nhưng chưa có live-fire full-round xác nhận thành công do thị trường quá biến động trong phiên test.

Cả 2 fix áp dụng đồng nhất cho CẢ Volman và SMC (code dùng chung/mirror). `done.md` cần cập nhật ghi nhận 2 bug + fix này trước khi coi plan hoàn thiện.
