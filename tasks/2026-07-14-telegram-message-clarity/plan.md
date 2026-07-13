# Plan — Làm rõ nội dung Telegram signal (đối chiếu tài liệu Bob Volman)

## Bối cảnh

User paste 1 message Telegram thật và chỉ ra nhiều chỗ khó hiểu/mâu thuẫn. Lead đã trace root cause
từng điểm bằng cách đọc code thực tế (không đoán). Lưu ý quan trọng: một phần nội dung user paste
(nhiều dòng "Lý do vào lệnh" chưa dịch, ví dụ `Range detected w=6, range=0.07700`, `Entry SHORT tai
3.52600` không dấu, `Edge test #1 at index 175...`) khớp với **bản build/deploy CŨ** của bot — tức là
bot chạy thật hiện tại chưa có các template dịch mà 2 subtask trước (`2026-07-14-arb-decoy-compression`)
đã thêm vào code (working tree, chưa rebuild/redeploy). Đây KHÔNG phải bug mới, chỉ là bot chưa chạy
bản mới nhất. Tuy nhiên rà lại code MỚI NHẤT vẫn phát hiện 6 vấn đề thật sự, liệt kê bên dưới.

## Root cause từng điểm user nêu

| User nêu | Nguyên nhân thật (đã xác nhận bằng code) | File |
|---|---|---|
| `Resolver Conflict: giu ARB(conf=85), bo RB(conf=80)` xuất hiện 2 lần (1 lần trong dòng "Lệnh:", 1 lần trong "Lý do vào lệnh") | `setup-resolver.ts` push thẳng debug text vào `kept.ruleTrace` — dòng này vừa lọt vào `reasons` (map toàn bộ ruleTrace) vừa bị lấy làm `entryCondition` (dòng CUỐI của ruleTrace, dùng cho phần "Lệnh:") vì nó là dòng được push SAU CÙNG, đè lên dòng entry thật | `src/charts/setup-resolver.ts:93-95`, `src/charts/signal-assembly.ts:119-121` |
| "từ cache ... 2026-07-13T20:00:deterministic:single:M15" khó hiểu | `candleKey` là cache-key nội bộ (gồm hậu tố `engineMode:timeframeMode:timeframe`), in thẳng ra Telegram không qua format | `src/shared/telegram-volman.ts:376-379` |
| Giờ "chưa đúng với Việt Nam" | 2 timestamp trong CÙNG message dùng 2 timezone khác nhau: `timestamp` header dùng `Asia/Ho_Chi_Minh` (dòng 363-365), nhưng `formatCandleAge()` hard-code giờ UTC (dòng 46-52) — user thấy giờ UTC tưởng nhầm là giờ sai | `src/shared/telegram-volman.ts:37-53` |
| "Giá và giá thật là gì" — hiện `Giá: 3.50700 (Giá thật hiện tại: 3.50700)` trùng lặp | `applyPriceSanityChecks()` LUÔN set `currentPriceContext = "Giá thật hiện tại: X"` (X = chính `lastPrice`) khi setup mới không có context nào khác → 2 giá trị giống hệt nhau hiển thị 2 lần | `src/charts/analyzer-volman.ts:39-41`, `src/shared/telegram-volman.ts:120-131` |
| "Rủi ro không hiểu gì" — hiện tiêu đề "⚠️ Rủi ro cần lưu ý:" trống, không có bullet nào | `buildRisks()` chỉ điền risk khi `confidence < 70`; signal này confidence=85% nên `risks=[]`, nhưng `risksBlock` trong `buildCopyableSetup()` LUÔN ghép header dù mảng rỗng → header hiện ra không có nội dung | `src/charts/signal-assembly.ts:69-96`, `src/shared/telegram-volman.ts:165-168` |
| "Lý do vào lệnh quá dài", lẫn text tiếng Anh/không dấu | `REASON_TEMPLATES` thiếu template cho nhiều dòng `ruleTrace` (vd `Edge test bonus: +20 (2 tests x 10)` không có template nào khớp) → giữ nguyên raw. Ngoài ra scan toàn bộ 7 file setup phát hiện còn nhiều dòng trace khác (SB/FB/DDB/BB/IRB) cũng thiếu template, sẽ lộ y hệt vấn đề này khi các setup đó bắn tín hiệu | `src/charts/signal-assembly.ts` (REASON_TEMPLATES), tất cả `src/charts/setups/*.ts` |

## Nguyên tắc chung khi sửa (bám tài liệu `bob_volman_setups.pdf`)

Tài liệu dùng ngôn ngữ giao dịch thuần Việt, không thuật ngữ debug: "EMA21 phẳng", "hộp đi ngang",
"chạm bật ở biên", "sóng kéo ngược hài hòa", "cụm doji", "mô hình W/M", "phá vỡ mồi", "đoạn nén
chặt/lỏng". Khi viết bản dịch cho các trace line còn thiếu, Worker PHẢI dùng đúng từ vựng này thay vì
dịch word-by-word từ biến code (vd không dịch "touchCount=2" thành "touchCount=2", mà "Đã chạm bật
biên 2 lần").

## Subtasks

| # | Subtask | Trạng thái |
|---|---------|-----------|
| 01 | Sửa resolver-conflict text rò vào entryCondition + reasons (2 lần) | Có thể làm ngay |
| 02 | Bỏ trùng lặp "Giá / Giá thật hiện tại" | Có thể làm ngay |
| 03 | Ẩn risks block khi rỗng + đồng bộ timezone Việt Nam + humanize cache-key line | Có thể làm ngay |
| 04 | Bổ sung đầy đủ REASON_TEMPLATES cho toàn bộ trace line còn thiếu (DDB/FB/SB/BB/RB/IRB/ARB), dùng đúng từ vựng tài liệu | Có thể làm ngay, khối lượng lớn nhất |

Không có subtask nào bị block — đủ thông tin để Worker thực thi ngay, không cần thêm tài liệu.

## Không làm trong lần này

- Không đổi thuật toán detect/confidence/entry/stop/TP của bất kỳ setup nào.
- Không đổi cấu trúc `DetectedSignal`/`TradeSetup` types (trừ khi task.md nêu rõ field optional mới,
  không có ở đây).
- Không rewrite lại toàn bộ kiến trúc `ruleTrace` (dùng chung cho debug lẫn hiển thị) — đó là thay đổi
  kiến trúc lớn hơn, ngoài phạm vi yêu cầu hiện tại của user (chỉ yêu cầu "làm rõ nội dung gửi tele",
  không yêu cầu tách bạch debug log vs user-facing log).
