# Task 01 — Xóa logic prune retention trong appendWeekdayHistory

## Bối cảnh

Xem `tasks/lottery-history-remove-retention-prune/plan.md` để hiểu đầy đủ root cause. Tóm tắt:
hàm `appendWeekdayHistory` trong `src/lottery/repository/lottery-repository.ts` hiện đang xóa
(prune) các bản ghi cũ hơn 3 năm (`HISTORY_RETENTION_DAYS = 1095`) mỗi khi insert dữ liệu mới,
khiến số kỳ (`periodCount`) không bao giờ tăng nữa khi dữ liệu đã đạt steady state. Người dùng
muốn bỏ hẳn prune để dữ liệu tăng liên tục theo thời gian.

## File cần sửa

`src/lottery/repository/lottery-repository.ts`

## Yêu cầu thực thi (làm đúng, không thêm/bớt)

1. Xóa hằng số `HISTORY_RETENTION_DAYS` (dòng ~4-5, bao gồm comment `/** Giữ lịch sử 3 năm... */`).

2. Trong hàm `appendWeekdayHistory`:
   - Đổi signature từ:
     ```ts
     export async function appendWeekdayHistory(weekday: number, newRecords: LotteryDrawRecord[], now: number = Date.now()): Promise<void> {
     ```
     thành:
     ```ts
     export async function appendWeekdayHistory(weekday: number, newRecords: LotteryDrawRecord[]): Promise<void> {
     ```
     (bỏ tham số `now` — không còn dùng sau khi bỏ prune).
   - Xóa toàn bộ block sau (từ dòng `const cutoff = ...` đến hết `pruneError` throw):
     ```ts
     const cutoff = new Date(now - HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
     const { error: pruneError } = await (getDb().from("lottery_draws") as any).delete().eq("weekday", weekday).lt("date", cutoff);
     if (pruneError) throw new Error(`appendWeekdayHistory prune failed: ${pruneError.message}`);
     ```
   - Tham số `weekday` của hàm sau khi bỏ đoạn trên sẽ không còn được dùng bên trong thân hàm
     (chỉ còn dùng cho upsert dữ liệu, không phải để filter prune nữa) — **giữ nguyên tham số
     `weekday` trong signature** dù không dùng trong thân hàm nữa, vì đây là public API được
     gọi từ `lottery-verify-runner.ts` và `lottery-backfill-runner.ts` với đúng thứ tự tham số
     `(weekday, records)`. KHÔNG đổi thứ tự/tên tham số còn lại, KHÔNG đổi các call site.
     Nếu TypeScript/linter báo lỗi "unused parameter" cho `weekday`, xử lý bằng cách đổi tên
     thành `_weekday` (convention TS cho unused param) — nhưng CHỈ làm việc này nếu build thực
     sự lỗi vì nó, không làm nếu build pass bình thường (không phải mọi tsconfig đều bật rule
     này).

3. Cập nhật JSDoc phía trên hàm (dòng ~67-71):
   ```
   /**
    * Upsert bản ghi mới (dedup theo primary key date+region+province nhờ Postgres), rồi prune
    * bản ghi quá cũ của ĐÚNG thứ tương ứng. `weekday` của các bản ghi phải khớp tham số `weekday`
    * — caller chịu trách nhiệm tách đúng nhóm trước khi gọi.
    */
   ```
   Sửa lại cho đúng hành vi mới (không còn prune) — ví dụ:
   ```
   /**
    * Upsert bản ghi mới (dedup theo primary key date+region+province nhờ Postgres). Giữ toàn bộ
    * lịch sử, không tự xóa dữ liệu cũ. `weekday` của các bản ghi phải khớp tham số `weekday`
    * — caller chịu trách nhiệm tách đúng nhóm trước khi gọi.
    */
   ```

## KHÔNG được làm

- KHÔNG sửa `loadWeekdayHistory`, `loadRegionHistory`, hay bất kỳ hàm nào khác trong file.
- KHÔNG sửa call site ở `lottery-verify-runner.ts:44` hay `lottery-backfill-runner.ts:60` —
  chúng gọi `appendWeekdayHistory(weekday, records)` đã đúng với signature mới (không truyền
  `now`), không cần đổi gì.
- KHÔNG thêm migration DB, KHÔNG thêm feature/refactor ngoài scope trên.
- KHÔNG thêm test mới trừ khi build/test hiện tại fail vì thay đổi này.

## Verification bắt buộc trước khi ghi result.md

Chạy và dán output thật (không được tự suy đoán/paraphrase) vào `result.md`:

```bash
npm run build
npm run test -- lottery-repository
npm run test
```

Grep xác nhận không còn tham chiếu nào tới `HISTORY_RETENTION_DAYS` trong toàn repo:

```bash
grep -rn "HISTORY_RETENTION_DAYS" src/ tests/
```
(phải ra kết quả rỗng)

## Ghi kết quả

Ghi vào `tasks/lottery-history-remove-retention-prune/01-remove-prune-logic/result.md`:
- Diff/tóm tắt thay đổi thực tế đã làm.
- Output đầy đủ của `npm run build` và `npm run test`.
- Output của lệnh grep xác nhận `HISTORY_RETENTION_DAYS` đã hết.

Nếu bị chặn (ví dụ build lỗi không rõ nguyên nhân, hoặc call site khác dùng `now` mà task
này chưa biết) → ghi `blocked.md`, không tự đoán cách fix ngoài scope.
