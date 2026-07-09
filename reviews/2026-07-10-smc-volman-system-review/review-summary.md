# Review hệ thống SMC + Bob Volman + GitHub Actions

**Ngày:** 2026-07-10 · **Reviewer:** Lead · **Scope:** `src/charts/smc/`, `src/charts/setups/`, `src/charts/deterministic-pipeline.ts`, `.github/workflows/analyze.yml`, `.github/workflows/analyze-smc.yml`

**Kết luận:** Cả hai hệ thống là **adaptation hợp lý, code sạch, có test**, nhưng chưa "đúng chuẩn" 100% theo lý thuyết gốc. Có **1 bug logic thật (CHOCH dead code)**, **1 bug tiềm ẩn (FB TP2 fallback)**, và **1 vấn đề vận hành lớn nhất: 2 hệ thống ghi chung bảng positions/pending không có cột phân biệt hệ thống**.

---

## A. Hệ thống SMC (`src/charts/smc/`)

### Đúng chuẩn
- Swing point fractal (left=2/right=2), BOS theo close-break, liquidity sweep (wick-through + reclaim), FVG 3-nến, premium/discount theo dealing range, kill-zone session, penalty ASIA/OFF_HOURS — đều đúng định nghĩa SMC phổ biến.
- Backtest có `buildRollingHtfContexts` chống look-ahead bias cho HTF — làm đúng và cẩn thận.
- TP2/TP3 hướng về liquidity (EQH/EQL, prior week level) có validate RR — đúng tư duy "liquidity as target".

### Issues

| # | Mức | File:Line | Vấn đề |
|---|-----|-----------|--------|
| S1 | 🔴 HIGH | `smc-pipeline.ts:175`, `smc-structure.ts:82` | **CHOCH không bao giờ được phát hiện.** `detectStructureBreak` chỉ phân loại CHOCH khi có `previousBias`, nhưng đường OB chính gọi không truyền `previousBias` → `kind` luôn là `BOS`. Setup `SMC_CHOCH_OB` và nhánh confidence 72 là dead code. CHOCH là tín hiệu đảo chiều cốt lõi của SMC — hiện hệ thống gắn nhãn BOS (confidence 80) cho cả các cú đảo chiều. **Fix:** track bias từ chuỗi structure break trước đó (đã có sẵn `detectTimeframeBias`) và truyền vào. |
| S2 | 🟠 MED | `smc-structure.ts:116-125` | BOS được detect lại ở **mọi nến** đóng cửa ngoài swing level, không chỉ nến break đầu tiên → trong window 20 nến, một break cũ 10 nến trước vẫn sinh candidate "mới" tại nến hiện tại. Cần điều kiện `close[i-1] <= level && close[i] > level` (first-close-through). |
| S3 | 🟠 MED | `smc-structure.ts:212-255` | Order block quá đơn giản theo chuẩn SMC: chỉ lấy nến ngược màu gần nhất, **không check displacement** (impulse rời khỏi OB) và **không check mitigation** (OB đã bị tap thì hết hiệu lực). Entry vào OB đã mitigated là sai chuẩn ICT/SMC. |
| S4 | 🟡 LOW | `smc-pipeline.ts` (imports) | `detectLiquiditySweep` được implement + test nhưng **không tham gia pipeline**. Model chuẩn SMC là sweep → CHOCH → OB/FVG entry; hiện sweep chỉ là field trang trí. |
| S5 | 🟡 LOW | `smc-liquidity-context.ts:105-106` | `weekIndex = floor(epochDay/7)`: epoch day 0 là **Thứ Năm** → "tuần" chạy Thu→Wed, PWH/PWL lệch tuần lịch. Ngoài ra pipeline chỉ fetch 200 nến M15 (~2 ngày) nên prior **week** level gần như luôn `null` → TP3 hầu như không bao giờ được set. |
| S6 | 🟡 LOW | `smc-structure.ts:267-299` | FVG không check **đã fill chưa** — gap bị lấp từ lâu vẫn được coi là hợp lệ nếu nằm trong window quét. |
| S7 | 🟡 LOW | `smc-pipeline.ts:410` | Live path dùng **toàn bộ** HTF history cho mọi candidate trong window 20 nến (candidate cũ được chấm bằng bias hiện tại) — nhẹ look-ahead trong live scan; backtest thì đã đúng. |

## B. Hệ thống Bob Volman (`src/charts/setups/` + `deterministic-pipeline.ts`)

### Đúng chuẩn
- Đủ 7 setup đúng tên sách *Forex Price Action Scalping*: DD, FB, SB, BB, RB, IRB, ARB; trục EMA20 đúng; DD yêu cầu ≥2 doji sát EMA, BB yêu cầu compression sát EMA + break theo trend, FB yêu cầu first touch của trend mới — logic nhận diện đúng tinh thần Volman.
- False-break filter + SB (second break) chạy sau khi signal fail — đúng cơ chế sách.

