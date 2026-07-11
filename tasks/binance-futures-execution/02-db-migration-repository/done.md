# Done — 02-db-migration-repository

**Status:** APPROVED

Migration `supabase/migrations/20260711000000_add_binance_execution_columns.sql` dùng `add column if not exists` cho cả 8 cột, idempotent, không phá dữ liệu cũ. `positions-repository-volman.ts`: `OpenPosition` type mở rộng đúng, `loadOpenPositions()` select/map đủ field, `saveBinanceExecutionDetails`/`updateBinanceSlOrder` implement đúng signature yêu cầu. Không tự apply migration lên production — đúng ràng buộc.

`npm run build && npm run test` pass.
