# Chuẩn Hóa Tiếng Việt Cho Tin Nhắn Telegram Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Chuẩn hóa các tin nhắn gửi lên Telegram sang tiếng Việt có dấu, tự nhiên và nhất quán, đặc biệt ở luồng Match Odds/OpenRouter và các thông báo hệ thống liên quan.

**Architecture:** Giữ nguyên kiến trúc hiện tại: các hàm format message tiếp tục nằm gần domain đang dùng chúng (`betting`, `shared`, `charts`). Không thêm dependency hoặc cơ chế “khôi phục dấu” tự động vì không đáng tin cậy; thay vào đó chuẩn hóa toàn bộ chuỗi tĩnh, fallback, prompt AI và test expectation. Với nội dung do AI sinh ra, tăng ràng buộc prompt để yêu cầu tiếng Việt có dấu; với nội dung do code sinh ra, sửa trực tiếp tại nguồn format.

**Tech Stack:** TypeScript ESM, Vitest, Telegram Markdown parse mode, OpenRouter prompt JSON output.

---

## Current Context / Findings

Qua kiểm tra repo:

- `src/betting/odds-runner.ts` có nhiều tin nhắn Telegram không dấu: `Khong co tran nao...`, `Lay du lieu that bai...`, `chua duoc cau hinh...`, `thieu OPENROUTER_API_KEY`, v.v.
- `src/betting/odds-text-format.ts` còn các dòng hiển thị không dấu:
  - `Chap`, `Tai/Xiu` ở summary kèo.
  - `_AI tam thoi chua phan tich duoc tran nay..._`.
  - `*Du lieu odds tho:*`.
- `src/betting/betting-gemini.ts` dùng prompt tiếng Việt không dấu, fallback parse/fallback cũng không dấu; điều này làm AI dễ trả về tiếng Việt không dấu.
- `src/shared/telegram.ts` có `buildPerformanceReportMessage()` còn không dấu: `Lenh dong`, `Tong R thuc te`, `Theo cap tien`, `Khong co lenh dong...`, v.v.
- `src/shared/ai-usage.ts` có alert Telegram bằng tiếng Anh: `AI usage alert`, `Requests`, `Tokens`, `By provider`, `By source`.
- Tests hiện tại còn assert các text không dấu ở `tests/betting/odds-text-format.test.ts` và `tests/shared/ai-usage.test.ts`.

Assumption: “tele” nghĩa là Telegram; phạm vi là các tin nhắn gửi qua `sendMessage()`/formatter, không phải log nội bộ `logger.info/warn` trừ khi chuỗi đó cũng được đưa vào Telegram.

## Proposed Approach

1. Chuẩn hóa các chuỗi Telegram tĩnh bằng tiếng Việt có dấu ngay tại các formatter/runner.
2. Chuẩn hóa prompt OpenRouter sang tiếng Việt có dấu, đồng thời thêm quy tắc rõ: mọi field text trong JSON phải là tiếng Việt có dấu, không dùng kiểu không dấu như `Dung ngoai`, `Khong co...`.
3. Giữ các mã thuật ngữ domain ngắn khi hợp lý (`H2H`, `GG/NG`, `AI`, `OpenRouter`, `TP1`, `SL`, `Win-rate`) nhưng phần câu chữ tiếng Việt phải có dấu.
4. Cập nhật tests để khóa hành vi mới và tránh regressions.
5. Chạy test/build để xác nhận.

## Style Guide For This Change

- Dùng “Trận”, “kèo”, “dữ liệu”, “chưa”, “đã”, “được”, “thiếu”, “cấu hình”, “tạm thời”, “phân tích”, “tỷ số”, “chấp”, “tài/xỉu”.
- Giữ thuật ngữ chuyên môn phổ biến:
  - `Match Odds`, `OpenRouter`, `AI`, `raw odds`, `fallback`, `verify`, `confidence` có thể giữ nếu đang là label kỹ thuật.
  - Với nhãn gửi người dùng, ưu tiên Việt hóa: `Verify` → `Thẩm định` hoặc `Kiểm tra`, `raw odds` → `dữ liệu odds thô`.
- Không thay đổi logic chọn kèo, xác minh, lưu database hoặc gọi Telegram.
- Không cố sửa tên biến/code identifier trừ khi cần cho readability; chỉ sửa text hiển thị/prompt/test.

---

## Step-by-Step Plan

