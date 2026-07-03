# Task: Cập nhật giao diện menu Telegram bot cho khớp với các chức năng hiện có

## Objective

Menu Telegram bot (webhook tại `supabase/functions/telegram-webhook/index.ts`) hiện đang **lệch so với các workflow/tính năng thực tế** trong repo:

1. **Thiếu nút cho dự đoán xổ số theo từng miền riêng lẻ**: sau khi tách `lottery-predict.yml` thành 3 workflow riêng (`lottery-predict-mien-nam.yml`, `-mien-trung.yml`, `-mien-bac.yml` — xem [tasks/lottery-predict-per-region-timing/task.md](../lottery-predict-per-region-timing/task.md) đã implement), menu hiện tại (`COMMANDS.lottery_predict`, dòng 53-56 trong `index.ts`) vẫn chỉ trigger workflow `lottery-predict.yml` cũ (chạy cả 3 miền cùng lúc qua `workflow_dispatch`, không set `LOTTERY_PREDICT_REGION`) — người dùng không có cách nào bấm nút để chạy tay dự đoán cho **1 miền cụ thể**, dù backend đã hỗ trợ.
2. **Thiếu nút cho báo cáo hiệu suất**: `.github/workflows/performance-report.yml` tồn tại (chạy `performance-report-runner.ts`) nhưng **không có trong `COMMANDS`**, không có nút nào trigger được — người dùng không thể chủ động xem báo cáo hiệu suất qua menu.
3. **`/help` được đăng ký nhưng không được xử lý**: `src/scripts/setup-telegram-menu-v2.ts` đăng ký lệnh `/help` (mô tả "Hướng dẫn sử dụng") qua `setMyCommands`, nhưng trong webhook (`index.ts`), logic xử lý message chỉ check `/stats` (xem đoạn xử lý `message.text`, khoảng dòng 683) — mọi text khác kể cả `/help` đều rơi vào nhánh mặc định gọi `showMenu()`, hiển thị y hệt menu chính, KHÔNG có nội dung hướng dẫn nào riêng. Lệnh `/help` hiện vô nghĩa (làm y hệt gõ bất kỳ text nào khác).
4. **2 script trùng lặp**: `src/scripts/setup-telegram-menu.ts` và `setup-telegram-menu-v2.ts` gần như giống hệt nhau (chỉ khác `v2` có thêm lệnh `/stats`) — cần dọn dẹp, chỉ giữ 1 bản đúng.

## Bối cảnh cần đọc trước khi sửa

1. `supabase/functions/telegram-webhook/index.ts` — đọc TOÀN BỘ file (763 dòng, Deno Supabase Edge Function):
   - `COMMANDS` (dòng 40-69): map tên lệnh → `{ file, description, parseInputs? }`, dùng bởi `dispatchWorkflow()` (dòng 189) để gọi GitHub Actions `workflow_dispatch` API.
   - `buildMainMenuKeyboard()` (dòng 285-299): keyboard chính hiện tại, 3 hàng nút.
   - `buildRegionSubmenuKeyboard()` (dòng 301-312): mẫu submenu theo miền đã có sẵn cho `lottery_verify` — **tái sử dụng đúng pattern này** cho submenu dự đoán theo miền mới, không phát minh cấu trúc khác.
   - `parseCallbackData()` (dòng 314-334): parse `callback_data` dạng `menu:<scope>` hoặc `run:<command>:<args>` — cần mở rộng để hỗ trợ submenu mới (ví dụ `menu:lottery_predict`) và lệnh mới có tham số vùng miền.
   - `CallbackAction` type (dòng 30-32): union type hiện chỉ cho phép `menu: "main" | "lottery_verify"` — cần mở rộng thêm giá trị menu mới.
   - `editMenu()` (dòng 371+, đọc tiếp phần sau dòng 380 chưa xem hết) — xử lý khi bấm "◂ Quay lại" hoặc chuyển submenu, cần thêm case cho menu mới.
   - Đoạn xử lý `message.text` (khoảng dòng 683 theo báo cáo khảo sát trước) — nơi check `/stats`, cần thêm nhánh `/help`.
