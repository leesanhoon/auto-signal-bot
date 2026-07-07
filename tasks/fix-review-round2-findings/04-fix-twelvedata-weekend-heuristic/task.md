# Task 04 — Fix Twelve Data "still forming" heuristic near weekend market close (MEDIUM)

## Vấn đề

`src/charts/ohlc-provider.ts:296-299`:
```ts
const intervalMs = getTwelveDataIntervalMs(timeframe);
const latestTime = parseTwelveDataTimestamp(body.values[0]?.datetime);
const skipLatestCandle = Number.isFinite(latestTime) && Date.now() - latestTime < intervalMs;
```

Heuristic này giả định "nến mới hơn 1 interval = đang hình thành" — đúng với
thị trường giao dịch liên tục, nhưng SAI khi thị trường forex/CFD ĐÓNG CỬA
cuối tuần. Ví dụ: nến H4 mở lúc 20:00 UTC thứ 6, thị trường đóng cửa cuối
tuần ngay sau đó (~21:00-22:00 UTC). Fetch lúc 23:00 UTC thứ 6
(`Date.now() - latestTime = 3h < 4h`) → bị coi là "đang hình thành" và bị
loại bỏ NHẦM, dù đó là nến ĐÃ ĐÓNG hoàn toàn (thị trường đã dừng giao dịch từ
lâu, giá không còn thay đổi). Hậu quả: mất nến thật cuối tuần cho tới khi
phiên thứ 2 có nến mới.

## Yêu cầu

Trong `src/charts/ohlc-provider.ts`, sửa logic tính `skipLatestCandle` để
không dựa thuần vào "khoảng cách thời gian < interval", mà kết hợp thêm 1
trong 2 cách sau (chọn cách nào dễ triển khai/rủi ro thấp hơn, ghi rõ lý do
trong `result.md`):

**Cách A (khuyến nghị, đơn giản hơn):** Chỉ áp dụng heuristic "còn đang hình
thành" khi hiện tại đang trong giờ giao dịch (dùng lại hoặc tham khảo
`isTradableWindow`/logic phiên trong `src/charts/indicators.ts`, hoặc đơn
giản hơn: kiểm tra `now` không rơi vào khung cuối tuần forex — thứ 7 toàn bộ
+ Chủ nhật trước ~21:00 UTC, xấp xỉ được coi là market closed). Nếu market
đang đóng cửa, KHÔNG áp dụng skip (coi nến cuối là đã đóng hẳn, vì market đã
dừng giao dịch nên giá không đổi nữa).

**Cách B:** So sánh nến mới nhất với nến liền trước nó — nếu 2 nến cách nhau
đúng 1 interval chuẩn (ví dụ đúng 4 giờ cho H4) VÀ nến mới nhất chỉ mới xuất
hiện gần đây, giữ heuristic hiện tại; nếu khoảng cách giữa 2 nến gần nhất LỚN
HƠN 1 interval (dấu hiệu có gap do market đóng cửa cuối tuần), coi nến cuối
là đã đóng, không skip.

## KHÔNG làm

- Không đổi heuristic cho trường hợp thị trường đang mở bình thường (giữa
  tuần) — giữ nguyên hành vi hiện tại cho case đó.
- Không cần xử lý ngày lễ/holiday cụ thể — chỉ cần xử lý đúng case cuối tuần
  (thứ 7 - Chủ nhật) là đủ cho fix này.

## Verification

```bash
npm run build
npm run test -- --run tests/charts/ohlc-provider.test.ts
```

Thêm test: mock response Twelve Data với nến cuối cùng có `datetime` là thứ 6
tối gần giờ đóng cửa thị trường, thời điểm test giả lập (`vi.setSystemTime`
hoặc tương đương) là vài giờ sau đó nhưng vẫn trong cuối tuần — xác nhận nến
đó KHÔNG bị loại bỏ (vì thị trường đã đóng cửa, nến coi như đã chốt).

## Ghi kết quả

`result.md`: cách chọn (A hay B) và lý do, đoạn code đã sửa, test mới, kết
quả build + test.
