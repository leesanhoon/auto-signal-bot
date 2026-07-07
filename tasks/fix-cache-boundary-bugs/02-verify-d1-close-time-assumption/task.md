# Task 02 — Xác minh D1 (nến ngày) đóng lúc mấy giờ UTC thật sự (MEDIUM)

## Vấn đề

`getNextCandleCloseMs` giả định mọi timeframe (kể cả D1) đóng nến tại các
mốc chia hết cho `intervalMs` kể từ epoch Unix — với D1 (`intervalMs = 24h`)
nghĩa là giả định nến ngày đóng lúc **00:00 UTC** (nửa đêm UTC). Nhưng forex
thường đóng nến ngày lúc **21:00 hoặc 22:00 UTC** (theo giờ đóng cửa phiên
New York), KHÔNG PHẢI nửa đêm UTC — cần xác minh MetaApi và Twelve Data thực
sự trả timestamp D1 theo mốc nào.

## Yêu cầu

1. Nếu có thể truy cập MetaApi hoặc Twelve Data thật (kiểm tra
   `TWELVEDATA_API_KEY`/`METAAPI_TOKEN` trong `.env`) — gọi thử API D1 cho 1
   symbol (ví dụ EUR/USD) lấy vài nến gần nhất, xem giá trị `time`/`datetime`
   trả về có phải đúng 00:00:00 UTC hay 21:00:00/22:00:00 UTC.

2. Nếu KHÔNG truy cập được (ví dụ MetaApi bị chặn khu vực) — dùng Twelve
   Data (đã xác nhận hoạt động được trong project này) để kiểm tra riêng
   nhánh Twelve Data. Với MetaApi, tìm trong docs chính thức của MetaApi
   (không tự đoán) xem có ghi rõ quy ước giờ đóng nến D1 hay không — nếu
   không tìm được tài liệu rõ ràng, ghi nhận "không xác minh được cho
   MetaApi" thay vì đoán.

3. Dựa trên kết quả:
   - **Nếu D1 THẬT SỰ đóng lúc UTC midnight**: không cần sửa gì, ghi rõ
     trong `result.md` là đã xác minh và code hiện tại đúng.
   - **Nếu D1 đóng ở giờ KHÁC** (ví dụ 21:00/22:00 UTC): cần sửa
     `getNextCandleCloseMs` để xử lý RIÊNG cho D1 — không dùng công thức
     chia hết chung với M15/H4 nữa, mà tính mốc "21:00 UTC gần nhất sau
     `fromMs`" (tương tự cách tính weekend reopen ở task 01). Đề xuất tách
     hàm:
     ```ts
     function getNextCandleCloseMs(timeframe: ChartTimeframe, fromMs: number): number {
       if (timeframe === "D1") {
         return getNextDailyCloseMs(fromMs); // mốc 21:00 UTC (hoặc giờ đúng đã xác minh) gần nhất sau fromMs
       }
       const intervalMs = getIntervalMs(timeframe);
       const next = Math.ceil(fromMs / intervalMs) * intervalMs;
       return next === fromMs ? next + intervalMs : next;
     }
     ```
     (Nếu task 01 đã sửa xong phần exact-boundary trước, dùng lại logic đó,
     chỉ thêm nhánh riêng cho D1.)

## KHÔNG làm

- Không tự đoán giờ đóng nến D1 nếu không xác minh được — thà báo
  "không xác định" còn hơn đoán sai rồi code theo giả định sai.
- Không đổi M15/H4 (chỉ D1 có nguy cơ lệch múi giờ kiểu này, vì M15/H4 là
  chu kỳ trong ngày, không liên quan tới "giờ đóng cửa phiên").

## Verification

```bash
npm run build
npm run test -- --run tests/charts/ohlc-provider.test.ts
```

Nếu có sửa code: thêm test xác nhận `getNextCandleCloseMs("D1", ...)` trả
về đúng mốc giờ đã xác minh (không phải UTC midnight nếu xác nhận sai).

## Ghi kết quả

`result.md`: cách đã xác minh (gọi API thật hay đọc docs), kết luận cụ thể
(giờ đóng nến D1 là mấy giờ UTC), có sửa code hay không (và vì sao).
