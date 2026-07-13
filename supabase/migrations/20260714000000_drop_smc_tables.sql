-- Xóa hệ SMC khỏi database (docs-alignment-audit, 2026-07-14).
-- Đã xác nhận trước khi drop: open_positions_smc trống, pending_orders_smc chỉ còn
-- 3 pending signal nội bộ (không có lệnh thật trên Binance).
DROP TABLE IF EXISTS public.pending_orders_smc;
DROP TABLE IF EXISTS public.open_positions_smc;
DROP TABLE IF EXISTS public.analysis_cache_smc;
