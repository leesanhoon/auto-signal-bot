# Chart Render Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sửa 2 lỗi render chart tín hiệu gửi Telegram: (1) label giá Entry/SL/TP bên phải bị cắt chữ ở mép ảnh, (2) đường pullback của setup FB vẽ từ điểm bắt đầu trend thay vì đoạn pullback thực tế.

**Architecture:** Cả 2 fix đều là thay đổi nhỏ, độc lập nhau. Fix 1 nằm trong SVG renderer (`setup-chart-renderer.ts`): nới `marginRight` từ 40px lên 110px để text label font-size 10 (~95px cho chuỗi dài nhất `Entry 64210.00000`) nằm trọn trong viewBox 900px. Fix 2 nằm trong detector FB (`fb.ts`): thêm helper thuần `findPullbackStartIndex` tìm nến cực trị của trend (đỉnh cao nhất cho LONG / đáy thấp nhất cho SHORT) trong khoảng `[trendStartIndex, index)`, rồi dùng nó làm điểm đầu của `geometry.lines[0]` thay cho `trendStartIndex`.

**Tech Stack:** TypeScript strict mode (ESM, import đuôi `.js`), vitest, arrow functions cho code mới (theo Code Standards). Test mirror cấu trúc `src/` dưới `tests/`.

## Global Constraints

- TypeScript strict mode — `npm run build` (tsc) phải pass, không dùng `any`.
- Test bằng vitest: `npm run test` (hoặc `npx vitest run <file>` cho từng file).
- KHÔNG auto-push. Commit từng task một, message tiếng Anh theo conventional commits (`fix:`, `test:`).
- Working tree hiện có sẵn thay đổi chưa commit ở `src/charts/deterministic-pipeline.ts`, `src/charts/setups/bb.ts`, `src/charts/setups/ddb.ts`, `tests/charts/deterministic-pipeline.test.ts` (việc khác, không liên quan) — chỉ `git add` đúng các file của task này, KHÔNG `git add -A`.
- Khi dispatch subagent qua Task tool: implementer dùng model `claude-haiku-4-5`, reviewer dùng `claude-sonnet-5` (Model Policy trong CLAUDE.md — không để trống field model).

---

### Task 1: Nới margin phải để label giá Entry/SL/TP không bị cắt

**Bối cảnh cho người không biết codebase:** `buildSetupChartSvg` vẽ chart SVG 900×500. Ba đường ngang Entry/SL/TP được vẽ từ `marginLeft` (40) tới `x2 = 900 - marginRight`, và label text đặt tại `x2 + 5` với font-size 10. Hiện `marginRight = 40` nên label bắt đầu ở x=865, chỉ còn 35px cho chuỗi dài ~95px (ví dụ `Entry 64210.00000` = 17 ký tự × ~5.6px Arial 10px) → chữ bị cắt ở mép phải trên MỌI chart production. Fix: `marginRight` 40 → 110 (label bắt đầu ở x=795, còn 105px ≥ 95px cần thiết). Vùng vẽ nến hẹp lại 70px — chấp nhận được, không đổi hành vi nào khác.

**Files:**
- Modify: `src/charts/setup-chart-renderer.ts:53` (hàm `buildCoordMap`, dòng `const marginRight = 40;`)
- Test: `tests/charts/setup-chart-renderer.test.ts`

**Interfaces:**
- Consumes: `buildSetupChartSvg(input: SetupChartInput): string` (đã tồn tại, không đổi signature).
- Produces: không có API mới — chỉ đổi hằng số layout bên trong `buildCoordMap`. Task 2 không phụ thuộc task này.

- [ ] **Step 1: Viết failing test**

Thêm test sau vào cuối `describe("buildSetupChartSvg", ...)` trong `tests/charts/setup-chart-renderer.test.ts` (sau test `"omits the live price line when livePrice is not provided"`, trước dấu đóng `});` của describe đó):

