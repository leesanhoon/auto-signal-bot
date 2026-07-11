# Done — smc-min-risk-production

**Lead review: APPROVED** (2026-07-11)

## Đối chiếu review criteria trong plan.md

| Criteria | Kết quả |
|---|---|
| 1. Gate đặt sau `signals[0]`, cùng tầng gate confidence, KHÔNG trong `buildSmcCandidatesAtIndex` | ✅ [smc-pipeline.ts:481-491](../../src/charts/smc/smc-pipeline.ts) — sau gate confidence, trước `checkMultiTimeframeConfluence`; `buildSmcCandidatesAtIndex`/`analyzeSmcSignalsAtIndex`/`analyzeSmcWindow` không bị đụng → backtest không bị filter 2 lần |
| 2. Reason ghi rõ risk% thực tế + ngưỡng | ✅ `"Setup SMC bi loai do risk X.XX% < nguong Y% (stop qua hep, phi an het edge)"` |
| 3. Default 0.5, env không hợp lệ → fallback 0.5, `0` tắt filter | ✅ `getConfiguredSmcMinRiskPct` (smc-config-env.ts:101-106) + 6 unit test cover đủ: unset/valid/zero/NaN/âm/quá range |
| 4. Không thay đổi ngoài scope | ✅ Worker chỉ sửa: `smc-config-env.ts`, `smc-pipeline.ts`, `smc-index.ts`, 3 file test. (`deploy/windows/register-tasks.ps1` có diff trong working tree nhưng là thay đổi scheduler của user, ngoài task này — không tính) |

## Verification (Lead tự chạy lại, không tin result.md)

- `npm run build`: pass (tsc không lỗi)
- `npx vitest run`: **72 files / 765 tests pass** (khớp result.md subtask 02)
- 2 test gate mới trong `smc-pipeline.test.ts` kiểm tra đúng cả 2 nhánh: risk 0.13% bị loại với reason đúng format; risk ~5% đi qua bình thường
- `smc-index.test.ts` đã assert `minRiskPct` được truyền vào `analyzeAllChartsSmc`

## Ghi chú nhỏ (không blocking)

- `tests/charts/smc-config-env.test.ts` set `process.env.SMC_MIN_RISK_PCT` trong test cuối mà không có `afterEach` cleanup — vitest isolate theo file nên không leak, nhưng nếu sau này thêm test khác vào cùng file thì nên thêm `afterEach(() => delete process.env.SMC_MIN_RISK_PCT)`.

## Trạng thái tổng

Chuỗi hoàn chỉnh: env `SMC_MIN_RISK_PCT` (default 0.5) → `smc-index.ts` → gate trong `analyzeAllChartsSmc`. Production giờ tự loại tín hiệu stop hẹp — đúng cấu hình "combo B" đã validate 5/5 cửa sổ.

Việc còn lại (user):
- [ ] Xác nhận venue maker fee ≤ 0.02%
- [ ] Commit toàn bộ thay đổi (scoring + filters + tests + tasks)
- [ ] Paper trade 1–2 tháng đối chiếu backtest
