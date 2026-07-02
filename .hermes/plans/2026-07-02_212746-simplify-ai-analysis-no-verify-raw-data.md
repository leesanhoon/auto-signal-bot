# Simplify AI Analysis No-Verify Raw Data Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Đơn giản hóa phân tích chart và trận đấu để AI nhận dữ liệu nguyên vẹn hơn, tự phân tích trực tiếp, không bị nhiễu bởi verify/revise/guardrail quá chặt hoặc prompt ép kết quả.

**Architecture:** Chuyển pipeline sang “single-pass AI analysis”: capture/fetch dữ liệu → gửi data rõ ràng cho AI → parse/format output → gửi Telegram. Verify/revise độc lập sẽ tắt mặc định hoặc bỏ khỏi runtime chính; deterministic code chỉ giữ phần an toàn tối thiểu để không crash và không gửi output rỗng, không còn tự sửa nhận định của AI theo hướng conservative nếu AI đã phân tích được.

**Tech Stack:** Node.js/TypeScript, OpenRouter, Vitest, Telegram Bot API, Playwright screenshots.

---

## Current Context / Assumptions

User intent:

- “Chỉ phân tích, không cần validate lại”.
- Dữ liệu hiện tại bị nhiễu/sai lệch vì có nhiều lớp:
  - chart: prompt quá nhiều rule Bob Volman/threshold/confluence + verify bằng model khác.
  - betting: candidateId/hydrate/filter odds > 1.80 + verify/revise + fallback đứng ngoài.
- Mong muốn: gửi data đầy đủ/nguyên bản hơn cho AI và nhờ AI phân tích trực tiếp; bỏ bớt các phần làm ảnh hưởng đến kết quả từ AI.

Relevant current code:

- Chart:
  - `src/charts/analyzer.ts`
    - `buildSystemPrompt()` và `buildUserPrompt()` đang ép nhiều rule: Bob Volman, D1/H4/M15, EMA20, volume, confidence threshold, orderType.
    - `parseAnalysisResponse()` filter setup theo `CHART_SIGNAL_CONFIDENCE_THRESHOLD`.
    - `confirmHighConfidenceSetups()` gọi verify model lần 2.
    - `analyzeAllCharts()` filter setup phải đủ D1/H4/M15.
  - `src/charts/index.ts`
    - gọi `confirmHighConfidenceSetups()` nếu `CHART_AI_VERIFY_ENABLED` bật.
    - auto-save chỉ khi `verifiedConfirmed === true && orderType === "MARKET_NOW"`.
- Betting:
  - `src/betting/betting-gemini.ts`
    - build candidate pool và yêu cầu AI chỉ trả `candidateId`.
    - `hydratePicks()` lọc invalid/duplicate/odds <= 1.8.
    - `verifyMatchAnalysis()` và `reviseMatchAnalysis()` có thể bác/đổi kết quả AI ban đầu.
    - `buildFallbackRevisedAnalysis()` chuyển sang “Đứng ngoài” khi revise fail/truncated.
  - `src/betting/odds-runner.ts`
    - `processMatch()` gọi analyze → verify/revise nếu có pick hợp lệ.
    - hiện đã có `BETTING_AI_VERIFY_ENABLED`, nhưng default đang bật.
  - `src/betting/odds-text-format.ts`
    - `formatOddsAnalysisInput()` chỉ gửi một phần market keys và chỉ top 8 correct score.
    - `formatOddsText()` gửi text odds thô hơn cho Telegram fallback.

---

## Design Decisions

1. **Không xóa toàn bộ verify code ngay** để giảm rủi ro; chỉ bỏ khỏi runtime chính bằng default env false và điều kiện rõ ràng. Có thể cleanup hẳn sau khi chạy ổn vài ngày.
2. **Giữ parser JSON và fallback parse tối thiểu** vì cần format Telegram ổn định. Nhưng parser không được “sửa nghĩa” quá nhiều.
3. **Giữ provenance chart** vì nó không làm nhiễu nhận định; nó chỉ giúp biết ảnh nào được AI xem/gửi Telegram.
4. **Không ép AI chỉ chọn candidateId** trong betting nữa. Thay vào đó gửi raw odds/correct score đầy đủ hơn và cho AI trả market/selection/odds/reason trực tiếp. Code có thể hiển thị nguyên pick AI trả, không hydrate lại từ candidate catalog.
5. **Không auto-save position từ chart trong chế độ no-verify** trừ khi user xác nhận riêng. Vì bỏ verify làm tăng rủi ro tự động mở/tracking nhầm.

