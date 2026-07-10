# Plan: Signal Freshness Guard — chặn signal "ôi thiu" + hiển thị tuổi nến

## Bối cảnh

Sự cố thực tế (2026-07-10, USD/CAD M15, setup SMCFVGCONTINUATION):
user nhận signal SELL entry 1.41657 / SL 1.41687 / TP1 1.41597 / TP2 1.41567
khi giá thị trường đã ở 1.41474 — **vượt qua TP2 hơn 9 pips**. Signal đã chết
trước khi đến tay user.

### Nguyên nhân gốc (đã xác minh trong code)

1. **Trễ giao hàng**: `.github/workflows/analyze-smc.yml` chạy cron `*/15 * * * 1-5`.
   GitHub Actions cron trễ 5–15+ phút, cộng setup job 1–3 phút → signal M15
   đến trễ 1 nến trở lên. (User sẽ tự xử lý phần hạ tầng bằng mini PC — NGOÀI SCOPE.)
2. **Sanity check có lỗ hổng**: `applyPriceSanityChecks` (duplicate tại
   `src/charts/analyzer-smc.ts:29` và `src/charts/analyzer-volman.ts:29`)
   chỉ LOẠI setup khi `lastPrice` vượt SL. Khi giá đã vượt TP1/TP2 thì chỉ
   ghi chú vào summary/currentPriceContext rồi VẪN GỬI signal như bình thường.
3. **`lastPrice` là giá cũ**: cả hai pipeline lấy `lastPrice = close` của nến
   đã đóng (`deterministic-pipeline.ts:132`, `smc-pipeline.ts`). Khi run bị trễ,
   check sanity so sánh với giá cũ, không phải giá tại thời điểm gửi.
4. **Tin nhắn không cho biết tuổi signal**: message per-setup không in thời điểm
   đóng của nến gốc, user không thể tự đánh giá độ tươi.

### Ảnh hưởng từng engine

- **SMC** (M15, SL/TP tính bằng vài pips): ảnh hưởng NẶNG — trễ 15 phút đủ giết signal.
- **Volman** (nhịp H4): ảnh hưởng NHẸ hơn nhưng cùng lỗ hổng logic → fix chung.

## Giải pháp

Hai lớp phòng thủ, KHÔNG đụng hạ tầng:

- **Lớp 1 — Freshness guard tại thời điểm gửi**: fetch giá tươi (ticker/price
  endpoint, không phải klines cache) cho các pair CÓ setup, ngay trước khi gửi
  Telegram. Loại setup nếu giá tươi đã chạm/vượt TP1 hoặc vượt SL. Ghi lý do
  loại vào `noSetupReason` để vẫn thấy trong message.
- **Lớp 2 — Hiển thị tuổi nến trong message**: mỗi signal in dòng
  `🕐 Nến gốc [M15] đóng: HH:mm dd/MM (X phút trước)` để user tự đánh giá.

### Quyết định thiết kế

| Quyết định | Lựa chọn | Lý do |
|---|---|---|
| Nguồn giá tươi | Binance: `GET /api/v3/ticker/price`. Twelve Data: `GET /price` | Nhẹ, không phá cache klines hiện có |
| Khi fetch giá tươi lỗi | VẪN GỬI signal, kèm dòng cảnh báo "không xác minh được giá hiện tại" | Không để lỗi mạng chặn toàn bộ delivery |
| Ngưỡng loại | Giá tươi chạm/vượt TP1 (theo hướng lệnh) HOẶC vượt SL | TP1 là mốc "cơ hội đã đi qua"; giữ đơn giản, không thêm ngưỡng % |
| Số call API | Chỉ fetch cho pair có setup sau khi lọc confidence (thường 0–3 pair/run) | Tôn trọng rate limit Twelve Data (7 rpm free) |
| Đặt guard ở đâu | Hàm dùng chung `src/charts/signal-freshness.ts`, gọi từ `handleAnalysisResult` của cả 2 index | Một nguồn sự thật, 2 engine dùng chung |
| Hợp nhất duplicate `applyPriceSanityChecks` | KHÔNG trong scope này | Tránh phình scope; ghi nhận nợ kỹ thuật |
| Env vars | `SIGNAL_FRESHNESS_GUARD_ENABLED` (default `true`) | Có công tắc tắt khi cần debug |

## Subtasks

| # | Subtask | File chính | Phụ thuộc | Trạng thái |
|---|---------|-----------|-----------|------------|
| 01 | fetch-last-price | `src/charts/ohlc-provider.ts` (+ export mới `fetchLastPrice`) | — | PENDING |
| 02 | freshness-guard-core | `src/charts/signal-freshness.ts` (mới) | 01 | PENDING |
| 03 | integrate-smc-volman | `src/charts/smc-index.ts`, `src/charts/index.ts` | 02 | PENDING |
| 04 | candle-age-in-message | `src/shared/telegram-smc.ts`, `src/shared/telegram.ts` (hoặc file build message volman tương ứng) | — | PENDING |

Mỗi subtask kèm tests trong `tests/` (mirror cấu trúc `src/`).

## Tiêu chí nghiệm thu (Lead review)

1. `npm run build` + `npm run test` pass toàn bộ.
2. Test mô phỏng đúng sự cố thật: setup SHORT entry 1.41657/TP1 1.41597,
   giá tươi 1.41474 → setup BỊ LOẠI, lý do xuất hiện trong `noSetupReason`.
3. Khi fetch giá tươi trả Error → setup VẪN được gửi kèm dòng cảnh báo.
4. Message signal có dòng tuổi nến với format
   `🕐 Nến gốc [<TF>] đóng: <HH:mm dd/MM UTC> (<X> phút trước)`.
5. Không thay đổi hành vi nào khác của pipeline (số lượng message, cache,
   auto-track position giữ nguyên).

## Ngoài scope

- Chuyển hạ tầng khỏi GitHub Actions (user tự làm trên mini PC).
- Hợp nhất 2 bản duplicate `applyPriceSanityChecks`.
- Thay đổi công thức SL/TP (SL 3 pips quá sát là vấn đề riêng — cần task khác
  nếu user muốn: lọc/hạ grade signal có SL distance < ngưỡng spread).
