# Task 04 — Bổ sung đầy đủ REASON_TEMPLATES cho các dòng trace còn thiếu

## Bối cảnh

`ruleTrace` (mảng string do mỗi hàm `detectXxx()` trong `src/charts/setups/*.ts` tạo ra) được dịch
sang tiếng Việt qua `REASON_TEMPLATES` trong [src/charts/signal-assembly.ts](../../../src/charts/signal-assembly.ts)
rồi hiển thị nguyên văn trong "✅ *Lý do vào lệnh:*" trên Telegram. Dòng nào KHÔNG khớp template nào thì
`translateRule()` (dòng 55-62) giữ nguyên text gốc — dẫn tới user thấy text tiếng Anh/không dấu lẫn
trong danh sách lý do (vd `Edge test bonus: +20 (2 tests x 10)`, `touchCount=1 (tu trendStartIndex 5)`).

Nhiệm vụ: rà TỪNG setup, xác định các dòng `ruleTrace` nằm trên **success path** (tức dòng CÓ THỂ xuất
hiện trong 1 signal cuối cùng được trả về — không phải dòng chỉ xuất hiện ngay trước 1 `return null`
của MỘT NHÁNH THẤT BẠI, vì nhánh đó khiến hàm thoát sớm, signal không bao giờ được tạo ra, dòng đó
không bao giờ tới tay user), rồi thêm template dịch còn thiếu.

## Quy tắc dịch (bám tài liệu `bob_volman_setups.pdf`)

Tài liệu dùng các khái niệm/từ vựng: "EMA21 phẳng" (Range context), "EMA21 dốc" (Trend context), "sóng
kéo ngược hài hòa" (harmonic pullback), "cụm doji", "mô hình chữ W / chữ M", "hộp nén / đoạn nén",
"chạm bật biên" (edge touch/test), "phá vỡ mồi", "đoạn nén chặt/lỏng" (tight/loose compression), "tôn
trọng EMA21". Khi viết replacement, ưu tiên dùng đúng cụm từ này thay vì dịch sát biến code. Ví dụ:

| Raw code-ish | Dịch đúng tinh thần tài liệu |
|---|---|
| `touchCount=1 (tu trendStartIndex 5)` | "Đây là lần đầu giá chạm EMA21 kể từ khi xu hướng mới hình thành" |
| `Cham EMA21, distance=0.15 ATR` | "Giá chạm EMA21 (cách 0.15 ATR)" |
| `Trend bat dau tu index 120` | "Xu hướng mới bắt đầu hình thành" |
| `Pullback la song hieu hoa` | "Sóng kéo ngược là sóng hài hòa (đơn lẻ, không nằm ngang)" |
| `Entry SHORT tai 3.52600, Stop=3.60000` | "Entry SHORT tại 3.52600, Stop tại 3.60000" |
| `Edge test bonus: +20 (2 tests x 10)` | "Thưởng độ tin cậy: +20 (đã test biên 2 lần)" |

Số liệu (giá, ATR, index...) VẪN giữ nguyên trong bản dịch — chỉ đổi phần chữ mô tả sang tiếng Việt có
dấu, đúng thuật ngữ tài liệu.

## Danh sách dòng trace CÒN THIẾU template — theo từng file

Đây là danh sách đã rà thủ công (grep toàn bộ `trace.push` + đối chiếu `REASON_TEMPLATES` hiện có).
Với MỖI dòng bên dưới, thêm 1 template anchored `^...$` (dùng `(\S+)`/`(\d+)` capture group cho phần số
liệu động) vào mảng `REASON_TEMPLATES`.

**QUAN TRỌNG VỀ VỊ TRÍ:** Pattern generic hiện có `{ pattern: /entry (LONG|SHORT) tai (\S+)/i, ... }`
(dòng 19) là substring-match (không anchor `^...$`), nên nó match SỚM với bất kỳ dòng nào chứa cụm
"entry X tai Y" và dịch dở dang (chỉ thay phần khớp, phần còn lại của dòng giữ nguyên raw). Mọi
template MỚI cho các dòng dạng `Entry ... tai ..., Stop=...` hoặc `... entry ... tai ...` PHẢI đặt
**TRƯỚC dòng 19** trong mảng để được ưu tiên khớp trước (đảm bảo dịch trọn vẹn cả dòng), nếu không
chúng sẽ không bao giờ được dùng.

### `ddb.ts`
- `Nen ${index} xac nhan -> entry ${direction} tai ${entry}` (dòng 83)

