# Plan — Lottery history query truncation fix

## Bối cảnh / Root cause (đã verify bằng data thật)

`src/lottery/repository/lottery-repository.ts` có 2 hàm đọc lịch sử từ Supabase:

- `loadWeekdayHistory(weekday)` (dòng 8) — `.select(...).eq("weekday", weekday)`, KHÔNG có `.order()`, KHÔNG phân trang.
- `loadRegionHistory(region)` (dòng 16) — `.select(...).eq("region", region)`, cùng vấn đề.

Supabase/PostgREST mặc định trả tối đa **1000 rows/request** (server-side cap, `.limit()` không vượt qua được cap này). Dữ liệu thật hiện tại:

| Query | Tổng rows | Vượt cap 1000? |
|---|---|---|
| `weekday=4` (Thứ 5, cả 3 miền) | 1097 | Có |
| `region=mien-bac` (mọi weekday) | 1087 | Có |
| `region=mien-trung` | 2667 | Có |
| `region=mien-nam` | 3450 | Có |

Đã verify trực tiếp: chạy `loadWeekdayHistory(4)` thật (qua tsx, cùng `.env` production) chỉ thấy dữ liệu mien-bac đến **2026-06-25** (142 kỳ), trong khi DB thật (query admin không giới hạn) có đến **2026-07-09** (155 kỳ). Vì không có `ORDER BY`, phần bị cắt rơi vào dữ liệu **mới nhất** — nghĩa là 2 kỳ Thứ 5 gần nhất (kết quả thật đã append đúng vào `lottery_draws` qua verify runner) **không hề được thuật toán dự đoán nhìn thấy**.

Hệ quả quan sát được: dự đoán Thứ 5 16/07/2026 và Thứ 5 09/07/2026 cho ra confidence score **giống hệt tới 6 chữ số thập phân** (`034: 0.386011`, `044: 0.385622`, `054: 0.318738` — mien-bac; tương tự mien-nam) vì cả 2 lần chạy dùng chung 1 cửa sổ dữ liệu cũ bị cắt.

**Ảnh hưởng lan rộng:** `loadRegionHistory` dùng trong `lottery-backtest.ts` có cùng lỗi, và cả 3 miền đều vượt xa cap 1000 rows. Backtest hồi 09/07/2026 (kết luận "không có edge so với random", dẫn tới quyết định dừng đầu tư — xem memory `project_lottery_prediction_decision`) **rất có thể đã chạy trên tập dữ liệu bị cắt/không đầy đủ**, không phải toàn bộ 3 năm lịch sử như giả định.

## Mục tiêu

1. Sửa 2 hàm đọc lịch sử để lấy **đầy đủ** dữ liệu (phân trang bỏ qua cap 1000 rows của Supabase).
2. Sau khi sửa: chạy lại backtest để biết kết luận "no edge" ở memory `project_lottery_prediction_decision` còn đúng hay không với dữ liệu đầy đủ.
3. Resync các dự đoán đang chờ verify (chưa quay số) để chúng dùng đúng dữ liệu mới nhất, tránh gửi số trùng tuần trước một lần nữa.

**Không nằm trong scope:** không thêm predictor mới, không đổi công thức confidence/weight, không đổi retention policy 3 năm. Đây thuần là data-correctness bug, không phải cải thiện độ chính xác thuật toán.

## Subtasks

| # | Subtask | Mô tả | File chính |
|---|---|---|---|
| 01 | Paginate history queries | Thêm phân trang (`.range()` loop) cho `loadWeekdayHistory` và `loadRegionHistory` để lấy hết rows, không bị cap 1000 | `src/lottery/repository/lottery-repository.ts`, test tương ứng |
| 02 | Rerun backtest & resync | Chạy `npm run lottery-backtest` với data đầy đủ, ghi lại kết quả; chạy `npm run lottery-predict-resync` để cập nhật dự đoán đang chờ verify | Không sửa code, chỉ chạy lệnh + ghi log kết quả |

## Acceptance criteria (Lead review sẽ check)

- `loadWeekdayHistory(4)` (chạy thật, `.env` production) phải trả về đúng tổng số rows mà `select count(*) from lottery_draws where weekday=4` trả về (hiện tại: 1097), không còn bị cắt.
- `loadRegionHistory("mien-bac"|"mien-trung"|"mien-nam")` tương tự phải khớp count(*) thật của từng miền.
- Test hiện có (`tests/lottery/*.test.ts` liên quan đến repository) vẫn pass; nếu chưa có test cho pagination behavior, phải thêm test mock nhiều trang (>1000 rows giả lập hoặc mock `.range()` được gọi nhiều lần).
- `npm run build` và `npm run test` pass.
- Không đổi signature public của `loadWeekdayHistory`/`loadRegionHistory` (giữ nguyên chữ ký, chỉ đổi implementation bên trong) — các caller khác (`lottery-predict-runner.ts`, `lottery-backtest.ts`, `lottery-predict-resync-index.ts`) không cần sửa.
