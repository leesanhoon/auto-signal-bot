# Context: Betting suggestion coverage check

## Vấn đề user báo cáo

"Kiểm tra phần các kèo lựa chọn không đủ tất cả trận đấu tôi muốn suggest cho tất
cả các trận đang phân tích" — nghĩa là: hiện tại một số trận đấu đang được phân
tích (trong danh sách `payloads` gửi cho AI) KHÔNG có suggestion/topPicks tương
ứng trong response cuối cùng gửi cho user và lưu DB.

## Luồng hiện tại (đã đọc mã nguồn)

1. `src/betting/odds-runner.ts::runOddsCheck()`:
   - Lấy danh sách trận `sortedPayload` (N trận).
   - Gọi `generateCombinedAnalysis(sortedPayload)` — MỘT request AI duy nhất
     cho toàn bộ N trận (`src/betting/betting-gemini.ts:1197-1330`).
   - Nếu có `plan`, gọi:
     - `buildCombinedAnalysisMessage(payload, plan)` → dùng
       `formatPicksSummaryBlock(payloads, plan)` (xem `odds-text-format.ts`)
       để build nội dung Telegram.
     - `saveCombinedAnalysisSnapshots(payload, plan)` (`odds-runner.ts:70-100`)
       — lặp `for (const match of plan.matches)` rồi tra `payloads[match.matchIndex]`.

2. `src/betting/betting-gemini.ts::generateCombinedAnalysis()`:
   - Prompt (`buildCombinedUserPrompt`) liệt kê N trận và yêu cầu AI trả JSON
     `matches` cho "mỗi match", nhưng KHÔNG có validation nào ép AI trả đủ N
     phần tử.
   - `parseCombinedAnalysisResponse()` (dòng 1153-1195) chỉ kiểm tra:
     - `Array.isArray(parsed.matches) && parsed.matches.length > 0` (không so
       sánh với số trận đầu vào `payloads.length`).
     - Với mỗi match: có `matchIndex` (number), `analysis` (string),
       `topPicks` (array) — nếu thiếu field thì loại bỏ TOÀN BỘ response (parse
       failed), không phải loại riêng match lỗi.
   - Không có cơ chế phát hiện/log/retry khi `parsed.matches.length <
     payloads.length` (tức AI bỏ sót 1 hoặc nhiều trận).
   - Root cause khả dĩ khiến AI bỏ sót trận:
     a. Token limit: `COMBINED_TOKENS = 16_000` là giới hạn output chung cho
        TẤT CẢ N trận + phân tích + parlays + remainingSingles. Với N trận lớn,
        model có thể tự cắt bớt số match để không vượt quá token, hoặc bị
        `finish_reason=length` (đã có xử lý fallback nhưng CHỈ khi finishReason
        === "length" ở top-level response — nếu response không bị cắt hẳn mà
        chỉ model tự ý bỏ bớt match thì không phát hiện được).
     b. Prompt không có ràng buộc cứng "PHẢI trả đủ N phần tử trong mảng
        matches, đúng bằng số trận liệt kê ở trên, không được bỏ sót trận nào".
     c. `parseCombinedAnalysisResponse` không validate số lượng/matchIndex đầy
        đủ (0..N-1 không trùng, không thiếu) trước khi coi là parse thành công.
     d. Không có retry riêng khi thiếu match — hệ thống chấp nhận luôn plan
        thiếu trận và tiếp tục chạy (silent partial coverage).

3. Downstream (`odds-runner.ts`):
   - `saveCombinedAnalysisSnapshots` bỏ qua trận không có trong `plan.matches`
     (dòng `if (!payload) continue;` chỉ bắt trường hợp matchIndex sai, không
     bắt trường hợp thiếu hẳn matchIndex đó trong mảng).
   - `formatPicksSummaryBlock` (trong `odds-text-format.ts`) presumably cũng
     chỉ render các match có trong `plan.matches` — cần đọc thêm khi implement,
     nhưng không cần sửa file này trong plan này (xem subtask 01 phạm vi).

## Quyết định kiến trúc cho fix

1. Thêm bước validate SAU KHI parse JSON thành công trong
   `parseCombinedAnalysisResponse` (hoặc một hàm mới gọi ngay sau đó trong
   `generateCombinedAnalysis`), so sánh:
   - Số lượng `matches` trong response với `payloads.length`.
   - Tập hợp `matchIndex` phải phủ đủ `0..payloads.length-1`, không trùng lặp,
     không thiếu.
2. Khi phát hiện THIẾU trận (coverage không đủ):
   - Log cảnh báo rõ ràng (trận nào bị thiếu — home/away — để dễ debug).
   - KHÔNG throw lỗi làm hỏng toàn bộ response (vẫn dùng phần match có), nhưng
     phải:
     - Thử fallback model (nếu đang ở primary) giống cơ chế `finishReason ===
       "length"` hiện có — coi thiếu-trận cũng là một dạng lỗi cần fallback.
     - Nếu fallback cũng thiếu, vẫn trả plan (đừng chặn hoàn toàn), nhưng phải
       để lại cảnh báo cho người vận hành (log) — vì đây có thể do model thật
       sự không thấy edge cho trận đó (không phải bug), NHƯNG hệ thống cần chủ
       động log ra "N/M trận có suggestion" để dễ theo dõi.
3. Điều chỉnh prompt: bổ sung câu yêu cầu cứng "matches PHẢI có đúng N phần tử
   (một phần tử cho MỖI trận đã liệt kê ở trên theo đúng thứ tự TRẬN 1..N,
   matchIndex tương ứng 0..N-1). Không được bỏ sót trận nào dù topPicks rỗng."
   — đây là điểm mấu chốt: ngay cả khi topPicks = [] (Đứng ngoài), AI vẫn phải
   trả về 1 phần tử match với topPicks rỗng, KHÔNG được lược bỏ hẳn trận đó.
4. Cân nhắc tăng `COMBINED_TOKENS` nếu N trận lớn (hiện đang cố định 16_000
   không phụ thuộc N) — có thể log cảnh báo khi N lớn (vd N > 8) vì token
   budget cố định dễ gây cắt bớt. Việc này để subtask 01 tự quyết định dựa trên
   phân tích thêm, nhưng PHẢI ít nhất log rõ khi nghi ngờ do token.

## Ngoài phạm vi (out of scope) của toàn bộ task này

- KHÔNG đổi kiến trúc sang gọi AI riêng lẻ từng trận (per-match calls) — vẫn
  giữ nguyên cơ chế combined 1-request-cho-N-trận.
- KHÔNG sửa `generateBettingPlan` (đường cũ, không dùng trong `odds-runner.ts`
  hiện tại) trừ khi subtask yêu cầu rõ.
- KHÔNG sửa UI Telegram formatting trong `odds-text-format.ts` trừ khi cần để
  hiển thị cảnh báo thiếu trận (subtask 01 sẽ quyết định phạm vi chính xác).
- KHÔNG implement cơ chế gọi lại AI theo từng trận thiếu riêng lẻ (single
  targeted retry) trong lần này — chỉ dùng lại cơ chế fallback model đã có.