---

## Proposed Runtime Behavior

### Chart scanner

- Capture D1/H4/M15 như hiện tại.
- Gửi ảnh + label pair/timeframe cho AI.
- Prompt ngắn hơn:
  - “Hãy phân tích khách quan các chart được gửi.”
  - “Nếu thấy setup rõ thì đưa setup; nếu không rõ thì nói không vào.”
  - Không ép Bob Volman quá cứng, không ép phải đủ mọi rule, không filter bằng threshold trước khi user thấy output.
- Không chạy `confirmHighConfidenceSetups()` mặc định.
- Telegram gửi kết quả AI phân tích + ảnh chart đúng provenance.

### Match odds

- Fetch odds như hiện tại.
- Gửi dữ liệu odds đầy đủ hơn:
  - match info
  - all markets/outcomes compact JSON hoặc structured text
  - correctScore đầy đủ hoặc giới hạn cao hơn nhưng không chỉ top 8 nếu token cho phép.
- AI trả analysis trực tiếp:
  - recommendation
  - picks với `market`, `selection`, `odds`, `reason`
  - keyPoints/risks/summary
- Không verify/revise mặc định.
- Không tự chuyển “Đứng ngoài” chỉ vì pick không hydrate được candidateId.

---

## Subagent Work Breakdown

## Subagent 1 — Betting Single-Pass AI Analysis

**Objective:** Đổi betting analysis sang single-pass: gửi data odds nguyên hơn, AI trả pick trực tiếp, không candidateId/hydrate bắt buộc và không verify/revise mặc định.

**Files:**
- Modify: `src/betting/betting-types.ts`
- Modify: `src/betting/betting-gemini.ts`
- Modify: `src/betting/odds-runner.ts`
- Modify: `src/betting/odds-text-format.ts`
- Modify: `.env.example`
- Test: `tests/betting/betting-gemini.test.ts`
- Test: `tests/betting/odds-runner.test.ts`
- Test: `tests/betting/odds-text-format.test.ts`

### Task 1.1: Extend pick type for direct AI picks

**Objective:** Cho phép AI trả pick trực tiếp mà không cần `candidateId`.

**Files:**
- Modify: `src/betting/betting-types.ts`
- Test: compile via `npm run build`

**Implementation detail:**

Change `MatchAiAnalysis.picks` item type from requiring `market`, `selection`, `odds` but candidateId optional, to also allow optional reason/confidence if useful:

```ts
picks?: Array<{
  candidateId?: string;
  market: string;
  selection: string;
  odds: number;
  reason?: string;
  confidence?: number;
}>;
```

**Verification:**

Run:

```bash
npm run build
```

Expected: PASS.

---

### Task 1.2: Add raw odds analysis input builder

**Objective:** Gửi data đầy đủ hơn cho AI, thay vì candidate catalog đã xử lý sẵn.

**Files:**
- Modify: `src/betting/odds-text-format.ts`
- Test: `tests/betting/odds-text-format.test.ts`

**Implementation detail:**

Add exported function:

```ts
export function formatFullOddsAnalysisInput(payload: MatchOddsPayload): string {
  return JSON.stringify(
    {
      match: {
        gameId: payload.gameId,
        home: payload.home,
        away: payload.away,
        kickoffUnix: payload.kickoffUnix,
      },
      odds: payload.odds,
      correctScore: payload.correctScore ?? [],
    },
    null,
    2,
  );
}
```

Keep `formatOddsAnalysisInput()` for backward compatibility/tests.

**Test to add:**

In `tests/betting/odds-text-format.test.ts`:

```ts
test("formatFullOddsAnalysisInput includes all markets and correct score", () => {
  const text = formatFullOddsAnalysisInput(payload);
  expect(text).toContain('"markets"');
  expect(text).toContain('"correctScore"');
  expect(text).toContain('"h2h"');
});
```

**Verification:**

```bash
npm run test -- tests/betting/odds-text-format.test.ts
```

Expected: PASS.

---

### Task 1.3: Simplify betting prompt to direct analysis

**Objective:** AI phân tích trực tiếp từ raw odds, không bị ép candidateId/hydrate.

**Files:**
- Modify: `src/betting/betting-gemini.ts`
- Test: `tests/betting/betting-gemini.test.ts`

**Implementation detail:**

1. Import new raw formatter:

```ts
import { formatFullOddsAnalysisInput } from "./odds-text-format.js";
```

2. Change `buildAnalyzeUserText()` to use full input:

```ts
function buildAnalyzeUserText(payload: MatchOddsPayload): string {
  return formatFullOddsAnalysisInput(payload);
}
```

3. Replace `buildAnalyzeSystemPrompt()` with a shorter prompt:

```ts
function buildAnalyzeSystemPrompt(): string {
  return [
    "Bạn là chuyên gia phân tích odds bóng đá.",
    "Chỉ dựa vào dữ liệu odds/correct score được cung cấp trong user message.",
    "Hãy phân tích khách quan xu hướng odds, kèo đáng chú ý, rủi ro và nếu không rõ edge thì nói đứng ngoài.",
    "Không cần tự validate lại qua model khác. Không tự bịa dữ liệu ngoài input.",
    "Tất cả field text bằng tiếng Việt có dấu, ngắn gọn, không markdown, không URL.",
  ].join(" ");
}
```

4. Replace `buildAnalyzeUserPrompt()`:

```ts
function buildAnalyzeUserPrompt(): string {
  return [
    "Trả duy nhất JSON với keys match, preferredScoreline, scoreConfidence, recommendation, confidence, picks, keyPoints, risks, summary.",
    "picks là mảng tối đa 3 kèo AI thấy đáng chú ý; mỗi pick gồm market, selection, odds, reason.",
    "Nếu không có kèo rõ, picks là [] và recommendation là Đứng ngoài.",
    "keyPoints và risks mỗi mảng 1-3 phần tử.",
  ].join(" ");
}
```

5. Keep candidate builder exports for old tests only if needed, but analysis request should not include `CANDIDATES:`.

**Test updates:**

- Update request test to assert analyze request does **not** contain `CANDIDATES:`.
- Add assertion request contains JSON-ish raw odds, e.g. `"odds"`, `"markets"`, `"correctScore"`.

**Verification:**

```bash
npm run test -- tests/betting/betting-gemini.test.ts
```

Expected: PASS.

---

### Task 1.4: Parse direct AI picks without forced hydration

**Objective:** Không drop pick chỉ vì thiếu candidateId.

**Files:**
- Modify: `src/betting/betting-gemini.ts`
- Test: `tests/betting/betting-gemini.test.ts`

**Implementation detail:**

Add direct pick parser:

```ts
function parseDirectPicks(rawPicks: unknown): NonNullable<MatchAiAnalysis["picks"]> {
  if (!Array.isArray(rawPicks)) return [];
  const picks: NonNullable<MatchAiAnalysis["picks"]> = [];
  for (const item of rawPicks) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Record<string, unknown>;
    const market = toText(raw.market);
    const selection = toText(raw.selection);
    const odds = Number(raw.odds);
    if (!market || !selection || !Number.isFinite(odds) || odds <= 0) continue;
    picks.push({
      candidateId: toText(raw.candidateId) || undefined,
      market,
      selection,
      odds,
      reason: toText(raw.reason) || undefined,
      confidence: Number.isFinite(Number(raw.confidence)) ? clampConfidence(raw.confidence) : undefined,
    });
    if (picks.length >= 3) break;
  }
  return picks;
}
```

Then in `normalizeAnalysisAfterHydration()` either rename to `normalizeDirectAnalysis()` or keep name but use:

