# Task 02: Gộp 5 window, áp voting rule, viết khuyến nghị cuối

Prerequisite: Task 01 đã xong (8 file JSON trong `tasks/smc-multi-window-validation/01-run-additional-windows/`).
Không sửa file src nào. KHÔNG commit.

## Input — 5 window, 2 timeframe = 10 file JSON

Window đã có sẵn (KHÔNG chạy lại, đọc trực tiếp):
- `tasks/smc-followups/04-filter-analysis/m15-pinned.json` (window `2026-07-08`)
- `tasks/smc-followups/04-filter-analysis/h4-pinned.json` (window `2026-07-08`)

8 file mới từ Task 01:
- `tasks/smc-multi-window-validation/01-run-additional-windows/m15-0624.json`, `h4-0624.json`
- `tasks/smc-multi-window-validation/01-run-additional-windows/m15-0610.json`, `h4-0610.json`
- `tasks/smc-multi-window-validation/01-run-additional-windows/m15-0527.json`, `h4-0527.json`
- `tasks/smc-multi-window-validation/01-run-additional-windows/m15-0513.json`, `h4-0513.json`

Mỗi file có khối JSON (có thể lẫn log pino phía trên) chứa `bySetup`, `byGrade`, `pairs` (mảng, mỗi phần tử có `pair`, `trades`, `winRatePct`, `avgRiskReward`).

## Voting rule — áp dụng CHÍNH XÁC như sau, KHÔNG tự đổi ngưỡng

Cho một đối tượng X (1 setup, 1 grade, hoặc 1 pair) và một window W (1 trong 5):

- **Valid vote** nếu `trades` của X trong W đạt ngưỡng tối thiểu:
  - Setup hoặc grade: `trades >= 15`.
  - Pair: `trades >= 8`.
- Nếu KHÔNG đạt ngưỡng → window đó KHÔNG tính (không phải phiếu chống — là thiếu dữ liệu, bỏ qua khi đếm).
- X **QUALIFY** nếu: tổng số valid votes trên 5 window >= 3, VÀ trong các valid votes đó, số window có `avgRiskReward > 0` chiếm hơn 50%.
- X **LOẠI** nếu: tổng số valid votes >= 3, VÀ đa số valid votes có `avgRiskReward <= 0`.
- X **CHƯA ĐỦ DỮ LIỆU** nếu: tổng số valid votes < 3 (dù cộng cả 5 window vẫn không đủ 3 window có mẫu đạt ngưỡng).

Làm việc này **tách riêng cho M15 và H4** — không gộp 2 timeframe vào chung 1 bảng voting.

## Việc cần làm

### 1. Bảng voting cho bySetup (M15 riêng, H4 riêng)

Với mỗi setup (SMC_BOS_OB, SMC_CHOCH_OB, SMC_FVG_CONTINUATION, và setup nào khác xuất hiện), liệt kê `avgRiskReward` ở từng window (ghi "insufficient" nếu dưới ngưỡng), rồi kết luận QUALIFY / LOẠI / CHƯA ĐỦ DỮ LIỆU theo rule trên.

### 2. Bảng voting cho byGrade (M15 riêng, H4 riêng)

Tương tự, cho grade A/B/C.

### 3. Bảng voting cho pairs

Chỉ xét các pair đã QUALIFY hoặc LOẠI rõ ràng ở setup level bên trên KHÔNG liên quan — đây là voting RIÊNG cho từng pair (dùng field `pairs[].avgRiskReward` trong mỗi file JSON, ngưỡng 8 trades/window như quy định). Chỉ cần liệt kê **top 10 pair QUALIFY tốt nhất** và **top 10 pair LOẠI tệ nhất** theo H4 (vì M15 dự kiến không có edge ở bất kỳ pair nào theo phân tích trước — vẫn kiểm tra để xác nhận, nhưng không cần liệt kê đầy đủ nếu tất cả đều loại).

### 4. Khuyến nghị cuối cùng

- Timeframe nào (M15/H4) nên cân nhắc dùng, dựa trên đa số setup/grade QUALIFY.
- Danh sách setup nên giữ / nên loại (voting-based, không phải chỉ 1 window như trước).
- Danh sách grade nên ưu tiên.
- Danh sách pair nên loại (nếu voting xác nhận LOẠI nhất quán qua nhiều window) và pair nên ưu tiên.
- So sánh với kết luận của task 04 (`smc-followups`) dựa trên 1 window duy nhất — cái gì được xác nhận thêm, cái gì bị đảo ngược khi có thêm dữ liệu.

### 5. Giới hạn (bắt buộc ghi, không bỏ qua)

- H4 với 1000 bars phủ ~166 ngày — 5 window H4 (cách nhau 2 tuần) **overlap dữ liệu đáng kể**, không phải 5 mẫu độc lập thật sự. M15 (1000 bars ≈ 10.4 ngày) độc lập hơn giữa các window.
- Đây vẫn là backtest, chưa phải forward-test/paper trading — kết quả quá khứ không đảm bảo tương lai.
- Nếu vẫn cần chắc chắn hơn trước khi đưa filter vào production, đề xuất Lead mở task paper-trading hoặc mở rộng thêm window xa hơn quá khứ.

## Verification

```bash
npm run build
npm run test
```

## result.md

Viết vào `tasks/smc-multi-window-validation/02-aggregate-and-vote/result.md`, đầy đủ 5 mục trên.

## Nếu bị chặn

Ghi `blocked.md` cùng thư mục — ví dụ nếu 1 trong 8 file từ Task 01 thiếu khối JSON hợp lệ, ghi rõ file nào và tiếp tục phân tích với các file còn lại (không tự chạy lại Task 01).
