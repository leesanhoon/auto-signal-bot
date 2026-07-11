# Task 01: Thêm env config `SMC_MIN_RISK_PCT`

## Bối cảnh (đọc, không cần scan thêm)

Backtest đã chứng minh cần loại tín hiệu SMC có khoảng cách entry→stopLoss < 0.5% giá (phí ăn hết edge). Subtask này chỉ thêm hàm đọc config; subtask 02 sẽ dùng nó. File config SMC hiện có: `src/charts/smc-config-env.ts` — đã có pattern tương tự là `getConfiguredSmcMinSignalConfidence()` (cuối file, đọc env, validate, fallback default).

## Việc cần làm

### 1. Sửa `src/charts/smc-config-env.ts`

Thêm vào cuối file (sau `getConfiguredSmcMinSignalConfidence`), theo đúng style hiện có:

```ts
export function getConfiguredSmcMinRiskPct(): number {
  const raw = process.env.SMC_MIN_RISK_PCT?.trim();
  if (!raw) return 0.5;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 5 ? parsed : 0.5;
}
```

Quy tắc:
- Default **0.5** (giá trị đã validate qua 5 cửa sổ backtest).
- Giá trị hợp lệ: số hữu hạn trong [0, 5]. `0` nghĩa là tắt filter.
- Không hợp lệ (NaN, âm, > 5) → fallback 0.5.

### 2. Unit test

Kiểm tra xem test cho `smc-config-env.ts` hiện nằm ở đâu: chạy `grep -rln "getConfiguredSmcMinSignalConfidence" tests/`. Kết quả hiện tại là `tests/charts/smc-index.test.ts` và `tests/charts/smc/smc-pipeline.test.ts` (mock, không phải unit test trực tiếp). **Nếu chưa có file unit test riêng cho config-env**, tạo `tests/charts/smc-config-env.test.ts` với các case cho `getConfiguredSmcMinRiskPct`:

1. Env không đặt → trả 0.5.
2. `SMC_MIN_RISK_PCT="0.3"` → trả 0.3.
3. `SMC_MIN_RISK_PCT="0"` → trả 0 (tắt filter, không fallback).
4. `SMC_MIN_RISK_PCT="abc"` → trả 0.5.
5. `SMC_MIN_RISK_PCT="-1"` → trả 0.5.
6. `SMC_MIN_RISK_PCT="10"` → trả 0.5.

Lưu ý kỹ thuật: đặt/xóa `process.env.SMC_MIN_RISK_PCT` trong `beforeEach`/`afterEach` để không leak giữa các test (xem pattern env-manipulation nếu đã có trong test khác, ví dụ `grep -rn "process.env" tests/charts/ | head`).

## Ràng buộc

- KHÔNG sửa file nào khác ngoài `src/charts/smc-config-env.ts` và file test.
- KHÔNG wire vào pipeline (đó là subtask 02).
- KHÔNG commit.

## Verification

```bash
npm run build
npm run test
```

Cả hai phải pass.

## result.md

Ghi vào `tasks/smc-min-risk-production/01-config-env/result.md`:
- Diff tóm tắt (file + hàm đã thêm).
- Vị trí file test + số test case đã thêm.
- Output build/test (dòng tổng kết pass/fail).

## Nếu bị chặn

Ghi `blocked.md` cùng thư mục, mô tả cụ thể lệnh/lỗi. Không đoán.
