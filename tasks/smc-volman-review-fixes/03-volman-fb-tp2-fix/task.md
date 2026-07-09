# Task 03 — Volman FB: fix TP2 fallback sai công thức

**Vấn đề:** `src/charts/setups/fb.ts` dòng 144-158, nhánh fallback của TP2 là `takeProfit1 * 1.5` — nhân GIÁ tuyệt đối thay vì khoảng cách:

- LONG: TP1 ≈ 1.08 (EURUSD) → TP2 ≈ 1.62, vô nghĩa.
- SHORT: `takeProfit1 * 1.5` cho giá CAO HƠN entry → TP2 sai hướng hoàn toàn.

Ngoài ra nhánh chính `entry ± |entry - swing| * 0.5` không kiểm tra swing có nằm đúng phía so với entry, và không đảm bảo TP2 xa hơn TP1.

**Mục tiêu:** TP2 luôn hợp lệ: đúng hướng và xa hơn TP1.

**KHÔNG làm:** không sửa logic detect FB (trend, touch count, signal bar), không sửa entry/stop/TP1, không đụng file khác ngoài `fb.ts` và test.

## Bước 1 — Sửa `src/charts/setups/fb.ts` dòng ~142-158

Thay toàn bộ block tính `tp2` hiện tại bằng:

```ts
  // TP2: hướng về swing extreme trước khi trend hình thành; fallback 2.5R.
  const defaultTp2 = direction === "LONG" ? entry + 2.5 * risk : entry - 2.5 * risk;
  let tp2 = defaultTp2;
  if (direction === "LONG") {
    let swingHigh = -Infinity;
    for (let i = Math.max(0, trendStartIndex - 15); i < trendStartIndex; i++) {
      if (candles[i].high > swingHigh) swingHigh = candles[i].high;
    }
    if (swingHigh > entry) {
      const candidate = entry + (swingHigh - entry) * 0.5;
      if (candidate > takeProfit1) tp2 = candidate;
    }
  } else {
    let swingLow = Infinity;
    for (let i = Math.max(0, trendStartIndex - 15); i < trendStartIndex; i++) {
      if (candles[i].low < swingLow) swingLow = candles[i].low;
    }
    if (swingLow < entry) {
      const candidate = entry - (entry - swingLow) * 0.5;
      if (candidate < takeProfit1) tp2 = candidate;
    }
  }
```

Quy tắc: giữ heuristic "nửa đường tới swing" khi swing đúng phía VÀ candidate xa hơn TP1; mọi trường hợp khác dùng 2.5R (nhất quán với DD/BB dùng 2.5R).

## Bước 2 — Tests

Tests setup Volman nằm ở `tests/charts/setups/` và `tests/charts/setups.test.ts`. Thêm test cho FB:

1. LONG với swing high phía trên entry → TP2 = entry + (swingHigh − entry)/2, và TP2 > TP1.
2. SHORT → TP2 < entry và TP2 < TP1 (đúng hướng — đây là case trước đây sai).
3. Case swing nằm sai phía (swing high < entry với LONG) → TP2 = entry + 2.5×risk.

Dựng candles giả theo pattern các test FB hiện có (nếu đã có test detectFb, mở rộng; nếu chưa, tạo `tests/charts/setups/fb.test.ts` theo cấu trúc test hàng xóm).

## Verification

```bash
npm run build
npm run test
```

Ghi kết quả vào `tasks/smc-volman-review-fixes/03-volman-fb-tp2-fix/result.md`. Nếu blocked → `blocked.md`.