```ts
const directPicks = parseDirectPicks(parsed.picks);
```

Important: Do **not** force `recommendation = "Đứng ngoài."` just because `directPicks.length === 0` unless recommendation is empty. Let AI’s recommendation show.

Suggested logic:

```ts
const recommendation = toText(
  parsed.recommendation,
  directPicks.length > 0 ? "Theo dõi các kèo AI đề xuất." : "Đứng ngoài.",
);
```

**Test to add/update:**

```ts
test("keeps direct AI picks without candidateId", () => {
  const parsed = parseMatchAnalysisResponse(JSON.stringify({
    match: "A vs B",
    preferredScoreline: "1-1",
    scoreConfidence: 45,
    recommendation: "Có thể theo dõi Xỉu 2.5",
    confidence: 62,
    picks: [{ market: "Tổng bàn", selection: "Xỉu 2.5", odds: 1.92, reason: "Odds thấp hơn nhóm còn lại" }],
    keyPoints: ["Tổng bàn nghiêng thấp"],
    risks: ["Kèo chưa quá rõ"],
    summary: "Theo dõi thận trọng"
  }), payload);
  expect(parsed?.picks?.[0]).toMatchObject({ market: "Tổng bàn", selection: "Xỉu 2.5", odds: 1.92 });
});
```

**Verification:**

```bash
npm run test -- tests/betting/betting-gemini.test.ts
```

Expected: PASS.

---

### Task 1.5: Disable betting verify/revise by default

**Objective:** Runtime chính chỉ phân tích một lượt, không validate/revise lại.

**Files:**
- Modify: `src/betting/odds-runner.ts`
- Modify: `.env.example`
- Test: `tests/betting/odds-runner.test.ts`

**Implementation detail:**

Change boolean helper for `BETTING_AI_VERIFY_ENABLED` default from true to false.

Current:

```ts
if (!normalized) return true;
```

Change for betting only:

```ts
if (!normalized) return false;
```

`.env.example`:

```env
BETTING_AI_VERIFY_ENABLED=false
```

Tests:

- Existing disabled test remains.
- Add default unset test:

```ts
test("skips verify by default when BETTING_AI_VERIFY_ENABLED is unset", async () => {
  delete process.env.BETTING_AI_VERIFY_ENABLED;
  // setup analyze result with picks
  // expect verify/revise not called and verificationStatus skipped
});
```

- Add explicit enabled test if not present:

```ts
process.env.BETTING_AI_VERIFY_ENABLED = "true";
// expect verify called
```

**Verification:**

```bash
npm run test -- tests/betting/odds-runner.test.ts
```

Expected: PASS.

---

## Subagent 2 — Chart Single-Pass AI Analysis

**Objective:** Chart analysis chỉ gửi chart package cho AI phân tích một lượt; không verify model thứ hai và không filter quá chặt trước khi gửi Telegram.

**Files:**
- Modify: `src/charts/analyzer.ts`
- Modify: `src/charts/index.ts`
- Modify: `src/charts/chart-config-env.ts`
- Modify: `.env.example`
- Test: `tests/charts/analyzer.test.ts`
- Test: `tests/charts/chart-config-env.test.ts`
- Test: `tests/shared/telegram.test.ts`

### Task 2.1: Simplify chart prompts

**Objective:** Giảm prompt nhiễu/rule cứng; AI tự phân tích chart trực tiếp.

**Files:**
- Modify: `src/charts/analyzer.ts:84-109`
- Test: `tests/charts/analyzer.test.ts`

**Implementation detail:**

Replace `buildSystemPrompt()` with:

```ts
function buildSystemPrompt(): string {
  return [
    "Bạn là chuyên gia phân tích biểu đồ forex/kim loại.",
    "Hãy đọc trực tiếp các ảnh chart được gửi, gồm pair và timeframe trong label.",
    "Phân tích khách quan xu hướng, vùng giá quan trọng, setup nếu có, điểm vào/SL/TP nếu đủ rõ.",
    "Nếu chart chưa rõ hoặc tín hiệu yếu, hãy nói không vào lệnh/chờ thêm xác nhận.",
    "Không cần validate lại bằng model khác. Không bịa level nếu không đọc được trên chart.",
    "Tất cả field text bằng tiếng Việt có dấu.",
  ].join(" ");
}
```

