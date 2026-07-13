# Review tổng hợp — docs-alignment-audit (Lead, 2026-07-14)

## Verdict vòng 3 (final): APPROVED ✅

Item 3 & 4 đã fix (Lead verify trực tiếp 2026-07-14): `test-analyze` xóa sạch (file + script +
README, grep rỗng); EMA exit default 21 ở cả 2 fallback + `.env.example` + tests. Build PASS,
**667/667 tests PASS (66 files)**. Đã viết `tasks/docs-alignment-audit/done.md`.

## Verdict vòng 2 (Lead re-review sau fix loop): CHANGES_REQUIRED — còn item 3 & 4

Lead đã tự verify vòng 2: build PASS, **664/664 tests PASS (66 files)**.

- ✅ **Item 1 ĐẠT**: `analyzer-volman.ts` sạch TP2 — nhánh so sánh takeProfit2 đã xóa, message
  là "Giá đã chạm/vượt TP", prompt chỉ còn 1 dòng `- Take profit:`. Test analyzer 12/12 pass.
- ✅ **Item 2 ĐẠT**: label `EXIT BREAKDOWN (trailing SL: TP->BE)` đã sửa, không đổi logic.
  Ghi chú chấp nhận thêm: `setup-backtest.ts` (tool nghiên cứu) vẫn dùng tên outcome nội bộ
  `tp1`/`trail_tp1`/nhãn "swing trail sau TP1" cho các exit mode backtest — chức năng đúng với
  1 TP duy nhất, chỉ là naming nội bộ của tool chạy tay, KHÔNG yêu cầu sửa thêm.
- ❌ **Item 3 CHƯA LÀM**: `src/charts/test-analyze.ts` vẫn tồn tại, script `test-analyze` vẫn
  trong `package.json:16`.
- ❌ **Item 4 CHƯA LÀM**: `volman-config-env.ts:113` vẫn `return 20` (và fallback invalid),
  `.env.example:19` vẫn `EMA_EXIT_PERIOD=20`.

(Nguyên nhân: Worker fix chạy theo bản review trước khi Lead bổ sung item 3-4 theo quyết định
user. Worker fix vòng tiếp theo CHỈ làm item 3 & 4 theo mô tả bên dưới.)

## Verdict vòng 1: CHANGES_REQUIRED (nhỏ) — 2 fix cosmetic, còn lại đạt

Lead đã tự verify lại (không chỉ dựa result.md): `npm run build` PASS, `npm run test` PASS
**66 files / 663 tests**, đọc trực tiếp code execution/reconcile/setups/telegram.

## Đạt (đối chiếu plan.md + task.md)

| Hạng mục | Kết quả verify |
|---|---|
| Xóa SMC | `git grep -il smc -- src tests package.json docker-compose.yml deploy .github README.md` → RỖNG. Files/scripts/workflow/deploy đã gỡ sạch. |
| TP = 2R theo env | `computeTakeProfit()` đúng công thức `entry ± TP_R_MULTIPLE×risk` (`setups/shared.ts:8-16`), getter default 2, cả 7 setup dùng chung, có test override `TP_R_MULTIPLE=3`. |
| Entry Buy/Sell Stop | `signal-assembly.ts:94` — orderType luôn `BUY_STOP`/`SELL_STOP`; `entry-style-config.ts` đã xóa; grep `WAIT_FOR_CONFIRMATION` trong setups/assembly → RỖNG. |
| Execution Entry+SL+1TP | `placeProtectionOrdersAndFinalize` đặt đúng 1 SL (retry -4509) + 1 `TAKE_PROFIT_MARKET`; fail-safe giữ nguyên; `splitTpQuantities`/TP2/partial-TP1/breakeven/swing-trailing đã gỡ khỏi flow. |
| Reconcile | EMA exit giữ (hủy SL/TP rồi MARKET close); SL fill → `stop_loss`; TP fill → `take_profit` (map đúng qua `buildClosedPositionSnapshot`); manual-close detection giữ. |
| Migration | 2 file tồn tại, CHƯA apply, nội dung constraint đúng convention Postgres. |
| Telegram | 1 dòng `TP : ... (2R)`, pattern info EMA21 + đúng thuật ngữ 7 setup. |
| Env | `.env.example` đã xóa biến chết, thêm `TP_R_MULTIPLE=2` + 2 biến thiếu; workflow match-odds đã gỡ `BETTING_AI_ANALYZE_TIMEOUT_MS`. |

