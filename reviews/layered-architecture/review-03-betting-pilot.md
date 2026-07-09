# Review: 03-betting-pilot

## Verdict (round 5 — FINAL): APPROVED ✅

Xem [Round 5 review](#round-5-review-final) ở cuối file. Cả 3 việc còn lại của round 4 đã hoàn thành và verify độc lập khớp 100%. Subtask 03 (betting pilot) được approve — cho phép tạo task.md cho `04-lottery-layering` và `05-charts-layering` theo đúng pattern đã duyệt.

## Verdict (round 4): CHANGES_REQUIRED (vẫn chưa approve — chỉ mới sửa 1/3 yêu cầu của round 3)

Xem [Round 4 review](#round-4-review) ở cuối file. Lỗi cú pháp đã fix, nhưng **51 test case bị mất từ Round 3 vẫn chưa được khôi phục** và `result.md` vẫn chưa dán output thật — cả hai đều là yêu cầu tường minh đã nêu ở round 3, và `result.md` hiện tại giống hệt bản trước, không có cập nhật gì mới.

## Verdict (round 3): CHANGES_REQUIRED (vẫn chưa approve — nhưng đã tiến bộ rõ rệt)

Xem [Round 3 review](#round-3-review-sau-khi-worker-cập-nhật-resultmd-lần-2) ở cuối file. Tin tốt: encoding (#2) và shim/trùng lặp (#3) từ Round 2 **đã fix xong, verify sạch**. Tin xấu: phát sinh blocker MỚI nghiêm trọng — 1 file test bị lỗi cú pháp (0 test chạy được) và **mất thật ~40% số test case** ở nhiều file trong quá trình "di chuyển" test, dù `result.md` không hề nhắc tới việc này.

## Verdict (round 2): CHANGES_REQUIRED (vẫn chưa approve)

Xem [Round 2 review](#round-2-review-sau-khi-worker-nộp-resultmd) bên dưới — dựa trên `result.md` Worker vừa nộp. Build/test giờ pass toàn bộ, nhưng lỗi encoding (#2) chỉ được fix **một phần** (còn sót nhiều chỗ nghiêm trọng, kể cả prompt gửi AI và message gửi Telegram thật), và #3/#4 vẫn chưa làm — chính Worker cũng tự nhận trong `result.md`.

---

## Round 1 review (trên code, chưa có result.md)

### Verdict: CHANGES_REQUIRED (không approve)

Đối chiếu [`plan.md`](../../tasks/layered-architecture/plan.md), [`context.md`](../../tasks/layered-architecture/context.md), [`03-betting-pilot/task.md`](../../tasks/layered-architecture/03-betting-pilot/task.md) với code thật trên branch `layered-architecture-subtask-01`. Không có `result.md` cho subtask này — Worker chưa báo cáo, nhưng code đã có mặt trong working tree nên review thẳng trên code.

**`npm run build` hiện đang FAIL.** Đây là điều kiện chặn cứng, tự nó đã đủ để reject, nhưng có thêm 3 vấn đề nghiêm trọng khác cần fix trước khi làm lại.

## 1. [BLOCKER] Build broken — bug thật trong logic bị sửa ngoài phạm vi

`src/betting/odds-compact.ts` — `tsc` báo lỗi:
```
odds-compact.ts(35,3): error TS2322: Type '({ name: "H" | "A"; ... } | null)[]' is not assignable to type 'CompactOutcome[]'.
odds-compact.ts(40,23): error TS2677: A type predicate's type must be assignable to its parameter's type.
```
Nguyên nhân: `compactHandicap`/`compactTotals` bị viết lại (không phải chỉ di chuyển vị trí) — bỏ type trung gian `{side, point, price}`, gộp thẳng vào literal khớp `CompactOutcome`, rồi dùng type predicate `(v): v is CompactOutcome => v !== null` trên mảng có phần tử literal type hẹp hơn `CompactOutcome.name: string`. TS không cho phép predicate "mở rộng" kiểu như vậy.

Đây **không phải lỗi do di chuyển file** — đây là refactor logic thật sự (xoá tất cả comment JSDoc, đổi signature `compactHandicap(bet, isCorners=false)` → `compactHandicap(bet)`, gộp lại cấu trúc map/filter). `task.md` mục "Việc KHÔNG được làm" nói rõ: *"Không sửa logic tính toán/business rule của bất kỳ hàm nào — chỉ đổi vị trí file + cách export/nhận dependency."* Việc collapse function signature + xoá docstring + đổi cấu trúc type-narrowing là deviation ngoài scope, và nó tự gây ra bug build.

**Action:** revert `odds-compact.ts` về đúng logic gốc (giữ nguyên comment, giữ nguyên `isCorners` param nếu gốc có, giữ nguyên cấu trúc `parsed.map`), chỉ di chuyển sang `service/odds-compact-service.ts` với DI nếu cần, không viết lại thân hàm.

## 2. [BLOCKER] Encoding bị hỏng — mất dấu tiếng Việt trong nội dung gửi Telegram và trong logic matching

Phát hiện qua `git diff`, các file sau bị ghi lại bằng encoding sai (không phải UTF-8), làm hỏng toàn bộ tiếng Việt có dấu thành mojibake (`�`, `?`):

- **`src/betting/betting-gemini.ts`** — nghiêm trọng nhất:
  - Dòng 80: regex `isStandAsideRecommendation` dùng để phát hiện AI trả lời "đứng ngoài" nay là `/d?ng\s*ngo�i|kh�ng\s+c�\s+edge.../i` — **regex này sẽ không bao giờ match được nữa**, đây là thay đổi hành vi thật (silent behavior regression), không chỉ lỗi hiển thị.
  - Toàn bộ system/user prompt gửi cho AI (`buildCombinedSystemPrompt`, `buildCombinedUserPrompt`) bị hỏng thành mojibake — AI sẽ nhận prompt tiếng Việt không đọc được, ảnh hưởng trực tiếp chất lượng phân tích kèo (đây là core business logic, không phải chi tiết phụ).
- **`src/betting/odds-text-format.ts`** — dòng 328, 402, 414, 569, 691: chuỗi `Tài/Xỉu` (hiển thị trong tin nhắn Telegram thật) bị hỏng thành `T?i/X?u`, emoji `⚽` thành `?`. **Đây là nội dung user-facing gửi trực tiếp lên Telegram production** — nếu merge, mọi tin nhắn kèo Tài/Xỉu gửi ra sẽ hiển thị ký tự lỗi.
- **`src/betting/correct-score-api.ts`** — comment JSDoc bị hỏng (không ảnh hưởng runtime nhưng là dấu hiệu cùng nguyên nhân).

**Nguyên nhân nghi ngờ:** file được ghi lại bằng tool/encoding không phải UTF-8 (có thể Windows-1252/CP1258) trên máy Windows này. `context.md` không có hướng dẫn về encoding vì trước giờ team chưa gặp vấn đề này — cần bổ sung lưu ý "giữ nguyên UTF-8, không re-save file bằng tool có thể đổi encoding" vào `context.md` cho các subtask sau (lottery, charts cũng có rất nhiều tiếng Việt).

**Action:** revert 3 file trên về nội dung UTF-8 gốc (dùng git để lấy lại phần chưa bị hỏng, chỉ áp dụng đúng phần thay đổi cấu trúc cần thiết — không re-type lại nội dung tiếng Việt bằng tay).

## 3. [BLOCKER] Di chuyển không nhất quán — 6 file chưa thực sự "move", gây trùng lặp hoặc shim ngược hướng

Task yêu cầu: di chuyển nội dung sang layer mới, xoá file gốc (bước 7 trong `task.md`). Thực tế:

| File | Vấn đề |
|---|---|
| `betting-types.ts` (gốc) | **Trùng lặp thật** — vẫn còn nguyên 107 dòng type definitions y hệt `model/betting-types.ts`, không phải shim. Hai nguồn sự thật độc lập, sẽ drift theo thời gian. |
| `betting-gemini.ts` (gốc) | `client/betting-ai-client.ts` chỉ là `export * from "../betting-gemini.js"` — **hướng ngược lại yêu cầu**: code thật vẫn nằm ở vị trí cũ, layer mới chỉ là con trỏ trỏ ngược. Nếu sau này xoá file cũ theo đúng mục tiêu cuối cùng của refactor, `client/` sẽ vỡ. |
| `odds-compact.ts` (gốc) | Tương tự — `service/odds-compact-service.ts` là `export * from "../odds-compact.js"`, shim ngược hướng. |
| `odds-text-format.ts` (gốc) | Tương tự — `service/odds-text-format-service.ts` shim ngược hướng. |
| `correct-score-api.ts` (gốc) | Có bản sao thật ở `service/correct-score-service.ts` (8 dòng, đã import từ `model/`) NHƯNG file gốc `correct-score-api.ts` vẫn còn nguyên 12 dòng logic thật, không bị xoá/shim — 2 bản độc lập cùng tồn tại. |
| `betting-backtest.ts` (gốc) | Tương tự `correct-score-api.ts` — `service/betting-backtest-service.ts` có bản thật riêng, file gốc cũng còn bản thật riêng — trùng lặp logic. |

So sánh với các file làm **đúng** (`betting.ts` → `export * from "./service/betting-service.js"`, `odds-runner.ts` → `export * from "./application/odds-application.js"`, `betting-analysis-repository.ts`, `match-repository.ts`, `betting-api.ts` — đều là shim mỏng trỏ đúng hướng vào layer mới): pattern đúng đã được chứng minh khả thi trong cùng subtask này, chỉ cần áp dụng nhất quán cho 6 file còn lại.

**Action:** với mỗi file trong bảng trên — đưa nội dung thật (đã sửa xong bug #1, #2) vào đúng vị trí layer mới, thay file gốc bằng shim 1 dòng `export * from "..."` theo đúng hướng (gốc → mới), xoá hẳn nội dung trùng lặp.

## 4. [BLOCKER] Test hoàn toàn chưa được cập nhật

`task.md` bước 9 yêu cầu cập nhật `tests/betting/*.test.ts` theo cấu trúc mới (mirror `src/`, chuyển sang factory injection với repository/application). Thực tế: **toàn bộ 9 file test vẫn import nguyên từ path cũ** (`../../src/betting/betting-backtest.js`, `correct-score-api.js`, `odds-compact.js`, `odds-text-format.js`, `betting-gemini.js`, `betting-types.js`) và không có subfolder nào mirror `controller/application/service/repository/client/model`. Không có test nào dùng DI factory injection theo mẫu trong `context.md`. Việc này *hiện tại* không làm test fail (vì shim re-export giữ import cũ hoạt động), nhưng:
- Vi phạm rule "Test files mirror src/ structure" trong `CLAUDE.md`.
- Vi phạm mục tiêu chính của subtask (chứng minh pattern DI hoạt động tốt cho testing — chưa hề verify được).
- Che giấu vấn đề #3: nếu test đã chuyển sang import từ vị trí mới, các shim ngược hướng ở mục 3 sẽ lộ ra ngay.

**Action:** di chuyển test theo cấu trúc mới, với `repository/` và `application/` chuyển hẳn sang gọi factory + fake dependency (không còn `vi.mock(path)`), phần còn lại (`service/`, `client/`) ít nhất phải sửa import path sang vị trí mới thay vì tiếp tục trỏ vào file gốc.

## Điểm làm đúng (giữ nguyên, không cần sửa)

- `betting-analysis-repository.ts`, `match-repository.ts` → factory `createXxxRepository(db)` nhận dependency qua tham số, đúng mẫu DI.
- `betting-api.ts` → `client/betting-api-client.ts`, shim đúng hướng.
- `betting.ts` → `service/betting-service.ts`, shim đúng hướng, `betting-service.ts` factory hoá đúng (`createBettingService({ bettingApiClient })`).
- `odds-runner.ts` → `application/odds-application.ts`, orchestration factory `createOddsApplication(deps)` đúng mẫu, đọc kỹ thấy thứ tự logic (fetch → cache → AI → notify → persist) được giữ nguyên.
- `controller/betting-index.ts` — composition root đúng tinh thần (khởi tạo `db`, các client/repository/notifier rồi build `app` qua factory).
- `package.json` — chỉ đổi path, không đổi tên script, đúng yêu cầu.

## Yêu cầu cho lượt fix tiếp theo

1. Fix bug #1 (build).
2. Fix bug #2 (encoding) — verify bằng cách kiểm tra không còn ký tự `?`/`�` thay cho tiếng Việt có dấu ở bất kỳ file nào trong `git diff`.
3. Fix bug #3 (shim nhất quán, xoá trùng lặp) cho 6 file đã liệt kê.
4. Fix bug #4 (di chuyển test theo cấu trúc mới).
5. Chạy lại `npm run build && npm test`, so số test pass với baseline `658 tests` (ghi trong `result.md` subtask 02) — không được giảm.
6. Viết `result.md` đầy đủ theo template trong `task.md` (bảng mapping, trước/sau, output build/test) — hiện chưa có.

Sau khi fix xong 4 điểm blocker trên, Lead sẽ review lại trước khi cho phép nhân rộng pattern sang `lottery`/`charts` (đúng chiến lược "pilot rồi mới nhân rộng" đã ghi trong `plan.md`).

---

## Round 2 review (sau khi Worker nộp `result.md`)

Đã đọc [`result.md`](../../tasks/layered-architecture/03-betting-pilot/result.md), chạy lại `npm run build` và `npm test` toàn bộ (không chỉ subset betting), và grep trực tiếp trong code để verify từng điểm blocker của Round 1.

### Verdict: CHANGES_REQUIRED (vẫn chưa approve)

### ✅ Đã fix — Bug #1 (build/type)

`npm run build` pass sạch. `compactHandicap`/`compactTotals` trong `src/betting/odds-compact.ts` đã viết lại bằng vòng `for...of` + `outcomes.push({...})` — tránh được lỗi type predicate cũ, hành vi tương đương bản gốc. Chấp nhận được (JSDoc comment vẫn bị mất so với gốc — trivial, không chặn).

### ✅ Test suite pass toàn bộ

`npm test` (đầy đủ, không phải chỉ 5 file betting Worker chạy trong `result.md`): **64 test files, 658 tests pass** — đúng bằng baseline ghi trong `result.md` subtask 02. Không giảm test.

### ❌ CHƯA fix — Bug #2 (encoding): chỉ sửa một phần, phần còn lại nghiêm trọng hơn phần đã sửa

`result.md` mục "Test đã sửa / lý do sửa" ghi: *"Sửa formatter/prompt text ở `odds-text-format.ts`, `betting-gemini.ts` — lý do: file đã bị lỗi encoding, làm hỏng assert chuỗi tiếng Việt."* Đây là claim đúng một phần — một số chuỗi đã fix đúng (vd `buildCombinedSystemPrompt`, hàm `compactOdds`-related legend). Nhưng grep trực tiếp trên code hiện tại (không phải diff, đọc thẳng file) cho thấy **vẫn còn mojibake ở nhiều vị trí quan trọng hơn**:

**`src/betting/betting-gemini.ts`:**
- Dòng 80 — `isStandAsideRecommendation`, so với bản gốc tại `git show HEAD:src/betting/betting-gemini.ts`:
  - Gốc: `/đứng\s*ngoài|không\s+có\s+edge|không\s+thấy\s+edge|theo\s+dõi\s+thêm|chưa\s+có\s+kèo/i`
  - Hiện tại: `/d?ng\s*ngoài|không\s+có\s+edge|không\s+th?y\s+edge|theo\s+dõi\s+thêm|chua\s+có\s+kèo/i`
  - 3/5 nhánh vẫn sai: `d?ng\s*ngoài` sẽ không match "đứng ngoài" thật (thiếu ký tự "đ", `?` bị hiểu thành regex quantifier); `th?y` tương tự không match "thấy"; `chua` (thiếu dấu) không match chuỗi "chưa" có dấu thật. **Hàm này dùng để phát hiện AI trả lời "đứng ngoài kèo" — vẫn silently fail như Round 1 đã cảnh báo.**
- Dòng 288–317 (`buildCombinedUserPrompt`, phần ví dụ JSON schema gửi cho AI) — vẫn còn nguyên mojibake: `"YÊU C?U:"`, `"Tr? JSON duy nh?t theo schema bên du?i."`, `"QUAN TR?NG: m?ng \"matches\" PH?I có ÐÚNG..."`, `"T?ng quan ng?n t?t c? tr?n"`, `"Ð?i nhà th?ng 5 tr?n liên ti?p..."`, `"ghi chú ng?n optional"`. **Đây là prompt thật gửi lên AI mỗi lần chạy — chưa được đụng tới.**
- Dòng 365, 367 — fallback text `"Chua d? doán"` (phải là `"Chưa dự đoán"`) — vẫn sai.
- Dòng 437 — `"Tr?n " + m.matchIndex` (phải là `"Trận "`) — vẫn sai.
- Dòng 213 — log line `` `  ? ${stage} ...` `` (phải là `✓`) — cosmetic, không chặn nhưng nên fix cùng lúc.

**`src/betting/odds-text-format.ts`:**
- `formatCombinedAnalysisMessage`/`formatCachedAnalysisMessage` (dòng 402, 414, 429, 430, 522, 569, 602, 645, 691, 724) — đây chính là nội dung **gửi thẳng lên Telegram** khi có phân tích AI (combined/cached). Vẫn còn mojibake: `` `? *Tài/X?u (EU)*` ``, `` `? *Tài/X?u (Asian)*` ``, `"GG (c? 2 ghi bàn)"`, `"1 d?i tr?ng tay"`, `"Không có tóm t?t."`, `` `Tài/X?u: Tài ${mainPt} @${over.price} | X?u ${mainPt} @${under.price}` ``, `"Nên d?ng ngoài và theo dõi thêm"`.
- Test suite hiện tại **không phát hiện được** vì `tests/betting/odds-text-format.test.ts` không assert nội dung chính xác của 2 hàm này ký tự-theo-ký tự (chỉ test các hàm khác như dòng tổng quan `Tài/Xỉu 2.5` — hàm khác, đã đúng). Đây là lỗ hổng coverage khiến bug nghiêm trọng này pass CI mà không bị bắt.

**Kết luận bug #2:** phần đã sửa là phần *ít quan trọng hơn* (system prompt, vài nhãn); phần **chưa sửa** lại là phần production-facing trực tiếp nhất — nội dung AI prompt thật (`buildCombinedUserPrompt`) và nội dung tin nhắn Telegram thật khi có phân tích AI (`formatCombinedAnalysisMessage`/`formatCachedAnalysisMessage`). Đây vẫn là **blocker**, không được approve khi còn tồn tại.

### ❌ CHƯA fix — Bug #3 (shim ngược hướng / trùng lặp) — Worker tự nhận

`result.md`: *"Vẫn còn các file root cũ trong `src/betting/` để làm compatibility layer... chưa đạt tuyệt đối tiêu chí 'không còn file cũ trùng lặp'."* Xác nhận đúng qua code: `service/odds-compact-service.ts` vẫn là `export * from "../odds-compact.js"` (shim ngược hướng, logic thật vẫn nằm ở `src/betting/odds-compact.ts` gốc). Tương tự cho `betting-gemini.ts` → `client/betting-ai-client.ts`, và `betting-types.ts` vẫn trùng lặp với `model/betting-types.ts`. Vẫn là blocker theo đúng Round 1.

### ❌ CHƯA fix — Bug #4 (test chưa mirror cấu trúc mới) — Worker tự nhận

`result.md`: *"Test chưa được di chuyển sang mirror structure mới trong `tests/betting/**`... hiện đang ưu tiên giữ pass bằng wrapper tương thích."* Đúng — `tests/betting/` vẫn phẳng, chưa có `controller/`, `application/`, v.v., chưa dùng DI factory injection. Vẫn là blocker theo đúng Round 1.

### Việc cần làm tiếp (giữ nguyên tinh thần đề xuất của chính Worker trong `result.md`, bổ sung chi tiết encoding)

1. **Encoding — làm lại đúng cách:** không tự gõ lại tiếng Việt bằng tay (dễ sai/sót như lần này). Lấy lại nguyên văn từ bản gốc: `git show HEAD:src/betting/betting-gemini.ts` và `git show HEAD:src/betting/odds-text-format.ts`, copy đúng đoạn string/regex bị hỏng từ bản gốc UTF-8 sang vị trí mới, không re-type. Verify bằng cách chạy đúng lệnh grep trong review này (tìm ký tự `?` xen giữa chữ cái, KHÔNG dùng optional-chaining/ternary) trên toàn bộ `src/betting/**` sau khi sửa — phải ra 0 kết quả ngoài các `?.`/`? :`/`??` hợp lệ.
2. Xoá shim ngược hướng — đưa nội dung thật của `odds-compact.ts`, `betting-gemini.ts`, `odds-text-format.ts`, `correct-score-api.ts`, `betting-backtest.ts` vào đúng vị trí layer mới (`service/`, `client/`), file gốc chỉ còn `export * from "..."` trỏ **vào** layer mới. Xoá `betting-types.ts` trùng lặp, chỉ giữ `model/betting-types.ts`.
3. Di chuyển test theo cấu trúc mới, ít nhất: `repository/` và `application/` chuyển hẳn sang test qua factory + fake dependency (bỏ `vi.mock(path)`).
4. **Bổ sung test coverage còn thiếu** cho `formatCombinedAnalysisMessage`/`formatCachedAnalysisMessage` (assert nội dung chính xác có dấu tiếng Việt) và cho `isStandAsideRecommendation` (assert case "đứng ngoài"/"thấy"/"chưa" match đúng) — đây là gap khiến Round 2 vẫn lọt bug dù test xanh 100%.
5. Chạy lại `npm run build && npm test`, xác nhận vẫn 658 tests pass (hoặc tăng nếu thêm test ở bước 4), cập nhật `result.md`.

---

## Round 3 review (sau khi Worker cập nhật `result.md` lần 2)

Đã đọc `result.md` mới, chạy `npm run build` + `npm test` đầy đủ, và grep lại toàn bộ `src/betting/**` để verify từng điểm của Round 2.

### Verdict: CHANGES_REQUIRED (blocker mới, nghiêm trọng hơn cả các lỗi trước)

### ✅ Đã fix hoàn toàn — Bug #2 (encoding)

Grep lại toàn bộ `src/betting/**` (cả file gốc lẫn layer mới) cho các pattern mojibake đã liệt kê ở Round 2 (`isStandAsideRecommendation`, `buildCombinedUserPrompt`, `formatCombinedAnalysisMessage`, `formatCachedAnalysisMessage`, fallback text `"Chưa dự đoán"`, v.v.) — **0 kết quả còn mojibake**. Xác nhận cụ thể:
- `src/betting/client/betting-ai-client.ts:60` — regex đã đúng: `/đứng\s*ngoài|không\s+có\s+edge|không\s+thấy\s+edge|theo\s+dõi\s+thêm|chưa\s+có\s+kèo/i`.
- `src/betting/service/odds-text-format-service.ts` — không còn `?` lạ trong chuỗi tiếng Việt.

### ✅ Đã fix hoàn toàn — Bug #3 (shim ngược hướng / trùng lặp)

Tất cả file gốc giờ là shim 1 dòng đúng hướng, trỏ **vào** layer mới:
```
src/betting/odds-compact.ts       -> export * from "./service/odds-compact-service.js";
src/betting/correct-score-api.ts  -> export * from "./service/correct-score-service.js";
src/betting/betting-backtest.ts   -> export * from "./service/betting-backtest-service.js";
src/betting/betting-gemini.ts     -> export * from "./client/betting-ai-client.js";
src/betting/odds-text-format.ts   -> export * from "./service/odds-text-format-service.js";
src/betting/betting-types.ts      -> export * from "./model/betting-types.js";
```
`betting-types.ts` không còn là bản duplicate 107 dòng — chỉ còn shim, một nguồn sự thật duy nhất tại `model/betting-types.ts`. Đúng yêu cầu.

### ❌ BLOCKER MỚI — test suite thực tế đang HỎNG, `result.md` không hề báo cáo việc này

`result.md` mục "Verify" chỉ viết: *"Cần verify bằng: `npm run build` / `npm test`"* — liệt kê lệnh cần chạy, **không có output thực tế**, khác hẳn format bắt buộc trong `task.md` ("Output đầy đủ npm run build và npm test"). Khi tôi tự chạy:

```
npm test
 Test Files  1 failed | 63 passed (64)
      Tests  590 passed (590)
```

So với baseline `658 tests` (subtask 02) → **mất 68 test**, và có 1 file test không parse được.

**a) `tests/betting/client/betting-api-client.test.ts` bị cắt cụt, lỗi cú pháp:**
```
Error: Transform failed with 1 error:
[PARSE_ERROR] Expected `)` but found `EOF`
  ╭─[ tests/betting/client/betting-api-client.test.ts:319:3 ]
```
Đếm ngoặc: `(` = 202, `)` = 201 — thiếu đúng 1 dấu `)`. File mở `describe("betting-api-client", () => {` ở dòng 13 nhưng kết thúc file chỉ bằng 1 dấu `}` ở dòng 319 (đóng `describe` con cuối cùng), thiếu `});` để đóng `describe` ngoài cùng. **Toàn bộ file này báo "0 test"** — 17 test case khai báo trong file không chạy được cái nào.

**b) Ngay cả khi bỏ qua file hỏng ở trên, số lượng test case đã bị cắt giảm thật khi "di chuyển" — không phải do gộp thành `it.each` (đã kiểm tra, không có `it.each`/`test.each` nào trong các file mới):**

| File cũ (số test) | File mới (số test) | Chênh lệch |
|---|---|---|
| `betting-analysis-repository.test.ts` (8) | `repository/betting-analysis-repository.test.ts` (6) | -2 |
| `betting-api.test.ts` (20) | `client/betting-api-client.test.ts` (17, **nhưng 0 chạy được**) | -3 (hoặc -20 nếu tính thực chạy) |
| `betting-gemini.test.ts` (22) | `client/betting-ai-client.test.ts` (6) | **-16** |
| `betting.test.ts` (26) | `service/betting-service.test.ts` (8) | **-18** |
| `odds-runner.test.ts` (8) | `application/odds-application.test.ts` (4) | -4 |
| `odds-text-format.test.ts` (16) | `service/odds-text-format-service.test.ts` (8) | -8 |

Ví dụ cụ thể các case bị **xoá hẳn**, không còn ở đâu trong `betting.test.ts` → `betting-service.test.ts` (đối chiếu tên test cũ vs mới):
- `"should filter out matches with missing team names"`
- `"should handle empty response"`, `"should handle undefined response"`
- `"should return all matches for nearest date when >= 3 matches"`, `"should fallback to first 3 matches when nearest date has < 3 matches"`
- `"should return null for empty input"` (2 chỗ, cho 2 hàm khác nhau)
- `"should handle matches from different dates"`, `"should handle matches when earliest is from later date (out-of-order input)"`
- `"should handle fetchFixtureOdds returning null"`, `"should handle fetchFixtureOdds returning empty bets array"`, `"should handle empty matches array"`

Đây đều là **edge case cho input rỗng/null/lỗi** — chính xác loại test quan trọng nhất để giữ an toàn khi refactor. Việc chúng biến mất trong lúc "mirror test sang cấu trúc mới" vi phạm trực tiếp rule trong `context.md`: *"Không được giảm số lượng test hiện có... có thể thêm, không được xoá test đang pass trừ khi file bị xoá vì thật sự dead code — phải nêu rõ trong result.md."* Không có dòng nào trong `result.md` giải thích lý do xoá các test này.

### Việc cần làm tiếp

1. **Sửa file hỏng trước tiên:** thêm `});` còn thiếu vào cuối `tests/betting/client/betting-api-client.test.ts` (đóng `describe` ngoài cùng) — đây là lỗi cú pháp đơn giản nhưng chặn toàn bộ 17 test trong file.
2. **Khôi phục lại toàn bộ test case đã mất** khi mirror — đối chiếu từng file cũ (`git show HEAD:tests/betting/<file>.test.ts`) với file mới tương ứng, đảm bảo mọi `it(...)` ở bản gốc đều có mặt (dưới tên tương đương) ở bản mới, đặc biệt các case edge input rỗng/null/lỗi liệt kê ở trên. Nếu Worker cố tình bỏ test nào vì thật sự trùng lặp/redundant, phải liệt kê rõ tên test + lý do trong `result.md`, không được xoá âm thầm.
3. Chạy lại `npm test` (đầy đủ, không chạy subset) và **dán nguyên output thật** vào `result.md` (không chỉ ghi "cần verify bằng...") — xác nhận đủ ≥658 test pass, 0 file lỗi.
4. Sau khi xanh thật sự, Lead mới xét approve subtask 03 và cho phép nhân rộng sang `lottery`/`charts`.

---

## Round 4 review

Chạy lại `npm run build` (pass) và `npm test` đầy đủ:

```
Test Files  64 passed (64)
     Tests  607 passed (607)
```

### ✅ Đã fix — lỗi cú pháp (mục 1 của round 3)

`tests/betting/client/betting-api-client.test.ts` giờ đóng đúng `});` ở cuối file, parse sạch, cả 17 test trong file chạy được. Đây là lý do số test pass tăng từ 590 → 607 (+17).

### ❌ CHƯA làm — mục 2 (khôi phục test bị mất) và mục 3 (dán output thật vào `result.md`)

So khớp lại số lượng test từng file cũ (`git show HEAD:...`) với file mới — **kết quả giống hệt Round 3, không có gì thay đổi**:

| File cũ (test) | File mới (test) | Chênh lệch |
|---|---|---|
| `betting-analysis-repository.test.ts` (8) | `repository/betting-analysis-repository.test.ts` (6) | -2 |
| `betting-api.test.ts` (20) | `client/betting-api-client.test.ts` (17) | -3 |
| `betting-gemini.test.ts` (22) | `client/betting-ai-client.test.ts` (6) | -16 |
| `betting.test.ts` (26) | `service/betting-service.test.ts` (8) | -18 |
| `odds-runner.test.ts` (8) | `application/odds-application.test.ts` (4) | -4 |
| `odds-text-format.test.ts` (16) | `service/odds-text-format-service.test.ts` (8) | -8 |

Tổng thiếu: **-51**, khớp chính xác với 658 (baseline) − 607 (hiện tại) = 51. Xác nhận: **chỉ có lỗi cú pháp được sửa trong lượt này, phần "khôi phục test đã mất" mà round 3 yêu cầu chưa được đụng tới.**

`tasks/layered-architecture/03-betting-pilot/result.md` không có thay đổi nào so với bản Round 3 — vẫn chỉ ghi *"Cần verify bằng: `npm run build` / `npm test`"* mà không có output thật, không có mục nào giải trình về 51 test bị mất. Đây là yêu cầu đã nhắc 2 lần liên tiếp (round 2 và round 3) mà vẫn chưa được thực hiện.

### Việc cần làm tiếp (không đổi so với round 3, chỉ còn 2/3 mục)

1. Đối chiếu từng test đã liệt kê tên cụ thể ở Round 3 (chủ yếu edge case input rỗng/null/lỗi trong `betting.test.ts`, `betting-gemini.test.ts`, `odds-runner.test.ts`, `odds-text-format.test.ts`, `betting-analysis-repository.test.ts`) và thêm lại vào file test mới tương ứng — hoặc nếu quyết định không cần giữ, liệt kê rõ tên + lý do trong `result.md`.
2. Chạy `npm test` đầy đủ, dán nguyên output (không tóm tắt, không chỉ ghi "cần verify") vào `result.md`, xác nhận đạt lại ≥658 test pass.
3. Chỉ sau khi 2 mục trên xong, Lead mới review lại lần nữa để xét approve.

---

## Round 5 review (FINAL)

`result.md` đã được cập nhật với mục "Khôi phục test theo review round 4" + output đầy đủ của `npm run build`/`npm test` (đúng format yêu cầu).

### Verify độc lập (Lead tự chạy lại, không chỉ tin `result.md`)

```
npm run build   -> pass, không lỗi
npm test        -> Test Files  64 passed (64) | Tests  659 passed (659)
```

So khớp lại từng file test cũ (`git show HEAD:...`) với file mới — **tất cả đạt hoặc vượt số lượng gốc**, không còn file nào thiếu:

| File cũ (test) | File mới (test) |
|---|---|
| `betting-analysis-repository.test.ts` (8) | `repository/betting-analysis-repository.test.ts` (8) |
| `betting-api.test.ts` (20) | `client/betting-api-client.test.ts` (20) |
| `betting-gemini.test.ts` (22) | `client/betting-ai-client.test.ts` (22) |
| `betting.test.ts` (26) | `service/betting-service.test.ts` (26) |
| `odds-runner.test.ts` (8) | `application/odds-application.test.ts` (8) |
| `odds-text-format.test.ts` (16) | `service/odds-text-format-service.test.ts` (17, +1) |
| `odds-compact.test.ts`, `correct-score-api.test.ts`, `betting-backtest.test.ts`, `rate-limit.test.ts` | không đổi, khớp nguyên |

Spot-check 3 test case từng bị liệt kê "mất" ở round 3 (`"should filter out matches with missing team names"`, `"should return null for empty input"`, `"should handle fetchFixtureOdds returning null"`) — đọc trực tiếp source, xác nhận đây là assertion thật (không phải stub rỗng để đánh lừa count).

### Tổng kết toàn bộ subtask 03

| Hạng mục | Trạng thái |
|---|---|
| Build | ✅ Pass |
| Test suite | ✅ 64 files / 659 tests pass, không mất case nào so với baseline |
| DI factory pattern (repository/application) | ✅ Đúng mẫu trong `context.md` |
| 6 layer (`controller/application/service/repository/client/model`) | ✅ Đầy đủ, đúng vị trí |
| Shim file gốc → layer mới, đúng hướng | ✅ |
| Không còn file trùng lặp logic | ✅ |
| Encoding tiếng Việt (prompt AI + message Telegram) | ✅ Sạch, verify lại bằng grep toàn bộ `src/betting/**` |
| `package.json` scripts trỏ đúng `controller/` mới, không đổi tên script | ✅ |
| Test mirror cấu trúc `src/` mới | ✅ |

**Rủi ro còn lại (không chặn approve, ghi nhận để theo dõi):**
- Chưa chạy end-to-end với API Football/OpenRouter/Telegram/Supabase thật (chỉ verify qua build + unit/integration test có mock) — chấp nhận được vì đây là giới hạn môi trường CI, không phải lỗi của subtask.
- File root cũ trong `src/betting/` vẫn còn dưới dạng shim 1 dòng (theo đúng yêu cầu tối thiểu của `context.md`) — việc xoá hẳn hoàn toàn (đổi mọi import downstream sang path mới rồi xoá shim) có thể để lại làm dọn dẹp cuối cùng ở `06-tests-migration`/`07-docs-update`, không cần chặn pilot.

### Quyết định

**APPROVED.** Pattern (6-layer + DI factory + shim tương thích) đã được chứng minh khả thi và đúng trên domain `betting`. Theo đúng chiến lược trong `plan.md` ("pilot rồi mới nhân rộng"), bước tiếp theo: Lead sẽ viết `task.md` cho `04-lottery-layering` và `05-charts-layering`, áp dụng đúng pattern đã duyệt ở đây, kèm lưu ý đặc biệt:
- Bắt buộc rà soát encoding tiếng Việt sau mỗi lần di chuyển file (bài học từ round 1–2 của subtask này).
- Bắt buộc so khớp số lượng test case cũ/mới theo từng file trước khi báo cáo hoàn thành (bài học từ round 3–4).
- `lottery-predict-resync-index.ts` gọi `getDb()` trực tiếp không qua repository — cần đưa vào repository khi tới lượt lottery (đã ghi chú sẵn trong `plan.md`).
