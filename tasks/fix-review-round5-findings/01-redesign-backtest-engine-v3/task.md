# Task 01 — Redesign backtest engine v3: thuật toán CỤ THỂ, không tự sáng tạo (CRITICAL)

## Đọc trước: vì sao 2 lần trước fail

**Round 3** (`tasks/fix-review-round3-findings/01-*`): hoãn TẤT CẢ signal 2
nến để chờ xác nhận false-break — sai vì 6 setup không phải SB không cần
chờ.

**Round 4** (`tasks/fix-review-round4-findings/01-*`): sửa lại cho vào lệnh
ngay, NHƯNG:
1. Xóa mất `activeUntilIndex` (không chồng lệnh) — vi phạm invariant đã có
   từ code gốc VÀ vi phạm cách live thực sự hoạt động
   (`src/charts/positions-repository.ts:58-77` — 1 pair chỉ 1 lệnh mở tại 1
   thời điểm).
2. Signal gốc + SB reversal của nó được tính thành **2 trade riêng** — vi
   phạm `// Do NOT keep the original failed signal (fix #16)` vẫn còn nguyên
   trong `src/charts/setup-sb-runner.ts:69` (code cũ dùng cho live — CHỈ giữ
   SB, KHÔNG giữ signal gốc nếu nó là false-break).
3. `resolveSetupConflicts` gọi lần 2 (dòng ~167) vô tình che giấu 1 phần bug
   #1/#2 theo cách không nhất quán (chỉ khi 2 signal trùng đúng 1 index).
4. `detectSb` được gọi LẶP LẠI ở nhiều `index` khác nhau (`triggerIndex+3`
   đến `+8`) — khác hẳn `setup-sb-runner.ts` (live) chỉ gọi ĐÚNG 1 lần ở
   `sbIndex = min(triggerIndex+3, currentIndex)` cố định.

## Thuật toán ĐÚNG (làm theo CHÍNH XÁC, không tự đổi)

**Nguyên tắc cốt lõi:** Backtest phải mô phỏng ĐÚNG những gì `runSbDetection`
(trong `setup-sb-runner.ts`, KHÔNG ĐỔI, vẫn dùng cho live) sẽ làm nếu được
gọi lặp lại qua nhiều "khung nhìn" (mỗi lần gọi tương ứng 1 candle mới xuất
hiện) — CHỨ KHÔNG PHẢI tự nghĩ ra thiết kế khác.