### `fb.ts`
- `Trend bat dau tu index ${trendStartIndex}` (dòng 77)
- `Trend chuyen tu FLAT tai ~index ${trendStartIndex}` (dòng 68)
- `Trend dao chieu tai ~index ${trendStartIndex}` (dòng 70)
- `Cham EMA21, distance=${currentDistance} ATR` (dòng 98)
- `touchCount=${touchCount} (tu trendStartIndex ${trendStartIndex})` (dòng 101)
- `Pullback la song hieu hoa` (dòng 114 — dùng CHUNG với ddb.ts dòng 71, viết 1 template chung áp dụng
  cho cả 2 file vì text giống hệt nhau)
- `Cham EMA21, dat stop order tai bien nen tin hieu, bodyRatio hien tai=${bodyRatio}` (dòng 126)
- `Entry ${direction} tai ${entry}, Stop=${stopLoss}` (dòng 140 — dùng CHUNG cho fb.ts/irb.ts, vì cùng
  format; bb.ts cũng có dòng y hệt ở dòng 86)

### `sb.ts`
- `Trend=${trend}` — đã có template chung `Trend=(UPTREND|DOWNTREND)` — verify khớp, không cần thêm.
- `Pattern W: low1=${firstLow} @ index ${firstLowIndex}, low2=${secondLow} @ index ${secondLowIndex}`
  (dòng 83) và bản SHORT tương ứng dùng `high1=`/`high2=` (dòng 227) — viết 2 template riêng (LONG dùng
  low1/low2, SHORT dùng high1/high2).
- `Song dan toi day 1 la song hai hoa` (dòng 101) và bản SHORT `Song dan toi dinh 1 la song hai hoa`
  (dòng 240) — 2 template riêng.
- `Day 1 bi false break (xac nhan pattern W)` (dòng 114) và bản SHORT `Dinh 1 bi false break (xac nhan
  pattern W)` (dòng 249) — 2 template riêng.
- `Pattern W san sang, cho gia pha len tren ${wHigh} de xac nhan (Alert)` (dòng 126) và bản SHORT
  `Pattern W san sang, cho gia pha xuong duoi ${wLow} de xac nhan (Alert)` (dòng 258) — 2 template.
- `Entry LONG tai ${entry}, Stop=${stopLoss}` (dòng 133) / `Entry SHORT tai ${entry}, Stop=${stopLoss}`
  (dòng 265) — dùng chung template `Entry (LONG|SHORT) tai (\S+), Stop=(\S+)` (xem mục dùng chung bên
  dưới, KHÔNG cần viết riêng nếu đã có template chung này).

### `bb.ts`
- `EMA21 slope=${slope}` (dòng 40) — KHÁC với 2 template hiện có (`EMA21 slope=X khong/cung huong
  breakout`), vì dòng này KHÔNG có phần "breakout" theo sau — cần template riêng.
- `Block sat EMA21, distance=${block.distanceToEma} ATR` (dòng 65)
- `Nen ${tightness} (range=${block.range}, max=${maxRange})` (dòng 69) — chú ý: đã có template
  `^Nen (\S+) \(range=(\S+), max=(\S+)\)$` trong `REASON_TEMPLATES` (dòng 29 hiện tại) — verify dòng
  này ĐÃ khớp, có thể không cần thêm (dùng chung với arb.ts).
- `Block san sang, theo trend ${direction}: STOP chap Binance truoc khi gia breakout` (dòng 79)
- `Entry ${direction} tai ${entry}, Stop=${stopLoss}` (dòng 86) — dùng chung template mục fb.ts ở trên.

### `rb.ts`
- `${touchCount} lan cham bat bien ${tren|duoi} (>=2, dat)` (dòng 116) — 2 biến thể "tren"/"duoi", viết
  1 template dùng `(tren|duoi)` capture.
- `EMA21 phang truoc breakout (slopeBefore=X), chuyen sang doc (slopeNow=Y)` (dòng 96) — LƯU Ý: khác
  với template hiện có `EMA21 phang truoc breakout (slopeBefore=X)$` (thiếu đuôi ", chuyen sang doc...")
  vì dòng này CÓ thêm phần đuôi — cần template riêng (KHÔNG dùng chung với template ARB hiện có).
- `Entry ${direction} tai ${entry}, rangeHeight=${rangeHeight}` (dòng 125) — dùng chung với arb.ts dòng
  166 (format giống hệt: `Entry (LONG|SHORT) tai (\S+), rangeHeight=(\S+)`).
- `Bonus confidence: FLAT->trend ro ret` (dòng 133) — verify: có khớp `Bonus confidence.*` (đã có sẵn,
  generic) → không cần thêm riêng.

