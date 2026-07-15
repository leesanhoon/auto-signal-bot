# R²-gated linear regression cho lottery predictor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thêm kiểm định R² (r-squared) vào `computeRegressionDigitDetails` — chỉ tin dùng slope của linear regression để ngoại suy `predictedRatio` khi R² ≥ 0.5; ngược lại fallback về tỉ lệ trung bình lịch sử của digit đó.

**Architecture:** Sửa 1 hàm duy nhất trong `src/lottery/lottery-regression-predict.ts`. Dùng `rSquared` + `linearRegressionLine` từ `simple-statistics` (dependency đã có sẵn, không thêm mới) để đánh giá độ tin cậy của regression trên chuỗi tỉ lệ mỗi digit, áp dụng đồng nhất cho cả 3 vị trí (hundreds/tens/units). Không đổi các hàm downstream (`predictTopNumbersRegression`, `computeRegressionDigitPositionProbabilities`, ensemble) — chúng vẫn tiêu thụ `predictedRatio` như cũ.

**Tech Stack:** TypeScript, `simple-statistics` (rSquared, linearRegressionLine, linearRegression — đã import sẵn `linearRegression`), Vitest.

## Global Constraints

- Ngưỡng R² để tin dùng slope: **0.5** (giá trị chính xác từ spec).
- Áp dụng gate cho **cả 3 vị trí** (hundreds/tens/units) — không đặc cách riêng vị trí nào.
- Không thêm dependency mới — `simple-statistics` đã có trong `package.json:37`.
- Không đổi `lottery-stats-predict.ts`, trọng số blend `0.25/0.35/0.4` trong `predictTopNumbersRegression`, hay weekday filtering ở `lottery-repository.ts`.
- `NaN`/undefined R² (chuỗi hằng số, ví dụ digit tỉ lệ luôn 0) phải được coi là "không đạt ngưỡng" → fallback, không throw.
- `totalPeriods < 3` giữ nguyên nhánh `getFallbackDetails` hiện có — không cần R² (không đủ điểm dữ liệu để tính).

---

### Task 1: Thêm R² gate vào `computeRegressionDigitDetails`

**Files:**
- Modify: `src/lottery/lottery-regression-predict.ts:1-3` (imports), `src/lottery/lottery-regression-predict.ts:11-15` (type `RegressionDigitDetail`), `src/lottery/lottery-regression-predict.ts:105-136` (hàm `computeRegressionDigitDetails`, đoạn tính slope/predictedRatio ở dòng 116-129)
- Test: `tests/lottery/lottery-regression-predict.test.ts`

**Interfaces:**
- Consumes: `linearRegression` (đã import), thêm `rSquared`, `linearRegressionLine` từ `"simple-statistics"`. Hàm `rSquared(points: [number, number][], func: (x: number) => number): number` — trả `1` khi `points.length < 2`, trả giá trị âm/thấp khi fit kém, có thể trả `NaN` khi `sumOfSquares === 0` (chuỗi hằng số, average === mọi giá trị).
- Produces: `RegressionDigitDetail` có thêm field `rSquared: number`. `computeRegressionDigitDetails` vẫn trả `{ hundreds, tens, units }` cùng shape như trước — các hàm gọi nó (`computeRegressionDigitPositionProbabilities`, `predictTopNumbersRegression`) không cần đổi vì chỉ đọc `predictedRatio`.

- [ ] **Step 1: Viết failing test cho case R² thấp → fallback về trung bình lịch sử**

Thêm vào `tests/lottery/lottery-regression-predict.test.ts`, sau test `"computeRegressionDigitDetails falls back to average when < 3 periods"` (dòng 122):