```ts
    test("label giá Entry/SL/TP bên phải có đủ chỗ ngang, không bị cắt ở mép 900px", () => {
      const candles = buildTrendingCandles(25);
      const ma21 = calculateEma(candles, 21);
      const svg = buildSetupChartSvg({
        pair: "BTC/USDT",
        setup: "BB",
        direction: "LONG",
        entry: 64210,
        stopLoss: 64020,
        takeProfit: 64590,
        chartContext: {
          candles,
          ma21,
          triggerIndex: 24,
          sliceStartIndex: 0,
        },
      });

      // Bắt đúng 3 label Entry (vàng #FFFF00), SL (đỏ #FF0000), TP (xanh #00AA00)
      const labelMatches = [
        ...svg.matchAll(
          /<text x="([\d.]+)" y="[\d.-]+" font-size="10" fill="(#FFFF00|#FF0000|#00AA00)">/g,
        ),
      ];
      expect(labelMatches).toHaveLength(3);

      for (const match of labelMatches) {
        const x = Number(match[1]);
        // Chuỗi dài nhất "Entry 64210.00000" = 17 ký tự × ~5.6px (Arial 10px) ≈ 95px.
        // Yêu cầu tối thiểu 100px từ vị trí label tới mép phải 900px.
        expect(900 - x).toBeGreaterThanOrEqual(100);
      }
    });
```

- [ ] **Step 2: Chạy test xác nhận FAIL**

Run: `npx vitest run tests/charts/setup-chart-renderer.test.ts -t "không bị cắt"`
Expected: FAIL — `expected 35 to be greater than or equal to 100` (label hiện ở x=865, tức `900 - 40 + 5`).

- [ ] **Step 3: Sửa marginRight trong buildCoordMap**

Trong `src/charts/setup-chart-renderer.ts`, hàm `buildCoordMap` (dòng ~53), đổi:

```ts
  const marginRight = 40;
```

thành:

```ts
  // 110px để label giá bên phải (font-size 10, dài nhất ~"Entry 64210.00000" ≈ 95px)
  // nằm trọn trong viewBox 900px — 40px cũ làm chữ bị cắt ở mép phải.
  const marginRight = 110;
```

KHÔNG đổi gì khác — `chartWidth` đã tự tính lại từ `marginRight` (`900 - marginLeft - marginRight`), các label vẫn vẽ tại `x2 + 5`.

- [ ] **Step 4: Chạy toàn bộ test file renderer xác nhận PASS**

Run: `npx vitest run tests/charts/setup-chart-renderer.test.ts`
Expected: PASS toàn bộ (test mới + các test cũ — không test cũ nào assert vị trí x của label nên không có regression).

- [ ] **Step 5: Build + full test**

Run: `npm run build`
Expected: exit 0, không lỗi tsc.

Run: `npm run test`
Expected: PASS toàn bộ suite.

- [ ] **Step 6: Commit**

```bash
git add src/charts/setup-chart-renderer.ts tests/charts/setup-chart-renderer.test.ts
git commit -m "fix: widen chart right margin so Entry/SL/TP price labels are not clipped"
```

---

### Task 2: FB vẽ đường pullback từ cực trị trend thay vì điểm bắt đầu trend

**Bối cảnh cho người không biết codebase:** Detector FB (`src/charts/setups/fb.ts`) phát hiện "First Break" — pullback hài hòa đầu tiên về EMA21 của một trend mới. Khi trả tín hiệu, nó kèm `geometry.lines` để renderer vẽ đường pullback đứt nét lên chart. Hiện tại (dòng 150-159) đường này nối từ `trendStartIndex` (nến BẮT ĐẦU trend) tới nến hiện tại — tức vẽ đè lên toàn bộ con sóng trend, trong khi pullback thật chỉ là đoạn từ CỰC TRỊ của trend (đỉnh cao nhất với LONG, đáy thấp nhất với SHORT) về nến chạm EMA21 hiện tại. Fix: thêm helper thuần `findPullbackStartIndex` (export để test trực tiếp — điều kiện kích hoạt `detectFb` rất chặt, không fixture unit test full-detector được một cách tin cậy) và dùng nó cho điểm đầu của line.

