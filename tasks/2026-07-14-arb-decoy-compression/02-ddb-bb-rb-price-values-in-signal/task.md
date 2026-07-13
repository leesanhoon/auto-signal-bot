# Task 02 — Thêm giá trị giá hành vi vào DDB/BB/RB signal gửi Telegram

## Bối cảnh

Theo tài liệu "Bảy Setup Bob Volman" (user cung cấp 2026-07-14), mỗi setup có 1 mức giá "hành vi"
then chốt cần hiển thị rõ khi gửi Telegram:

- **DDB (Double Doji Break)**: đáy/đỉnh cụm doji — "Dừng lỗ đặt dưới đáy cụm doji" (LONG) / "trên
  đỉnh cụm doji" (SHORT).
- **BB (Block Break)**: đáy/đỉnh hộp nén — "Dừng lỗ đặt dưới đáy hộp nén" (LONG) / "trên đỉnh hộp
  nén" (SHORT).
- **RB (Range Break)**: đáy/đỉnh hộp — "Dừng lỗ đặt dưới đáy nến phá vỡ / đáy hộp" (LONG) / "trên
  đỉnh nến phá vỡ / đỉnh hộp" (SHORT).

Pipeline hiển thị: `DetectedSignal.ruleTrace` (setup file) → dịch tiếng Việt qua `REASON_TEMPLATES`
ở [src/charts/signal-assembly.ts](../../../src/charts/signal-assembly.ts) → `TradeSetup.reasons` →
hiển thị trong Telegram message ở block "✅ *Lý do vào lệnh:*" ([src/shared/telegram-volman.ts](../../../src/shared/telegram-volman.ts)).

Đã rà code: FB, SB, IRB đã log đủ giá trị high/low liên quan vào `ruleTrace` — KHÔNG sửa 3 file đó.
Chỉ DDB, BB, RB thiếu dòng trace tường minh nêu high/low. Đây là pattern y hệt đã áp dụng cho ARB ở
subtask 01 — chỉ thêm dữ liệu vào trace, KHÔNG đổi logic detect/entry/stop/confidence.

## Việc cần làm

### 1. `src/charts/setups/ddb.ts`

`dojiHigh`/`dojiLow` đã được tính ở dòng 75-76 nhưng không được push vào `trace`. Thêm ngay sau dòng
76 (`const dojiLow = Math.min(...)`), TRƯỚC dòng `const entry = ...` (dòng 77):

```ts
trace.push(`Cum doji: dinh=${dojiHigh.toFixed(5)}, day=${dojiLow.toFixed(5)}`);
```

### 2. `src/charts/setups/bb.ts`

Sau dòng phát hiện block (dòng 48-51, trong vòng lặp `for (const w of windowSizes)`), khi
`block !== null`, thêm 1 dòng trace nêu rõ `block.high`/`block.low` (mức đỉnh/đáy hộp nén). Sửa:

```ts
if (block !== null) {
  trace.push(`Block detected w=${w}, range=${block.range.toFixed(5)}, distanceToEma=${block.distanceToEma.toFixed(2)}`);
  trace.push(`Hop nen: dinh=${block.high.toFixed(5)}, day=${block.low.toFixed(5)}`);
  break;
}
```

### 3. `src/charts/setups/rb.ts`

Sau dòng phát hiện range (dòng 33-36, trong vòng lặp `for (const w of windowSizes)`), khi
`range !== null`, thêm 1 dòng trace nêu rõ `range.high`/`range.low`. Sửa:

```ts
if (range !== null) {
  trace.push(`Range detected w=${w}, range=${range.range.toFixed(5)}, distanceToEma=${range.distanceToEma.toFixed(2)}`);
  trace.push(`Hop range: dinh=${range.high.toFixed(5)}, day=${range.low.toFixed(5)}`);
  break;
}
```

### 4. `src/charts/signal-assembly.ts` — thêm template dịch cho các dòng trace mới

Thêm vào mảng `REASON_TEMPLATES` (đặt TRƯỚC các pattern generic như `block.*near EMA.*` / `range.*window.*`
ở dòng 20-21, để không bị bắt nhầm bởi pattern rộng hơn):

```ts
{ pattern: /^Cum doji: dinh=(\S+), day=(\S+)$/, replacement: "Cụm doji: đỉnh=$1, đáy=$2" },
{ pattern: /^Hop nen: dinh=(\S+), day=(\S+)$/, replacement: "Hộp nén: đỉnh=$1, đáy=$2" },
{ pattern: /^Hop range: dinh=(\S+), day=(\S+)$/, replacement: "Hộp range: đỉnh=$1, đáy=$2" },
```

## Ràng buộc — KHÔNG được làm

- KHÔNG đổi entry/stopLoss/takeProfit hoặc bất kỳ điều kiện detect nào (doji count, slope check,
  compression tightness, confidence calculation...).
- KHÔNG đổi tên biến hiện có (`dojiHigh`, `dojiLow`, `block`, `range`...).
- KHÔNG động vào `fb.ts`, `sb.ts`, `irb.ts`, `arb.ts` — 3 file đã đủ, `arb.ts` thuộc subtask 01 riêng.
- KHÔNG tạo file mới, không thêm field mới vào `DetectedSignal`/`TradeSetup` types — chỉ dùng
  `ruleTrace` (string[]) đã có sẵn.
- KHÔNG sửa `getPatternInfo()` trong telegram-volman.ts.

## Verify

1. `npm run build` — phải pass, không lỗi TypeScript.
2. `npm run test` — chạy full suite. Chú ý các file test cho DDB/BB/RB (`tests/charts/setups/*.test.ts`
   nếu có) — nếu có assertion cứng trên độ dài/nội dung `ruleTrace`, sửa test cho khớp nội dung mới
   (đây là kỳ vọng, không phải bug). Nếu không chắc, liệt kê trong `result.md` để Lead review.
3. Đưa ví dụ thực tế (chạy thử hoặc từ test) cho thấy dòng trace mới xuất hiện đúng vị trí, đúng giá
   trị (khớp với `block.high`/`block.low`, `range.high`/`range.low`, `dojiHigh`/`dojiLow` thực tế).

## Ghi kết quả

Ghi `result.md` trong cùng thư mục subtask này, gồm:
- Diff/nội dung đã sửa ở 4 file.
- Kết quả `npm run build` và `npm run test` (pass/fail, số test).
- Ví dụ `ruleTrace` thực tế cho cả 3 setup (DDB, BB, RB) cho thấy dòng mới xuất hiện đúng.

Nếu bị chặn (ví dụ code đã đổi khác so với snapshot dòng số nêu trong task này), ghi `blocked.md` nêu
rõ chỗ khác biệt, không tự đoán sửa theo hướng khác.