### `irb.ts`
- `Breakout ${direction} pha ca RangeInner va RangeOuter` (dòng 56)
- `RangeInner pha index ${i}, RangeOuter pha index ${j} -> chap nhan (${direction})` (dòng 61)
- `RangeOuter detected w=${w}, range=${r}, high=${h}, low=${l}` (dòng 99)
- `RangeInner detected w=${w}, range=${r}` (dòng 120)
- `RangeInner nam giua RangeOuter (centerOffset=X <= Y)` (dòng 144)
- `Entry ${direction} tai ${entry}, Stop=${stopLoss}` (dòng 166) — dùng chung template fb.ts ở trên.
- `RangeInner ${tightnessInner}, RangeOuter ${tightnessOuter}` (dòng 171)

### `arb.ts`
- `Edge test bonus: +${edgeBonus} (${edgeTestCount} tests x 10)` (dòng 174)
- `Entry ${direction} tai ${entry}, rangeHeight=${rangeHeight}` (dòng 166) — dùng chung template rb.ts
  ở trên (format giống hệt).

### `shared.ts` (áp dụng cho MỌI setup dùng `applyStandardConfidenceAdjustments`)
- `Bonus confidence: trend ro (|slope|>0.3)` (dòng 60) — verify: khớp generic `Bonus confidence.*` sẵn
  có → không cần thêm.
- `Penalty: nen pha vo yeu (bodyRatio=X < 0.3)` (dòng 64) — verify: khớp generic `Penalty.*` sẵn có →
  không cần thêm.
- `Bonus confidence: nen chặt, phá vỡ đáng tin cậy (+5)` (dòng 80, trong `applyCompressionTightnessBonus`)
  — DÒNG NÀY ĐÃ LÀ TIẾNG VIỆT SẴN (không cần dịch) — verify không bị template khác can thiệp sai.

## Việc cần làm

1. Thêm các template còn thiếu liệt kê ở trên vào `REASON_TEMPLATES`
   ([src/charts/signal-assembly.ts](../../../src/charts/signal-assembly.ts)), dùng đúng vị trí (template
   cho dòng chứa "entry...tai..." PHẢI đặt trước dòng 19 như đã nêu).
2. Với các mục ghi "dùng chung" (vd `Entry (LONG|SHORT) tai (\S+), Stop=(\S+)`), chỉ viết 1 template áp
   dụng cho tất cả file liên quan — KHÔNG lặp lại nhiều template giống hệt nhau.
3. Sau khi thêm, chạy lại TỪNG fixture setup hiện có trong test (mỗi setup đều có ít nhất 1 test case
   detect thành công trong `tests/charts/setups.test.ts` hoặc `tests/charts/setups/*.test.ts`), in ra
   `reasons` cuối cùng (qua `buildTradeSetupFromSignal`), xác nhận KHÔNG còn dòng nào chứa từ tiếng Anh
   thô hoặc chữ Việt không dấu kiểu code-variable (vd không còn "tai", "chua", "khong", "duoc" viết liền
   không dấu — trừ số liệu/tên biến kỹ thuật như "ATR", "EMA21" vốn giữ nguyên theo quy ước hiện tại của
   codebase).

## Ràng buộc — KHÔNG được làm

- KHÔNG đổi bất kỳ logic detect/entry/stop/TP/confidence nào trong 7 file setup — CHỈ thêm
  `trace.push(...)` MỚI nếu cần bổ sung dữ liệu (không có yêu cầu này trong task — chỉ cần thêm
  template dịch cho dòng ĐÃ TỒN TẠI).
- KHÔNG xoá template cũ đang hoạt động đúng.
- KHÔNG đổi cấu trúc `translateRule()`/`REASON_TEMPLATES` (vẫn là mảng object `{pattern, replacement}`,
  duyệt tuần tự, dùng match đầu tiên).

## Verify

1. `npm run build` — pass.
2. `npm run test` — full suite pass.
3. Với MỖI trong 7 setup (DDB/FB/SB/BB/RB/IRB/ARB), chạy fixture test hiện có, in `TradeSetup.reasons`,
   dán kết quả vào `result.md` — chứng minh không còn dòng raw/không dấu nào lọt qua.

## Ghi kết quả

Ghi `result.md`: danh sách template đã thêm (raw pattern → replacement), vị trí trong mảng (đặc biệt
xác nhận các template "entry...tai..." đã đặt trước dòng 19 gốc), và output `reasons` thực tế của cả 7
setup sau khi build từ fixture test. Nếu phát hiện dòng trace nào task này liệt kê thiếu (do code đã
đổi khác so với snapshot dùng để viết task), bổ sung template cho dòng đó luôn (không cần hỏi lại, vì
đây là mở rộng đúng tinh thần task, không phải deviation) và ghi rõ trong `result.md` là đã bổ sung
ngoài danh sách gốc kèm lý do.