**Files:**
- Modify: `src/charts/setups/fb.ts` (thêm helper export + sửa khối `geometry` dòng 147-165)
- Test: `tests/charts/setups.test.ts` (thêm describe mới cho helper, sau describe `"FB — First Break"` hiện có ở dòng ~113-129)

**Interfaces:**
- Consumes: type `Candle` từ `../ohlc-provider.js` (fields: `time, open, high, low, close, volume` — đều `number`).
- Produces: `export const findPullbackStartIndex = (candles: Candle[], trendStartIndex: number, index: number, direction: "LONG" | "SHORT"): number` — trả index của nến cực trị trend trong `[trendStartIndex, index)`; khi nhiều nến bằng nhau chọn nến MUỘN nhất (gần pullback nhất). Chỉ `fb.ts` và test dùng — không task nào khác phụ thuộc.

- [ ] **Step 1: Viết failing tests cho helper**

Trong `tests/charts/setups.test.ts`, thêm import `findPullbackStartIndex` vào dòng import FB hiện có (dòng 9):

```ts
import { detectFb, findPullbackStartIndex } from "../../src/charts/setups/fb.js";
```

Rồi thêm describe mới ngay SAU describe `"FB — First Break"` (sau dòng 129, trước comment block setup kế tiếp):

```ts
describe("FB — findPullbackStartIndex", () => {
  const mkHL = (prices: Array<{ h: number; l: number }>): Candle[] =>
    prices.map((p, i) => ({
      time: 1700000000000 + i * 3600000,
      open: (p.h + p.l) / 2,
      high: p.h,
      low: p.l,
      close: (p.h + p.l) / 2,
      volume: 100,
    }));

  test("LONG: trả index nến có high cao nhất trong [trendStartIndex, index)", () => {
    // Trend lên đạt đỉnh tại index 3 (high 106), rồi pullback xuống về index 5
    const candles = mkHL([
      { h: 101, l: 100 }, // 0
      { h: 103, l: 101 }, // 1
      { h: 105, l: 103 }, // 2
      { h: 106, l: 104 }, // 3 ← đỉnh trend
      { h: 104, l: 102 }, // 4 pullback
      { h: 103, l: 101 }, // 5 ← nến tín hiệu (index)
    ]);
    expect(findPullbackStartIndex(candles, 0, 5, "LONG")).toBe(3);
  });

  test("SHORT: trả index nến có low thấp nhất trong [trendStartIndex, index)", () => {
    const candles = mkHL([
      { h: 106, l: 105 }, // 0
      { h: 104, l: 103 }, // 1
      { h: 102, l: 100 }, // 2 ← đáy trend
      { h: 103, l: 101 }, // 3 pullback lên
      { h: 104, l: 102 }, // 4 ← nến tín hiệu
    ]);
    expect(findPullbackStartIndex(candles, 0, 4, "SHORT")).toBe(2);
  });

  test("nhiều nến cùng cực trị: chọn nến muộn nhất (gần pullback nhất)", () => {
    const candles = mkHL([
      { h: 106, l: 104 }, // 0 high 106
      { h: 106, l: 104 }, // 1 high 106 (bằng) ← phải chọn nến này
      { h: 104, l: 102 }, // 2
      { h: 103, l: 101 }, // 3 ← nến tín hiệu
    ]);
    expect(findPullbackStartIndex(candles, 0, 3, "LONG")).toBe(1);
  });

  test("không quét nến tín hiệu (index) — cực trị chỉ tìm trong [trendStartIndex, index)", () => {
    // Nến tín hiệu (index 2) có high cao nhất nhưng KHÔNG được chọn
    const candles = mkHL([
      { h: 104, l: 102 }, // 0 ← cực trị hợp lệ
      { h: 103, l: 101 }, // 1
      { h: 110, l: 100 }, // 2 ← nến tín hiệu, high cao nhất nhưng ngoài phạm vi quét
    ]);
    expect(findPullbackStartIndex(candles, 0, 2, "LONG")).toBe(0);
  });
});
```

