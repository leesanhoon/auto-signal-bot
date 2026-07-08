# Phase 01: Bộ test tự động

## Mục tiêu
Hiện chưa có unit/integration test nào trong repo (không có vitest/jest config; các script `test-*` chỉ là `tsx` chạy thủ công). Cần thêm Vitest cho các hàm logic thuần — đây là nơi sai sót ảnh hưởng trực tiếp đến quyết định giao dịch/tiền bạc.

## Bối cảnh / file liên quan
- [src/charts/analyzer.ts](../../src/charts/analyzer.ts): logic phân tích chart Forex.
- [src/charts/position-decision.ts](../../src/charts/position-decision.ts): export `decidePosition`, `decidePositionWithClaude` — quyết định mở/đóng/điều chỉnh vị thế.
- [src/lottery/lottery-predict.ts](../../src/lottery/lottery-predict.ts): logic dự đoán số.
- `package.json`: chưa có `vitest`/`jest` trong devDependencies, scripts `test-analyze`/`test-model-compare` hiện chỉ chạy `tsx` thủ công, không phải test runner thật.

## Việc cần làm
- [x] Thêm `vitest` vào devDependencies, tạo `vitest.config.ts`.
- [x] Thêm script `"test": "vitest run"` (và `"test:watch": "vitest"`) vào `package.json`.
- [x] Viết unit test cho phần logic thuần (không gọi network/model) của `analyzer.ts`.
- [x] Viết unit test cho `position-decision.ts` (đặc biệt các nhánh quyết định dựa trên input cố định, mock phần gọi model).
- [x] Viết unit test cho `lottery-predict.ts`.
- [x] Thêm bước chạy test vào CI (GitHub Actions) nếu repo có workflow CI riêng cho lint/build.

## Acceptance criteria
- [x] `npm test` chạy được và pass cho 3 file logic chính ở trên.
- [x] Test không phụ thuộc vào gọi API thật (provider ngoài/Supabase) — dùng mock/fixture.
- [x] Coverage tối thiểu bao phủ các nhánh quyết định quan trọng trong `position-decision.ts` (mở lệnh, đóng lệnh, giữ nguyên).

## Ghi chú / rủi ro
- Vì chưa có migration/schema SQL trong repo, mock dữ liệu Supabase nên dựa theo các bảng thực tế đã biết: `lottery_draws`, `lottery_predictions`, `matches`, `open_positions`.
