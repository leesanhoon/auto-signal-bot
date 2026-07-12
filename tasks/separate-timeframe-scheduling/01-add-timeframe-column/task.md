# Task 01: Thêm cột `primary_timeframe` vào `open_positions_volman` (migration) + backfill

**Prerequisite**: Không có.

**Objective**: Thêm cột `primary_timeframe` (TEXT/VARCHAR) vào table `open_positions_volman` trên Supabase, backfill 2 vị thế hiện tại (TIA id=7, INJ id=8) bằng "M15" (vì chúng được mở khi test M15).

## Schema Change

### Migration SQL
Tạo file migration hoặc chạy trực tiếp trên Supabase SQL editor:

```sql
ALTER TABLE open_positions_volman
ADD COLUMN primary_timeframe TEXT NOT NULL DEFAULT 'M15';

-- Verify: select id, pair, primary_timeframe from open_positions_volman;
-- Kết quả expected: 2 row hiện tại (TIA, INJ) đều có primary_timeframe = 'M15'
```

### Constraints
- **NOT NULL** — mỗi vị thế phải ghi rõ timeframe nó thuộc.
- **Default = 'M15'** — các vị thế cũ sẽ backfill tự động bằng M15 (vì chúng được mở test M15).
- **Type = TEXT** — match với `ChartTimeframe` type đã có ("M15", "H1", "H4", "D1").

## TypeScript Types Update

### File: `src/charts/positions-repository-volman.ts`

1. Update interface `OpenPositionVolman`:
   ```typescript
   export interface OpenPositionVolman {
     id: number;
     pair: string;
     entry_price: number;
     entry_qty: number;
     entry_time: string;
     entry_type: string;
     status: string;
     system_type: string;
     // ... other fields
     primary_timeframe: ChartTimeframe;  // ADD THIS
     // ... rest
   }
   ```

2. Update `loadOpenPositions()` signature:
   ```typescript
   export async function loadOpenPositions(
     supabaseClient: SupabaseClient,
     timeframe: ChartTimeframe  // ADD THIS PARAM
   ): Promise<OpenPositionVolman[]> {
     // SQL: WHERE primary_timeframe = $1
   }
   ```

3. Update `saveOpenPosition()`:
   - Nhận `primary_timeframe` param và lưu vào DB.
   - Example:
     ```typescript
     export async function saveOpenPosition(
       supabaseClient: SupabaseClient,
       position: OpenPositionVolman,
       timeframe: ChartTimeframe  // ADD THIS PARAM
     ): Promise<number> {
       // Set position.primary_timeframe = timeframe before insert
     }
     ```

4. Check guard logic `existingPositionAmt !== 0`:
   - Hiện tại: check `WHERE pair = $1` (across all timeframes).
   - **KHÔNG đổi** — giữ nguyên vì Binance One-way mode chỉ cho 1 symbol 1 vị thế dù timeframe nào.

## Validation

### 1. Database Verification
- Chạy Supabase SQL editor, chạy migration.
- Query: `SELECT id, pair, primary_timeframe FROM open_positions_volman;`
- Expected: 2 rows (TIA, INJ) với primary_timeframe = 'M15'.

### 2. TypeScript Compilation
- Run `npx tsc --noEmit` — không có type error (strict mode).
- Kiểm tra `loadOpenPositions()` và `saveOpenPosition()` được type-check đúng với new param.

### 3. Test Suite
- Run `npx vitest run tests/charts/` — các test liên quan `open_positions_volman` không crash.
- Nếu có test mock DB, update mock để include `primary_timeframe: 'M15'`.

## Important Caveats

- **KHÔNG xoá hoặc thay đổi trạng thái 2 vị thế hiện tại** (TIA id=7, INJ id=8) — chỉ backfill cột mới thôi.
- **Sau migration, `loadOpenPositions()` phải bắt buộc nhận timeframe param** — không được default nếu bị thiếu (tránh task vô tình load sai timeframe).
- **Regression check**: Pipeline SMC cũng dùng chung `positions-repository-volman.ts` → kiểm tra SMC pipeline test không break khi `loadOpenPositions()` signature thay đổi.

## Acceptance Criteria
- ✅ Cột `primary_timeframe` được thêm vào DB (`ALTER TABLE` success).
- ✅ 2 vị thế hiện tại backfill với 'M15' (query verify: 2 rows with 'M15').
- ✅ TypeScript types updated, `loadOpenPositions(timeframe)` bắt buộc timeframe param.
- ✅ TypeScript strict mode pass: `npx tsc --noEmit`.
- ✅ Tests pass: `npx vitest run tests/charts/`.

## Result File
Ghi result tại `tasks/separate-timeframe-scheduling/01-add-timeframe-column/result.md` với:
- Migration SQL executed (copy paste command run).
- DB verification: query output showing 2 rows with primary_timeframe = 'M15'.
- Files modified: `positions-repository-volman.ts` changes (line numbers, function signatures).
- Test results: `npx tsc --noEmit` + `npx vitest run` output.

## Next Subtasks Dependencies
- Task 02 phụ thuộc task 01 (schema có sẵn mới filter được).
- Task 07 có thể run trước nhưng nên check schema sau 01 xong để không conflict.