Replace `buildUserPrompt()` with:

```ts
function buildUserPrompt(): string {
  return [
    "Return only JSON with keys summaries, setups, and noSetupReason.",
    "summaries: mỗi pair gồm pair, trend, emaProximity nếu thấy, status, confidence.",
    "setups: chỉ các setup AI thấy đáng chú ý, gồm pair, direction, setup, orderType, entryCondition, currentPriceContext, emaTouch, reasons, risks, confidence, entry, stopLoss, takeProfit1, takeProfit2, riskReward, summary.",
    "Không cần ép đủ mọi rule; nếu không chắc thì giảm confidence và ghi rõ trong risks.",
  ].join(" ");
}
```

Then update call sites:

```ts
systemPrompt: buildSystemPrompt(),
...
userContent.push({ type: "text", text: buildUserPrompt() });
```

**Test update:**

- Existing tests should still parse output.
- If tests assert threshold wording, update to no longer expect threshold in prompt.

**Verification:**

```bash
npm run test -- tests/charts/analyzer.test.ts
```

Expected: PASS.

---

### Task 2.2: Stop filtering chart setups by confidence during parse

**Objective:** Không chặn output AI trước khi user thấy, tránh mất tín hiệu vì threshold cứng.

**Files:**
- Modify: `src/charts/analyzer.ts:267-304`
- Test: `tests/charts/analyzer.test.ts`

**Implementation detail:**

In `parseAnalysisResponse()`, remove:

```ts
const threshold = getConfiguredChartSignalConfidenceThreshold();
...
.filter((setup) => (setup.confidence ?? 0) >= threshold);
```

Keep normalization of fields only:

```ts
const normalizedSetups: TradeSetup[] = rawSetups
  .filter(...)
  .map(...);
```

**Test update:**

Current test `parseAnalysisResponse filters low-confidence setups` should be renamed and expected changed:

```ts
test("parseAnalysisResponse keeps low-confidence setups from AI", () => {
  const parsed = analyzer.parseAnalysisResponse(/* one 72, one 30 */);
  expect(parsed.setups).toHaveLength(2);
});
```

**Verification:**

```bash
npm run test -- tests/charts/analyzer.test.ts
```

Expected: PASS.

---

### Task 2.3: Stop confluence filtering before Telegram

**Objective:** Không drop setup chỉ vì thiếu/không khớp đủ D1/H4/M15; AI đã tự cân nhắc trong analysis.

**Files:**
- Modify: `src/charts/analyzer.ts:399-413`
- Test: `tests/charts/analyzer.test.ts`

**Implementation detail:**

Replace confluence filter block with direct return:

```ts
logger.info(`  ✓ ${summaries.length} pairs scanned, ${setups.length} setup(s) returned by AI`);
return { summaries, setups, noSetupReason: noSetupReasons.join("\n").trim(), screenshots };
```

Keep `sourceCharts` attachment.

**Test update:**

- Add/modify test where only H4 screenshot exists and AI returns setup; expected setup is retained.

**Verification:**

```bash
npm run test -- tests/charts/analyzer.test.ts
```

Expected: PASS.

---

### Task 2.4: Disable chart verify by default and skip runtime verify block

**Objective:** Chart scanner không gọi `confirmHighConfidenceSetups()` mặc định.

**Files:**
- Modify: `src/charts/chart-config-env.ts`
- Modify: `src/charts/index.ts`
- Modify: `.env.example`
- Test: `tests/charts/chart-config-env.test.ts`

**Implementation detail:**

Change chart verify default false:

```ts
function parseBooleanEnv(raw: string | undefined): boolean {
  const value = raw?.trim().toLowerCase();
  if (!value) return false;
  return !(value === "false" || value === "0" || value === "no" || value === "off");
}
```

`.env.example`:

```env
CHART_AI_VERIFY_ENABLED=false
```

