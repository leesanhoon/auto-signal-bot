# Plan — Cache OHLC theo đúng thời điểm nến đóng (thay vì TTL cố định)

## Context

Hiện tại `src/charts/ohlc-provider.ts` đã có cache (`cache = new Map(...)`),
nhưng TTL là con số CỐ ĐỊNH không khớp với thời điểm nến thực sự đóng:

```ts
// TIMEFRAME_CONFIG hiện tại (dòng 65-84)
M15: { cacheTtlMs: 5 * 60 * 1000, ... }   // cache 5 phút
H4:  { cacheTtlMs: 30 * 60 * 1000, ... }  // cache 30 phút
D1:  { cacheTtlMs: 6 * 60 * 60 * 1000, ... } // cache 6 giờ
```

Nến M15 đóng mỗi 15 phút, nhưng cache chỉ giữ 5 phút → trong 1 chu kỳ nến 15
phút, có thể gọi API lại 2-3 lần dù dữ liệu (các nến đã đóng) KHÔNG hề đổi.
Tương tự H4 (nến đóng mỗi 4h, cache chỉ 30 phút → gọi lại ~8 lần/chu kỳ nến).

Người dùng chỉ vào lệnh SAU KHI nến hiện tại đã đóng hoàn toàn (phong cách
giao dịch dựa trên nến đã đóng, không phải nến đang hình thành) — nghĩa là
dữ liệu nến ĐÃ ĐÓNG không cần fetch lại cho tới khi nến TIẾP THEO đóng. Cache
nên sống chính xác từ lúc fetch tới lúc nến kế tiếp đóng, không phải 1 con
số TTL tùy ý.

## Mục tiêu

Đổi cache expiry từ "TTL cố định kể từ lúc fetch" sang "tới đúng thời điểm
nến tiếp theo đóng" (candle-boundary-aligned cache), cho cả 3 timeframe
M15/H4/D1, áp dụng cho cả 2 provider (MetaApi, Twelve Data).

## 1 subtask

- `01-implement-boundary-aligned-cache/`

## Verification chung

```bash
npm run build
npm run test -- --run
```
Sau khi xong, Lead sẽ tự theo dõi log thực tế (chạy `npm run backtest:setups`
hoặc scanner thật) để xác nhận số lần gọi API giảm đúng như kỳ vọng, không
gọi lại trong cùng 1 chu kỳ nến.
