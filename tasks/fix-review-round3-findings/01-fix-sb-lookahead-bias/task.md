# Task 01 — Fix SB backtest lookahead bias (CRITICAL — cần thiết kế lại, không phải sửa 1 dòng)

## Vấn đề (đã xác nhận qua 6+ agent review độc lập, đọc trực tiếp code)

`src/charts/setup-backtest.ts:93`:
```ts
const { resolved } = runSbDetection(candles, signals, candles.length - 1, ctx);
```

Đây là fix của round trước cho bug "SB không bao giờ ra tín hiệu trong
backtest" — nhưng cách fix (truyền `candles.length - 1`, tức chỉ số nến CUỐI
CÙNG của TOÀN BỘ dataset, thay vì vị trí walk-forward hiện tại `index`) gây ra
lookahead bias nghiêm trọng hơn:

- Mọi detector set `triggerIndex: index` (vị trí vòng lặp walk-forward hiện
  tại) cho signal nó trả về.
- `runSbDetection` bên trong tính `sbIndex = Math.min(triggerIndex + 3,
  currentIndex)` (`setup-sb-runner.ts:49`) — với `currentIndex` giờ luôn là
  hằng số lớn (`candles.length - 1`), `sbIndex` gần như luôn resolve thành
  `triggerIndex + 3` — tức 3 nến SAU vị trí walk-forward hiện tại.
- `detectSb(candles, sbIndex, ctx, signal)` tính `entry`/`stopLoss` từ block
  hình thành ở các nến `triggerIndex+1` đến `triggerIndex+3` — dữ liệu mà 1
  trader thật tại thời điểm `index=triggerIndex` KHÔNG THỂ biết được.
- `setup-backtest.ts:105` ghi nhận trade với `entryIndex: index` (=
  `triggerIndex`, KHÔNG PHẢI `sbIndex`), nhưng `entryPrice`/`stopLoss` là giá
  trị tính từ tương lai.
- `scanOutcome(candles, signal, index)` (dòng 99) quét outcome BẮT ĐẦU TỪ
  `index` — quét lại CHÍNH các nến (`index+1` đến `index+3`) vừa dùng để tính
  ra `stopLoss`/`entry` — gần như chắc chắn khớp SL/TP ngay lập tức bằng dữ
  liệu đã dùng để định nghĩa chính nó. Điều này thổi phồng win-rate/RR của SB
  trong báo cáo backtest một cách không thực tế.
- Hệ quả phụ: `activeUntilIndex` (dòng ~117-121) có thể bị set sai do
  `outcome.exitIndex` nằm trong khoảng `[index, sbIndex)`, có thể phá vỡ
  invariant "không chồng lệnh".

Pipeline live (`deterministic-pipeline.ts:96`, truyền `lastIndex` thật) KHÔNG
bị ảnh hưởng — vấn đề CHỈ xảy ra trong backtest.

## Nguyên tắc bắt buộc phải giữ (walk-forward invariant)

**Tại bất kỳ thời điểm nào trong vòng lặp backtest ở vị trí `index`, MỌI
tính toán/quyết định (kể cả việc xác nhận SB) CHỈ ĐƯỢC dùng dữ liệu từ
`candles[0..index]`.** Không được dùng `candles[index+1..]` để tính bất kỳ
giá trị nào (entry, stop, TP, hay quyết định có tín hiệu hay không) rồi gán
kết quả đó cho `entryIndex = index`.

## Hướng fix được khuyến nghị

SB cần 3 nến SAU false-break để xác nhận buildup — điều này về bản chất
KHÔNG THỂ xác nhận ngay tại `index = triggerIndex` trong 1 walk-forward
backtest trung thực. Cách đúng: **hoãn việc xác nhận SB sang lần lặp SAU**,
khi vòng lặp walk-forward tự nhiên tiến tới `index >= triggerIndex + 2` (đủ
dữ liệu thật sự đã "xảy ra").

Thiết kế đề xuất cho `runSetupBacktest` (`src/charts/setup-backtest.ts`):

1. Thêm 1 danh sách `pendingFalseBreaks: Array<{ signal: DetectedSignal,
   triggerIndex: number }>` sống xuyên suốt vòng lặp (không phải biến cục bộ
   trong 1 lần lặp).

