# Task 03 — Ẩn risks rỗng + đồng bộ giờ Việt Nam + humanize cache-key

3 fix độc lập, cùng trong `src/shared/telegram-volman.ts`. Làm cả 3 trong 1 lần sửa file này.

## Fix 1 — Ẩn "⚠️ Rủi ro cần lưu ý:" khi không có risk nào

### Bối cảnh

`buildRisks()` ([src/charts/signal-assembly.ts:69-96](../../../src/charts/signal-assembly.ts)) chỉ
điền `risks` khi `confidence < 70`. Signal có confidence ≥70% (vd 85%) → `risks = []`. Nhưng
`buildCopyableSetup()` ([src/shared/telegram-volman.ts:165-168](../../../src/shared/telegram-volman.ts))
LUÔN build `risksBlock` với header, kể cả khi mảng rỗng:

```ts
const risksBlock = [
  `⚠️ *Rủi ro cần lưu ý:*`,
  ...(setup.risks || []).map((r) => `  • ${r}`),
].join("\n");
```

→ `risksBlock` không rỗng (luôn có ít nhất dòng header) nên filter `.filter((block) => block !== "")`
ở cuối hàm (dòng 172-174) KHÔNG loại được nó → user thấy header trơ trọi không có bullet nào.

### Việc cần làm

Đổi đoạn dòng 165-168 thành:

```ts
const risksBlock =
  setup.risks && setup.risks.length > 0
    ? [`⚠️ *Rủi ro cần lưu ý:*`, ...setup.risks.map((r) => `  • ${r}`)].join("\n")
    : "";
```

Giữ nguyên phần cuối hàm dùng `.filter((block) => block !== "")` — với sửa này, risksBlock rỗng sẽ tự
động bị loại đúng như filter đã kỳ vọng.

## Fix 2 — Đồng bộ giờ Việt Nam cho candle close time

### Bối cảnh

Message có 2 timestamp khác timezone trong CÙNG 1 tin nhắn:
- Header `timestamp` (dòng 363-365): `new Date().toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })`.
- `formatCandleAge()` (dòng 27-53): hard-code UTC (`closeTime.getUTCHours()`, v.v.) và ghi rõ nhãn "UTC"
  trong output — vd `🕐 Nến gốc [M15] đóng: 20:00 13/07 UTC`.

User đọc thấy giờ UTC ("20:00") khác giờ VN (thực tế sẽ là 03:00 sáng hôm sau theo giờ VN, UTC+7) và
tưởng nhầm là bug giờ sai — vì phần lớn message khác đều theo giờ VN.

### Việc cần làm

Đổi `formatCandleAge()` (dòng 27-53) để hiển thị giờ đóng nến theo giờ Việt Nam thay vì UTC, dùng
`toLocaleString` với cùng timezone `Asia/Ho_Chi_Minh` như phần header, và đổi nhãn từ "UTC" thành
"giờ VN" để rõ ràng:

```ts
function formatCandleAge(timeframe: ChartTimeframe | undefined): string | null {
  const closeTimeMs = getCandleCloseTime(timeframe);
  if (!closeTimeMs) return null;

  const nowMs = Date.now();
  const minutesAgo = Math.floor((nowMs - closeTimeMs) / 60000);

  if (minutesAgo < 0) return null;

  const closeTime = new Date(closeTimeMs);
  const vnTimeStr = closeTime.toLocaleString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
    hour12: false,
  });

  return `🕐 Nến gốc [${timeframe}] đóng: ${vnTimeStr} giờ VN (${minutesAgo} phút trước)`;
}
```

Giữ nguyên `getCandleCloseTime()` (dòng 27-35) — nó tính đúng mốc thời điểm UTC epoch ms, chỉ có phần
FORMAT hiển thị cần đổi sang giờ VN. KHÔNG đổi logic tính `closeTimeMs`/`minutesAgo`.

Kiểm tra `toLocaleString` với các option trên trả về format mong muốn (vd "20:00, 14/07" tuỳ locale) —
nếu thứ tự/dấu phẩy khác ý muốn, có thể tự build chuỗi thủ công bằng `Intl.DateTimeFormat` với timeZone
`Asia/Ho_Chi_Minh` và lấy từng phần (hour/minute/day/month) tương tự cách `timestamp` header đang làm,
miễn là kết quả cuối cùng hiển thị ĐÚNG giờ Việt Nam (UTC+7), có nhãn rõ ràng, và giữ định dạng
"HH:mm dd/MM" nhất quán với style hiện tại của codebase.

## Fix 3 — Humanize cache-key trong dòng "từ cache"

### Bối cảnh