### Task 1: Add failing tests for Match Odds Vietnamese output

**Objective:** Khóa các chuỗi Telegram của Match Odds phải có dấu và không còn các câu không dấu phổ biến.

**Files:**
- Modify: `tests/betting/odds-text-format.test.ts`
- Test target: `tests/betting/odds-text-format.test.ts`

**Step 1: Extend existing fallback/data message coverage**

Add a new test under `describe("formatMatchAnalysisMessage", ...)` or create a sibling `describe("odds Telegram messages", ...)` in the same file.

Test should import already available functions from `../../src/betting/odds-text-format.js`:

- `formatMainOddsSummary`
- `formatOddsFallbackMessage`
- `formatOddsDataMessage`

Use a minimal `MatchOddsPayload` with:

```ts
const payload: MatchOddsPayload = {
  gameId: "1",
  home: "Việt Nam",
  away: "Thái Lan",
  kickoffUnix: 0,
  odds: {
    updatedUnix: 0,
    legend: "",
    markets: [
      {
        key: "asia_handicap",
        outcomes: [
          { name: "H", point: -0.25, price: 1.91 },
          { name: "A", point: -0.25, price: 1.99 },
        ],
      },
      {
        key: "asia_totals",
        outcomes: [
          { name: "Over", point: 2.5, price: 1.87 },
          { name: "Under", point: 2.5, price: 2.01 },
        ],
      },
    ],
  },
};
```

Assertions:

```ts
expect(formatMainOddsSummary(payload)).toContain("Chấp -0.25");
expect(formatMainOddsSummary(payload)).toContain("Tài/Xỉu 2.5");

const fallback = formatOddsFallbackMessage(payload, "thiếu OPENROUTER_API_KEY");
expect(fallback).toContain("AI tạm thời chưa phân tích được trận này");
expect(fallback).not.toContain("tam thoi");
expect(fallback).not.toContain("tran nay");

const dataMessage = formatOddsDataMessage(payload);
expect(dataMessage).toContain("Dữ liệu odds thô");
expect(dataMessage).not.toContain("Du lieu odds tho");
```

**Step 2: Update existing tests that expect unaccented output**

In `tests/betting/odds-text-format.test.ts` update existing expectations:

- `expect(message).toContain("🔄 *Verify:* đã hiệu chỉnh")` should become the chosen standardized label, e.g. `expect(message).toContain("🔄 *Thẩm định:* đã hiệu chỉnh")`.
- `expect(message).toContain("⚠️ *Verify:* lỗi model")` should become `expect(message).toContain("⚠️ *Thẩm định:* lỗi model")`.
- Test data fields like `recommendation: "Dung ngoai"`, `keyPoints: ["Odds chu nha nhinh hon."]` may remain as synthetic AI input if the display formatter still handles unaccented AI text; do not overfit by changing all fixture values unless assertions require it.

**Step 3: Run failing test**

Run:

```bash
npm run test -- tests/betting/odds-text-format.test.ts
```

Expected before implementation: FAIL because current output contains `Chap`, `Tai/Xiu`, `AI tam thoi...`, `Du lieu odds tho`, and `Verify`.

**Acceptance Criteria:**

- [ ] New tests fail before implementation for the expected text reasons.
- [ ] Tests clearly assert accented Telegram output.
- [ ] No production code changed in this task.

---

### Task 2: Standardize Match Odds formatter strings

**Objective:** Sửa các chuỗi Telegram trong formatter Match Odds sang tiếng Việt có dấu.

**Files:**
- Modify: `src/betting/odds-text-format.ts`
- Test: `tests/betting/odds-text-format.test.ts`

**Step 1: Update display labels in `src/betting/odds-text-format.ts`**

Make these exact semantic replacements:

- In `mainHandicapText()`:
  - From: `` `Chap ${fmtSignedPoint(point)}: ${h.price}/${a.price}` ``
  - To: `` `Chấp ${fmtSignedPoint(point)}: ${h.price}/${a.price}` ``

- In `mainTotalText()`:
  - From: `` `Tai/Xiu ${fmtNum(point)}: ${over.price}/${under.price}` ``
  - To: `` `Tài/Xỉu ${fmtNum(point)}: ${over.price}/${under.price}` ``

