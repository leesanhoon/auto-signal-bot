# Task 03: Betting Domain — Layered Architecture Pilot

**Đọc trước:** [`../plan.md`](../plan.md) và [`../context.md`](../context.md) — bắt buộc, đặc biệt phần "Khảo sát domain betting" trong `context.md` có bảng mapping file cũ → layer mới. **Phụ thuộc subtask 01, 02 đã hoàn thành và approved.**

Đây là **pilot domain** — Lead sẽ review kỹ trước khi áp dụng pattern này sang `lottery` và `charts`. Làm đúng, đừng vội.

## Mục tiêu

Tái cấu trúc toàn bộ `src/betting/` (14 file) theo layer `controller/application/service/repository/client/model`, áp dụng DI factory pattern mô tả trong `context.md`, cập nhật `tests/betting/*` tương ứng, giữ nguyên 100% hành vi.

## Cấu trúc thư mục cần tạo

```
src/betting/
  controller/
    betting-index.ts
    fetch-matches-list-index.ts
    betting-backtest-runner.ts
  application/
    odds-application.ts
  service/
    betting-service.ts
    betting-backtest-service.ts
    odds-compact-service.ts
    odds-text-format-service.ts
    correct-score-service.ts
  repository/
    betting-analysis-repository.ts
    match-repository.ts
  client/
    betting-api-client.ts
    betting-ai-client.ts
  model/
    betting-types.ts
```

## Việc cần làm (theo thứ tự, bottom-up để tránh gãy dependency giữa chừng)

