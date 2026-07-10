# Task 03: integrate-smc-volman

## Mục tiêu
Integrate freshness guard vào pipeline signal delivery:
1. **SMC pipeline**: `src/charts/smc-index.ts` → `handleAnalysisResult()`
2. **Volman pipeline**: `src/charts/index.ts` → `handleAnalysisResult()`

Gọi `applySignalFreshnessGuard()` cho mỗi setup trước khi gửi Telegram.
Lọc setup stale (có `noSetupReason`), update `noSetupReason` trong result.

## Yêu cầu chức năng

### SMC Pipeline: `src/charts/smc-index.ts`

**Vị trí:** Trong hàm `handleAnalysisResult(result, origin)`
**Trước:** `await sendAllAnalysesSmc(result, undefined, {...})`

**Logic:**
1. Đối với mỗi setup trong `result.setups`:
   ```
   const guardedSetup = await applySignalFreshnessGuard(setup, setup.pair)
   ```
2. Nếu `guardedSetup.noSetupReason` được set:
   - Thêm reason vào `result.noSetupReason`
   - Loại setup khỏi list (không gửi signal)
3. Nếu `guardedSetup.noSetupReason` undefined:
   - Giữ setup lại, gửi signal như bình thường

**Pseudocode:**
```typescript
const filteredSetups: TradeSetup[] = [];
const freshnesReasons: string[] = [];

for (const setup of result.setups) {
  const guardedSetup = await applySignalFreshnessGuard(setup, setup.pair);
  if (guardedSetup.noSetupReason) {
    freshnesReasons.push(`${setup.pair}: ${guardedSetup.noSetupReason}`);
  } else {
    filteredSetups.push(guardedSetup);
  }
}

result.setups = filteredSetups;
if (freshnesReasons.length > 0) {
  result.noSetupReason = [result.noSetupReason, ...freshnesReasons]
    .filter(Boolean)
    .join("\n");
}
```

### Volman Pipeline: `src/charts/index.ts`

**Tương tự SMC:**
- Tìm `handleAnalysisResult()` function
- Áp dụng freshness guard trước khi gửi
- Update `result.setups` và `result.noSetupReason`

### Import

Thêm import vào cả hai file:
```typescript
import { applySignalFreshnessGuard, type SetupWithFreshness } from "./signal-freshness.js";
```

### Logger

Tùy chọn log:
```typescript
if (guardedSetup.noSetupReason) {
  logger.info("Setup filtered by freshness guard", { 
    pair: setup.pair, 
    reason: guardedSetup.noSetupReason 
  });
}
```

## Lưu ý kỹ thuật

1. **Order:** Freshness guard áp dụng SAU khi đã lọc confidence nhưng TRƯỚC khi gửi
2. **Error handling:** `fetchLastPrice()` đã handle error (return setup unchanged)
3. **No additional API calls:** Dùng `fetchLastPrice()` đã có rate limit handling
4. **Không thay đổi logic khác:** Chỉ thêm freshness guard, giữ nguyên auto-track, pending orders, v.v.

## Tests

Tạo `tests/charts/smc-index.integration.test.ts` (hoặc thêm vào existing test):

### Test case 1: SMC — Setup fresh (giữ lại)
- Mock `fetchLastPrice()` trả price fresh
- Input: analysis result với 1 setup
- Output: result.setups có 1 setup, noSetupReason không thay đổi

### Test case 2: SMC — Setup stale (loại bỏ)
- Mock `fetchLastPrice()` trả price stale
- Input: analysis result với 1 setup
- Output: result.setups rỗng, noSetupReason được update

### Test case 3: SMC — Mixed fresh & stale
- Input: 2 setups (1 fresh, 1 stale)
- Output: result.setups có 1, noSetupReason updated

### Test case 4: SMC — Freshness guard disabled
- `SIGNAL_FRESHNESS_GUARD_ENABLED=false`
- Input: stale setup
- Output: setup vẫn được giữ

### Test case 5: Volman — Similar to SMC tests

## Acceptance criteria

- `npm run build` pass
- `npm run test` pass (tất cả existing + new integration tests)
- Freshness guard được gọi trước khi gửi Telegram (smc-index + index)
- Setup stale bị loại, noSetupReason được update
- Feature disabled → setup được giữ
- Không có performance regression (batch call fetchLastPrice, không per-setup overhead)
