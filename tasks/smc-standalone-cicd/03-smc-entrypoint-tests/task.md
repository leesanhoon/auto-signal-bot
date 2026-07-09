# Task 03: Test cho SMC Standalone Entrypoint

**Đọc trước:** [`../plan.md`](../plan.md) — bắt buộc. **Chạy sau khi subtask 02 đã approved.**

## Mục tiêu

Viết test cho `src/charts/smc-index.ts` (tạo ở subtask 01), theo đúng mẫu mocking đã dùng trong `tests/charts/index.test.ts` (test cho bản Bob Volman) — nhưng đơn giản hơn vì không còn nhánh rẽ engine.

## Việc cần làm

Tạo `tests/charts/smc-index.test.ts`. Đọc `tests/charts/index.test.ts` trước để theo đúng convention mock hiện có trong dự án (dùng `vi.hoisted`, `vi.mock` theo path, không đổi cách này).

### Test case bắt buộc

1. **Cache key/window dùng đúng M15**: mock `getConfiguredChartTimeframeMode` trả `"multi"` (mặc định) → assert `isWithinTimeframeCandleCloseWindow`/`getLastClosedCandleKey` (hoặc hàm tương đương đã mock) được gọi với tham số timeframe là `"M15"`, **không phải `"H4"`**. Đây là test quan trọng nhất — chứng minh đã sửa đúng lỗi ép cứng H4 phát hiện ở `index.ts` gốc.
2. **Chế độ `single`**: mock `getConfiguredChartTimeframeMode` trả `"single"`, `getConfiguredChartPrimaryTimeframe` trả `"H4"` → assert cache/window dùng `"H4"` (tôn trọng override, đúng công thức `timeframeMode === "single" ? primaryTimeframe : "M15"`).
3. **Không có nhánh Bob Volman**: assert `analyzeAllChartsDeterministic` (nếu import được để spy) **không bao giờ được gọi** — hoặc đơn giản hơn, xác nhận file `smc-index.ts` không import module đó (kiểm tra qua source, không nhất thiết cần test runtime cho việc này nếu đã verify tĩnh ở subtask 01).
4. **`runCheckPendingOrders` được gọi thật**: mock trả về số lượng bất kỳ (ví dụ `2`) → assert hàm `main()` gọi đúng 1 lần, và giá trị trả về ảnh hưởng đúng đến điều kiện gửi heartbeat (không gửi heartbeat nếu `pendingNotifications > 0`).
5. **Cache hit**: mock `loadChartAnalysisCache` trả về kết quả có sẵn → assert **không gọi** `analyzeAllChartsSmc` (dùng cache, không phân tích lại).
6. **Cache miss + trong cửa sổ đóng nến**: mock `loadChartAnalysisCache` trả `null`, `isWithinTimeframeCandleCloseWindow` trả `true` → assert `analyzeAllChartsSmc` được gọi, kết quả được lưu qua `saveChartAnalysisCache`.
7. **Heartbeat message không chứa "Bob Volman"**: mock kịch bản heartbeat (`heartbeatReason` khác null) → assert nội dung message gửi qua `sendMessage` chứa `"SMC"` và **không chứa** chuỗi `"Bob Volman"`.
8. **`notifyError` dùng đúng scope**: giả lập lỗi ném ra trong `main()` (nếu có thể test được theo cấu trúc file) → assert `notifyError` được gọi với chuỗi liên quan đến SMC (ví dụ `"SMC multi-timeframe scanner"`), không phải scope chung `getChartScannerErrorScope`.

### Rà soát

- Không sửa `tests/charts/index.test.ts` (test Bob Volman hiện có) — chạy lại xác nhận vẫn pass nguyên trạng, không bị ảnh hưởng bởi việc thêm file test mới.

## Việc KHÔNG được làm

- Không sửa `src/charts/smc-index.ts`, `src/charts/index.ts` ở subtask này — chỉ viết test. Nếu phát hiện bug khi viết test (ví dụ hành vi không như mô tả trong `result.md` của subtask 01), ghi rõ vào `blocked.md`, không tự sửa source.
- Không đổi cấu trúc mock convention khác với `tests/charts/index.test.ts` đã thiết lập (giữ nhất quán style test trong dự án).

## Acceptance Criteria

- `npm run build` pass.
- `npm test` pass, bao gồm toàn bộ test mới trong `tests/charts/smc-index.test.ts`, không giảm test hiện có (kể cả `tests/charts/index.test.ts`).
- Test case 1 (M15 thay vì H4) và test case 7 (không có "Bob Volman" trong heartbeat) **phải pass** — đây là 2 bằng chứng cốt lõi xác nhận mục tiêu tách biệt đã đạt.

## Kết quả cần ghi vào `result.md`

- Danh sách test case đã viết, giải thích từng case verify điều gì.
- Output `npm run build` và `npm test` (số test pass trước/sau).
- Nếu bị chặn (ví dụ hành vi thực tế của `smc-index.ts` khác mô tả trong task 01 khiến test không viết được như dự kiến) → ghi rõ trong `blocked.md`, không tự sửa source để né tránh.
