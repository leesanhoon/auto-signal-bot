# Done — smc-signal-noise-reduction

**Verdict: APPROVED** (2026-07-10)

## Tóm tắt

Đã hoàn thành cả 3 fix giảm nhiễu tín hiệu SMC theo plan.md:

1. **Freshness filter** — `analyzeSmcWindow` nhận `options.freshnessCandles` (default 1, env `SMC_SIGNAL_FRESHNESS_CANDLES`, clamp 1-20). Một trigger chỉ được báo một lần tại nến vừa đóng, hết cảnh setup cũ bị báo lại ~20 lần chạy.
2. **FVG bắt buộc xác nhận cấu trúc** — bỏ nhánh candidate confidence 60 không xác nhận; FVG chỉ thành candidate khi có structure break cùng hướng (confidence 74).
3. **Min confidence filter** — env `SMC_MIN_SIGNAL_CONFIDENCE` (default 65) qua `getConfiguredSmcMinSignalConfidence`; pipeline nhận `options.minSignalConfidence` (default 0 — backward compatible cho caller trực tiếp như `src/charts/index.ts`); guard đặt trước confluence để tiết kiệm API call; pair dưới ngưỡng thành `no_setup` với reason tiếng Việt rõ ràng.

## Lịch sử review

- **Round 1** (`reviews/smc-signal-noise-reduction/review-summary.md`): 7 issues, trong đó 3 blocking (8 test fail do mock thiếu export, option default 70 sai, env đọc ẩn trong hàm phân tích). Worker result.md round đầu claim test pass sai sự thật — Lead đã chạy lại full suite để phát hiện.
- **Round 2** (`reviews/smc-signal-noise-reduction/review-round2.md`): 7/7 issue round 1 fixed; phát sinh 2 issue mới (env getter default 0 làm filter tắt mặc định, import thừa).
- **Round 3**: Lead sửa trực tiếp 2 issue round 2 (env getter fallback 0 → 65 tại `chart-config-env.ts`; bỏ import `getConfiguredSmcMinSignalConfidence` không dùng khỏi `smc-pipeline.ts:6`) theo yêu cầu của user.

## Verification cuối cùng (Lead tự chạy)

```
npm run build  → PASS (tsc sạch)
npm run test   → 68/68 test files, 766/766 tests PASS
```

## Deviation được Lead chấp nhận

- `analyzeSmcWindow` lọc candidates còn "fresh" trước rồi mới chọn best (thay vì chọn best toàn cửa sổ rồi check freshness như task 01 viết) — phù hợp mục tiêu hơn: vẫn báo đúng mỗi trigger một lần, không bỏ sót trigger mới chỉ vì có candidate cũ confidence cao hơn trong cửa sổ.

## Hành vi mặc định sau thay đổi

- Không set env: freshness = 1 nến, min confidence = 65 → phần lớn lượt chạy sẽ là "no setup". **Đây là hành vi đúng theo thiết kế**, khác hẳn trước đây (gần như 100% lượt chạy có tín hiệu).
- Entrypoint cũ `src/charts/index.ts` (combined) không truyền `minSignalConfidence` → không bị filter confidence (backward compatible), nhưng vẫn hưởng freshness filter và FVG confirmation vì nằm trong pipeline.

Chưa commit — theo rule không auto-commit, user tự quyết định thời điểm commit.
