# Task 01 — Thêm giá trị giá vào ARB signal (mức mồi + edge-test) gửi Telegram

## Bối cảnh

`ARB` (Advanced Range Break) detect ở [src/charts/setups/arb.ts](../../../src/charts/setups/arb.ts).
Signal đi qua pipeline: `DetectedSignal.ruleTrace` (arb.ts) → dịch sang tiếng Việt bởi
`REASON_TEMPLATES` ở [src/charts/signal-assembly.ts](../../../src/charts/signal-assembly.ts) →
gán vào `TradeSetup.reasons` → hiển thị trong Telegram message ở block "✅ *Lý do vào lệnh:*"
(xem `buildCopyableSetup()` trong [src/shared/telegram-volman.ts](../../../src/shared/telegram-volman.ts)).

Hiện tại `arb.ts` dòng 34 chỉ log `Range detected w=${w}, range=${range.range.toFixed(5)}` —
KHÔNG có giá trị `range.high` / `range.low` tường minh (đây chính là mức "mồi" bị phá vỡ khi
breakout xảy ra). User muốn các giá trị giá này xuất hiện rõ trong nội dung signal gửi Telegram.

Edge-test đã có giá trị giá sẵn (dòng 117/125: `Edge test #N at index i: high=X, close=Y`) và đã
có template dịch ở signal-assembly.ts dòng 35 — phần này **không cần sửa**, chỉ verify nó vẫn chạy
đúng sau khi thêm dòng trace mới.

## Việc cần làm

### 1. `src/charts/setups/arb.ts`

Ngay sau dòng phát hiện range (khoảng dòng 33-37, trong vòng lặp `for (const w of windowSizes)`),
sau khi `range !== null` và trước khi `break`, thêm 1 dòng trace nêu rõ high/low của range (mức mồi):

```ts
if (range !== null) {
  trace.push(`Range detected w=${w}, range=${range.range.toFixed(5)}`);
  trace.push(`Vung moi: high=${range.high.toFixed(5)}, low=${range.low.toFixed(5)}`);
  break;
}
```

Sau khi breakout được xác nhận hợp lệ (ngay trước đoạn "Entry/Stop/Target" ở dòng ~154, sau dòng
`trace.push(\`Current breakout khong bi false\`);`), thêm 1 dòng nêu rõ mức giá "mồi" bị phá + gap
(khoảng cách giữa giá đóng cửa breakout và mức mồi):

```ts
const breakoutLevel = direction === "LONG" ? levelHigh : levelLow;
const gap = Math.abs(candles[index].close - breakoutLevel);
trace.push(`Pha vo muc moi tai gia ${breakoutLevel.toFixed(5)}, gap=${gap.toFixed(5)}`);
```

Đặt đoạn này NGAY TRƯỚC dòng `// Entry/Stop/Target (same as RB)` (dòng 154 hiện tại). Dùng biến
`levelHigh`/`levelLow` đã có sẵn trong scope (khai báo ở dòng 104-105), không tạo biến trùng tên.

### 2. `src/charts/signal-assembly.ts` — thêm template dịch cho 2 dòng trace mới

Thêm vào mảng `REASON_TEMPLATES` (gần các dòng ARB-specific hiện có, khoảng dòng 35-40):

```ts
{ pattern: /^Vung moi: high=(\S+), low=(\S+)$/, replacement: "Vùng mồi: đỉnh=$1, đáy=$2" },
{ pattern: /^Pha vo muc moi tai gia (\S+), gap=(\S+)$/, replacement: "Phá vỡ mức mồi tại giá $1 (gap=$2)" },
```

Đặt 2 dòng này TRƯỚC dòng generic `{ pattern: /edgeTestCount.*/, ... }` (dòng 41) để không bị pattern
generic bắt nhầm trước.

## Ràng buộc — KHÔNG được làm

- KHÔNG đổi entry/stopLoss/takeProfit hoặc bất kỳ điều kiện detect nào (breakout check, slope check,
  edge test count, confidence calculation...).
- KHÔNG đổi tên biến `levelHigh`/`levelLow`/`range` hiện có.
- KHÔNG động vào BB/RB/IRB/DDB/FB/SB hay bất kỳ file setup nào khác ngoài `arb.ts`.
- KHÔNG sửa `getPatternInfo()` trong telegram-volman.ts (mô tả tĩnh của ARB) — chỉ dựa vào
  `reasons` (từ ruleTrace) để show giá trị động.
- KHÔNG tạo file mới, không thêm field mới vào `DetectedSignal`/`TradeSetup` types — chỉ dùng
  `ruleTrace` (string[]) đã có sẵn.

## Verify

1. `npm run build` — phải pass, không lỗi TypeScript.
2. `npm run test` — chạy full suite, đặc biệt các test liên quan ARB (tìm file test có "arb" trong
   tên, ví dụ `tests/charts/setups/*.test.ts` nếu có, hoặc test cho `signal-assembly.ts` /
   `setup-chart-renderer.ts` có check `ruleTrace`/`reasons` của ARB).
3. Nếu có test snapshot hoặc assertion cứng trên độ dài/nội dung `ruleTrace` của ARB, test đó có thể
   fail vì thêm 2 dòng trace mới — **đây là kỳ vọng, sửa test cho khớp nội dung mới**, không phải bug.
   Nếu không chắc test nào cần sửa, liệt kê trong `result.md` để Lead review.

## Ghi kết quả

Ghi `result.md` trong cùng thư mục subtask này, gồm:
- Diff/nội dung đã sửa ở 2 file.
- Kết quả `npm run build` và `npm run test` (pass/fail, số test).
- Ví dụ 1 đoạn `ruleTrace` thực tế (chạy thử hoặc từ test) cho thấy 2 dòng mới xuất hiện đúng vị trí.

Nếu bị chặn (ví dụ không tìm thấy `windowSizes` loop như mô tả vì code đã đổi khác so với snapshot
trong task này), ghi `blocked.md` nêu rõ chỗ khác biệt, không tự đoán sửa theo hướng khác.
