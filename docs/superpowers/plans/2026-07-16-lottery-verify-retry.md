# Lottery verify retry window — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `runLotteryVerify` chỉ verify đúng ngày hôm nay, chạy 1 lần/ngày qua cron; nếu xoso.com.vn chưa có kết quả đúng lúc job chạy, dự đoán ngày đó `verified_at` sẽ mãi mãi là `null` (không ai retry lại vì lần verify hôm sau chỉ query "hôm nay" mới). Plan này mở query verify sang **khoảng ngày** (7 ngày gần nhất) để mỗi lần chạy tự động retry cả các ngày trước còn chưa verify được.

**Architecture:** Đổi `loadUnverifiedPredictions` trong `lottery-predictions-repository.ts` từ nhận đúng 1 `date` sang nhận khoảng `[sinceDateStr, uptoDateStr]`. Đổi `runLotteryVerify` để gom kết quả theo từng `date` riêng (vì mỗi ngày có thể khác `weekday`, cần gọi `fetchActualRecords` riêng cho từng ngày), verify ngày nào có kết quả, bỏ qua (để lần sau retry tiếp) ngày nào chưa có kết quả — không đổi logic match/verify từng prediction. Đồng thời thay hàm `vnToday()` viết tay (dùng pattern `toLocaleString` + `toISOString` đã biết có bug double-offset trên máy chạy giờ VN — xem comment trong `src/shared/vn-time.ts:4-6`) bằng `vnDateStr`/`vnDateOffsetStr` đã có sẵn, đúng và dùng chung toàn repo.

**Tech Stack:** TypeScript, Vitest, Supabase JS client (mock qua `getDb()`).

## Global Constraints

- Cửa sổ retry: **7 ngày gần nhất** kể cả hôm nay (`sinceDateStr = vnDateOffsetStr(-7)`, `uptoDateStr = vnDateOffsetStr(0)`), giá trị hằng số đặt tên `VERIFY_LOOKBACK_DAYS = 7` trong `lottery-verify-runner.ts`.
- Không đổi logic match prediction ↔ actual record (`matchPrizeLabel`, `matchPrizeLabelLast2`, `markPredictionVerified`) — chỉ đổi cách xác định **những ngày nào** cần verify trong 1 lần chạy.
- Không đổi bảng `lottery_predictions` schema, không thêm cột mới.
- Giữ nguyên hành vi khi chỉ có đúng 1 ngày cần verify và đã có kết quả (trường hợp phổ biến nhất) — nội dung Telegram message cho ngày đó phải giữ nguyên format cũ (không được đổi test snapshot của người dùng nếu có).
- Nếu **không có ngày nào** trong cửa sổ có kết quả sẵn sàng, gửi đúng 1 message tổng hợp (không gửi message trùng lặp mỗi ngày khi tất cả đều "chưa có kết quả").
- Dùng `vnDateStr`/`vnDateOffsetStr` từ `src/shared/vn-time.ts` thay cho pattern `toLocaleString` viết tay trong file bị sửa — không sửa các file khác đang dùng pattern cũ (ngoài scope).

---

### Task 1: Repository — `loadUnverifiedPredictions` nhận khoảng ngày

**Files:**
- Modify: `src/lottery/repository/lottery-predictions-repository.ts:63-73`
- Test: `tests/lottery/lottery-predictions-repository.test.ts` (file mới — chưa tồn tại)

**Interfaces:**
- Consumes: `getDb()` từ `src/shared/infra/db.js` (đã import sẵn trong file).
- Produces: `loadUnverifiedPredictions(sinceDateStr: string, uptoDateStr: string, region: LotteryRegion): Promise<PredictionRow[]>` — thay cho signature cũ `(date: string, region: LotteryRegion)`. `PredictionRow` giữ nguyên shape `{ date, weekday, region, number, rank }`. Kết quả sắp xếp theo `date ascending, rank ascending` (trước đây chỉ `rank ascending` vì luôn đúng 1 ngày).

- [ ] **Step 1: Viết failing test cho query mới**

Tạo file `tests/lottery/lottery-predictions-repository.test.ts`:

```typescript
import { beforeEach, describe, expect, test, vi } from "vitest";

const repoState = vi.hoisted(() => ({
  selectResult: { data: [] as unknown[], error: null as { message: string } | null },
  from: vi.fn(),
}));

vi.mock("../../src/shared/infra/db.js", () => ({
  getDb: () => ({ from: repoState.from }),
}));

const predictionsRepo = await import(
  "../../src/lottery/repository/lottery-predictions-repository.js"
);

describe("lottery-predictions-repository", () => {
  beforeEach(() => {
    repoState.from.mockReset();
    repoState.selectResult = { data: [], error: null };

    const chain: Record<string, ReturnType<typeof vi.fn>> = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      is: vi.fn(() => chain),
      gte: vi.fn(() => chain),
      lte: vi.fn(() => chain),
      order: vi.fn(() => chain),
      then: (resolve: (value: typeof repoState.selectResult) => unknown) =>
        Promise.resolve(repoState.selectResult).then(resolve),
    };

    repoState.from.mockReturnValue(chain);
  });

  describe("loadUnverifiedPredictions", () => {
    test("trả đúng rows khi query thành công, gồm nhiều ngày khác nhau", async () => {
      repoState.selectResult = {
        data: [
          { date: "2026-07-10", weekday: 5, region: "mien-nam", number: "123", rank: 1 },
          { date: "2026-07-16", weekday: 4, region: "mien-nam", number: "456", rank: 1 },
        ],
        error: null,
      };

      const result = await predictionsRepo.loadUnverifiedPredictions(
        "2026-07-09",
        "2026-07-16",
        "mien-nam",
      );

      expect(result).toEqual([
        { date: "2026-07-10", weekday: 5, region: "mien-nam", number: "123", rank: 1 },
        { date: "2026-07-16", weekday: 4, region: "mien-nam", number: "456", rank: 1 },
      ]);
    });

    test("trả mảng rỗng khi có lỗi", async () => {
      repoState.selectResult = { data: null as never, error: { message: "DB error" } };

      const result = await predictionsRepo.loadUnverifiedPredictions(
        "2026-07-09",
        "2026-07-16",
        "mien-nam",
      );

      expect(result).toEqual([]);
    });

    test("gọi đúng .eq/.is/.gte/.lte với tham số", async () => {
      await predictionsRepo.loadUnverifiedPredictions("2026-07-09", "2026-07-16", "mien-bac");

      const chain = repoState.from("lottery_predictions");
      expect(repoState.from).toHaveBeenCalledWith("lottery_predictions");
      expect(chain.select).toHaveBeenCalledWith("date, weekday, region, number, rank");
      expect(chain.eq).toHaveBeenCalledWith("region", "mien-bac");
      expect(chain.is).toHaveBeenCalledWith("verified_at", null);
      expect(chain.gte).toHaveBeenCalledWith("date", "2026-07-09");
      expect(chain.lte).toHaveBeenCalledWith("date", "2026-07-16");
    });
  });
});
```

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: `npx vitest run tests/lottery/lottery-predictions-repository.test.ts`
Expected: FAIL — `loadUnverifiedPredictions` hiện chỉ nhận 2 tham số `(date, region)`, gọi với 3 tham số `(sinceDateStr, uptoDateStr, region)` sẽ query sai field (`eq("date", uptoDateStr)` thay vì `gte`/`lte`) nên assertion về `chain.gte`/`chain.lte` không được gọi sẽ fail.

- [ ] **Step 3: Sửa `loadUnverifiedPredictions`**

Trong `src/lottery/repository/lottery-predictions-repository.ts`, thay đoạn (dòng 63-73):

```typescript
/** Lấy các dự đoán chưa được xác minh (`verified_at is null`) của đúng ngày + miền. */
export async function loadUnverifiedPredictions(date: string, region: LotteryRegion): Promise<PredictionRow[]> {
  const { data, error } = await (getDb().from("lottery_predictions") as any)
    .select("date, weekday, region, number, rank")
    .eq("date", date)
    .eq("region", region)
    .is("verified_at", null)
    .order("rank", { ascending: true });
  if (error || !data) return [];
  return data as PredictionRow[];
}
```

bằng:

```typescript
/** Lấy các dự đoán chưa được xác minh (`verified_at is null`) của 1 miền, trong khoảng
 * [sinceDateStr, uptoDateStr] (2 đầu inclusive) — dùng khoảng ngày thay vì đúng 1 ngày để
 * verify runner có thể tự retry các ngày trước đó nếu kết quả quay số hôm đó chưa kịp có
 * lúc job chạy lần đầu. */
export async function loadUnverifiedPredictions(
  sinceDateStr: string,
  uptoDateStr: string,
  region: LotteryRegion,
): Promise<PredictionRow[]> {
  const { data, error } = await (getDb().from("lottery_predictions") as any)
    .select("date, weekday, region, number, rank")
    .eq("region", region)
    .is("verified_at", null)
    .gte("date", sinceDateStr)
    .lte("date", uptoDateStr)
    .order("date", { ascending: true })
    .order("rank", { ascending: true })
    ;
  if (error || !data) return [];
  return data as PredictionRow[];
}
```

(Bỏ dấu `;` thừa ở cuối nếu editor tự format lại — chỉ cần đúng nội dung logic, không cần giữ style dòng trống đó.)

- [ ] **Step 4: Chạy lại test, xác nhận pass**

Run: `npx vitest run tests/lottery/lottery-predictions-repository.test.ts`
Expected: PASS (3/3 test)

- [ ] **Step 5: Build để xác nhận không còn caller nào dùng signature cũ ngoài phạm vi Task 2**

Run: `npm run build`
Expected: FAIL tại `src/lottery/controller/lottery-verify-runner.ts` (gọi `loadUnverifiedPredictions(dateStr, region)` — 2 tham số, sai với signature mới). Đây là kỳ vọng — sẽ được sửa ở Task 2. Ghi lại lỗi TypeScript chính xác (dòng, message) vào `result.md` để xác nhận đúng nguyên nhân trước khi sang Task 2, KHÔNG sửa `lottery-verify-runner.ts` trong task này.

- [ ] **Step 6: Commit**

```bash
git add src/lottery/repository/lottery-predictions-repository.ts tests/lottery/lottery-predictions-repository.test.ts
git commit -m "feat(lottery): loadUnverifiedPredictions nhận khoảng ngày thay vì đúng 1 ngày"
```

---

### Task 2: Verify runner — retry theo cửa sổ ngày + dùng `vn-time.ts`

**Files:**
- Modify: `src/lottery/controller/lottery-verify-runner.ts` (toàn bộ file, đặc biệt dòng 17-20 `vnToday()` và dòng 23-108 `runLotteryVerify`)
- Test: `tests/lottery/lottery-verify-runner.test.ts` (file mới — chưa tồn tại)

**Interfaces:**
- Consumes: `loadUnverifiedPredictions(sinceDateStr: string, uptoDateStr: string, region: LotteryRegion): Promise<PredictionRow[]>` (từ Task 1), `vnDateStr(unixMs: number): string` và `vnDateOffsetStr(offsetDays?: number, now?: number): string` từ `src/shared/vn-time.js`, `fetchActualRecords(region, dateStr, weekday)`, `appendWeekdayHistory(weekday, records)`, `matchPrizeLabel`/`matchPrizeLabelLast2`, `markPredictionVerified`, `sendMessage` — tất cả đã tồn tại, không đổi signature của chúng.
- Produces: `runLotteryVerify(region: LotteryRegion): Promise<void>` — signature không đổi, hành vi bên trong đổi (xem Global Constraints).

- [ ] **Step 1: Viết failing test cho happy path (1 ngày, có kết quả — giữ hành vi cũ)**

Tạo file `tests/lottery/lottery-verify-runner.test.ts`:

```typescript
import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  fetchActualRecords: vi.fn(),
  appendWeekdayHistory: vi.fn(async () => undefined),
  loadUnverifiedPredictions: vi.fn(),
  markPredictionVerified: vi.fn(async () => undefined),
  matchPrizeLabel: vi.fn(),
  matchPrizeLabelLast2: vi.fn(),
  sendMessage: vi.fn(async () => undefined),
}));

vi.mock("../../src/lottery/client/lottery-scraper.js", () => ({
  fetchActualRecords: state.fetchActualRecords,
}));
vi.mock("../../src/lottery/repository/lottery-repository.js", () => ({
  appendWeekdayHistory: state.appendWeekdayHistory,
}));
vi.mock("../../src/lottery/repository/lottery-predictions-repository.js", () => ({
  loadUnverifiedPredictions: state.loadUnverifiedPredictions,
  markPredictionVerified: state.markPredictionVerified,
}));
vi.mock("../../src/lottery/service/lottery-format.js", () => ({
  matchPrizeLabel: state.matchPrizeLabel,
  matchPrizeLabelLast2: state.matchPrizeLabelLast2,
}));
vi.mock("../../src/shared/notification/telegram-client.js", () => ({
  sendMessage: state.sendMessage,
}));

let runner: typeof import("../../src/lottery/controller/lottery-verify-runner.js");

beforeAll(async () => {
  runner = await import("../../src/lottery/controller/lottery-verify-runner.js");
});

const actualRecord = {
  date: "2026-07-16",
  weekday: 4,
  region: "mien-nam" as const,
  province: "TP.HCM",
  prizes: { db: "00123", g1: "00456", g2: [], g3: [], g4: [], g5: [], g6: [], g7: [], g8: [] },
};

describe("lottery/lottery-verify-runner", () => {
  beforeEach(() => {
    state.fetchActualRecords.mockReset();
    state.appendWeekdayHistory.mockClear();
    state.loadUnverifiedPredictions.mockReset();
    state.markPredictionVerified.mockClear();
    state.matchPrizeLabel.mockReset();
    state.matchPrizeLabelLast2.mockReset();
    state.sendMessage.mockClear();

    state.matchPrizeLabel.mockReturnValue(undefined);
    state.matchPrizeLabelLast2.mockReturnValue(undefined);
  });

  test("không có prediction nào trong cửa sổ — gửi message 'không có gì để verify', không gọi fetchActualRecords", async () => {
    state.loadUnverifiedPredictions.mockResolvedValue([]);

    await runner.runLotteryVerify("mien-nam");

    expect(state.fetchActualRecords).not.toHaveBeenCalled();
    expect(state.sendMessage).toHaveBeenCalledTimes(1);
    expect(String((state.sendMessage as any).mock.calls[0][0])).toContain("Không có dự đoán nào");
  });

  test("1 ngày, có kết quả — verify và gửi đúng 1 message như hành vi cũ", async () => {
    state.loadUnverifiedPredictions.mockResolvedValue([
      { date: "2026-07-16", weekday: 4, region: "mien-nam", number: "123", rank: 1 },
    ]);
    state.fetchActualRecords.mockResolvedValue([actualRecord]);
    state.matchPrizeLabel.mockImplementation((_prizes: unknown, number: string) =>
      number === "123" ? "Giải Đặc Biệt" : undefined,
    );

    await runner.runLotteryVerify("mien-nam");

    expect(state.fetchActualRecords).toHaveBeenCalledTimes(1);
    expect(state.fetchActualRecords).toHaveBeenCalledWith("mien-nam", "2026-07-16", 4);
    expect(state.appendWeekdayHistory).toHaveBeenCalledWith(4, [actualRecord]);
    expect(state.markPredictionVerified).toHaveBeenCalledWith(
      "2026-07-16",
      "mien-nam",
      "123",
      true,
      "TP.HCM",
      "Giải Đặc Biệt",
      false,
      undefined,
      undefined,
    );
    expect(state.sendMessage).toHaveBeenCalledTimes(1);
    expect(String((state.sendMessage as any).mock.calls[0][0])).toContain("TRÚNG");
  });

  test("2 ngày trong cửa sổ, chỉ 1 ngày có kết quả — verify ngày có kết quả, giữ nguyên ngày chưa có (retry lần sau)", async () => {
    state.loadUnverifiedPredictions.mockResolvedValue([
      { date: "2026-07-10", weekday: 5, region: "mien-nam", number: "111", rank: 1 },
      { date: "2026-07-16", weekday: 4, region: "mien-nam", number: "123", rank: 1 },
    ]);
    state.fetchActualRecords.mockImplementation(async (_region: string, dateStr: string) => {
      if (dateStr === "2026-07-10") return [];
      return [actualRecord];
    });

    await runner.runLotteryVerify("mien-nam");

    expect(state.fetchActualRecords).toHaveBeenCalledTimes(2);
    expect(state.fetchActualRecords).toHaveBeenCalledWith("mien-nam", "2026-07-10", 5);
    expect(state.fetchActualRecords).toHaveBeenCalledWith("mien-nam", "2026-07-16", 4);
    // Chỉ ngày 2026-07-16 được verify (có kết quả) — prediction "111" của 2026-07-10 KHÔNG bị mark verified
    expect(state.markPredictionVerified).toHaveBeenCalledTimes(1);
    expect(state.markPredictionVerified).toHaveBeenCalledWith(
      "2026-07-16",
      "mien-nam",
      "123",
      false,
      undefined,
      undefined,
      false,
      undefined,
      undefined,
    );
  });

  test("tất cả các ngày trong cửa sổ đều chưa có kết quả — gửi đúng 1 message tổng hợp, không lặp theo từng ngày", async () => {
    state.loadUnverifiedPredictions.mockResolvedValue([
      { date: "2026-07-10", weekday: 5, region: "mien-nam", number: "111", rank: 1 },
      { date: "2026-07-16", weekday: 4, region: "mien-nam", number: "123", rank: 1 },
    ]);
    state.fetchActualRecords.mockResolvedValue([]);

    await runner.runLotteryVerify("mien-nam");

    expect(state.markPredictionVerified).not.toHaveBeenCalled();
    expect(state.sendMessage).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: `npx vitest run tests/lottery/lottery-verify-runner.test.ts`
Expected: FAIL — `loadUnverifiedPredictions` mock được set nhưng runner hiện gọi `loadUnverifiedPredictions(dateStr, region)` (2 args, sai thứ tự với mock 3-arg mới), và runner hiện không loop theo nhiều ngày.

- [ ] **Step 3: Viết lại `lottery-verify-runner.ts`**

Thay toàn bộ nội dung file `src/lottery/controller/lottery-verify-runner.ts` bằng:

```typescript
import { fetchActualRecords } from "../client/lottery-scraper.js";
import { appendWeekdayHistory } from "../repository/lottery-repository.js";
import { matchPrizeLabel, matchPrizeLabelLast2 } from "../service/lottery-format.js";
import {
  loadUnverifiedPredictions,
  markPredictionVerified,
  type PredictionRow,
} from "../repository/lottery-predictions-repository.js";
import { WEEKDAY_LABELS } from "../service/lottery-schedule.js";
import { sendMessage } from "../../shared/notification/telegram-client.js";
import type { LotteryRegion } from "../model/lottery-types.js";
import { createLogger } from "../../shared/infra/logger.js";
import { vnDateStr, vnDateOffsetStr } from "../../shared/vn-time.js";