In `src/charts/index.ts`, keep block but it will skip unless explicitly enabled. Update log if needed:

```ts
logger.info("Skipped chart verification because CHART_AI_VERIFY_ENABLED is not enabled", { count: highConfSetups.length });
```

**Test update:**

In `tests/charts/chart-config-env.test.ts`, default should be false.

**Verification:**

```bash
npm run test -- tests/charts/chart-config-env.test.ts
```

Expected: PASS.

---

### Task 2.5: Prevent auto-save when no verify

**Objective:** Không tự động track position khi đã bỏ validate lại.

**Files:**
- Modify: `src/charts/index.ts`
- Test: existing build; optional new test only if runner is testable.

**Implementation detail:**

Current:

```ts
function shouldAutoTrackAsOpen(setup: TradeSetup): boolean {
  return setup.verifiedConfirmed === true && setup.orderType === "MARKET_NOW";
}
```

This is already safe if verify disabled. Keep unchanged.

Add a comment:

```ts
// In no-verify mode setups are user-visible only; auto-track requires explicit verification.
```

No behavior change required.

**Verification:**

```bash
npm run build
```

Expected: PASS.

---

## Subagent 3 — Telegram Output for Raw AI Analysis

**Objective:** Telegram output thể hiện rõ đây là phân tích AI trực tiếp, không phải kết quả đã verify/revise; không ẩn phần reason/pick của AI.

**Files:**
- Modify: `src/betting/odds-text-format.ts`
- Modify: `src/shared/telegram.ts`
- Test: `tests/betting/odds-text-format.test.ts`
- Test: `tests/shared/telegram.test.ts`

### Task 3.1: Show pick reason in betting Telegram message

**Objective:** Nếu AI trả `reason`, Telegram hiển thị reason thay vì chỉ market/selection/odds.

**Files:**
- Modify: `src/betting/odds-text-format.ts:377-385`
- Test: `tests/betting/odds-text-format.test.ts`

**Implementation detail:**

Change pick map line to include reason:

```ts
...picks.map((pick, index) => {
  const reason = pick.reason ? `\n   Lý do: ${compact(pick.reason, 100)}` : "";
  return `${index + 1}. *${compact(pick.selection, 60)}*  \`@${pick.odds}\`\n   _${compact(pick.market, 35)}_${reason}`;
})
```

**Test:**

Add assertion that formatted message contains `Lý do:` when pick has reason.

**Verification:**

```bash
npm run test -- tests/betting/odds-text-format.test.ts
```

Expected: PASS.

---

### Task 3.2: Change verify label wording to direct AI mode

**Objective:** Khi verify disabled/skipped, không làm user nghĩ có lỗi; nói rõ “AI phân tích trực tiếp”.

**Files:**
- Modify: `src/betting/odds-text-format.ts:359-368`
- Test: `tests/betting/odds-text-format.test.ts`

**Implementation detail:**

Change skipped label:

```ts
: analysis.verificationStatus === "skipped"
  ? "🤖 *Chế độ:* AI phân tích trực tiếp"
  : "🤖 *Chế độ:* AI phân tích trực tiếp";
