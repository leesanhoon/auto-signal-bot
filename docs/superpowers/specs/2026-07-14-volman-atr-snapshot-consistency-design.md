# Volman Setup Detectors — ATR Snapshot Consistency Fix

## Bối cảnh

Người dùng phát hiện lệnh SHORT XLM/USDT (setup ARB, mở 2026-07-14 02:16 UTC) trông "hoàn toàn sai" khi đối chiếu với chart live. Điều tra thực tế qua Supabase (`open_positions_volman`, `ohlc_candle_cache`, `logs`) cho thấy:

- Setup ARB đó **hợp lệ về mặt số liệu** — vùng tích lũy, breakout, entry/SL/TP đều khớp với candle thật. Đây là một lệnh thua bình thường (-1R), không phải bug.
- Lý do người dùng "không thấy chart" là một bug riêng, đã xác nhận 100% tái hiện qua log: Playwright chưa được cài (`browserType.launch: Executable doesn't exist`) trên máy chạy production (`C:\Project\auto-signal-bot`), khiến mọi lần gửi signal đều fallback về text-only trong im lặng. Bug này **không nằm trong scope của spec này** (xem "Ngoài phạm vi" bên dưới).

Trong lúc audit sâu 7 setup detector (`ddb.ts`, `fb.ts`, `sb.ts`, `bb.ts`, `rb.ts`, `arb.ts`, `irb.ts`) theo yêu cầu người dùng, phát hiện một lỗi cấu trúc thật sự trong 4 detector dùng `detectCompression()`: **ATR dùng để xác nhận block/range không nhất quán với ATR dùng để phân loại độ chặt (tightness) và tính ngưỡng khoảng cách EMA21 của chính block/range đó.**

## Vấn đề kỹ thuật

`detectCompression(candles, ma21, atr14, endIndex, windowSize, kBlock)` (trong `src/charts/indicators.ts`) nhận `endIndex` là nến cuối cùng đã đóng của block/range (luôn truyền `index - 1`, không bao gồm nến breakout đang xét tại `index`). Nội bộ hàm này dùng `atr14[endIndex]` để quyết định block có hợp lệ không: `range <= kBlock * atr14[endIndex]`. Đây là bước tự nhất quán.

Nhưng ngay sau khi nhận `CompressionWindow` trả về, 4 file gọi hàm này lại dùng `ctx.atr14[index]` (ATR của **nến breakout**, khác `endIndex`) cho các bước xử lý tiếp theo trên cùng block/range đó:

| File | Dòng liên quan | Dùng sai ATR cho |
|---|---|---|
| `src/charts/setups/bb.ts` | `const atr = ctx.atr14[index]` (dòng 30) → `classifyCompressionTightness(block, kBlock, atr)` (dòng 68) | Phân loại TIGHT/LOOSE |
| `src/charts/setups/rb.ts` | `const atr = ctx.atr14[index]` (dòng 23) → `classifyCompressionTightness(range, kBlockRb, atr)` (dòng 53) | Phân loại TIGHT/LOOSE |
| `src/charts/setups/arb.ts` | `const atr = ctx.atr14[index]` (dòng 25) → `classifyCompressionTightness(range, kBlockArb, atr)` (dòng 46) và `maxEmaDistance = 0.5 * atr` (dòng 94) | Phân loại TIGHT/LOOSE + ngưỡng khoảng cách EMA21 |
| `src/charts/setups/irb.ts` | `const atr = ctx.atr14[index]` (dòng 89) → `classifyCompressionTightness(rangeInner, kBlockInner, atr)` (dòng 169) và `classifyCompressionTightness(rangeOuter, kBlockOuter, atr)` (dòng 170) | Phân loại TIGHT/LOOSE cho cả 2 range |

Khi biến động (ATR) thay đổi đáng kể giữa nến cuối compression và nến breakout — điều thường xảy ra chính lúc breakout — các bước phân loại/ngưỡng này dùng sai mốc ATR so với mốc đã thực sự xác nhận block/range hợp lệ. Hệ quả có thể là:
- Một block/range LOOSE (rủi ro cao hơn) bị phân loại nhầm thành TIGHT (hoặc ngược lại), làm sai confidence bonus.
- Với ARB: một range thực ra đã quá xa EMA21 lúc hình thành (đáng lẽ phải loại) lại lọt qua gate vì `maxEmaDistance` được tính bằng ATR "hậu breakout" (thường lớn hơn), nới lỏng ngưỡng không đúng ý đồ thiết kế.

## Giải pháp

Tại đúng 5 điểm gọi liệt kê ở bảng trên, thay `ctx.atr14[index]` bằng ATR tại `endIndex` của chính window đang được xử lý:
- `bb.ts`: `ctx.atr14[block.endIndex]`
- `rb.ts`: `ctx.atr14[range.endIndex]`
- `arb.ts`: `ctx.atr14[range.endIndex]` (áp dụng cho cả 2 điểm gọi)
- `irb.ts`: `ctx.atr14[rangeInner.endIndex]` cho tightness của inner; `ctx.atr14[rangeOuter.endIndex]` cho tightness của outer

Giá trị này an toàn non-null: `detectCompression()` chỉ trả về window khi `atr14[endIndex]` đã hợp lệ và khác 0, nên khi window không phải `null`, `ctx.atr14[window.endIndex]` chắc chắn là số hữu hạn khác 0. Có thể ép kiểu non-null (`!`) hoặc thêm guard tường minh tùy theo convention hiện có trong file.

**Không đổi** các chỗ dùng `ctx.atr14[index]` khác trong cùng 4 file — ví dụ `computeBodyRatio` trên nến breakout, `computeSlope` khi đánh giá momentum hiện tại, guard `if (ema === null || atr === null || atr === 0) return null` ở đầu hàm (vẫn giữ nguyên như bail sớm trước khi window được tìm thấy). Những chỗ này đúng nghĩa là "trạng thái tại nến breakout", không liên quan đến việc xác nhận block/range.

## Ngoài phạm vi

Các vấn đề sau được phát hiện trong cùng buổi audit nhưng **không** thuộc spec này (đã thống nhất với người dùng thu hẹp phạm vi):
- Bug Playwright chưa cài trên máy production → chart luôn fallback text-only.
- Bug Binance position sizing tính margin vượt balance khả dụng, khiến lệnh auto-track không mở được trên Binance thật.
- Bug convert symbol theo format Forex (`OANDA:XXXYYY`) áp dụng nhầm cho cặp crypto khi check EMA-exit, gây lỗi fetch OHLC liên tục.
- Nghi vấn ngưỡng SB/FB đã bị nới lỏng quá mức so với tài liệu Volman gốc (cần backtest xác nhận riêng).

## Testing

- Rà lại thư mục `tests/charts/` để xác nhận có/chưa có test riêng cho từng file `setups/*.ts` — nếu chưa có, cần viết test case tái hiện tình huống ATR tại `index` khác biệt rõ rệt so với ATR tại `endIndex` của window, chứng minh kết quả tightness/gate thay đổi đúng như kỳ vọng sau fix.
- Chạy `setup-backtest-runner.ts` / `setup-backtest-compare-runner.ts` trước và sau fix để so sánh ảnh hưởng lên win-rate/số lượng tín hiệu — đảm bảo fix không vô tình làm mất hết tín hiệu (over-correction) hoặc không thay đổi gì (fix không có tác dụng thực).
- `npm run build` + `npm run test` phải pass.