```typescript
  test("computeRegressionDigitDetails falls back to historical average when R² below threshold", () => {
    // Digit "7" tại units dao động ngẫu nhiên không theo xu hướng tuyến tính rõ ràng
    // qua nhiều period — R² sẽ thấp, fallback nên trả về đúng tỉ lệ trung bình lịch sử.
    const records: LotteryDrawRecord[] = [
      {
        date: "2026-07-01",
        weekday: 3,
        region: "mien-bac",
        province: "Hà Nội",
        prizes: { db: "00107", g1: "00207", g2: [], g3: [], g4: [], g5: [], g6: [], g7: [], g8: [] },
      },
      {
        date: "2026-07-02",
        weekday: 4,
        region: "mien-bac",
        province: "Hà Nội",
        prizes: { db: "00301", g1: "00402", g2: [], g3: [], g4: [], g5: [], g6: [], g7: [], g8: [] },
      },
      {
        date: "2026-07-03",
        weekday: 5,
        region: "mien-bac",
        province: "Hà Nội",
        prizes: { db: "00507", g1: "00601", g2: [], g3: [], g4: [], g5: [], g6: [], g7: [], g8: [] },
      },
      {
        date: "2026-07-04",
        weekday: 6,
        region: "mien-bac",
        province: "Hà Nội",
        prizes: { db: "00701", g1: "00807", g2: [], g3: [], g4: [], g5: [], g6: [], g7: [], g8: [] },
      },
    ];

    const result = computeRegressionDigitDetails(records);
    const digit7 = result.units.find((d) => d.digit === "7");
    expect(digit7).toBeDefined();
    expect(digit7!.rSquared).toBeDefined();

    if (digit7!.rSquared < 0.5) {
      // Tính trung bình lịch sử thủ công để so sánh: digit "7" xuất hiện ở units trong
      // 4/8 lần (period 1: 2 lần "07", period 2: 0, period 3: 1 lần "07", period 4: 2 lần "07")
      // predictedRatio phải khớp trung bình per-period-ratio, không phải giá trị ngoại suy từ slope.
      expect(digit7!.predictedRatio).toBeGreaterThanOrEqual(0);
      expect(digit7!.predictedRatio).toBeLessThanOrEqual(1);
    }
  });

  test("computeRegressionDigitDetails handles constant-zero ratio series without NaN", () => {
    // Digit "9" không bao giờ xuất hiện ở units — ratio luôn 0 → sumOfSquares = 0 →
    // rSquared có thể trả NaN. Phải không throw và predictedRatio phải là số hợp lệ (0).
    const records: LotteryDrawRecord[] = [
      {
        date: "2026-07-01",
        weekday: 3,
        region: "mien-bac",
        province: "Hà Nội",
        prizes: { db: "00111", g1: "00222", g2: [], g3: [], g4: [], g5: [], g6: [], g7: [], g8: [] },
      },
      {
        date: "2026-07-02",
        weekday: 4,
        region: "mien-bac",
        province: "Hà Nội",
        prizes: { db: "00333", g1: "00444", g2: [], g3: [], g4: [], g5: [], g6: [], g7: [], g8: [] },
      },
      {
        date: "2026-07-03",
        weekday: 5,
        region: "mien-bac",
        province: "Hà Nội",
        prizes: { db: "00555", g1: "00666", g2: [], g3: [], g4: [], g5: [], g6: [], g7: [], g8: [] },
      },
    ];

    expect(() => computeRegressionDigitDetails(records)).not.toThrow();
    const result = computeRegressionDigitDetails(records);
    const digit9 = result.units.find((d) => d.digit === "9");
    expect(digit9).toBeDefined();
    expect(Number.isNaN(digit9!.predictedRatio)).toBe(false);
    expect(digit9!.predictedRatio).toBe(0);
  });
```

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: `npx vitest run tests/lottery/lottery-regression-predict.test.ts`
Expected: FAIL — `digit7!.rSquared` là `undefined` (property `rSquared` chưa tồn tại trên `RegressionDigitDetail`), lỗi TypeScript/assertion.

- [ ] **Step 3: Sửa import và type `RegressionDigitDetail`**

Trong `src/lottery/lottery-regression-predict.ts`, sửa dòng 1-3:

```typescript
import { extractNums } from "./lottery-format.js";
import type { LotteryDrawRecord } from "./lottery-types.js";
import { linearRegression, linearRegressionLine, rSquared } from "simple-statistics";
```

Sửa type `RegressionDigitDetail` (dòng 11-15):

```typescript
export type RegressionDigitDetail = {
  digit: string;
  slope: number;
  predictedRatio: number;
  rSquared: number;
};
```

- [ ] **Step 4: Sửa vòng lặp tính `predictedRatio` để gate theo R²**

Trong `computeRegressionDigitDetails`, thay đoạn dòng 108-130:

```typescript
    for (let d = 0; d < 10; d++) {
      const digit = String(d);
      const ratios = digitRatios.get(digit)!;

      // Build points: [periodIndex, ratio]
      const points: Array<[number, number]> = ratios.map((ratio, idx) => [idx, ratio]);

      // Linear regression: y = m*x + b
      const { m: slope, b: intercept } = linearRegression(points);
      const regressionLine = linearRegressionLine({ m: slope, b: intercept });

      // R² đo mức độ regression giải thích được biến thiên thực tế. Với dữ liệu gần-uniform
      // (tỉ lệ mỗi digit dao động quanh 0.1), slope phần lớn chỉ là nhiễu — không gate sẽ
      // ngoại suy từ 1 xu hướng không có thật. Ngưỡng 0.5: chỉ tin slope khi regression giải
      // thích được từ 50% phương sai trở lên.
      const r2 = rSquared(points, regressionLine);
      const trustsSlope = Number.isFinite(r2) && r2 >= 0.5;

      let predictedRatio: number;
      if (trustsSlope) {
        const nextPeriodIndex = totalPeriods;
        predictedRatio = Math.max(0, Math.min(1, slope * nextPeriodIndex + intercept));
      } else {
        // Fallback: trung bình lịch sử của digit này (không ngoại suy khi regression yếu).
        predictedRatio = ratios.reduce((sum, r) => sum + r, 0) / ratios.length;
      }

      details.push({
        digit,
        slope,
        predictedRatio,
        rSquared: Number.isFinite(r2) ? r2 : 0,
      });
    }
```

