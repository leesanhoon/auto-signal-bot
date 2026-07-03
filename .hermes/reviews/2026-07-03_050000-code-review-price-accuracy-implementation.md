# Code review findings: price-accuracy implementation (screenshot.ts / check-pending-orders-runner.ts)

Review của diff hiện tại (implementation của plan [2026-07-03_040000-accurate-price-data-entry-sl-tp.md](../plans/2026-07-03_040000-accurate-price-data-entry-sl-tp.md)). 3 finding, giao cho worker sửa theo thứ tự dưới đây (đã tạo task #13-#15 tương ứng trong task tracker).

## 1. [Mức độ: cao] Mất render delay ở nhánh fallback của `captureChart()`

**File:** `src/charts/screenshot.ts`, hàm `captureChart` (trong khối `if (frame) { ... }`)

Bản cũ luôn gọi `await page.waitForTimeout(renderDelayMs ?? CHART_RENDER_DELAY)` **vô điều kiện** trước khi chụp ảnh. Bản mới thay bằng vòng lặp `resolveLastPrice()` polling giá — nhưng vòng lặp này **chỉ chạy bên trong nhánh `if (contentFrame)`**. Khi `contentFrame` là `null`/falsy (ví dụ Playwright không lấy được nội dung iframe), code rơi xuống nhánh fallback bên dưới và **chụp ảnh ngay lập tức, không còn bất kỳ khoảng chờ nào**.

→ Nhánh fallback có thể chụp chart chưa render xong (trắng, thiếu nến/EMA/label giá), lại đúng vào lúc mục tiêu của thay đổi này là *tăng* độ chính xác dữ liệu chart. Cần thêm lại một khoảng chờ tối thiểu (vd 2-4s, hoặc tái dùng logic polling nhưng bỏ qua bước đọc giá) trước khi `page.screenshot()` ở nhánh fallback.

## 2. [Mức độ: trung bình] Code chụp ảnh + đặt tên file bị lặp lại

**File:** `src/charts/screenshot.ts`, cùng hàm `captureChart`

Logic tạo `timestamp`/`filename`/`filepath` và gọi `page.screenshot(...)` xuất hiện **2 lần gần như y hệt**: một lần trong nhánh `if (contentFrame)` (đường thành công, có `lastPrice`), một lần ở nhánh fallback bên dưới (khác mỗi cách viết regex thay `:` và `/` trong tên file — `.replace(/[:/]/g, "_")` vs `.replace(/:/g, "_").replace(/\//g, "_")`, kết quả tương đương). Nên gộp lại thành một đường chụp ảnh duy nhất, `lastPrice` là optional, tránh 2 nơi phải sửa đồng bộ mỗi khi đổi logic chụp ảnh.

*Gợi ý: sửa chung với finding #1 vì cùng một chỗ, cùng lúc dedupe + thêm lại delay cho nhánh fallback.*

## 3. [Mức độ: thấp] Dead code — case `MARKET_NOW` không bao giờ chạy tới

**File:** `src/charts/check-pending-orders-runner.ts`, hàm `resolvePendingOrderByPrice`

`switch (order.orderType)` có nhánh `case "MARKET_NOW":` nhưng bảng `pending_orders` có check constraint chỉ cho phép `order_type in (BUY_STOP, SELL_STOP, BUY_LIMIT, SELL_LIMIT, WAIT_FOR_CONFIRMATION)` (xem `supabase/migrations/20260703010000_create_pending_orders.sql`). Setup dạng `MARKET_NOW` được lưu thẳng vào `open_positions` qua `shouldAutoTrackAsOpen()` trong `src/charts/index.ts`, không bao giờ vào `pending_orders`. → nhánh `case "MARKET_NOW"` này là dead code, nên xoá (hoặc thu hẹp type `PendingOrder.orderType` để loại `MARKET_NOW` ra khỏi union, để TypeScript tự bắt lỗi tương tự trong tương lai thay vì phải rà bằng review).

## Task tracker

- #13 — Fix missing render delay in screenshot.ts fallback path
- #14 — Dedupe screenshot capture/filename logic in captureChart()
- #15 — Remove dead MARKET_NOW case in resolvePendingOrderByPrice