```
State cần duy trì xuyên suốt vòng lặp:
  trades: SetupBacktestTrade[]           // kết quả cuối
  openTrade: { trade, signal, triggerIndex } | null   // lệnh đang mở (0 hoặc 1, KHÔNG chồng lệnh)
  watchingFalseBreak: { signal, triggerIndex } | null  // signal gốc đang chờ xác nhận false-break
                                                        // (chỉ theo dõi khi nó CHÍNH LÀ openTrade hiện tại)

Với mỗi index từ startIndex đến candles.length - 1:

  BƯỚC 1 — Nếu đang có watchingFalseBreak (tức openTrade hiện tại đang chờ
  xác nhận false-break) VÀ index đã đủ dữ liệu để check
  (index >= watchingFalseBreak.triggerIndex + 2, giống hệt điều kiện
  maxLookahead=2 trong isFalseBreak):

    a. Check isFalseBreak(candles, triggerIndex, levelHigh, levelLow,
       direction, maxLookahead=2) — CHỈ CHECK 1 LẦN DUY NHẤT, ngay khi
       index vừa đủ (index == triggerIndex + 2), sau đó XÓA
       watchingFalseBreak dù kết quả thế nào (không check lại lần 2).

    b. Nếu KHÔNG false-break: giữ nguyên openTrade như đã vào lệnh, không
       làm gì thêm (trade gốc hợp lệ, để scanOutcome tự nhiên xử lý outcome
       của nó — xem BƯỚC 3).

    c. Nếu LÀ false-break:
       - XÓA trade gốc khỏi `trades` (nó chưa từng được tính là 1 lệnh thật
         — xem BƯỚC 2 để hiểu tại sao trade gốc CHƯA được push vào `trades`
         cho tới khi qua được bước check này).
       - Đặt `openTrade = null` tạm thời (pair coi như đang "trống", nhưng
         xem bước d).
       - Gọi `detectSb(candles, sbIndex, ctx, watchingFalseBreak.signal)`
         với `sbIndex = Math.min(triggerIndex + SB_BUILDUP_LOOKAHEAD,
         candles.length - 1)` — **GIỐNG HỆT công thức trong
         `setup-sb-runner.ts:49`**. QUAN TRỌNG: nếu `sbIndex > index` hiện
         tại (tức chưa đủ nến tới `triggerIndex+3`), thì CHƯA gọi detectSb ở
         bước này — phải đợi tới khi `index` walk-forward tới đúng
         `sbIndex` mới gọi (dùng 1 pending slot riêng để nhớ việc này, xem
         bước d).
       - d. Nếu `index == sbIndex` (đủ điều kiện gọi ngay): gọi detectSb,
         nếu có signal → đây là trade MỚI DUY NHẤT cho sự kiện này, xử lý y
         hệt 1 signal thường ở BƯỚC 2 (kể cả check `openTrade` đang trống
         hay không — lúc này chắc chắn trống vì vừa xóa ở bước c). Nếu
         `index < sbIndex`: lưu vào 1 state tạm `pendingSb = { signal:
         watchingFalseBreak.signal, sbIndex }`, tiếp tục vòng lặp, và ở các
         `index` sau, khi `index == pendingSb.sbIndex`, gọi detectSb đúng 1
         lần DUY NHẤT tại đó (không lặp lại nhiều lần như bug round 4 #4),
         dù kết quả null hay có signal đều XÓA `pendingSb` sau đó.
       - Bọc lời gọi `detectSb` trong try/catch (giống `setup-sb-runner.ts`
         — log lỗi, bỏ qua signal, KHÔNG để throw ra ngoài vòng lặp chính).

  BƯỚC 2 — Nếu `openTrade === null` (không có lệnh nào đang mở, kể cả sau
  khi BƯỚC 1 vừa dọn dẹp) VÀ không có `pendingSb` đang chờ ở đúng `index`
  này (để tránh 2 signal cùng lúc giành 1 slot — nếu cả detector thường VÀ
  pendingSb cùng sẵn sàng ở 1 index, ưu tiên `resolveSetupConflicts` xử lý
  chung, xem bước dưới):

    a. Chạy 6 detector chuẩn tại `index` → `freshSignals`.
    b. Nếu BƯỚC 1d cũng vừa tạo ra 1 SB signal ở ĐÚNG `index` này, gộp
       chung: `resolveSetupConflicts([...freshSignals, sbSignalNếuCó])`.
    c. Nếu có kết quả (>=1 signal sau resolve): lấy signal đầu tiên (đã
       resolve, chỉ có tối đa 1 vì cùng 1 pair) → tạo trade, gán
       `openTrade = { trade, signal, triggerIndex: signal.triggerIndex }`,
       push trade vào `trades`.
    d. NẾU signal vừa vào lệnh này KHÔNG PHẢI là 1 SB signal (tức nó là 1
       trong 6 setup thường, có khả năng SAU NÀY bị phát hiện false-break):
       đặt `watchingFalseBreak = { signal, triggerIndex: index }` để BƯỚC 1
       theo dõi ở các index sau. NẾU nó LÀ SB signal (đến từ BƯỚC 1),
       KHÔNG cần watch false-break cho nó nữa (SB không có "SB của SB").

  BƯỚC 3 — Nếu `openTrade !== null`: gọi `scanOutcome` cho trade đó xem đã
  đóng chưa (dùng đúng logic `scanOutcome` hiện có, chỉ cần adapt để check
  TỪNG index một thay vì quét 1 lần tới cuối — HOẶC đơn giản hơn: giữ
  nguyên `scanOutcome` quét-tới-cuối như hiện tại NGAY KHI trade được tạo ở
  BƯỚC 2c, và dùng kết quả `exitIndex` để biết khi nào `openTrade` nên được
  set về `null` (khi `index > exitIndex` hoặc `index >= candles.length` nếu
  `open_at_end`). Cách này ĐƠN GIẢN HƠN — khuyến nghị dùng cách này thay vì
  scan từng bước.

  QUAN TRỌNG: nếu trade gốc bị XÓA ở BƯỚC 1c (hóa ra false-break), thì
  `exitIndex` đã tính trước đó cho nó KHÔNG còn ý nghĩa — phải hủy luôn
  (đừng dùng để tính lại `openTrade = null` timing cũ, vì trade đó đã bị xóa
  khỏi `trades`). Set `openTrade = null` NGAY khi xóa ở bước 1c, không chờ
  `exitIndex` cũ.
```

