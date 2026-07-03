# Plan: Tối ưu độ chính xác phân tích AI theo Bob Volman + lọc tín hiệu ≥70% + dọn dữ liệu test

## Context

Bot đang scan chart forex và dùng AI (OpenRouter, model `xiaomi/mimo-v2.5`) để tìm setup theo phương pháp price-action của Bob Volman (EMA 20 + các pattern RB/ARB/IRB/BB/FB/SB/DD). Sau khi kiểm tra code, phát hiện gốc rễ khiến phân tích thiếu chính xác:

- System prompt hiện tại ở `src/charts/analyzer.ts:83-101` **hoàn toàn chung chung** ("chuyên gia phân tích biểu đồ forex", "phân tích xu hướng, vùng giá quan trọng, setup nếu có"). Nó **không hề mô tả quy tắc cụ thể của Bob Volman** (EMA20 chuyển từ flat→steep, buildup trước breakout, momentum candle, entry timing...). Các tên pattern (RB, ARB, IRB, BB, FB, SB, DD) chỉ được định nghĩa mô tả ở tầng hiển thị Telegram (`src/shared/telegram.ts:217-234`) — AI tự đặt tên setup mà không có luật để đối chiếu, nên gán tên/pattern không đáng tin.
- Ngưỡng `CHART_SIGNAL_CONFIDENCE_THRESHOLD` (mặc định 70%, `src/charts/chart-config-env.ts`) hiện **chỉ dùng để tô màu** trong bảng tổng quan (`src/shared/telegram.ts:195-215`) — mọi setup, kể cả confidence thấp, vẫn được gửi đầy đủ ảnh + lệnh chi tiết trong vòng lặp ở `src/shared/telegram.ts:487-508` (`sendAllAnalyses` trong `src/charts/index.ts:77` nhận `result` chưa lọc).
- DB `open_positions` (Supabase project `irgworcpfyfuigyvylkj`) hiện có 2 dòng test: id=1 (EUR/USD, đã closed), id=2 (AUD/USD, đang open). Cần đóng lệnh open để không ảnh hưởng vòng lặp `runCheckOpenTrades` (theo dõi TP/SL/trailing), giữ lại lịch sử.

Quyết định đã chốt với user:
1. Đóng lệnh open còn lại (id=2), giữ lại lịch sử 2 dòng làm dữ liệu tham khảo — không xóa.
2. Ẩn hoàn toàn các cặp/setup <70% khỏi mọi tin nhắn Telegram (cả bảng tổng quan lẫn setup chi tiết).
3. Viết lại system prompt với luật Volman chi tiết, bám sát pattern definitions đã có sẵn ở telegram.ts.

## Việc cần làm

### 1. Viết lại prompt AI theo đúng phương pháp Bob Volman
File: `src/charts/analyzer.ts` — sửa `buildSystemPrompt()` (dòng 83-101) và `buildUserPrompt()` (dòng 94-101).

- Đưa vào system prompt các quy tắc cụ thể cho từng pattern, lấy nội dung mô tả đã có sẵn ở `src/shared/telegram.ts:217-234` làm nguồn (đồng bộ 2 nơi, tránh lệch định nghĩa):
  - **RB (Range Break)**: EMA20 đi ngang (flat) một thời gian rồi bắt đầu dốc theo hướng breakout khỏi vùng tích lũy.
  - **ARB (Advanced Range Break)**: range lớn, có nhiều lần test biên + false break trước khi break thật.
  - **IRB (Inside Range Break)**: range nhỏ nằm trong range lớn, breakout của range nhỏ kéo theo phá luôn range lớn.
  - **BB (Block Break)**: block nến nhỏ nằm sát EMA20, break theo đúng hướng trend chính (EMA20 dốc).
  - **FB (First Break)**: breakout lần đầu ra khỏi range lớn, xác nhận bằng nến thân dài (momentum candle).
  - **SB (Second Break)**: có false break lần 1 → buildup (tích lũy nhỏ) → break lần 2 mới là hướng thật.
  - **DD (Double Doji)**: 2-3 doji liền kề sát EMA20 trong trend rõ ràng, break theo hướng trend.
  - Nhấn mạnh: chỉ gán 1 trong các pattern trên khi **thấy rõ trên chart** cấu trúc tương ứng; nếu không khớp rõ ràng thì `noSetupReason` hoặc hạ confidence, không được đoán/ép pattern.
  - Yêu cầu AI xác nhận EMA20 slope (flat/dốc lên/dốc xuống) và vị trí giá so với EMA20 trước khi kết luận — đây là điều kiện tiên quyết của toàn bộ phương pháp Volman.
  - Yêu cầu đối chiếu volume tại điểm breakout (volume tăng xác nhận breakout thật, volume thấp → nghi ngờ false break) vì volume đã được capture trong chart nhưng prompt hiện tại không nhắc AI dùng nó khi đánh giá.
  - Giữ nguyên các ràng buộc hiện có: không bịa level, không cần ép đủ mọi rule khi không chắc, output tiếng Việt có dấu.