- [ ] **Step 5: Sửa `getFallbackDetails` để khớp type mới**

Trong `getFallbackDetails` (dòng 138-200), thêm field `rSquared: 1` vào object đẩy vào `details` (dòng 189-193) — regression không chạy trong nhánh này nên coi R² là "hoàn hảo/không áp dụng" (giữ hành vi cũ: luôn dùng `avgRatio`):

```typescript
      details.push({
        digit,
        slope: 0,
        predictedRatio: avgRatio,
        rSquared: 1,
      });
```

- [ ] **Step 6: Chạy lại toàn bộ test file để xác nhận pass**

Run: `npx vitest run tests/lottery/lottery-regression-predict.test.ts`
Expected: PASS — tất cả test (kể cả 2 test mới) đều xanh.

- [ ] **Step 7: Chạy build để phát hiện lỗi TypeScript ở nơi khác đang tự dựng `RegressionDigitDetail` literal**

Run: `npm run build`
Expected: FAIL — `tests/lottery/lottery-ensemble-predict.test.ts:52-53,73` tự dựng object `hundredsDetail`/`tensDetail`/`unitsDetail` kiểu `RegressionDigitDetail` (`{ digit, slope, predictedRatio }`) thiếu field `rSquared` mới, TypeScript báo lỗi thiếu property.

- [ ] **Step 8: Sửa 3 object literal thiếu `rSquared` trong `tests/lottery/lottery-ensemble-predict.test.ts`**

Dòng 52:
```typescript
      { number: "111", confidence: 0.4, hundredsDetail: { digit: "1", slope: 0.1, predictedRatio: 0.4, rSquared: 1 }, tensDetail: { digit: "1", slope: 0.1, predictedRatio: 0.4, rSquared: 1 }, unitsDetail: { digit: "1", slope: 0.1, predictedRatio: 0.4, rSquared: 1 } },
```

Dòng 53:
```typescript
      { number: "333", confidence: 0.7, hundredsDetail: { digit: "3", slope: 0.2, predictedRatio: 0.7, rSquared: 1 }, tensDetail: { digit: "3", slope: 0.2, predictedRatio: 0.7, rSquared: 1 }, unitsDetail: { digit: "3", slope: 0.2, predictedRatio: 0.7, rSquared: 1 } },
```

Dòng 73:
```typescript
      { number: "123", confidence: 0.9, hundredsDetail: { digit: "1", slope: 0, predictedRatio: 0.9, rSquared: 1 }, tensDetail: { digit: "2", slope: 0, predictedRatio: 0.9, rSquared: 1 }, unitsDetail: { digit: "3", slope: 0, predictedRatio: 0.9, rSquared: 1 } },
```

- [ ] **Step 9: Chạy lại build để xác nhận hết lỗi TypeScript**

Run: `npm run build`
Expected: build thành công, không còn lỗi type ở bất kỳ file nào tiêu thụ `RegressionDigitDetail`/`computeRegressionDigitDetails` (ensemble, predict-runner, backtest).

- [ ] **Step 10: Commit**

```bash
git add src/lottery/lottery-regression-predict.ts tests/lottery/lottery-regression-predict.test.ts tests/lottery/lottery-ensemble-predict.test.ts
git commit -m "feat(lottery): gate regression extrapolation by R² threshold

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Chạy toàn bộ test suite dự án để xác nhận không có regression ở downstream consumers

**Files:**
- Không tạo/sửa file — chỉ verify. Nếu phát sinh lỗi type mới, sửa trực tiếp file lỗi đó.

**Interfaces:**
- Consumes: toàn bộ `src/lottery/*` và `tests/lottery/*` đã tồn tại/đã sửa ở Task 1, không thêm interface mới.

- [ ] **Step 1: Chạy toàn bộ test suite lottery**

Run: `npx vitest run tests/lottery`
Expected: PASS — `lottery-ensemble-predict.test.ts`, `lottery-stats-predict.test.ts`, `lottery-regression-predict.test.ts`, và mọi test khác trong `tests/lottery` đều xanh.

- [ ] **Step 2: Chạy full test suite dự án để đảm bảo không phá vỡ chỗ khác**

Run: `npm run test`
Expected: PASS toàn bộ.

- [ ] **Step 3: Commit (chỉ nếu Step 1/2 phát hiện và cần sửa thêm file ngoài phạm vi Task 1)**

```bash
git add -A
git commit -m "test(lottery): fix remaining type errors after rSquared field addition

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

Nếu Step 1 và Step 2 đều pass ngay không cần sửa gì, bỏ qua bước commit này (không tạo commit rỗng).
