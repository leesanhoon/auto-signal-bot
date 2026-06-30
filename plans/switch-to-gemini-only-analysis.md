# Chuyển phân tích chart sang dùng hoàn toàn Gemini (bỏ Claude do hết credit)

## Context

API key `ANTHROPIC_API_KEY` (Claude Sonnet 4.6) hiện đã hết credit. Luồng phân tích chart trong [src/charts/analyzer.ts](../src/charts/analyzer.ts) đang dùng Claude ở 2 chỗ:
1. **`analyzeWithClaude`** — fallback nếu Gemini lỗi (luồng `analyzeAllCharts`)
2. **`verifySetupWithClaude`** — đối chiếu độc lập các setup có confidence >80% từ Gemini (luồng `confirmHighConfidenceSetups`), kết quả này được hiển thị trong tin nhắn Telegram (`claudeConfirmed`, `claudeConfidence`, `claudeComment` — xem [src/shared/telegram.ts](../src/shared/telegram.ts) hàm `buildConfirmationLine`)

Người dùng muốn chuyển toàn bộ sang Gemini, không phụ thuộc Claude nữa:
- **Bước kiểm tra chính (check)**: `gemini-3.5-flash` (giữ nguyên model đang dùng, không đổi)
- **Bước verify (đối chiếu độc lập)**: `gemini-2.5-pro` (thay cho Claude)
- **Không fallback về Claude** nếu Gemini lỗi — bỏ hẳn nhánh gọi Anthropic SDK khỏi luồng này

> Lưu ý giá/free-tier: chưa xác nhận được giá chính xác hiện tại của `gemini-3.5-flash` và `gemini-2.5-pro` — kiểm tra tại https://ai.google.dev/pricing trước khi chạy thật, đặc biệt model `pro` thường tốn phí nhiều hơn dòng `flash`.

## Thay đổi cụ thể trong `src/charts/analyzer.ts`

### 1. Model bước check chính — không đổi
- Hàm `analyzeWithGemini` (dòng 66-88): giữ nguyên `model: "gemini-3.5-flash"`, không cần sửa dòng này

### 2. Xoá fallback Claude trong `analyzeAllCharts`
- Xoá hoàn toàn hàm `analyzeWithClaude` (dòng 33-64)
- Sửa `analyzeAllCharts` (dòng 178-201): bỏ `try/catch` gọi `analyzeWithClaude`, chỉ còn gọi thẳng `analyzeWithGemini`. Nếu Gemini lỗi → ném lỗi ra ngoài để [src/shared/telegram.ts](../src/shared/telegram.ts) `notifyError` xử lý gửi thông báo lỗi qua Telegram như các luồng khác (không còn fallback)
- Đổi log `provider` — bỏ nhánh "Claude Sonnet 4.6", chỉ còn `"Gemini 2.5 Flash"`

### 3. Đổi hàm verify sang Gemini
- Đổi tên hàm `verifySetupWithClaude` → `verifySetupWithGemini` (hoặc tên trung lập hơn `verifySetupIndependently`)
- Bên trong: thay `new Anthropic({ apiKey })` + `client.messages.create(...)` bằng `new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })` + `ai.models.generateContent({ model: "gemini-2.5-pro", ... })`, theo đúng pattern ảnh + text đã có trong `analyzeWithGemini` (dùng `inlineData` cho ảnh thay vì `source: { type: "base64", ... }` của Anthropic)
- Giữ nguyên `userPrompt` và cách parse JSON response (`confirmed`, `confidence`, `comment`)
- Trong `confirmHighConfidenceSetups`: đổi log message "Verifying ... with Claude Sonnet 4.6" → "Verifying ... with Gemini 2.5 Pro", đổi field tên biến `claudeConfirmed`/`claudeConfidence`/`claudeComment` → cân nhắc đổi tên field cho khớp ý nghĩa mới (xem mục 4)

### 4. Đổi tên field trong types & UI hiển thị (tuỳ chọn nhưng khuyến nghị)
File [src/shared/types.ts](../src/shared/types.ts) hiện có field `claudeConfirmed`, `claudeConfidence`, `claudeComment` trong `TradeSetup`. Vì giờ verify bằng Gemini chứ không phải Claude, nên đổi tên để tránh gây hiểu nhầm:
- `claudeConfirmed` → `verifiedConfirmed` (hoặc `geminiProConfirmed`)
- `claudeConfidence` → `verifiedConfidence`
- `claudeComment` → `verifiedComment`