- Không cần đổi model hay cấu trúc JSON response (`summaries`, `setups`, `noSetupReason`) — chỉ thay nội dung hướng dẫn.

### 2. Lọc tín hiệu <70% khỏi Telegram hoàn toàn
Threshold source: `getConfiguredChartSignalConfidenceThreshold()` từ `src/charts/chart-config-env.ts` (đã dùng ở cả analyzer flow và telegram.ts, tái sử dụng nguyên trạng, không thêm config mới).

- File `src/shared/telegram.ts`, hàm `sendAllAnalyses` (dòng 464-513):
  - Trước khi build header/loop gửi setup, lọc `result.setups` chỉ giữ `confidence >= threshold`.
  - Trước khi build bảng tổng quan, lọc `result.summaries` chỉ giữ `confidence >= threshold` trong `buildSummaryTable` (dòng 195-215) — bỏ luôn nhánh in cặp <70% (icon 🟡/🔴 không còn cần thiết vì chỉ còn cặp đạt ngưỡng, giữ 🟢 cho nhất quán hoặc bỏ icon).
  - Cập nhật câu thông báo "Không có setup" (dòng 472-478) và câu kết (dòng 510-512) để phản ánh đúng số lượng đã lọc, không phải tổng số AI trả về.
  - Không sửa `src/charts/index.ts` — logic auto-save vào `open_positions` (dòng 50-74) dùng `highConfSetups` riêng đã lọc theo threshold từ trước, giữ nguyên.

### 3. Dọn dữ liệu test trong Supabase (project `irgworcpfyfuigyvylkj`, bảng `open_positions`)
Không sửa code cho việc này — chạy trực tiếp qua Supabase MCP (`execute_sql` hoặc `apply_migration` nếu cần ghi log migration):

```sql
UPDATE open_positions
SET status = 'closed',
    closed_at = now(),
    close_reason = 'manual_close',
    last_management_comment = 'Đóng thủ công - dữ liệu test trước khi tối ưu prompt Volman'
WHERE id = 2 AND status = 'open';
```

Giữ nguyên id=1 (đã closed từ trước). Không xóa dòng nào — theo quyết định của user.

## Verification

1. **Prompt**: chạy lại pipeline chart analysis thủ công (script trong `src/charts/index.ts`, hoặc script test nếu có trong `docs/tasks/01-testing.md`) trên vài chart mẫu đã biết trước pattern, kiểm tra AI có gán đúng tên pattern (RB/ARB/IRB/BB/FB/SB/DD) khớp với luật mới, và có nêu rõ EMA20 slope + volume trong `reasons`/`currentPriceContext`.
2. **Lọc threshold**: giả lập `result` có setups/summaries hỗn hợp confidence (vd. 45%, 68%, 72%, 85%) qua unit test hoặc gọi trực tiếp `sendAllAnalyses` với `Notifier` giả (kiểm tra pattern test double có sẵn trong codebase, vd. `src/shared/telegram.test.ts` nếu tồn tại) — xác nhận chỉ setup/summary ≥70% được gửi.
3. **DB**: sau khi update, query lại `select id, status, close_reason from open_positions;` qua Supabase MCP để xác nhận id=2 đã chuyển `closed` và id=1 không đổi.
4. Chạy `npm run build` / `tsc --noEmit` (theo config hiện có của repo) để đảm bảo không có lỗi type sau khi sửa analyzer.ts và telegram.ts.
