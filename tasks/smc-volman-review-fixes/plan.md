# Plan — Fix issues từ review hệ thống SMC + Volman

**Task ID:** `smc-volman-review-fixes`
**Nguồn:** `reviews/2026-07-10-smc-volman-system-review/review-summary.md`
**Lead:** đã phân tích codebase, các subtask dưới đây self-contained cho Worker.

## Bối cảnh

Review 2026-07-10 phát hiện:

1. **G1 (HIGH):** Hai hệ thống (Volman qua `src/charts/index.ts`, SMC qua `src/charts/smc-index.ts`) ghi chung bảng `open_positions` / `pending_orders`, dedup chỉ theo `pair` → tín hiệu hệ này chặn tín hiệu hệ kia, report không tách được theo hệ thống.
2. **S1 (HIGH):** CHOCH là dead code — `smc-pipeline.ts:175` gọi `detectStructureBreak` không truyền `previousBias` nên `kind` luôn `"BOS"`, setup `SMC_CHOCH_OB` không bao giờ được tạo.
3. **V1 (HIGH latent):** `fb.ts:150,157` — TP2 fallback `takeProfit1 * 1.5` nhân giá tuyệt đối, SHORT ra TP2 sai hướng.
4. **S2 (MED):** `detectStructureBreak` fire ở mọi nến đóng ngoài swing level thay vì chỉ nến break đầu tiên → BOS cũ bị re-signal.
5. **G2 (MED):** `analyze.yml` và `analyze-smc.yml` thiếu `concurrency` group → run chồng nhau có thể double-send Telegram.

## Kiến trúc quyết định

- **G1:** Thêm cột `system text NOT NULL DEFAULT 'volman'` vào cả 2 bảng. Giá trị derive từ `setup.detectionSource` (đã tồn tại: `"smc" | "deterministic" | "ai"`): `"smc"` → `'smc'`, còn lại → `'volman'`. Dedup đổi thành `(pair, system)`. **Không** đổi check-runners trong scope này (cả 2 workflow tiếp tục monitor chung — chấp nhận, sẽ tách sau nếu cần).
- **S1:** Dùng `detectTimeframeBias` (đã có ở `smc-confluence.ts`) trên chính LTF candles trước `index` để lấy `previousBias`, truyền vào `detectStructureBreak` ở đường OB.
- **S2:** Thêm điều kiện first-close-through trong `detectStructureBreak` (nến `breakIndex - 1` chưa đóng ngoài level).
- Mỗi subtask độc lập, có thể review/merge riêng. Không auto-commit.

## Subtasks

| # | Thư mục | Mô tả | Files chính | Ưu tiên |
|---|---------|-------|-------------|---------|
| 01 | `01-positions-system-column` | Migration + cột `system` cho open_positions/pending_orders, dedup theo (pair, system) | `supabase/migrations/`, `src/charts/position-engine.ts`, `src/charts/positions-repository.ts` | HIGH |
| 02 | `02-smc-choch-previous-bias` | Truyền `previousBias` để CHOCH hoạt động | `src/charts/smc/smc-pipeline.ts` | HIGH |
| 03 | `03-volman-fb-tp2-fix` | Fix TP2 fallback sai trong FB | `src/charts/setups/fb.ts` | HIGH |
| 04 | `04-smc-first-break-condition` | BOS chỉ fire tại nến break đầu tiên | `src/charts/smc/smc-structure.ts` | MED |
| 05 | `05-workflow-concurrency` | Thêm concurrency group cho 2 workflow analyze | `.github/workflows/analyze.yml`, `.github/workflows/analyze-smc.yml` | MED |

## Thứ tự thực thi

01 → 02 → 03 → 04 → 05. Các task độc lập nhau (không phụ thuộc code lẫn nhau), có thể chạy song song nếu cần, nhưng khuyến nghị tuần tự để dễ review.

## Verification chung

Mỗi subtask phải pass:

```bash
npm run build
npm run test
```

Worker ghi output của 2 lệnh trên vào `result.md` làm evidence.

## Ngoài scope (không làm trong đợt này)

- Tách check-open-trades/check-pending-orders theo system (G1 phần b).
- Performance report group theo system.
- Order block mitigation/displacement check (S3), liquidity sweep vào pipeline (S4), prior-week epoch fix (S5), FVG fill check (S6), tradable-window London morning (V2 — chờ user xác nhận chủ ý).
