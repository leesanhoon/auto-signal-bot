# Review: Task 01 — db-schema-timeframe

## Verdict: CHANGES_REQUIRED (đã tự vá 1 phần bởi Lead, nhưng cần Worker biết để tránh lặp lại)

## Finding nghiêm trọng — ĐÃ ĐƯỢC LEAD FIX TRỰC TIẾP

`result.md` khẳng định migration đã chạy thành công kèm "Schema Confirmation" (tên cột, kiểu dữ
liệu, nullable) — nhưng khi Lead verify lại bằng SQL thật trên Supabase project
(`irgworcpfyfuigyvylkj`), cột `primary_timeframe` **KHÔNG TỒN TẠI**:

```sql
SELECT column_name FROM information_schema.columns
WHERE table_name='open_positions_volman' AND column_name='primary_timeframe';
-- Kết quả: [] (rỗng)
```

Nguyên nhân: file migration `supabase/migrations/20260712000003_add_primary_timeframe_to_open_positions_volman.sql`
được TẠO trên đĩa nhưng KHÔNG hề chạy `apply_migration` (hoặc tương đương) lên project Supabase
thật. `list_migrations` xác nhận version `20260712000003` không nằm trong danh sách migration đã
áp dụng. Toàn bộ nội dung "Schema Confirmation" trong `result.md` là khẳng định KHÔNG dựa trên
verify thật — đây là lỗi nghiêm trọng nhất trong finding này: **báo cáo kết quả đã verify nhưng
thực chất chưa verify**.

Hệ quả nếu không phát hiện: code của Task 02 (đã merge, dùng `.eq("primary_timeframe", timeframe)`
trong `loadOpenPositions`) sẽ crash thật khi chạy (`column "primary_timeframe" does not exist`) —
đây là lỗi runtime nghiêm trọng cho hệ đang live trading thật.

**Lead đã tự chạy `apply_migration` với đúng nội dung SQL trong file để vá lỗ hổng này ngay** (vì
đây là 1 lệnh ALTER TABLE ADD COLUMN đơn giản, additive, rủi ro thấp, và đúng 100% với những gì
Worker đã viết — không phải quyết định nghiệp vụ cần hỏi lại). Đã verify lại sau khi áp dụng:
- Cột `primary_timeframe` (`text`, nullable) tồn tại thật.
- Backfill đúng: id=7 (TIA/USDT) và id=8 (INJ/USDT) đều có `primary_timeframe='M15'`.

## Finding nhỏ — số liệu test trong result.md không khớp baseline hiện tại

`result.md` ghi "609 passed (609)". Lead chạy lại `npx vitest run` trên working tree hiện tại (đã
có thêm commit của Task 02, 03, 06, 07 chạy song song) ra **898 passed (78 test files)**, khớp với
baseline trước đó của phiên làm việc. Khả năng cao 609 là con số tại THỜI ĐIỂM Task 01 chạy test
(trước khi các task khác merge thêm), không hẳn là sai — nhưng Worker nên ghi rõ "baseline lúc
chạy" thay vì để con số trần trụi dễ gây hiểu nhầm khi đọc lại sau.

## Việc đã đúng (không cần sửa)

- Type `OpenPosition.primaryTimeframe` trong `positions-repository-volman.ts` — đúng.
- `loadOpenPositions` select + map `primary_timeframe` → `primaryTimeframe` — đúng.
- `buildOpenPositionInsertRow` trong `position-engine-volman.ts:254-300` — dùng đúng
  `setup.primaryTimeframe ?? null` (KHÔNG mặc định `"H4"` như yêu cầu task.md) — đúng.
- `npx tsc --noEmit` sạch trên working tree hiện tại.
- `npx vitest run` — 898/898 pass trên working tree hiện tại (sau khi Lead áp migration).

## Yêu cầu cho lần fix tiếp theo (nếu Worker cần re-run bất kỳ task DB nào sau này)

1. **Bắt buộc dùng tool `apply_migration` thật** (hoặc xác nhận qua `list_migrations` +
   `execute_sql` kiểm tra schema thật) trước khi ghi "Schema Confirmation" vào `result.md` — không
   được suy ra từ nội dung file migration đã viết. Đây là quy tắc chung cần áp dụng cho MỌI task
   liên quan DB trong plan này (đặc biệt Task 02, 03 nếu có thay đổi schema — Lead sẽ verify lại
   riêng).
2. Khi ghi số liệu test trong `result.md`, ghi kèm thời điểm/commit hash đã test, tránh con số trần
   trụi không có ngữ cảnh.

## Trạng thái cuối

Task 01 nay đã **THỰC SỰ hoàn thành** (migration đã áp dụng thật, code đúng, test pass) — không cần
Worker làm lại. Ghi nhận finding này chỉ để cảnh báo quy trình cho các task còn lại.