Đổi tương ứng tại:
- [src/shared/types.ts](../src/shared/types.ts) — định nghĩa `TradeSetup`
- [src/charts/analyzer.ts](../src/charts/analyzer.ts) — nơi set giá trị các field này
- [src/shared/telegram.ts](../src/shared/telegram.ts) — hàm `buildConfirmationLine` (dòng 162-167), đổi text hiển thị từ "Đã xác nhận bởi Claude Sonnet 4.6" → "Đã xác nhận bởi Gemini 2.5 Pro", và "chỉ dựa trên Gemini" → câu phù hợp hơn (vd "chỉ dựa trên Gemini 2.5 Flash, chưa đối chiếu độc lập")

> Nếu muốn giảm rủi ro/diff tối thiểu, có thể **giữ nguyên tên field cũ** (`claudeConfirmed`...) và chỉ đổi nội dung text hiển thị — đánh đổi là tên field gây hiểu nhầm về sau. Quyết định cuối để Codex/người review chọn khi thực thi, nhưng khuyến nghị đổi tên field cho rõ ràng.

### 5. Dọn dẹp import
- Xoá `import Anthropic from "@anthropic-ai/sdk";` khỏi `analyzer.ts` nếu không còn dùng ở đâu khác trong file

## Phần bổ sung: thêm bước verify cho luồng betting (match-odds)

`src/betting/betting-gemini.ts` hiện chỉ gọi Gemini **1 lần duy nhất** (`analyzeMatchOdds`, model mặc định `gemini-2.5-flash` qua `GEMINI_MODEL` env) — không có bước đối chiếu độc lập như luồng chart analysis. Bổ sung verify tương tự, dùng cùng pattern check=flash / verify=pro:

### 1. Thêm hàm verify trong `betting-gemini.ts`
- Thêm `VERIFY_MODEL = "gemini-2.5-pro"` (hằng số riêng, không lệ thuộc `GEMINI_MODEL` env vì đó là model cho bước check)
- Thêm hàm `verifyMatchAnalysis(payload: MatchOddsPayload, analysis: MatchAiAnalysis): Promise<{ confirmed: boolean; confidence: number; comment: string }>`:
  - Gọi `GoogleGenAI` với `model: VERIFY_MODEL`
  - Prompt: đưa lại odds snapshot (`formatOddsAnalysisInput(payload)`) + kết luận của bước check (`preferredScoreline`, `recommendation`, `confidence`, `keyPoints`, `risks`) → yêu cầu Gemini Pro đánh giá độc lập xem kết luận đó có hợp lý, nhất quán với cấu trúc odds hay không
  - Yêu cầu trả JSON `{ confirmed: boolean, confidence: number, comment: string }`, parse theo cùng pattern `extractJsonObject` + `clampConfidence` đã có sẵn trong file
  - Chỉ verify khi **`confidence` của bước check ≥ 70** (giống ngưỡng >80% bên chart analysis nhưng betting đã có sẵn khái niệm "do ro tin hieu" ở mốc 70 trong `formatMatchAnalysisMessage`) — tránh tốn quota verify cho các kèo confidence thấp vốn đã kết luận "khong co edge ro rang"

### 2. Mở rộng type `MatchAiAnalysis`
Trong [src/betting/betting-types.ts](../src/betting/betting-types.ts), thêm field optional:
```ts
verifiedConfirmed?: boolean;
verifiedConfidence?: number;
verifiedComment?: string;
```

### 3. Gọi verify trong `odds-runner.ts`
Trong vòng lặp `for (const match of payload)` (dòng 77-93):
```ts
const analysis = await analyzeMatchOdds(match);
if (analysis.confidence >= 70) {
  try {
    const verification = await verifyMatchAnalysis(match, analysis);
    analysis.verifiedConfirmed = verification.confirmed;
    analysis.verifiedConfidence = verification.confidence;
    analysis.verifiedComment = verification.comment;
    console.log(`  ${verification.confirmed ? "✓" : "✗"} Verify ${match.home} vs ${match.away}: Gemini 2.5 Pro ${verification.confirmed ? "confirmed" : "rejected"} (${verification.confidence}%)`);
  } catch (error) {
    console.warn(`  ⚠ Verify failed for ${match.home} vs ${match.away}: ${error instanceof Error ? error.message : error}`);
  }
}
await sendMessage(formatMatchAnalysisMessage(match, analysis));
```
Nếu verify lỗi → bỏ qua, vẫn gửi tin nhắn với kết quả check gốc (không chặn luồng chính, giống cách `confirmHighConfidenceSetups` bên chart xử lý lỗi).

