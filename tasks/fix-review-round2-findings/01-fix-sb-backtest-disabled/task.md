# Task 01 — Fix SB detection permanently disabled in backtest (CRITICAL)

## Vấn đề (đã xác nhận đọc code)

`src/charts/setup-sb-runner.ts:40` có guard (thêm ở vòng fix trước):
```ts
if (currentIndex < signal.triggerIndex + 2) {
  logger.debug(`Dropped ${signal.setup} signal (false-break confirmed but insufficient trailing candles for SB)`, {...});
  continue;
}
```

`src/charts/setup-backtest.ts:93` gọi:
```ts
const { resolved } = runSbDetection(candles, signals, index, ctx);
```
với `index` là biến vòng lặp `for (let index = startIndex; index < candles.length; index++)`
(dòng 70). MỌI detector (`dd.ts`, `fb.ts`, `bb.ts`, `rb.ts`, `arb.ts`, `irb.ts`,
`sb.ts`) đều set `triggerIndex: index` — CHÍNH `index` đó — cho signal trả về ở
lần lặp đó.

Kết quả: trong `setup-backtest.ts`, `currentIndex` LUÔN LUÔN bằng
`signal.triggerIndex` (cùng 1 giá trị `index`). Vậy điều kiện
`currentIndex < signal.triggerIndex + 2` luôn đúng (`index < index + 2`) — SB
LUÔN bị drop, không bao giờ gọi `detectSb`. `npm run backtest:setups` giờ sẽ
LUÔN báo cáo 0 lệnh SB, dù dữ liệu thực tế có đủ nến sau đó để hình thành SB.

Đây là regression nghiêm trọng hơn bug ban đầu (trước đây SB backtest vẫn chạy
được, dù có off-by-one khác) — cần fix trước khi tin số liệu backtest.

## Nguyên nhân gốc

Guard mới được thiết kế cho use-case LIVE (deterministic-pipeline.ts, nơi
`currentIndex = lastIndex` cố định và re-run nhiều lần với `lastIndex` tăng dần
theo thời gian thực — nên 1 signal quá "mới" ở lần chạy này có thể pass ở lần
chạy sau). Nhưng batch backtest (`setup-backtest.ts`) chỉ duyệt qua lịch sử
ĐÚNG 1 LẦN theo thứ tự — không có "lần chạy sau" nào để re-check, nên guard
này vô tình chặn vĩnh viễn.

## Yêu cầu

Sửa `src/charts/setup-backtest.ts` để gọi `runSbDetection` với `currentIndex`
đúng ngữ nghĩa "có đủ nến TRONG TOÀN BỘ MẢNG `candles`" thay vì "đến đâu rồi
trong vòng lặp hiện tại" — vì trong backtest, TOÀN BỘ `candles` đã có sẵn từ
đầu (không giống live chỉ có dữ liệu đến `lastIndex`).

Cách sửa: đổi tham số `currentIndex` truyền vào `runSbDetection` ở
`setup-backtest.ts:93` từ `index` (vị trí đang duyệt) thành
`candles.length - 1` (chỉ số nến cuối cùng có sẵn trong toàn bộ dataset —
đúng với thực tế là backtest CÓ SẴN toàn bộ dữ liệu, không bị giới hạn bởi
"hiện tại đang ở đâu"):

```ts
const { resolved } = runSbDetection(candles, signals, candles.length - 1, ctx);
```

SAU KHI sửa, đọc lại kỹ `runSbDetection` — đảm bảo các phần khác của hàm (vd.
`sbIndex = Math.min(signal.triggerIndex + SB_BUILDUP_LOOKAHEAD, currentIndex)`)
vẫn hoạt động đúng với `currentIndex` giờ luôn là hằng số lớn
(`candles.length - 1`) thay vì tăng dần theo từng lần lặp — đặc biệt kiểm tra
xem việc này có làm SB "nhìn thấy tương lai" (look-ahead bias) trong backtest
hay không: `detectSb` chỉ dùng nến từ `sbIndex` trở về trước để tính block/entry
(xem `src/charts/setups/sb.ts`), nên việc `currentIndex` lớn hơn không tự động
gây look-ahead — nhưng PHẢI tự xác nhận lại điều này bằng cách đọc kỹ
`detectSb` và `scanOutcome` trong `setup-backtest.ts` trước khi kết luận an
toàn. Nếu phát hiện look-ahead bias thực sự (SB dùng dữ liệu từ SAU
`triggerIndex` gốc mà lẽ ra tại thời điểm đó chưa biết), ghi rõ vào
`blocked.md` và đề xuất cách khác (ví dụ: giữ nguyên `currentIndex = index`
nhưng nới điều kiện guard cho phù hợp cả 2 use-case).

## KHÔNG làm

- Không đổi `deterministic-pipeline.ts` (live pipeline không bị ảnh hưởng bởi
  bug này — vẫn đúng như thiết kế).
- Không xóa guard `currentIndex < signal.triggerIndex + 2` trong
  `setup-sb-runner.ts` — guard vẫn đúng và cần thiết, vấn đề chỉ nằm ở giá trị
  `currentIndex` mà `setup-backtest.ts` truyền vào.

## Verification

```bash
npm run build
npm run test -- --run
```

Viết test trong `tests/charts/setup-backtest.test.ts` (nếu file tồn tại) hoặc
file test phù hợp: dựng candle array có false-break + buildup rõ ràng cho SB
(có thể tham khảo cách runSbDetection được test ở
`tests/charts/setup-sb-runner-boundary.test.ts` để dựng fixture tương tự,
nhưng chạy qua `runSetupBacktest` thay vì gọi `runSbDetection` trực tiếp) —
xác nhận sau khi sửa, `report.bySetup["SB"]` có ít nhất 1 trade khi dữ liệu
phù hợp (KHÔNG mock `detectSb`/`detectCompression` — dùng dữ liệu nến thật để
tránh lặp lại lỗi test-tautological đã gặp ở IRB).

## Ghi kết quả

`result.md`: cách sửa, kết quả kiểm tra look-ahead bias, test mới, kết quả
build + test.