1. **model/**: di chuyển `betting-types.ts` → `model/betting-types.ts` nguyên trạng.
2. **client/**:
   - `betting-api.ts` → `client/betting-api-client.ts`. Đổi export chính sang factory nếu file hiện đang export các hàm rời (`fetchLiveFixtures`, `fetchOdds`, ...) — bọc lại thành `createBettingApiClient()` trả về object chứa các method đó, **giữ nguyên logic implementation từng hàm, chỉ đổi cách export**. Nếu factory hoá làm vỡ quá nhiều chỗ gọi, có thể giữ export hàm rời + thêm factory wrapper gọi lại các hàm đó (không bắt buộc xoá hàm rời nếu việc đó an toàn hơn — ưu tiên không vỡ hành vi hơn là ép form).
   - `betting-gemini.ts` → `client/betting-ai-client.ts`, tương tự.
3. **repository/**: di chuyển `betting-analysis-repository.ts`, `match-repository.ts` vào `repository/`. Đổi sang factory `createBettingAnalysisRepository(db: SupabaseClient)` / `createMatchRepository(db: SupabaseClient)` nhận `db` qua tham số thay vì gọi `getDb()` trực tiếp bên trong — đây là thay đổi DI thật sự, xem mẫu trong `context.md`.
4. **service/**: di chuyển `betting.ts` → `service/betting-service.ts`, `betting-backtest.ts` → `service/betting-backtest-service.ts`, `odds-compact.ts` → `service/odds-compact-service.ts`, `odds-text-format.ts` → `service/odds-text-format-service.ts`, `correct-score-api.ts` → `service/correct-score-service.ts`. Đây phần lớn là pure function, có thể giữ export hàm rời nếu không cần dependency injection — chỉ bọc thành factory nếu hàm cần `aiClient` hoặc dependency khác qua tham số.
5. **application/**: `odds-runner.ts` (`runOddsCheck()`) → `application/odds-application.ts`. Refactor thành `createOddsApplication(deps: { bettingApiClient, aiClient, bettingAnalysisRepository, matchRepository, notifier })` trả về `{ run(): Promise<void> }`, nội dung `run()` giữ đúng thứ tự logic hiện tại của `runOddsCheck()` (fetch → cache check → AI → notify → persist) nhưng gọi qua `deps.*` thay vì import path trực tiếp.
6. **controller/**: `betting-index.ts`, `fetch-matches-list-index.ts`, `betting-backtest-runner.ts` → `controller/`. Mỗi file trở thành composition root: tạo `db = getDb()`, khởi tạo các repository/client/notifier qua factory, gọi `createOddsApplication({...}).run()` (hoặc tương đương cho 2 file kia). Giữ nguyên hành vi CLI (exit code, error handling) như code gốc.
7. Xoá các file gốc ở vị trí cũ sau khi đã xác nhận toàn bộ nội dung đã chuyển đúng (không để trùng lặp 2 bản).
8. Cập nhật `package.json`: sửa path trong các script `match-odds`, `fetch-matches-list`, `betting-backtest` trỏ tới vị trí `controller/` mới. **Không đổi tên script.**
9. Cập nhật `tests/betting/*.test.ts`:
   - Với các phần đã chuyển sang factory DI (repository, application): sửa test để gọi factory với fake dependency truyền trực tiếp (theo mẫu trong `context.md`) thay vì `vi.mock(path)`.
   - Với các phần vẫn giữ pure function/export rời (phần lớn `service/`): giữ nguyên cách test hiện tại (import trực tiếp), chỉ sửa import path cho khớp vị trí file mới.
   - Đảm bảo tên file test vẫn mirror cấu trúc `src/` mới (di chuyển `tests/betting/xxx.test.ts` vào subfolder tương ứng nếu cần, theo rule "Test files mirror src/ structure" trong CLAUDE.md).

## Việc KHÔNG được làm

- Không sửa logic tính toán/business rule của bất kỳ hàm nào — chỉ đổi vị trí file + cách export/nhận dependency.
- Không đổi format message Telegram gửi ra (test hiện có nên bắt được nếu vô tình đổi — nếu test fail vì format khác, đó là bug cần fix, không phải est thay đổi cố ý).
- Không đụng vào `src/charts/`, `src/lottery/`, `src/shared/` (trừ việc *dùng* các export mới từ `shared/infra`, `shared/notification` đã có sẵn từ subtask 01/02).
- Không thêm test mới ngoài việc di chuyển/thích ứng test cũ (nếu muốn đề xuất thêm test, ghi vào `result.md` phần "đề xuất", không tự ý thêm).
- Không xoá `betting-types.ts`, `correct-score-api.ts` hay bất kỳ file nào chỉ vì nghi ngờ ít dùng — di chuyển nguyên trạng.

## Acceptance Criteria

- `npm run build` pass, không lỗi type.
- `npm test` pass, số test không giảm so với baseline (lấy từ `result.md` subtask 02).
- Cấu trúc thư mục đúng như mô tả ở trên.
- `npm run match-odds`, `npm run fetch-matches-list`, `npm run betting-backtest` — verify bằng cách chạy thử với env thật nếu có `.env` sẵn (nếu không có credential thật, verify bằng cách chạy `tsx --check` hoặc `node --experimental-strip-types --check` trên từng controller file để xác nhận không lỗi cú pháp/import, và ghi rõ trong `result.md` là chưa verify runtime thật do thiếu credential).
- Không còn file cũ trùng lặp ở vị trí gốc (`src/betting/betting-index.ts`, `src/betting/odds-runner.ts`, v.v. không còn tồn tại sau khi đã move).
- Repository và application đã dùng DI factory thật (nhận `db`/dependency qua tham số, không gọi `getDb()` hoặc import client trực tiếp bên trong hàm nghiệp vụ).

## Kết quả cần ghi vào `result.md`

- Bảng mapping file cũ → file mới đầy đủ (path chính xác).
- Với mỗi file đã factory-hoá: đoạn code trước/sau (trích ngắn) chứng minh đã chuyển sang nhận dependency qua tham số.
- Output đầy đủ `npm run build` và `npm test`.
- Danh sách test đã sửa và lý do sửa (path only vs chuyển sang factory injection).
- Ghi rõ phần nào **chưa** verify được runtime thật (vd do thiếu API key) để Lead biết rủi ro còn lại khi review.
- Nếu gặp file nào không rõ nên xếp vào layer nào (vd nghi ngờ giữa service/client) → ghi rõ quyết định đã chọn và lý do, không tự tạo layer mới ngoài 6 layer đã định nghĩa.