- [ ] **Step 2: Chạy test xác nhận FAIL**

Run: `npx vitest run tests/charts/setups.test.ts -t "findPullbackStartIndex"`
Expected: FAIL — `findPullbackStartIndex` chưa được export (`SyntaxError` hoặc `undefined is not a function`).

- [ ] **Step 3: Thêm helper + sửa geometry trong fb.ts**

Trong `src/charts/setups/fb.ts`, thêm helper ngay TRƯỚC `export function detectFb(` (sau block comment dòng 6-10):

```ts
/**
 * Tìm điểm bắt đầu pullback: nến cực trị của trend (đỉnh cao nhất với LONG,
 * đáy thấp nhất với SHORT) trong [trendStartIndex, index). Nhiều nến bằng nhau
 * → chọn nến muộn nhất (gần pullback nhất). Export để unit test trực tiếp —
 * điều kiện kích hoạt detectFb quá chặt để fixture full-detector tin cậy.
 */
export const findPullbackStartIndex = (
  candles: Candle[],
  trendStartIndex: number,
  index: number,
  direction: "LONG" | "SHORT",
): number => {
  let extremeIndex = trendStartIndex;
  for (let i = trendStartIndex; i < index; i++) {
    if (direction === "LONG") {
      if (candles[i].high >= candles[extremeIndex].high) extremeIndex = i;
    } else {
      if (candles[i].low <= candles[extremeIndex].low) extremeIndex = i;
    }
  }
  return extremeIndex;
};
```

Rồi sửa khối `geometry` (hiện ở dòng 147-165). Thay:

```ts
  const geometry: SetupChartGeometry = {
    boxes: [],
    markers: [],
    lines: [
      {
        points: [
          { index: trendStartIndex, price: candles[trendStartIndex].close },
          { index, price: candles[index].close },
        ],
        label: "Pullback",
        style: "pullback",
      },
    ],
```

bằng:

```ts
  // Đường pullback vẽ từ CỰC TRỊ trend (đỉnh/đáy) về nến chạm EMA21, không phải
  // từ điểm bắt đầu trend — trước đây line đè lên toàn bộ con sóng trend.
  const pullbackStartIndex = findPullbackStartIndex(candles, trendStartIndex, index, direction);
  const pullbackStartPrice =
    direction === "LONG" ? candles[pullbackStartIndex].high : candles[pullbackStartIndex].low;

  const geometry: SetupChartGeometry = {
    boxes: [],
    markers: [],
    lines: [
      {
        points: [
          { index: pullbackStartIndex, price: pullbackStartPrice },
          { index, price: candles[index].close },
        ],
        label: "Pullback",
        style: "pullback",
      },
    ],
```

Phần còn lại của `geometry` (`patternLabel`) và `return` giữ nguyên.

- [ ] **Step 4: Chạy test xác nhận PASS**

Run: `npx vitest run tests/charts/setups.test.ts`
Expected: PASS toàn bộ (4 test mới + test cũ; 2 test FB cũ chỉ assert `signal === null || setup === "FB"` nên không regression).

- [ ] **Step 5: Build + full test**

Run: `npm run build`
Expected: exit 0.

Run: `npm run test`
Expected: PASS toàn bộ suite.

- [ ] **Step 6: Commit**

```bash
git add src/charts/setups/fb.ts tests/charts/setups.test.ts
git commit -m "fix: FB pullback line starts at trend extreme instead of trend start"
```

---

### Task 3: Xác minh trực quan bằng chart mẫu gửi Telegram