[src/shared/telegram-volman.ts:373-379](../../../src/shared/telegram-volman.ts):

```ts
const isCached = deliveryContext.source === "cached";
const sourceLabel = isCached ? " từ cache" : " từ thuật toán";
const cacheLine = isCached
  ? deliveryContext.candleKey
    ? `📦 Dữ liệu phân tích lấy từ cache của *last closed candle ${deliveryContext.candleKey}*`
    : "📦 Dữ liệu phân tích lấy từ cache"
  : "";
```

`deliveryContext.candleKey` là cache-key nội bộ dạng `"2026-07-13T20:00:deterministic:single:M15"`
(xem [src/charts/analyzer-common.ts:4-11](../../../src/charts/analyzer-common.ts) — format
`${candleKey}:${engineMode}:${timeframeMode}:${primaryTimeframe}`), in thẳng ra Telegram không qua xử
lý — user không hiểu "deterministic:single:M15" nghĩa là gì.

### Việc cần làm

Thêm hàm helper humanize candle key trước `sendAllAnalysesVolman` (gần `formatCandleAge`), chỉ lấy phần
ngày-giờ ở đầu chuỗi (trước dấu `:` đầu tiên theo sau bởi chữ, tức phần ISO-like `YYYY-MM-DDTHH:mm` hoặc
`YYYY-MM-DDTHH`), bỏ hậu tố engine/timeframe mode:

```ts
function humanizeCandleKey(candleKey: string): string {
  // candleKey format: "<ISO date/hour>:<engineMode>:<timeframeMode>[:<timeframe>]"
  // Chỉ lấy phần ISO date/hour đầu tiên, bỏ các hậu tố kỹ thuật nội bộ.
  const isoPart = candleKey.match(/^\d{4}-\d{2}-\d{2}T\d{2}(:\d{2})?/)?.[0];
  if (!isoPart) return candleKey;

  const isoWithMinutes = isoPart.length === 13 ? `${isoPart}:00` : isoPart;
  const date = new Date(`${isoWithMinutes}:00.000Z`);
  if (Number.isNaN(date.getTime())) return candleKey;

  return date.toLocaleString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
    hour12: false,
  });
}
```

Đổi dòng build `cacheLine` (377) để dùng hàm này:

```ts
const cacheLine = isCached
  ? deliveryContext.candleKey
    ? `📦 Dữ liệu phân tích lấy từ cache của nến đóng lúc *${humanizeCandleKey(deliveryContext.candleKey)} giờ VN*`
    : "📦 Dữ liệu phân tích lấy từ cache"
  : "";
```

Nếu parse thất bại (`isoPart` null hoặc `date` invalid), hàm trả về nguyên `candleKey` — KHÔNG throw,
đảm bảo message vẫn gửi được kể cả khi format cache-key thay đổi trong tương lai.

## Ràng buộc — KHÔNG được làm

- KHÔNG đổi logic quyết định cache hit/miss, KHÔNG đổi cấu trúc `candleKey` ở nơi khác (chỉ format lại
  khi hiển thị, giữ nguyên giá trị gốc dùng cho cache lookup).
- KHÔNG đổi `getCandleCloseTime()` — chỉ đổi phần format hiển thị của `formatCandleAge()`.
- KHÔNG đổi `buildRisks()` trong `signal-assembly.ts` — chỉ đổi cách `telegram-volman.ts` render khi
  risks rỗng.

## Verify

1. `npm run build` — pass.
2. `npm run test` — full suite pass. Nếu có test snapshot cứng cho `buildHeartbeatMessage`/
   `sendAllAnalysesVolman`/`buildCopyableSetup` chứa chuỗi giờ UTC cũ hoặc cache-key raw cũ, sửa
   assertion cho khớp format mới (kỳ vọng đúng).
3. Verify thủ công 3 case:
   - Setup confidence ≥70% (risks rỗng) → xác nhận Telegram message KHÔNG còn dòng
     "⚠️ Rủi ro cần lưu ý:" trơ trọi.
   - `formatCandleAge("M15")` → xác nhận output ghi rõ "giờ VN", giá trị giờ khớp UTC+7 (vd candle close
     UTC 20:00 → hiển thị 03:00 giờ VN ngày hôm sau, không phải 20:00).
   - `humanizeCandleKey("2026-07-13T20:00:deterministic:single:M15")` → xác nhận output là chuỗi ngày
     giờ đọc được (vd "03:00, 14/07"), không còn "deterministic:single:M15".

## Ghi kết quả

Ghi `result.md`: diff cho cả 3 fix, kết quả build/test, output thực tế của `formatCandleAge` và
`humanizeCandleKey` với input mẫu ở trên.
