# Task 03 — Make MetaApi incomplete-candle filter robust (HIGH)

## Vấn đề

`src/charts/ohlc-provider.ts:446` khôi phục filter:
```ts
if (r.complete === false) continue;
```
cho nhánh MetaApi. Nhưng đối chiếu git history, đoạn code này BAN ĐẦU được
viết cho response OANDA (`body.candles[]`, có field `complete` — schema OANDA
tài liệu hóa rõ ràng), KHÔNG PHẢI viết riêng cho MetaApi. MetaApi's
historical-market-data endpoint trả về mảng phẳng với field khác
(`tickVolume`, `brokerTime`, `spread`, `volume`...) — không có tài liệu nào
trong repo xác nhận MetaApi có field `complete`.

Nếu MetaApi thực sự KHÔNG trả field này, `r.complete` luôn là `undefined`,
điều kiện `r.complete === false` không bao giờ đúng → filter là dead code,
nến đang hình thành (nếu MetaApi có trả về) vẫn lọt qua.

**Không thể verify trực tiếp bằng cách gọi MetaApi thật** (tài khoản hiện bị
chặn region tại VN — xem `docs/volman-numeric-engine.md` phần lịch sử liên
quan Twelve Data). Vì vậy cần fix theo hướng KHÔNG PHỤ THUỘC vào việc field
`complete` có tồn tại hay không.

## Yêu cầu

Trong `src/charts/ohlc-provider.ts`, nhánh MetaApi:

1. GIỮ NGUYÊN check `if (r.complete === false) continue;` (không hại gì nếu
   field không tồn tại — chỉ là no-op, và nếu MetaApi CÓ trả field này thì
   vẫn hữu ích).

2. THÊM một heuristic dự phòng dựa trên thời gian — tương tự cách nhánh
   Twelve Data đã làm (`getTwelveDataIntervalMs`, `skipLatestCandle` —
   tham khảo cách implement ở đó, khoảng dòng 193-202, 296-299): xác định nến
   MetaApi CUỐI CÙNG (mới nhất theo `time`, sau khi đã parse) có nằm trong
   khung interval hiện tại hay chưa (`Date.now() - latestCandleTime <
   intervalMsCủaTimeframeĐó`), nếu đúng thì loại bỏ nến đó — CÙNG LOGIC như
   Twelve Data, có thể tái sử dụng `getTwelveDataIntervalMs` (đổi tên thành
   tên trung lập hơn nếu dùng chung, ví dụ `getIntervalMs`, không bắt buộc —
   tùy bạn đánh giá mức độ rủi ro rename).

3. Áp dụng CÙNG lưu ý về weekend market-close đã ghi nhận ở Twelve Data (task
   khác, `04-fix-twelvedata-weekend-heuristic` trong plan này) — nếu task đó
   đã có người làm trước và đổi cách tính, dùng lại helper đã sửa thay vì viết
   riêng bản khác cho MetaApi. Nếu task đó CHƯA làm, cứ dùng heuristic đơn
   giản (age < interval duration) như Twelve Data hiện tại, không cần tự chờ
   task kia.

## KHÔNG làm

- Không xóa check `r.complete === false` — giữ lại làm lớp bảo vệ đầu tiên
  (rẻ, không hại), heuristic thời gian là lớp bảo vệ thứ hai.
- Không đổi nhánh Twelve Data (trừ việc tái sử dụng hàm tính interval-ms nếu
  bạn chọn refactor chung).

## Verification

```bash
npm run build
npm run test -- --run tests/charts/ohlc-provider.test.ts
```

Cập nhật/thêm test cho nhánh MetaApi: mock response KHÔNG có field `complete`
(giống thực tế nếu giả thuyết đúng) nhưng candle cuối cùng có `time` rất gần
hiện tại (trong vòng 1 interval) — xác nhận candle đó vẫn bị loại bỏ nhờ
heuristic thời gian, không phụ thuộc field `complete`.

## Ghi kết quả

`result.md`: đoạn code đã thêm, test mới, kết quả build + test.