const logger = createLogger("lottery:lottery-verify-runner");
const REGION_LABELS: Record<LotteryRegion, string> = {
  "mien-bac": "🟦 Miền Bắc",
  "mien-trung": "🟨 Miền Trung",
  "mien-nam": "🟩 Miền Nam",
};

/** Số ngày lùi lại tối đa để retry verify — nếu xoso.com.vn chưa kịp có kết quả lúc job chạy
 * đúng ngày, các lần chạy sau (kể cả ngày khác) sẽ tự thử lại các ngày cũ còn `verified_at = null`
 * trong cửa sổ này, thay vì bỏ sót vĩnh viễn. */
const VERIFY_LOOKBACK_DAYS = 7;

function groupByDate(predictions: PredictionRow[]): Map<string, PredictionRow[]> {
  const grouped = new Map<string, PredictionRow[]>();
  for (const prediction of predictions) {
    const list = grouped.get(prediction.date) ?? [];
    list.push(prediction);
    grouped.set(prediction.date, list);
  }
  return grouped;
}

/** Verify các prediction của đúng 1 ngày (đã biết có actualRecords) — trả về các dòng message
 * để gộp vào báo cáo chung, và cập nhật `verified_at` cho từng prediction. */
async function verifyDateGroup(
  region: LotteryRegion,
  dateStr: string,
  weekday: number,
  predictions: PredictionRow[],
  actualRecords: Awaited<ReturnType<typeof fetchActualRecords>>,
): Promise<{ lines: string[]; hitCount: number; hit2Count: number }> {
  await appendWeekdayHistory(weekday, actualRecords);
  logger.info(`✓ [${region}] Đã lưu ${actualRecords.length} bản ghi kết quả thật vào lottery_draws cho ${dateStr}.`);

  const lines: string[] = [];
  let hitCount = 0;
  let hit2Count = 0;

  for (const prediction of predictions) {
    let matchedProvince: string | undefined;
    let matchedPrize: string | undefined;
    for (const record of actualRecords) {
      const label = matchPrizeLabel(record.prizes, prediction.number);
      if (label) {
        matchedProvince = record.province;
        matchedPrize = label;
        break;
      }
    }

    let matchedProvince2: string | undefined;
    let matchedPrize2: string | undefined;
    for (const record of actualRecords) {
      const label2 = matchPrizeLabelLast2(record.prizes, prediction.number);
      if (label2) {
        matchedProvince2 = record.province;
        matchedPrize2 = label2;
        break;
      }
    }

    const hit = matchedPrize !== undefined;
    const hit2 = matchedPrize2 !== undefined;
    await markPredictionVerified(
      dateStr,
      region,
      prediction.number,
      hit,
      matchedProvince,
      matchedPrize,
      hit2,
      matchedProvince2,
      matchedPrize2,
    );
    if (hit) hitCount++;
    if (hit2) hit2Count++;

    let detail: string;
    if (hit) {
      detail = `✅ TRÚNG${matchedPrize ? ` — ${matchedPrize}` : ""}${matchedProvince ? ` (${matchedProvince})` : ""}`;
    } else if (hit2) {
      detail = `🔸 Trúng 2 số cuối${matchedPrize2 ? ` — ${matchedPrize2}` : ""}${matchedProvince2 ? ` (${matchedProvince2})` : ""}`;
    } else {
      detail = "❌ Không trúng";
    }
    lines.push(`#${prediction.rank} \`${prediction.number}\`  —  ${detail}`);
    logger.info(`✓ [${prediction.number}] ${hit ? "TRÚNG" : hit2 ? "trúng 2 số cuối" : "không trúng"}`);
  }

  return { lines, hitCount, hit2Count };
}