### 4. Hiển thị kết quả verify trong tin nhắn Telegram
Trong [src/betting/odds-text-format.ts](../src/betting/odds-text-format.ts) hàm `formatMatchAnalysisMessage` (dòng 192-217), thêm 1 dòng xác nhận sau dòng "Do ro tin hieu", chỉ hiện khi có `verifiedConfirmed`:
```ts
const verifyLine =
  analysis.verifiedConfirmed === undefined
    ? ""
    : analysis.verifiedConfirmed
      ? `✅ Da xac nhan boi Gemini 2.5 Pro (${analysis.verifiedConfidence}%)${analysis.verifiedComment ? ` — ${analysis.verifiedComment}` : ""}`
      : `⚠️ Gemini 2.5 Pro khong xac nhan ket qua nay (${analysis.verifiedConfidence}%)${analysis.verifiedComment ? ` — ${analysis.verifiedComment}` : ""}`;
```
Thêm `verifyLine` vào mảng `lines` (sau dòng "Do ro tin hieu", trước "Keo chinh"), theo đúng style đang dùng cho `buildConfirmationLine` bên chart (file `telegram.ts`).

## Phạm vi KHÔNG đổi
- **`package.json`** — vẫn giữ dependency `@anthropic-ai/sdk` vì có thể dùng lại sau khi nạp credit; không gỡ package, chỉ ngừng import trong `analyzer.ts`. Nếu muốn dọn hẳn, cân nhắc riêng sau, không nằm trong phạm vi plan này.
- **`.github/workflows/analyze.yml`** — vẫn giữ `ANTHROPIC_API_KEY` trong env (không gây lỗi gì nếu không dùng tới, nhưng có thể xoá dòng đó nếu muốn gọn — không bắt buộc).
- **GitHub Actions / Supabase / Telegram webhook** — không liên quan, không đổi gì.

## File cần sửa
- [src/charts/analyzer.ts](../src/charts/analyzer.ts) — toàn bộ thay đổi chính phần chart (mục 1-3, 5)
- [src/shared/types.ts](../src/shared/types.ts) — đổi tên field phần chart (mục 4, nếu chọn đổi)
- [src/shared/telegram.ts](../src/shared/telegram.ts) — cập nhật text hiển thị phần chart (mục 4)
- [src/betting/betting-gemini.ts](../src/betting/betting-gemini.ts) — thêm `verifyMatchAnalysis` (phần bổ sung mục 1)
- [src/betting/betting-types.ts](../src/betting/betting-types.ts) — thêm field verify vào `MatchAiAnalysis` (phần bổ sung mục 2)
- [src/betting/odds-runner.ts](../src/betting/odds-runner.ts) — gọi verify sau check (phần bổ sung mục 3)
- [src/betting/odds-text-format.ts](../src/betting/odds-text-format.ts) — hiển thị dòng verify (phần bổ sung mục 4)

## Kiểm thử

### Chart analysis (analyzer.ts)
1. Chạy `npm run analyze` (hoặc `npm run test-analyze`) cục bộ với `GEMINI_API_KEY` hợp lệ, **không cần** `ANTHROPIC_API_KEY` — xác nhận chạy hết luồng không lỗi do thiếu Anthropic key.
2. Kiểm tra log in ra đúng `"Gemini 3.5 Flash"` cho bước check, không còn nhắc tới Claude.
3. Với setup có confidence >80%, xác nhận log "Verifying ... with Gemini 2.5 Pro" xuất hiện, và tin nhắn Telegram cuối cùng hiển thị đúng dòng xác nhận mới (không còn chữ "Claude").
4. Test trường hợp Gemini lỗi (vd tạm sửa sai `GEMINI_API_KEY` để giả lập) — xác nhận lỗi được `notifyError` gửi qua Telegram, không có code nào cố gọi sang Anthropic SDK nữa.
5. Chạy `npm run build` (tsc) để đảm bảo không còn type lỗi sau khi đổi tên field (nếu chọn đổi field ở mục 4) — rà tất cả nơi tham chiếu `claudeConfirmed`/`claudeConfidence`/`claudeComment` còn sót.

### Betting / match-odds (betting-gemini.ts)
6. Chạy `npm run match-odds` với ít nhất 1 trận có `confidence` từ bước check ≥70 — xác nhận log "Verify ... Gemini 2.5 Pro" xuất hiện, tin nhắn Telegram có thêm dòng xác nhận/từ chối.
7. Test 1 trận có `confidence` <70 — xác nhận **không** gọi verify (tiết kiệm quota), tin nhắn không có dòng verify.
8. Test verify lỗi (vd tạm để model verify sai tên) — xác nhận luồng chính không bị chặn, vẫn gửi được tin nhắn với kết quả check gốc, chỉ thiếu dòng verify.
9. Chạy `npm run build` (tsc) sau khi thêm field mới vào `MatchAiAnalysis` — đảm bảo không lỗi type ở các nơi dùng `MatchAiAnalysis`.