```

If verify is explicitly enabled, keep confirmed/revised/failed labels.

**Verification:**

```bash
npm run test -- tests/betting/odds-text-format.test.ts
```

Expected: PASS.

---

### Task 3.3: Chart Telegram should not require `verifiedConfirmed`

**Objective:** Chart Telegram still sends AI setup even without verify.

**Files:**
- Review/Modify: `src/shared/telegram.ts`
- Test: `tests/shared/telegram.test.ts`

**Current behavior likely OK:**

`sendAllAnalyses()` filters by confidence threshold:

```ts
const highConfSetups = result.setups.filter((s) => (s.confidence ?? 0) >= threshold);
```

But if Subagent 2 removes parse threshold, Telegram still filters by threshold. To fully satisfy “không validate/filter”, change this to send all setups returned by AI:

```ts
const aiSetups = result.setups;
const headerSuffix = " từ AI";
```

Then loop over `aiSetups` instead of `highConfSetups`.

**Tradeoff:** This may send more low-confidence setups. To avoid spam, only do this if AI prompt says setups should only contain “đáng chú ý”. Otherwise set env threshold default lower, e.g. 0. Recommended for user intent: send all AI setups.

**Test update:**

Existing test with setup confidence 92 still passes. Add low-confidence setup test:

```ts
test("sendAllAnalyses sends AI setup even below threshold", async () => {
  // setup confidence 35
  // expect buildCopyableSetup message sent
});
```

**Verification:**

```bash
npm run test -- tests/shared/telegram.test.ts
```

Expected: PASS.

---

## Subagent 4 — Tests, Runtime Validation, and Cleanup

**Objective:** Đảm bảo pipeline mới build/test pass và runtime chạy theo single-pass mode.

**Files:**
- Modify tests only if failures surface.
- Optional Modify: `.env.example` comments.

### Task 4.1: Run focused tests

Run:

```bash
npm run test -- tests/betting/betting-gemini.test.ts tests/betting/odds-runner.test.ts tests/betting/odds-text-format.test.ts tests/charts/analyzer.test.ts tests/charts/chart-config-env.test.ts tests/shared/telegram.test.ts
```

Expected: PASS.

---

### Task 4.2: Run full tests and build

Run:

```bash
npm run test
npm run build
```

Expected: PASS.

---

### Task 4.3: Run runtime smoke with no-verify defaults

Only after tests/build pass, run:

```bash
npm run analyze
npm run match-odds
```

Expected logs:

- Chart:
  - captured charts
  - analyzed pairs
  - log says chart verification skipped/not enabled
  - Telegram sends AI setups without calling `Verifying high-confidence setups`
- Betting:
  - fetched odds
  - analyzed matches
  - log says verify/revise skipped by default
  - no `revise` stage logs unless env explicitly enables verify

---

## Acceptance Criteria

- Betting runtime default is single-pass: analyze only, no verify/revise.
- Chart runtime default is single-pass: analyze only, no verify model call.
- AI receives raw/full odds data, not only candidate IDs.
- Direct AI betting picks without `candidateId` are preserved and shown in Telegram.
- Chart setups returned by AI are not removed by parse confidence threshold or D1/H4/M15 confluence filter.
- Telegram clearly labels direct AI analysis mode.
- Tests and build pass.
- Runtime smoke confirms no verify/revise stages by default.

---

## Risks / Tradeoffs

- Removing verify/revise may increase false positives and bad picks. This matches current user intent but should be understood.
- Sending all AI setups may increase Telegram noise. If too noisy, add a lighter prompt instruction rather than code-side filtering.
- Full odds JSON may increase token usage. If context too large, keep compact JSON but do not remove important markets/correctScore.
- Disabling candidate hydration allows AI to output odds text that may not exactly match source; Telegram should show it as AI analysis, not guaranteed validated pick.

---

## Open Questions

1. Có muốn giữ env để bật verify lại khi cần không? Plan giữ `BETTING_AI_VERIFY_ENABLED` và `CHART_AI_VERIFY_ENABLED`, nhưng default đổi thành `false`.
2. Chart Telegram có nên gửi tất cả setup AI trả về, kể cả confidence thấp, hay chỉ gửi setup từ một ngưỡng rất thấp như `>=30` để tránh spam? Plan đề xuất gửi tất cả setup AI trả về.
3. Betting có nên tiếp tục gửi `formatOddsDataMessage(match)` sau mỗi phân tích không? Plan giữ nguyên để user tự đối chiếu raw odds.

---

## Suggested Task Queue Files

Nếu triển khai bằng AGENTS.md protocol, tạo các task sau:

```text
tasks/betting-single-pass-ai-analysis/
  plan.md
  task.md
  context.md

tasks/chart-single-pass-ai-analysis/
  plan.md
  task.md
  context.md

tasks/telegram-direct-ai-output/
  plan.md
  task.md
  context.md

tasks/no-verify-regression-runtime/
  plan.md
  task.md
  context.md
```

Lead review theo thứ tự: betting → chart → telegram → regression. Chỉ viết `done.md` khi tests/build/runtime smoke đạt.