**Nếu đọc thuật toán trên thấy có case chưa rõ hoặc mâu thuẫn, HỎI LẠI
(viết vào `blocked.md` câu hỏi cụ thể) TRƯỚC KHI tự quyết định theo cách
khác — đây là yêu cầu bắt buộc cho task này, không tự sáng tạo thiết kế như
2 lần trước.**

## Việc PHẢI kiểm tra sau khi cài đặt xong (tự verify trước khi báo cáo)

Đọc lại code TỰ MÌNH và trả lời rõ trong `result.md` cho từng câu hỏi sau —
KHÔNG chỉ nói "đã fix", phải CHỨNG MINH bằng cách trỏ tới dòng code cụ thể:

1. Có bao giờ `trades` chứa 2 trade có khoảng entryIndex/exitIndex chồng lấn
   nhau cho CÙNG 1 pair không? (Phải là KHÔNG — chỉ 1 `openTrade` tại 1 thời
   điểm.)
2. Có bao giờ 1 sự kiện thị trường (1 signal gốc + false-break + SB) tạo ra
   2 trade trong `trades` không? (Phải là KHÔNG — chỉ SB trade, hoặc chỉ
   trade gốc nếu nó KHÔNG false-break, không bao giờ cả 2.)
3. `detectSb` có được gọi nhiều hơn 1 lần cho cùng 1 signal gốc không? (Phải
   là KHÔNG — đúng 1 lần tại `sbIndex` cố định.)
4. `resolveSetupConflicts` có bao giờ vô tình loại bỏ 1 signal hợp lệ không
   liên quan gì đến signal khác (chỉ vì cùng gọi trong 1 lần, cùng `pair`)
   không?

## KHÔNG làm

- Không đổi `src/charts/setup-sb-runner.ts`, `deterministic-pipeline.ts`
  (live pipeline không đổi).
- Không đổi `detectSb`, `isFalseBreak`, 6 detector chuẩn.
- Không tự nghĩ ra thiết kế khác "đơn giản hơn" — nếu thấy thuật toán trên
  có vấn đề, hỏi lại (blocked.md), đừng tự sửa.

## Verification

```bash
npm run build
npm run test -- --run
```

**BẮT BUỘC** viết 4 test mới trong `tests/charts/setup-backtest.test.ts`
hoặc `tests/charts/setup-backtest-queue.test.ts` (xóa/sửa lại test cũ nếu
chúng assert hành vi SAI của round 4 — ví dụ test hiện tại đang assert
`trades.length === 2` cho case double-count PHẢI SỬA LẠI thành
`trades.length === 1`):

1. Test "không chồng lệnh": dựng 2 signal độc lập overlap về thời gian →
   xác nhận chỉ 1 trade được tạo, cái thứ 2 bị bỏ qua cho tới khi cái đầu
   đóng.
2. Test "không double-count": signal gốc + false-break + SB confirm →
   `trades.length === 1` (chỉ SB), KHÔNG PHẢI 2.
3. Test "SB chỉ check 1 lần": dựng tình huống `detectSb` trả null ở
   `sbIndex` đầu tiên → xác nhận signal bị drop hẳn (giống live), KHÔNG thử
   lại ở index sau.
4. Test try/catch: `detectSb` throw → không crash backtest.

## Ghi kết quả

`result.md`: trả lời đầy đủ 4 câu hỏi tự-verify ở trên (trỏ dòng code cụ
thể), 4 test mới, kết quả build + test. Nếu có điểm không rõ trong thuật
toán đã hỏi qua `blocked.md`, ghi rõ đã hỏi gì và cách Lead trả lời (nếu đã
nhận được) trước khi implement.