2. `src/lottery/lottery-predict-index.ts` — biến môi trường `LOTTERY_PREDICT_REGION` mà 3 workflow mới dùng để chỉ định miền (xem [tasks/lottery-predict-per-region-timing/task.md](../lottery-predict-per-region-timing/task.md)) — webhook cần dispatch đúng workflow file tương ứng (`lottery-predict-mien-nam.yml` v.v.), KHÔNG cần set thêm input vì mỗi workflow đã tự có `LOTTERY_PREDICT_REGION` cố định trong file yml của nó.
3. `.github/workflows/performance-report.yml` — xác nhận có `workflow_dispatch` hay không (nếu chưa có, cần thêm trigger này vào file yml để webhook dispatch được — đọc kỹ file trước khi giả định).
4. `src/scripts/setup-telegram-menu.ts` vs `setup-telegram-menu-v2.ts` — so sánh nội dung, xác nhận `v2` là bản mới hơn/đúng hơn (có thêm `/stats`), và tìm xem `package.json` script `setup:telegram-menu` đang trỏ tới bản nào.
5. `src/shared/stats-report.ts`, `src/shared/stats.ts` — nội dung `/stats` hiện tại, để viết nội dung `/help` mô tả đúng các lệnh/nút đang có mà không trùng lặp.

## Instructions

1. **Thêm submenu "Dự đoán xổ số theo miền"** vào webhook:
   - Đổi nút "🔮 Dự đoán xổ số" ở `buildMainMenuKeyboard()` (dòng 294) từ `callback_data: "run:lottery_predict"` sang `callback_data: "menu:lottery_predict"` (mở submenu thay vì chạy thẳng).
   - Thêm hàm `buildLotteryPredictSubmenuKeyboard()` theo đúng mẫu `buildRegionSubmenuKeyboard()` (dòng 301-312), với 3 nút miền + 1 nút "Cả 3 miền" (giữ lại lựa chọn chạy tay cả 3 như cũ, dùng `lottery-predict.yml` gốc) + nút "◂ Quay lại".
   - Thêm entry mới vào `COMMANDS` cho từng miền, ví dụ:
     ```ts
     lottery_predict_mien_nam: { file: "lottery-predict-mien-nam.yml", description: "dự đoán xổ số Miền Nam" },
     lottery_predict_mien_trung: { file: "lottery-predict-mien-trung.yml", description: "dự đoán xổ số Miền Trung" },
     lottery_predict_mien_bac: { file: "lottery-predict-mien-bac.yml", description: "dự đoán xổ số Miền Bắc" },
     ```
     (giữ nguyên `lottery_predict` trỏ `lottery-predict.yml` cho lựa chọn "cả 3 miền").
   - Mở rộng `CallbackAction`/`parseCallbackData()` để nhận diện `menu:lottery_predict` và các `run:lottery_predict_mien_*`.
   - Mở rộng `editMenu()` để xử lý hiển thị submenu mới khi nhận `menu:lottery_predict`, và quay lại `menu:main` đúng như submenu `lottery_verify` đã làm.

2. **Thêm nút "📈 Báo cáo hiệu suất"** vào `buildMainMenuKeyboard()`:
   - Kiểm tra `.github/workflows/performance-report.yml` có `workflow_dispatch` chưa — nếu chưa, thêm vào (chỉ thêm trigger, không đổi logic job).
   - Thêm entry `performance_report: { file: "performance-report.yml", description: "báo cáo hiệu suất" }` vào `COMMANDS`.
   - Thêm nút `{ text: "📈 Báo cáo hiệu suất", callback_data: "run:performance_report" }` vào keyboard chính (cân nhắc vị trí hợp lý, ví dụ hàng riêng hoặc cạnh nút xác minh kết quả).