2. Ở mỗi vị trí `index`:
   - Chạy 6 detector chuẩn như hiện tại → `signals`.
   - Với mỗi signal MỚI: kiểm tra `isFalseBreak` (logic này giữ nguyên, đã
     đúng — chỉ nhìn tối đa 2 nến sau `triggerIndex`, nằm trong dữ liệu đã
     biết tại `index` nếu `index >= triggerIndex + 2`). Nếu KHÔNG false-break
     → coi là valid signal, xử lý như bình thường (entry ngay tại `index`).
     Nếu LÀ false-break → đẩy vào `pendingFalseBreaks`, KHÔNG gọi `detectSb`
     ngay.
   - Với mỗi phần tử trong `pendingFalseBreaks` mà `index >= triggerIndex +
     SB_BUILDUP_LOOKAHEAD` (đủ 3 nến đã thực sự trôi qua): gọi
     `detectSb(candles, index, ctx, pendingSignal)` — dùng CHÍNH `index` hiện
     tại (không phải `triggerIndex + 3` được tính trước) làm điểm xác nhận,
     vì dữ liệu tới `index` giờ ĐÃ THỰC SỰ có sẵn tại bước lặp này. Nếu có
     tín hiệu SB → entry tại `index` HIỆN TẠI (không phải `triggerIndex` cũ),
     ghi `entryIndex: index` khớp đúng với thời điểm dữ liệu thực sự sẵn
     sàng. Xóa phần tử khỏi `pendingFalseBreaks` (dù thành công hay thất bại
     — không chờ mãi, tránh rò rỉ bộ nhớ/kiểm tra vô hạn). Nếu quá hạn hợp
     lý (ví dụ `index > triggerIndex + SB_BUILDUP_LOOKAHEAD + 5` mà vẫn chưa
     xử lý được — dùng do logic overlap-skip `activeUntilIndex` có thể trì
     hoãn), vẫn phải xóa để tránh giữ mãi.

3. Cân nhắc kỹ tương tác với `activeUntilIndex` (skip khi có lệnh đang mở) —
   đảm bảo `pendingFalseBreaks` vẫn được xử lý đúng ngay cả khi vòng lặp
   `continue` do đang có lệnh active (tách riêng việc "xử lý pending SB" ra
   khỏi điều kiện skip nếu cần, hoặc merge phù hợp — tùy bạn quyết định,
   miễn giữ đúng invariant walk-forward).

4. `runSbDetection` trong `setup-sb-runner.ts` có thể cần tách thành 2 hàm
   nhỏ hơn: 1 hàm chỉ check false-break + phân loại pending/valid (không gọi
   detectSb), 1 hàm chỉ xử lý pending queue tại 1 `index` cụ thể — hoặc giữ
   nguyên interface hiện có nếu bạn tìm được cách tương thích ngược cho
   `deterministic-pipeline.ts` (live pipeline KHÔNG cần đổi gì — nó gọi 1 lần
   duy nhất ở cuối với `lastIndex`, hoàn toàn tương thích với thiết kế hiện
   tại, không có khái niệm "pending qua nhiều lần gọi").

**Nếu bạn có cách tiếp cận khác đơn giản hơn nhưng VẪN đảm bảo đúng invariant
walk-forward (không dùng dữ liệu tương lai để tính giá trị gán cho 1 index
quá khứ), có thể dùng — miễn giải thích rõ trong `result.md` và pass được
test ở phần Verification.**

## KHÔNG làm

- Không đổi `deterministic-pipeline.ts` (live pipeline đã đúng, không cần
  sửa).
- Không đổi logic `isFalseBreak`, `detectSb`'s internal block detection —
  chỉ đổi CÁCH GỌI và THỜI ĐIỂM gọi.
- Không đơn giản trả `currentIndex = index` (revert nguyên trạng) — điều đó
  tái tạo lại bug "SB luôn bị drop" đã fix ở round trước (guard
  `currentIndex < triggerIndex + 2` trong `setup-sb-runner.ts:40` sẽ luôn
  đúng nếu `currentIndex = index = triggerIndex`).

## Verification

```bash
npm run build
npm run test -- --run
```

**BẮT BUỘC** viết test mới trong `tests/charts/setup-backtest.test.ts` chứng
minh KHÔNG còn lookahead — ví dụ:

```ts
test("SB trade entryIndex reflects when data was actually available (no lookahead)", () => {
  // Dựng candles sao cho block định nghĩa entry/stop của SB chỉ có thể tính
  // được SAU khi có đủ nến tại index = triggerIndex + 3
  // Chạy runSetupBacktest
  // Xác nhận: trade.entryIndex >= trade tương ứng với triggerIndex gốc + ít
  // nhất 2 (không phải bằng triggerIndex gốc, vì SB cần buildup)
  // Xác nhận: entryPrice/stopLoss của trade KHÔNG dùng dữ liệu candles sau
  // entryIndex đã ghi nhận (kiểm tra bằng cách thay đổi candles SAU
  // entryIndex và xác nhận entry/stop KHÔNG đổi — nếu đổi tức còn lookahead)
});
```

Test hiện có (`tests/charts/setup-backtest.test.ts:38-71`, "captures an SB
trade...") vẫn phải pass, cập nhật nếu cần cho khớp `entryIndex` mới (giờ sẽ
khác `triggerIndex` gốc).

## Ghi kết quả

`result.md`: thiết kế đã chọn (theo đề xuất hay khác), thay đổi cụ thể ở
`setup-backtest.ts`/`setup-sb-runner.ts`, test mới chứng minh không lookahead,
kết quả build + test.