- In `formatMatchAnalysisMessage()` `verifyLabel`:
  - `✅ *Verify:* đạt` → `✅ *Thẩm định:* đạt`
  - `🔄 *Verify:* đã hiệu chỉnh` → `🔄 *Thẩm định:* đã hiệu chỉnh`
  - `⚠️ *Verify:* lỗi model` → `⚠️ *Thẩm định:* lỗi model`
  - `⚪ *Verify:* chưa chạy` → `⚪ *Thẩm định:* chưa chạy`

- In `formatOddsFallbackMessage()`:
  - From: `_AI tam thoi chua phan tich duoc tran nay: ${reason}_`
  - To: `_AI tạm thời chưa phân tích được trận này: ${reason}_`

- In `formatOddsDataMessage()`:
  - From: `*Du lieu odds tho:*`
  - To: `*Dữ liệu odds thô:*`

**Step 2: Run focused tests**

Run:

```bash
npm run test -- tests/betting/odds-text-format.test.ts
```

Expected: PASS.

**Acceptance Criteria:**

- [ ] All modified formatter strings are accented.
- [ ] Existing Markdown formatting is preserved.
- [ ] Focused odds formatter tests pass.

---

### Task 3: Standardize Match Odds runner Telegram status messages

**Objective:** Sửa các tin nhắn trực tiếp gửi qua Telegram trong `runOddsCheck()` sang tiếng Việt có dấu.

**Files:**
- Modify: `src/betting/odds-runner.ts`
- Optional Test: if existing runner tests are absent, verify by TypeScript build.

**Step 1: Replace Telegram-facing strings only**

In `src/betting/odds-runner.ts`, update strings passed to `sendMessage()` or reason strings that are included in `sendMessage()`:

- Line with no upcoming matches:
  - From: `⏸ [${LABEL}] Khong co tran nao sap toi trong DB - hay chay lai fetch-matches-list.`
  - To: `⏸ [${LABEL}] Không có trận nào sắp tới trong DB — hãy chạy lại fetch-matches-list.`

- Failure list summary:
  - From: `⚠️ [${LABEL}] Lay du lieu that bai cho ${failures.length} tran (da bo qua):\n${failedList}`
  - To: `⚠️ [${LABEL}] Lấy dữ liệu thất bại cho ${failures.length} trận (đã bỏ qua):\n${failedList}`

- Payload status header:
  - From: `🏆 *[${LABEL}] ${payload.length} tran lay duoc keo* (ngay ${matches[0].date}):\n\n`
  - To: `🏆 *[${LABEL}] ${payload.length} trận lấy được kèo* (ngày ${matches[0].date}):\n\n`

- Empty payload status:
  - From: `⏸ [${LABEL}] ${matches.length} tran ngay ${matches[0].date}, nhung khong lay duoc keo tran nao.`
  - To: `⏸ [${LABEL}] ${matches.length} trận ngày ${matches[0].date}, nhưng không lấy được kèo trận nào.`

- Missing OpenRouter key:
  - From: `⚠️ [${LABEL}] OPENROUTER_API_KEY chua duoc cau hinh - se gui raw odds cho tung tran.`
  - To: `⚠️ [${LABEL}] OPENROUTER_API_KEY chưa được cấu hình — sẽ gửi dữ liệu odds thô cho từng trận.`

- Fallback reason:
  - From: `thieu OPENROUTER_API_KEY`
  - To: `thiếu OPENROUTER_API_KEY`

- Revised verification comment assigned to `analysis.verifiedComment`:
  - From: `Nhan dinh da duoc dieu chinh sau khi bi tu choi: ${verification.comment}`
  - To: `Nhận định đã được điều chỉnh sau khi bị từ chối: ${verification.comment}`

**Step 2: Keep logger-only lines optional**

Do not spend time changing logs unless they are copied into Telegram. If changing logs for readability, keep it small and avoid touching logic.

**Step 3: Verify build**

Run:

```bash
npm run build
```

Expected: TypeScript build passes.

**Acceptance Criteria:**

- [ ] All `sendMessage()` text in `src/betting/odds-runner.ts` is accented.
- [ ] Fallback reason passed to Telegram is accented.
- [ ] No control flow changed.
- [ ] `npm run build` passes.

---

### Task 4: Standardize OpenRouter betting prompts and fallback analysis text

**Objective:** Giảm khả năng AI gửi tiếng Việt không dấu bằng cách chuẩn hóa prompt và fallback strings trong `betting-gemini.ts`.