3. **Xử lý `/help`**: trong đoạn xử lý `message.text` của webhook, thêm nhánh kiểm tra `normalizeTelegramCommandToken(message.text) === "/help"` (tái dùng hàm `normalizeTelegramCommandToken` đã có, dòng 147-161) → gửi 1 message text mô tả ngắn gọn các nút/lệnh hiện có (liệt kê tương ứng với `COMMANDS` + `/stats`), KHÔNG cần kèm keyboard. Đặt nhánh này TRƯỚC nhánh `/stats` hiện có, để không phá vỡ logic check `/stats`.

4. **Dọn dẹp script trùng lặp**: xác nhận `package.json` script `setup:telegram-menu` trỏ tới `setup-telegram-menu-v2.ts`. Nếu `setup-telegram-menu.ts` (bản không có `/stats`) không còn được dùng ở đâu (grep toàn repo, kể cả workflow yml), xoá file này; cập nhật `setup-telegram-menu-v2.ts` (đổi tên lại thành `setup-telegram-menu.ts` nếu muốn đơn giản hoá, HOẶC giữ tên `-v2` nếu đổi tên gây rủi ro — ưu tiên phương án ít rủi ro nhất, chỉ xoá bản cũ không dùng, không cần đổi tên bản còn lại) và thêm mô tả lệnh `/help` vào danh sách `commands` truyền cho `setMyCommands` (hiện tại dòng 7-10 chỉ có `/help`, `/stats` — giữ nguyên, chỉ đảm bảo `/help` giờ thực sự có tác dụng sau bước 3).

## Acceptance Criteria

- [ ] `npm run build` pass (lưu ý: `supabase/functions/telegram-webhook/index.ts` là Deno function, KHÔNG nằm trong phạm vi `tsc` của `npm run build` — xác nhận trước bằng cách kiểm tra `tsconfig.json` có exclude thư mục `supabase/functions` hay không; nếu Deno function không được build bởi `tsc`, không cần lo lỗi type ở đây nhưng vẫn cần tự kiểm tra logic đúng bằng đọc kỹ, vì không có test tooling nào chạy Deno function này trong CI hiện tại — xác nhận bằng cách tìm xem có script `test`/`deploy` nào cho Supabase function không).
- [ ] Bấm "🔮 Dự đoán xổ số" ở menu chính → hiển thị submenu 3 miền + nút "Cả 3 miền" + "◂ Quay lại", không lỗi.
- [ ] Bấm từng nút miền → dispatch đúng workflow file tương ứng (`lottery-predict-mien-nam.yml` v.v.), verify bằng cách đọc kỹ code dispatch, không cần chạy thật GitHub Actions (không có quyền trigger thật trong quá trình dev).
- [ ] Bấm "📈 Báo cáo hiệu suất" → dispatch `performance-report.yml`.
- [ ] Gõ `/help` → nhận được message hướng dẫn liệt kê chức năng, KHÔNG phải menu y hệt `/start`/text khác.
- [ ] Gõ `/stats` vẫn hoạt động như cũ (không bị nhánh `/help` mới chặn nhầm).
- [ ] Chỉ còn 1 file script `setup-telegram-menu*.ts`, không còn bản trùng lặp không dùng.
- [ ] `npm test` (nếu có test nào cho phần này — kiểm tra `tests/` có test cho webhook function không, nếu chưa có thì không bắt buộc viết test Deno, nhưng phải chạy `npm test` xác nhận không phá vỡ gì trong `src/`).

## Files to Touch

- `supabase/functions/telegram-webhook/index.ts` — sửa `COMMANDS`, `buildMainMenuKeyboard`, thêm `buildLotteryPredictSubmenuKeyboard`, mở rộng `CallbackAction`/`parseCallbackData`/`editMenu`, thêm nhánh xử lý `/help`.
- `.github/workflows/performance-report.yml` — thêm `workflow_dispatch` nếu chưa có.
- `src/scripts/setup-telegram-menu.ts` — xoá nếu xác nhận không còn dùng.
- `src/scripts/setup-telegram-menu-v2.ts` — cập nhật mô tả lệnh nếu cần.
- `package.json` — xác nhận/sửa script `setup:telegram-menu` nếu đổi tên file.
