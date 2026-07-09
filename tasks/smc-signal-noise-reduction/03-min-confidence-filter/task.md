# Task 03 — Ngưỡng confidence tối thiểu để gửi tín hiệu

> Phụ thuộc: chạy SAU khi subtask 02 hoàn thành (cùng sửa `smc-pipeline.ts` và `chart-config-env.ts`).

## Mục tiêu

Hiện tại mọi setup SMC bất kể confidence đều vào `result.setups` và được gửi Telegram; `getConfiguredChartSignalConfidenceThreshold()` (default 70) chỉ gate auto-track open position trong `src/charts/smc-index.ts`. Thêm ngưỡng riêng `SMC_MIN_SIGNAL_CONFIDENCE` (default 65): pair có signal dưới ngưỡng bị xử lý như `no_setup`.

## Không được làm

- KHÔNG đổi logic auto-track / `getConfiguredChartSignalConfidenceThreshold` hiện có.
- KHÔNG đổi flow Volman hay backtest.
- KHÔNG refactor ngoài scope.

## Thay đổi 1 — `src/charts/chart-config-env.ts`

Thêm getter (cùng style các getter hiện có):

```ts
/**
 * Confidence tối thiểu để một signal SMC được đưa vào setups gửi Telegram.
 * Thấp hơn ngưỡng này pair bị coi là no_setup. Default 65.
 */
export function getConfiguredSmcMinSignalConfidence(): number {
  const raw = process.env.SMC_MIN_SIGNAL_CONFIDENCE?.trim();
  if (!raw) return 65;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 ? parsed : 65;
}
```

## Thay đổi 2 — `src/charts/smc/smc-pipeline.ts`

`analyzeAllChartsSmc` (dòng ~389): mở rộng `options` thêm `minSignalConfidence?: number` (default 0 nếu không truyền — giữ backward compatible cho test/backtest gọi trực tiếp).

Trong phần xử lý mỗi pair, **sau** khi `analyzeSmcWindow` trả về signals và **trước** khi gọi `checkMultiTimeframeConfluence`, thêm guard:

```ts
const minSignalConfidence = options.minSignalConfidence ?? 0;
if (signals[0].confidence < minSignalConfidence) {
  return {
    kind: "no_setup" as const,
    pair,
    summaries: [buildSmcPairSummary(pair, gradeToTrend(signals[0].direction), 0, false)],
    lowConfidence: signals[0].confidence,
  };
}
```

Ở vòng for tổng hợp kết quả phía dưới, nhánh `no_setup` hiện push reason `"[<pair>] Khong phat hien setup SMC nao"`. Với case bị lọc bởi ngưỡng, reason phải ghi rõ: `"[<pair>] Setup SMC bi loai do confidence <x> < nguong <minSignalConfidence>"`. Cách làm: thêm field optional `lowConfidence?: number` vào object kết quả `no_setup` (như snippet trên) và branch theo nó khi build reason.

Lưu ý: đặt guard **trước** confluence để tránh tốn API call cho signal sẽ bị loại. Confidence không bị confluence thay đổi (confluence chỉ chỉnh `score`/`grade`), nên lọc trước là an toàn.

## Thay đổi 3 — `src/charts/smc-index.ts`

Chỗ gọi pipeline trong `analyzeCurrentWindow` (dòng ~73):

```ts
const result = await analyzeAllChartsSmc(getPairs(), { timeframeMode, primaryTimeframe });
```

sửa thành:

```ts
const result = await analyzeAllChartsSmc(getPairs(), {
  timeframeMode,
  primaryTimeframe,
  minSignalConfidence: getConfiguredSmcMinSignalConfidence(),
});
```

và thêm import `getConfiguredSmcMinSignalConfidence` vào block import từ `./chart-config-env.js` (dòng ~8-16).

## Tests

1. `tests/charts/smc/smc-pipeline.test.ts`: nếu có test cho `analyzeAllChartsSmc` (kiểm tra trước — có thể phải mock `fetchOhlcHistory`/`buildHtfContext` theo pattern hiện có; nếu file test hiện chưa test hàm này và việc mock quá phức tạp, test qua đường khác: export guard logic không cần thiết — thay vào đó test `analyzeAllChartsSmc` với mock module theo vitest `vi.mock`):
   - Signal confidence < ngưỡng → pair thành `no_setup`, `noSetupReason` chứa chuỗi "bi loai do confidence", `setups` rỗng.
   - Signal confidence >= ngưỡng → setup được trả về bình thường.
   - Không truyền `minSignalConfidence` → không lọc (default 0).
2. Test getter env (cùng chỗ với test getter của subtask 01): default 65, parse hợp lệ, giá trị rác → 65.

Nếu mock cho `analyzeAllChartsSmc` thực sự không khả thi trong khuôn khổ test hiện tại → ghi `blocked.md` nêu rõ lý do, KHÔNG bỏ qua âm thầm.

## Verification

```bash
npm run build
npm run test
```

Cả hai phải pass. Ghi kết quả vào `tasks/smc-signal-noise-reduction/03-min-confidence-filter/result.md` (file sửa, output build/test). Nếu blocked → `blocked.md`.
