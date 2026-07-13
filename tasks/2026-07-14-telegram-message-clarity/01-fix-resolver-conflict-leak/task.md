# Task 01 — Sửa resolver-conflict text rò vào entryCondition + reasons

## Bối cảnh

Khi 2 setup trùng pair xung đột, [src/charts/setup-resolver.ts:93-95](../../../src/charts/setup-resolver.ts)
push debug text thẳng vào `kept.ruleTrace`:

```ts
kept.ruleTrace.push(
  `[Resolver] Conflict: giu ${kept.setup}(conf=${kept.confidence}), bo ${dropped}`,
);
```

Vì đây là dòng CUỐI CÙNG được thêm vào `ruleTrace`, nó gây ra 2 hậu quả trong
[src/charts/signal-assembly.ts](../../../src/charts/signal-assembly.ts):

1. `entryCondition = translateRule(lastRule)` (dòng 120-121) lấy `ruleTrace[ruleTrace.length - 1]` —
   giờ là dòng resolver debug thay vì dòng entry thật (vd "Entry SHORT tại 3.52600..."). Dòng này hiển
   thị trong Telegram ở phần `🧭 *Lệnh:* ... — <entryCondition>`.
2. `reasons = ruleTrace.map(translateRule)` (dòng 114) — dòng resolver debug KHÔNG có template dịch
   nào khớp, hiện nguyên văn trong "✅ *Lý do vào lệnh:*".

Kết quả: user thấy `Resolver Conflict: giu ARB(conf=85), bo RB(conf=80)` xuất hiện 2 lần trong cùng
1 message Telegram — đây là thông tin nội bộ (debug), không có giá trị với người giao dịch.

## Việc cần làm

### `src/charts/setup-resolver.ts`

Thay vì push vào `kept.ruleTrace` (khiến nó lẫn vào dữ liệu user-facing), chỉ log qua logger nội bộ.
File hiện chưa import logger — thêm import và đổi đoạn code:

```ts
import { createLogger } from "../shared/logger.js";

const logger = createLogger("charts:setup-resolver");
```

Đặt import này ở đầu file, cùng nhóm với `import type { DetectedSignal, SetupKind } from "./setup-types.js";`.

Thay đoạn (dòng 89-96):

```ts
    // Log conflicts for debugging
    if (pairSignals.length > 1) {
      const kept = pairSignals[0];
      const dropped = pairSignals.slice(1).map((s) => `${s.setup}(conf=${s.confidence})`).join(", ");
      kept.ruleTrace.push(
        `[Resolver] Conflict: giu ${kept.setup}(conf=${kept.confidence}), bo ${dropped}`,
      );
    }
```

thành:

```ts
    // Log conflicts for debugging — KHONG push vao ruleTrace vi ruleTrace duoc dung
    // truc tiep de build entryCondition + reasons hien thi cho user (xem
    // signal-assembly.ts). Debug info nay chi phuc vu dev, khong lien quan quyet dinh
    // vao lenh cua user.
    if (pairSignals.length > 1) {
      const kept = pairSignals[0];
      const dropped = pairSignals.slice(1).map((s) => `${s.setup}(conf=${s.confidence})`).join(", ");
      logger.debug(
        `Conflict resolved for ${kept.pair}: giu ${kept.setup}(conf=${kept.confidence}), bo ${dropped}`,
      );
    }
```

Kiểm tra import path `../shared/logger.js` đúng — xác nhận file `src/shared/logger.ts` tồn tại và export
`createLogger` (đã dùng ở nhiều nơi khác, vd `src/shared/telegram-volman.ts:8`). Nếu path tương đối
sai (do vị trí `setup-resolver.ts` nằm trong `src/charts/`, cần `../shared/logger.js`), sửa lại cho đúng
theo cấu trúc thư mục thực tế.

## Ràng buộc — KHÔNG được làm

- KHÔNG đổi logic resolve conflict (sort, priority, tie-break) — chỉ đổi cách log.
- KHÔNG đổi `entryCondition`/`reasons` construction trong `signal-assembly.ts` — sau khi bỏ push vào
  ruleTrace, `entryCondition` sẽ TỰ ĐỘNG lấy đúng dòng cuối thật (vd "Entry SHORT tại...") mà không cần
  sửa gì thêm ở đó.
- KHÔNG đổi `DetectedSignal`/`TradeSetup` types.

## Verify

1. `npm run build` — pass.
2. `npm run test` — full suite pass. Đặc biệt chú ý `tests/charts/setups.test.ts` phần
   `describe("resolveSetupConflicts", ...)` (dòng ~438-492) — nếu có assertion kiểm tra
   `ruleTrace` chứa chuỗi `"[Resolver] Conflict"`, test đó cần sửa để thay vào đó verify qua
   logger (mock `createLogger`/`logger.debug`) hoặc đơn giản verify `ruleTrace` KHÔNG còn chứa dòng
   resolver debug nữa — đây là kỳ vọng đúng của thay đổi, không phải regression.
3. Verify thủ công: viết đoạn code chạy thử `resolveSetupConflicts()` với 2 signal cùng pair,
   confirm `kept.ruleTrace` không chứa dòng "Conflict" nào, và log debug xuất hiện qua logger.

## Ghi kết quả

Ghi `result.md` trong thư mục này: diff, kết quả build/test, ví dụ `ruleTrace` cuối cùng của 1 signal
sau conflict resolve (chứng minh entryCondition giờ lấy đúng dòng entry thật). Nếu bị chặn (path logger
sai, hoặc test có snapshot cứng không sửa được theo hướng trên), ghi `blocked.md`.