/** Xác minh các dự đoán chưa verify trong `VERIFY_LOOKBACK_DAYS` ngày gần nhất của 1 miền bằng kết quả
 * scrape thật, lưu vào `lottery_draws`, báo Telegram. Ngày nào chưa có kết quả thật thì bỏ qua (giữ
 * `verified_at = null`) để lần chạy sau (dù là job của ngày khác) tự động retry lại — tránh sót vĩnh
 * viễn nếu xoso.com.vn cập nhật kết quả trễ. */
export async function runLotteryVerify(region: LotteryRegion): Promise<void> {
  const uptoDateStr = vnDateStr(Date.now());
  const sinceDateStr = vnDateOffsetStr(-VERIFY_LOOKBACK_DAYS);

  const predictions = await loadUnverifiedPredictions(sinceDateStr, uptoDateStr, region);
  if (predictions.length === 0) {
    logger.info(`✓ [${region}] Không có dự đoán nào cần xác minh trong ${sinceDateStr}..${uptoDateStr}.`);
    await sendMessage(
      `🔍 *DÒ KẾT QUẢ* — ${REGION_LABELS[region]}\n📅 ${sinceDateStr}..${uptoDateStr}\n\nKhông có dự đoán nào để xác minh.`,
    );
    return;
  }

  const grouped = groupByDate(predictions);
  const dates = [...grouped.keys()].sort();

  const messageBlocks: string[] = [];
  let totalHit = 0;
  let totalHit2 = 0;
  let totalVerified = 0;
  let anyPending = false;

  for (const dateStr of dates) {
    const datePredictions = grouped.get(dateStr)!;
    const weekday = datePredictions[0].weekday;
    const weekdayLabel = WEEKDAY_LABELS[weekday];

    const actualRecords = await fetchActualRecords(region, dateStr, weekday);
    if (actualRecords.length === 0) {
      logger.info(`✓ [${region}] Chưa có kết quả thật cho ${dateStr} — bỏ qua, lần chạy sau sẽ tự thử lại.`);
      anyPending = true;
      continue;
    }

    const { lines, hitCount, hit2Count } = await verifyDateGroup(
      region,
      dateStr,
      weekday,
      datePredictions,
      actualRecords,
    );
    totalHit += hitCount;
    totalHit2 += hit2Count;
    totalVerified += datePredictions.length;

    messageBlocks.push(
      [`📅 ${weekdayLabel}, ${dateStr}`, ...lines, `_Trúng đủ 3 số ${hitCount}/${datePredictions.length}, trúng 2 số cuối ${hit2Count}/${datePredictions.length}_`].join("\n"),
    );
  }

  if (messageBlocks.length === 0) {
    await sendMessage(
      `🔍 *DÒ KẾT QUẢ* — ${REGION_LABELS[region]}\n📅 ${sinceDateStr}..${uptoDateStr}\n\n⏳ Chưa có kết quả quay số nào sẵn sàng trên xoso.com.vn cho ${dates.length} ngày đang chờ — thử lại sau.`,
    );
    logger.info(`\n✅ Hoàn tất. Không có ngày nào có kết quả sẵn sàng (${dates.length} ngày đang chờ).`);
    return;
  }

  const lines: string[] = [`🔍 *DÒ KẾT QUẢ* — ${REGION_LABELS[region]}`, "", ...messageBlocks];
  if (anyPending) {
    lines.push("", "_⏳ Còn ngày khác chưa có kết quả, sẽ tự thử lại ở lần chạy sau._");
  }
  lines.push("", `*Tổng kết: trúng đủ 3 số ${totalHit}/${totalVerified}, trúng 2 số cuối ${totalHit2}/${totalVerified}*`);
  await sendMessage(lines.join("\n"));
  logger.info(`\n✅ Hoàn tất. Trúng đủ 3 số ${totalHit}/${totalVerified}, trúng 2 số cuối ${totalHit2}/${totalVerified}.`);
}
```

Lưu ý: `PredictionRow` cần export từ `lottery-predictions-repository.ts` (đã export sẵn — kiểm tra dòng `export type PredictionRow` vẫn còn nguyên sau Task 1, không cần đổi).

- [ ] **Step 4: Chạy lại test verify-runner, xác nhận pass**

Run: `npx vitest run tests/lottery/lottery-verify-runner.test.ts`
Expected: PASS (4/4 test)

- [ ] **Step 5: Build toàn bộ dự án**

Run: `npm run build`
Expected: PASS — không còn lỗi TypeScript nào (lỗi ở Task 1 Step 5 phải biến mất).

- [ ] **Step 6: Chạy toàn bộ test suite, xác nhận không có regression**

Run: `npm run test`
Expected: PASS toàn bộ (bao gồm 2 file test mới) — tổng số test phải là 793 (baseline trước plan này) + số test mới thêm ở Task 1 (3) + Task 2 (4) = 800.

- [ ] **Step 7: Commit**

```bash
git add src/lottery/controller/lottery-verify-runner.ts tests/lottery/lottery-verify-runner.test.ts
git commit -m "fix(lottery): verify runner tự retry các ngày chưa có kết quả trong 7 ngày gần nhất"
```

---

## Ghi chú ngoài scope (không làm trong plan này)

- Không đổi lịch cron trong `docker-compose.yml` — cửa sổ retry đã đủ để bù việc scrape trễ mà không cần đổi lịch.
- Không đổi `lottery-predict-resync-index.ts` hay `lottery-backfill-runner.ts` — chúng phục vụ mục đích khác (resync số theo rule mới, backfill lịch sử), không liên quan tới retry verify.
- Không audit lại các chỗ khác trong repo còn dùng pattern `toLocaleString`/`toISOString` viết tay thay vì `vn-time.ts` (ví dụ `lottery-predict-runner.ts:37-46`, `lottery-hit-rate-report.ts:29-34`) — ngoài phạm vi file đang sửa trong plan này.