**Bối cảnh:** Repo có sẵn 2 script demo dựng chart mẫu bằng nến tổng hợp và gửi vào Telegram qua đúng renderer + Telegram client production: `src/scripts/send-sample-chart.ts` (BB) và `src/scripts/send-sample-charts-all.ts` (RB/ARB/IRB/FB/SB/DDB). Sau 2 fix trên, chạy lại để xác minh bằng mắt: label giá bên phải hiển thị đủ chữ. Lưu ý: mẫu FB trong script tự dựng geometry (line từ index 15) — nó KHÔNG đi qua `detectFb` nên không phản ánh fix 2; sửa 2 điểm đầu line của mẫu FB cho khớp hành vi mới.

**Files:**
- Modify: `src/scripts/send-sample-charts-all.ts` (hàm `buildFbShort` — điểm đầu line pullback)

**Interfaces:**
- Consumes: `renderSetupChartsBatch`, `telegramNotifier` (đã tồn tại). Cần env `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` (đã có sẵn trong `.env` — script tự load qua `../shared/env.js`).
- Produces: không có — task xác minh, chỉ sửa dữ liệu mẫu demo.

- [ ] **Step 1: Cập nhật mẫu FB theo hành vi mới**

Trong `src/scripts/send-sample-charts-all.ts`, hàm `buildFbShort`, khối `lines`. Trend giảm của mẫu bắt đầu tại nến 15 nhưng ĐÁY (cực trị) trước pullback là nến 24 (`closes` chạm 63960 tại vòng lặp thứ ba), pullback hồi lên tới nến 30, break tại 31. Thay:

```ts
    lines: [
      {
        points: [
          { index: 15, price: candles[15].close },
          { index: 31, price: candles[31].close },
        ],
        label: "Pullback",
        style: "pullback",
      },
    ],
```

bằng:

```ts
    lines: [
      {
        points: [
          // Từ cực trị trend (đáy nến 24) về nến break — khớp hành vi mới của fb.ts
          { index: 24, price: candles[24].low },
          { index: 31, price: candles[31].close },
        ],
        label: "Pullback",
        style: "pullback",
      },
    ],
```

- [ ] **Step 2: Chạy 2 script gửi chart mẫu**

Run: `npx tsx src/scripts/send-sample-chart.ts`
Expected: stdout `Đã lưu sample-chart-bb-long.png ... Xong — kiểm tra Telegram.` không lỗi.

Run: `npx tsx src/scripts/send-sample-charts-all.ts`
Expected: stdout `Đã lưu` cho đủ 6 file PNG, không dòng `Render thất bại`.

- [ ] **Step 3: Kiểm tra bằng mắt các PNG vừa tạo**

Mở (hoặc đọc bằng tool xem ảnh) `sample-chart-bb-long.png` và `sample-chart-fb-short.png` ở repo root, xác nhận:
- Label `Entry ...`, `SL ...`, `TP ...` bên phải hiển thị TRỌN VẸN chữ và số (không cắt ở mép phải).
- Chart FB: đường pullback đứt xám chỉ nối từ vùng đáy (nến 24) lên nến break — không còn kéo dài đè lên toàn bộ đoạn trend giảm.

Expected: cả 2 điều kiện đạt. Nếu label vẫn cắt → quay lại Task 1 kiểm tra `marginRight`.

- [ ] **Step 4: Commit**

```bash
git add src/scripts/send-sample-charts-all.ts
git commit -m "chore: align FB sample chart pullback line with new fb.ts geometry"
```

---

## Self-Review

1. **Spec coverage:** Lỗi label cắt → Task 1 (margin 110 + test khoảng cách ≥100px). Lỗi FB pullback line → Task 2 (helper + geometry). Xác minh trực quan end-to-end → Task 3. Đủ.
2. **Placeholder scan:** Không có TBD/TODO; mọi step code đều có code đầy đủ, mọi lệnh có expected output.
3. **Type consistency:** `findPullbackStartIndex(candles: Candle[], trendStartIndex: number, index: number, direction: "LONG" | "SHORT"): number` — nhất quán giữa Task 2 Step 1 (test import), Step 3 (implementation) và Interfaces. `Candle` đã được import sẵn ở cả `fb.ts` (dòng 1) và `tests/charts/setups.test.ts` (dòng 2).