### Lưu ý khái niệm
Volman gốc là **scalping 70-tick chart, target/stop cố định ~10 pip**. Repo chạy M15/H4 với stop theo ATR và TP theo R-multiple (1.5R/2.5R) — đây là **chuyển thể** (hợp lý cho bot swing) chứ không phải "chuẩn Volman" nguyên bản. Nên ghi rõ trong docs để tránh kỳ vọng sai khi so backtest với sách.

### Issues

| # | Mức | File:Line | Vấn đề |
|---|-----|-----------|--------|
| V1 | 🔴 HIGH (latent) | `fb.ts:150,157` | TP2 fallback = `takeProfit1 * 1.5` — **nhân giá tuyệt đối**: EURUSD TP1≈1.08 → TP2≈1.62; với SHORT thì TP2 nằm **trên** entry (sai hướng). Hiện fallback khó chạm tới (luôn có nến trước `trendStartIndex≥5`) nhưng là bom nổ chậm. Fix: `entry ± 1.5 × risk`. |
| V2 | 🟠 MED | `deterministic-pipeline.ts:85`, `indicators.ts:257-269` | `isTradableWindow` chỉ cho 13:00–21:00 UTC. Với H4 (nến mở 0/4/8/12/16/20), chỉ nến 16:00 (và 20:00 tuỳ mốc time) pass → **phần lớn run H4 bị skip toàn bộ**, và bỏ hẳn London morning — trong khi Volman trade chủ yếu London. Cần xác nhận đây là chủ ý. |
| V3 | 🟡 LOW | `bb.ts:81-83` | BB: điều kiện là `close` đã vượt `block.high` nhưng entry đặt tại `block.high` dạng BUY_STOP → stop order nằm **sau** giá hiện tại, pending sẽ trigger ngay lượt check kế tiếp với giá xấu hơn. Stop loss = `block.low` không có buffer (các setup khác dùng 0.1 ATR) — thiếu nhất quán. |
| V4 | 🟡 LOW | `signal-assembly.ts:94` | `const isLastCandle = triggerIndex === triggerIndex;` — luôn true, dead code, nên xoá. Mọi order Volman đều hardcode BUY_STOP/SELL_STOP. |

## C. GitHub Actions

### Đúng
- `analyze.yml` (Volman): cron `5 0,4,8,12,16,20 * * 1-5` khớp H4 close +5'; `analyze-smc.yml`: `*/15 * * * 1-5` khớp M15. Cả hai dùng `environment: production`, secrets qua GitHub Secrets, config qua `vars`, có `timeout-minutes`, cache npm/Playwright hợp lý (SMC không cài Playwright vì không chụp screenshot — đúng).
- `test.yml` chạy trên mọi push/PR — CI có thật.

### Issues

| # | Mức | Vấn đề |
|---|-----|--------|
| G1 | 🔴 HIGH | **Hai hệ thống ghi chung `open_positions` / `pending_orders` không có cột system** (`positions-repository.ts` dedup chỉ theo `pair` + status). Hệ quả: (a) SMC chạy 96 lần/ngày sẽ chiếm slot pair trước → tín hiệu Volman cùng pair bị **drop im lặng** như "duplicate" (và ngược lại); (b) cả 2 workflow đều chạy `runCheckOpenTrades`/`runCheckPendingOrders` trên cùng bảng → SMC run trigger/notify order do Volman tạo; (c) `performance-report` không thể tách win-rate theo hệ thống → **không đánh giá được hệ nào có edge**. Fix đề xuất: thêm cột `system` (`volman`/`smc`), dedup theo `(pair, system)`, filter check-runner + report theo system. |
| G2 | 🟠 MED | Cả hai workflow **thiếu `concurrency` group**. GitHub cron hay delay 3–10'; SMC 15'/lần có thể chồng run → double analyze + double Telegram trước khi cache kịp ghi. Thêm: `concurrency: { group: analyze-smc, cancel-in-progress: false }` (tương tự cho analyze.yml). |
| G3 | 🟡 LOW | Với M15, `CANDLE_CLOSE_WINDOW_MS = 20'` > interval 15' → check "within close window" **luôn true**, chỉ còn cache key chống trùng. Không sai nhưng window filter là no-op cho M15 — nên hạ xuống ~10' hoặc chấp nhận và ghi chú. |
| G4 | 🟡 LOW | Lịch `* * 1-5` UTC: vẫn chạy Fri 21:00–24:00 UTC (market đóng) và bỏ Sun 21:00+ UTC (market mở). Minor vì fetch OHLC sẽ không có nến mới. |
| G5 | 🟡 LOW | `test.yml` trigger cả `push` lẫn `pull_request` → chạy đôi trên PR branch. Thêm `branches: [main]` cho push hoặc bỏ một trigger. |

## Đề xuất thứ tự fix
1. **G1** — thêm cột `system` vào positions/pending (ảnh hưởng dữ liệu thật hằng ngày).
2. **S1** — nối `previousBias` để CHOCH sống lại (sai nhãn tín hiệu cốt lõi).
3. **V1 + S2** — bug TP2 fallback và first-break condition.
4. **G2, V2** — concurrency + xác nhận chủ ý của tradable window.
5. Còn lại (S3–S7, V3–V4, G3–G5) gom vào một task cleanup.