**Files:**
- Modify: `src/betting/betting-gemini.ts`
- Test: `tests/betting/betting-gemini.test.ts` if coverage exists; otherwise build + existing tests.

**Step 1: Rewrite `SYSTEM_PROMPT` with Vietnamese diacritics**

Replace the unaccented prompt with the same meaning but accented. Preserve schema and technical constraints exactly.

Key required wording to include:

```ts
const SYSTEM_PROMPT = `Bạn là chuyên gia đọc odds bóng đá. Có thể dùng web search để tra cứu phong độ, chấn thương, tin tức mới nhất của các đội để hỗ trợ phân tích.

Mục tiêu: tìm và xếp hạng các kèo nên cân nhắc có odds >1.80.

Cách làm:
1. Đọc đúng H=chủ nhà, A=đội khách, D=hòa, O=tài, U=xỉu, GG=hai đội ghi bàn, NG=không.
2. Dấu handicap sau H/A là handicap thật của chính đội đó; tuyệt đối không đảo dấu.
3. Đối chiếu market: 1X2 với handicap; totals với GG/NG và team goals; corners 1X2 với corners handicap/totals; correct_score_top chỉ hỗ trợ kịch bản.
4. Chọn tối đa 3 kèo ĐƠN có odds >1.80, xếp từ mạnh đến yếu. Chỉ chọn kèo được ít nhất 2 tín hiệu cùng market hỗ trợ và không có mâu thuẫn lớn.
5. Không ghép xiên. Không bảo đảm thắng. Nếu không có lựa chọn đạt điều kiện, ghi rõ "Đứng ngoài".

Quy tắc output:
- Tất cả field dạng text phải viết tiếng Việt có dấu, ngắn gọn, không markdown; không viết không dấu kiểu "Dung ngoai", "Khong co", "Nhan dinh".
- recommendation: danh sách ngắn dạng "1) Kèo @odds; 2) Kèo @odds". Odds phải tồn tại chính xác trong snapshot.
- confidence: độ tin cậy chung của danh sách, 0-100; không hạ confidence chỉ vì odds >=1.80.
- preferredScoreline là một tỷ số tham khảo phù hợp các kèo bàn thắng.
- keyPoints gồm đúng 2 bằng chứng odds quan trọng nhất; risks gồm đúng 2 mâu thuẫn/rủi ro.
- Không gọi chênh lệch odds là value chắc chắn; chỉ gọi là tín hiệu phù hợp.

Trả duy nhất JSON: {"match":string,"preferredScoreline":string,"scoreConfidence":number,"recommendation":string,"confidence":number,"picks":[{"market":string,"selection":string,"odds":number}],"marketViews":[{"market":string,"assessment":string,"odds":number|null}],"keyPoints":string[2],"risks":string[2],"summary":string}.
Mỗi pick phải là một kèo trong recommendation; market là tên ngắn như "Chấp Châu Á", "Tài/Xỉu", "GG/NG", "1X2", "Phạt góc".
marketViews phải tóm tắt 4-5 nhóm nếu có dữ liệu: "Chấp Châu Á", "GG/NG", "Tổng bàn", "Tỷ số", "Phạt góc". assessment ngắn gọn; odds là giá của lựa chọn được nhắc, hoặc null nếu không có hướng rõ. marketViews vẫn phải có khi picks rỗng.
Viết tiếng Việt có dấu, ngắn gọn, không markdown.`;
```

**Step 2: Rewrite `VERIFY_PROMPT` and `REVISE_PROMPT` with diacritics**

Maintain exact schema and behavioral constraints. Add the same text rule:

```text
Tất cả field dạng text phải viết tiếng Việt có dấu; không dùng tiếng Việt không dấu.
```

For `REVISE_PROMPT`, keep the rule that revised output must not mention verification/rejection/internal previous analysis.

**Step 3: Update fallback strings**

In `buildFallbackRevisedAnalysis()` and `parseMatchAnalysisResponse()`, replace unaccented strings:

- `Nhan dinh truoc do khong vuot qua buoc tham dinh.` → `Nhận định trước đó không vượt qua bước thẩm định.`
- `Khong co edge ro rang, nen dung ngoai va theo doi them.` → `Không có edge rõ ràng, nên đứng ngoài và theo dõi thêm.`
- `Buoc tham dinh doc lap da bac bo nhan dinh ban dau.` → `Bước thẩm định độc lập đã bác bỏ nhận định ban đầu.`
- `Odds hien tai chua cho thay mot edge ro rang de vao keo.` → `Odds hiện tại chưa cho thấy một edge rõ ràng để vào kèo.`
- `Uu tien ky luat va cho them du lieu truoc khi hanh dong.` → `Ưu tiên kỷ luật và chờ thêm dữ liệu trước khi hành động.`
- `Nhan dinh thay the duoc ha muc tin cay de tranh overclaim.` → `Nhận định thay thế được hạ mức tin cậy để tránh overclaim.`
- `Thi truong hien tai co the dang can bang...` → `Thị trường hiện tại có thể đang cân bằng hoặc xung đột giữa các market.`
- `Nhan dinh goc bi tu choi...` → `Nhận định gốc bị từ chối trong bước thẩm định độc lập. Bản thay thế này chuyển sang góc nhìn bảo thủ vì odds chưa cho edge rõ ràng.`
- `Chua co ti so uu tien` → `Chưa có tỷ số ưu tiên`
- `Dung ngoai.` → `Đứng ngoài.`
- `Khong tach duoc cac diem odds noi bat.` → `Không tách được các điểm odds nổi bật.`
- `Can than vi du lieu odds chua cho thay mot edge ro rang.` → `Cẩn thận vì dữ liệu odds chưa cho thấy một edge rõ ràng.`
- `Khong co du thong tin de rut ra ket luan on dinh.` → `Không có đủ thông tin để rút ra kết luận ổn định.`

**Step 4: Update tests if needed**

If `tests/betting/betting-gemini.test.ts` has assertions for fallback strings, update them to accented equivalents.

**Step 5: Verify focused tests/build**

Run:

```bash
npm run test -- tests/betting/betting-gemini.test.ts tests/betting/odds-text-format.test.ts
npm run build
```

Expected: PASS.

**Acceptance Criteria:**

- [ ] All prompt bodies are accented Vietnamese.
- [ ] Prompt explicitly requires text fields in Vietnamese with diacritics.
- [ ] Fallback analysis strings are accented.
- [ ] Schemas and JSON parse logic remain unchanged.
- [ ] Focused tests and build pass.

---

### Task 5: Standardize shared Telegram performance report text

**Objective:** Sửa báo cáo hiệu suất gửi Telegram trong `buildPerformanceReportMessage()`.

**Files:**
- Modify: `src/shared/telegram.ts`
- Add/Modify Test: if no direct test exists, add focused test in `tests/shared/telegram.test.ts` or extend an existing shared formatter test.

**Step 1: Add focused test for `buildPerformanceReportMessage()`**

If `tests/shared/telegram.test.ts` does not exist, create it. Mock environment only if importing `src/shared/telegram.ts` requires no Telegram config at import time (current config is read lazily, so importing is safe).

Test should call `buildPerformanceReportMessage()` with a minimal `PerformanceReport` object. If the type is cumbersome, use a typed object imported from `../charts/performance-tracking.js` or cast minimally in test.

Assertions should include:

```ts
expect(message).toContain("Lệnh đóng");
expect(message).toContain("Tổng R thực tế");
expect(message).toContain("R trung bình");
expect(message).toContain("Theo cặp tiền");
expect(message).not.toContain("Lenh dong");
expect(message).not.toContain("Tong R thuc te");
```

**Step 2: Replace report strings**

In `src/shared/telegram.ts`, update `buildPerformanceReportMessage()`:

- `*Kỳ:* ${report.startAt} -> ${report.endAt}` → `*Kỳ:* ${report.startAt} → ${report.endAt}`
- `*Tổng quan portfolio*` → `*Tổng quan danh mục*`
- `Lenh dong:` → `Lệnh đóng:`
- `Win rate:` → `Win-rate:` or `Tỷ lệ thắng:`; choose one and update tests accordingly.
- `Tong R thuc te:` → `Tổng R thực tế:`
- `R trung binh:` → `R trung bình:`
- `Theo cap tien` → `Theo cặp tiền`
- Per-pair line:
  - `lenh` → `lệnh`
  - `Tong` → `Tổng`
  - Keep `WR`, `Avg`, `DD` if desired, or expand them if preferred.
- `_Khong co lenh dong trong ky bao cao nay._` → `_Không có lệnh đóng trong kỳ báo cáo này._`

**Step 3: Run focused test/build**

Run:

```bash
npm run test -- tests/shared/telegram.test.ts
npm run build
```

Expected: PASS.

**Acceptance Criteria:**

- [ ] `buildPerformanceReportMessage()` text is accented.
- [ ] Markdown remains valid.
- [ ] Focused test verifies no old unaccented labels remain.

---

### Task 6: Standardize AI usage alert Telegram text

**Objective:** Sửa cảnh báo AI usage gửi Telegram từ tiếng Anh sang tiếng Việt có dấu.

**Files:**
- Modify: `src/shared/ai-usage.ts`
- Modify: `tests/shared/ai-usage.test.ts`

**Step 1: Update test expectations first**

In `tests/shared/ai-usage.test.ts`, change alert assertions:

- From: `expect(message).toContain("AI usage alert")`
- To: `expect(message).toContain("Cảnh báo mức dùng AI")`

Add assertions:

```ts
expect(message).toContain("Yêu cầu: 6");
expect(message).toContain("Token: 10000 tổng cộng");
expect(message).toContain("Chi phí ước tính: $1.8000");
expect(message).toContain("Ngưỡng chạm tới:");
```

Keep existing threshold numeric assertions but update `tokens`/`cost` labels if changed.

**Step 2: Update `buildAiUsageAlertMessage()` output**

In `src/shared/ai-usage.ts`:

- Threshold strings:
  - `tokens ${...}` → `token ${...}`
  - `cost ${...}` → `chi phí ${...}`
- Main lines:
  - `⚠️ AI usage alert for ${summary.date}` → `⚠️ Cảnh báo mức dùng AI ngày ${summary.date}`
  - `Requests: ${summary.requests}` → `Yêu cầu: ${summary.requests}`
  - `Tokens: ${total} in total` → `Token: ${total} tổng cộng`
  - `Estimated cost: ${...}` → `Chi phí ước tính: ${...}`
  - `Thresholds hit: ${...}` → `Ngưỡng chạm tới: ${...}`
  - `By provider:` → `Theo provider:`
  - `By source:` → `Theo nguồn:`
  - For breakdown rows, `tokens` can become `token`; `req` can remain if UI uses compact label, or use `yêu cầu` for fully Vietnamese.

**Step 3: Run focused test**

Run:

```bash
npm run test -- tests/shared/ai-usage.test.ts
```

Expected: PASS.

**Acceptance Criteria:**

- [ ] AI usage alert sent to Telegram is Vietnamese with diacritics.
- [ ] Tests cover the new labels.
- [ ] Numeric values and threshold logic unchanged.

---

### Task 7: Scan for remaining unaccented Telegram-facing strings

**Objective:** Tìm các chuỗi có khả năng gửi Telegram vẫn không dấu và xử lý phần còn lại nhỏ gọn.

**Files:**
- Potentially modify: `src/shared/stats.ts`, `src/lottery/*.ts`, `src/charts/*.ts` only if strings are Telegram-facing and visibly unaccented.
- Do not modify logs-only strings unless trivial.

**Step 1: Search for likely offenders**

Run:

```bash
rg -n "Khong|khong|tran|keo|duoc|thieu|cau hinh|tien|lenh|Tong|trung binh|Tham|Phan|Ty so|Chua|chua|Dung|ngoai|Nhan|dinh|cap|bao cao|ky|Da|da gui|lay du lieu" src tests
```

**Step 2: Classify each match**

For each match:

- If it is sent to Telegram via `sendMessage()`, `sendPhoto(..., caption)`, `sendDocument(..., caption)`, or a formatter used by those calls: fix it.
- If it is an OpenRouter prompt/fallback displayed to user: fix it.
- If it is only a logger/debug line: optional; skip if changing it would create noisy diff.
- If it is test fixture data intentionally unaccented to test robustness: keep it unless output assertion is affected.

**Known file to inspect:**

- `src/shared/stats.ts` currently mixes Vietnamese and English (`Win-rate`, `req`, `tokens`). Decide whether to keep compact dashboard jargon or Vietnamese labels. If changing, update `tests/shared/stats.test.ts`.

**Step 3: Run full validation**

Run:

```bash
npm run test
npm run build
```

Expected: both PASS.

**Acceptance Criteria:**

- [ ] No obvious Telegram-facing Vietnamese sentence remains without diacritics.
- [ ] Logs-only strings are not unnecessarily churned.
- [ ] Full test suite passes.
- [ ] Build passes.