## CHANGES_REQUIRED — giao Worker fix (nhỏ, không chặn behavior)

1. **`src/charts/analyzer-volman.ts`** — `applyPriceSanityChecks` (dòng ~83-99):
   - Xóa 2 nhánh so sánh `takeProfit2` (dòng 83-94) — dead code vì `takeProfit2` giờ luôn null.
   - Đổi label message `"Giá đã chạm/vượt TP1"` → `"Giá đã chạm/vượt TP"` (dòng 95-99).
   - Trong các prompt builder cùng file (vd `buildPendingOrderCheckPrompt` dòng ~120-121):
     gộp `- Take profit 1/2` thành 1 dòng `- Take profit: ${order.takeProfit1}`.
   - Cập nhật test tương ứng (`tests/charts/analyzer-volman.test.ts`).
2. **`src/charts/setup-backtest-runner.ts`** (dòng ~227-230): console label còn mô tả cơ chế cũ
   `(trailing SL: TP1->BE, TP2->TP1)` / `trail_tp1 (cham TP2, dong tai TP1)` — sửa label khớp
   semantics 1-TP hiện tại của `setup-backtest.ts` (chỉ đổi text/tên outcome hiển thị, KHÔNG đổi
   logic backtest).

3. **Xóa script `test-analyze`** (user đã quyết 2026-07-14 — fixture `test-charts/` không tồn tại,
   tool không dùng nữa):
   - Xóa file `src/charts/test-analyze.ts`.
   - Gỡ script `"test-analyze"` khỏi `package.json`.
   - Grep `test-analyze` trong repo (`src`, `tests`, `deploy`, `.github`, `README.md`) và gỡ
     mọi tham chiếu còn lại (nếu có test/README nhắc tới).
4. **Đổi default EMA exit 20 → 21** (user đã quyết — nhất quán EMA21 của hệ Volman):
   - `src/charts/volman-config-env.ts` — `getEmaExitPeriod()`: 2 chỗ `return 20` → `return 21`
     (fallback khi env trống và khi giá trị không hợp lệ). KHÔNG đổi `isEmaExitEnabled`.
   - `.env.example`: `EMA_EXIT_PERIOD=20` → `EMA_EXIT_PERIOD=21`, sửa comment nếu nhắc 20.
   - Cập nhật test liên quan (grep `EMA_EXIT_PERIOD\|getEmaExitPeriod` trong `tests/`).

Sau fix: `npm run build` + `npm run test` PASS, cập nhật result.md của task 07.

## Chấp nhận giữ (legacy compatibility — KHÔNG fix)

- `take_profit_2` trong union `closeReason` + `resolveExitPrice` (`performance-tracking-volman.ts`,
  `forex-backtest.ts`, repos): cần cho dữ liệu lịch sử đã đóng bằng cơ chế cũ.
- `takeProfit2: string | null` ở types/repo (ghi null): tương thích cột DB, đúng thiết kế task 03.
- Cột DB cũ (`tp1_closed_percent`, `trailing_stop_loss`...) để nguyên, code không đọc/ghi.

## Quyết định user (2026-07-14)

1. `test-analyze`: **XÓA** → chuyển thành item 3 của CHANGES_REQUIRED.
2. EMA exit default: **ĐỔI 21** → chuyển thành item 4 của CHANGES_REQUIRED.
3. Migration + `.env` thật: user OK — **Lead thực hiện trực tiếp** (xem phần dưới).

## Lead thực hiện (2026-07-14, sau khi user duyệt)

- Apply migration `20260714000000_drop_smc_tables.sql` + `20260714000001_close_reason_take_profit.sql`
  lên Supabase (project `irgworcpfyfuigyvylkj`) — verify lại bảng trước khi drop.
- Sửa `.env` thật máy này: xóa `BINANCE_LIVE_TRADING_ENABLED_SMC`, `BINANCE_HONOR_ORDER_TYPE_SMC`,
  `CHART_TRADING_SYSTEM`; thêm `TP_R_MULTIPLE=2`.
- Nếu có máy production khác còn scheduled task `analyze-smc` thì unregister (máy này không có).
