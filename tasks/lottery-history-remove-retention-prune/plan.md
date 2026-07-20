# Plan — Bỏ prune retention trong lottery history, giữ dữ liệu tăng liên tục

## Bối cảnh / Root cause

Người dùng báo: mỗi ngày insert thêm dữ liệu xổ số mới, nhưng số "kỳ" (`periodCount`)
hiển thị trong tin nhắn Telegram dự đoán luôn đứng yên ở 157, không tăng.

Đã debug (systematic-debugging) và xác nhận root cause:

- `src/lottery/repository/lottery-repository.ts:5` — `HISTORY_RETENTION_DAYS = 1095` (3 năm).
- `appendWeekdayHistory()` (dòng 72-83): mỗi lần upsert bản ghi mới, hàm **đồng thời xóa**
  luôn bản ghi cũ hơn 3 năm của đúng `weekday` đó (dòng 80-82, `.delete().eq("weekday", weekday).lt("date", cutoff)`).
- Vì dữ liệu hiện tại đã đủ >3 năm (steady state), mỗi lần thêm 1 kỳ mới thì prune đi đúng
  1 kỳ cũ nhất → tổng số kỳ không đổi.
- Số 157 khớp với `1095 / 7 ≈ 156.43` — 3/7 ngày trong tuần rơi vào đúng 157 kỳ trong cửa sổ
  3 năm, đúng như dữ liệu thực tế đang cho thấy.

Đây không phải bug logic (query/pagination đã đúng, xem `loadWeekdayHistory` đã có
pagination `.range()` để vượt giới hạn 1000 dòng của Supabase) — mà là hành vi retention
có chủ đích, nhưng người dùng muốn dữ liệu **tăng liên tục theo thời gian**, không bị prune.

## Quyết định

Người dùng đã chọn: **bỏ hẳn logic prune** trong `appendWeekdayHistory` — giữ toàn bộ lịch
sử mãi mãi, không giới hạn theo `HISTORY_RETENTION_DAYS` nữa. Dữ liệu xổ số dạng text/JSON
nhỏ, nhiều năm cũng chỉ vài chục MB, chấp nhận được.

## Scope

- CHỈ sửa `src/lottery/repository/lottery-repository.ts`:
  - Xóa block `.delete().eq("weekday", weekday).lt("date", cutoff)` và biến `cutoff` liên quan
    trong `appendWeekdayHistory`.
  - Xóa hằng số `HISTORY_RETENTION_DAYS` (không còn dùng ở đâu khác — đã grep xác nhận).
  - Cập nhật JSDoc của `appendWeekdayHistory` (dòng 67-71) — bỏ phần nhắc tới prune.
- KHÔNG đổi signature hàm `appendWeekdayHistory(weekday, newRecords, now)` — tham số `now`
  hiện chỉ dùng cho cutoff/prune; sau khi bỏ prune, `now` không còn dùng nữa trong hàm.
  → Cần quyết định: giữ tham số `now` (để không phá vỡ call site) nhưng không dùng nữa,
    hay xóa tham số `now` luôn.
  → **Chọn: xóa tham số `now` luôn** vì nó chỉ tồn tại để phục vụ prune (đã grep, chỉ dùng
    nội bộ cho cutoff, không phải public API cần giữ ổn định). Phải cập nhật call site
    trong `lottery-verify-runner.ts:44` (`appendWeekdayHistory(weekday, actualRecords)` —
    hiện tại không truyền `now` nên gọi không đổi) và bất kỳ nơi khác gọi hàm này
    (`lottery-backfill-runner.ts` — cần grep xác nhận cách gọi trước khi sửa).
- KHÔNG động vào `loadWeekdayHistory`, `loadRegionHistory`, hay bất kỳ file nào khác.
- KHÔNG có test hiện tại cho `appendWeekdayHistory`/prune (đã grep `tests/lottery/lottery-repository.test.ts`
  — không có test nào cover hàm này) → không cần sửa test, nhưng nếu Worker phát hiện có
  test khác reference `appendWeekdayHistory` hoặc `HISTORY_RETENTION_DAYS` thì phải cập nhật
  theo đúng hành vi mới (không prune).

## Subtasks

| # | Subtask | Mô tả |
|---|---------|-------|
| 01 | remove-prune-logic | Xóa logic prune + `HISTORY_RETENTION_DAYS` trong `lottery-repository.ts`, xóa tham số `now`, cập nhật call site nếu cần, chạy build+test xác nhận không breaking |

## Verification

```bash
npm run build
npm run test
```