---

## Files Likely To Change

Primary:

- `src/betting/odds-text-format.ts` — Telegram Match Odds message formatter labels/fallback/data header.
- `src/betting/odds-runner.ts` — Telegram status messages and fallback reason.
- `src/betting/betting-gemini.ts` — OpenRouter prompts and fallback text.
- `src/shared/telegram.ts` — performance report Telegram message text.
- `src/shared/ai-usage.ts` — AI usage alert Telegram message text.

Tests:

- `tests/betting/odds-text-format.test.ts` — update expected labels and add fallback/data tests.
- `tests/betting/betting-gemini.test.ts` — update if prompt/fallback text is asserted.
- `tests/shared/ai-usage.test.ts` — update AI alert expected labels.
- `tests/shared/telegram.test.ts` — create if adding coverage for performance report.
- `tests/shared/stats.test.ts` — update only if dashboard wording changes.

Do not touch unless needed:

- Database/repository code.
- Telegram transport `sendMessage()` mechanics.
- Odds fetching or AI verification control flow.
- Generated `dist/` files unless the project explicitly expects committed build artifacts.

---

## Tests / Validation

Run in this order during implementation:

```bash
npm run test -- tests/betting/odds-text-format.test.ts
npm run test -- tests/betting/betting-gemini.test.ts tests/betting/odds-text-format.test.ts
npm run test -- tests/shared/ai-usage.test.ts
npm run test -- tests/shared/telegram.test.ts
npm run test
npm run build
```

If `tests/shared/telegram.test.ts` is not created, skip its focused command and rely on `npm run test` + `npm run build`.

Manual review command:

```bash
rg -n "Khong|khong|tran|keo|duoc|thieu|cau hinh|tien|lenh|Tong|trung binh|Ty so|Chua|chua|Dung|ngoai|Nhan|dinh|Du lieu|tam thoi|phan tich" src tests
```

Expected after implementation: remaining matches are either logs-only, fixture inputs intentionally unaccented, identifiers, or English technical labels.

---

## Risks, Tradeoffs, and Open Questions

### Risks

- Telegram Markdown can fail if dynamic AI output contains unescaped `_`, `*`, or backticks. This plan does not change Markdown escaping behavior; current `sendMessage()` already retries without parse mode on parse errors.
- AI may still occasionally return unaccented Vietnamese despite prompt changes. Deterministically restoring accents for arbitrary generated text is error-prone without an NLP library/model; not recommended in this scope.
- Changing test fixture strings too aggressively could hide formatter robustness for unaccented AI input. Prefer changing output labels and leaving some unaccented fixture input where useful.

### Tradeoffs

- Direct string replacement is simpler and safer than introducing a global localization layer.
- Keeping compact technical labels (`AI`, `OpenRouter`, `req`, `tokens`, `Win-rate`) may be acceptable, but user-facing Vietnamese sentences should have diacritics.
- Prompts with Vietnamese diacritics are longer by bytes but not meaningfully costly compared to current OpenRouter calls.

### Open Questions

- Should dashboard abbreviations like `req`, `tokens`, `Win-rate`, `provider` be fully Việt hóa (`yêu cầu`, `token`, `tỷ lệ thắng`, `nhà cung cấp`) or kept as compact technical terms?
- Should lottery messages be included in this pass? Current visible lottery messages are mostly already accented, but a full scan may reveal more.
- Should generated `dist/` be updated/committed after `npm run build`, or is `dist/` treated as build output only?

---

## Suggested Execution Handoff

Plan complete. Recommended implementation order:

1. Implement Tasks 1-2 together for formatter TDD.
2. Implement Task 3 runner strings.
3. Implement Task 4 prompt/fallback strings.
4. Implement Tasks 5-6 shared Telegram messages.
5. Run Task 7 scan and full validation.

Use small commits after each logical task if commits are requested by the Lead:

```bash
git add tests/betting/odds-text-format.test.ts src/betting/odds-text-format.ts
git commit -m "fix: standardize match odds telegram text"

git add src/betting/odds-runner.ts src/betting/betting-gemini.ts
git commit -m "fix: require accented vietnamese betting analysis"

git add src/shared/telegram.ts src/shared/ai-usage.ts tests/shared/ai-usage.test.ts tests/shared/telegram.test.ts
git commit -m "fix: standardize shared telegram alerts"
```

Do not commit unless explicitly instructed.
