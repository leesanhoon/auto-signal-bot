# Plan: Layered Architecture Refactor (controller / application / service / repository / client / model + DI)

## Bối cảnh (từ khảo sát codebase thực tế)

- Hệ thống là **CLI/cron script system**, KHÔNG có HTTP server (không express/fastify). 11 GitHub Actions workflow chạy `npm run <script>` → `tsx src/<domain>/<file>.ts` theo cron. Vậy **"controller" ở đây = entrypoint script (`*-index.ts`), không phải HTTP route.**
- 3 domain: `src/charts` (26 file + `setups/`, `smc/`), `src/betting` (14 file, flat), `src/lottery` (24 file, flat), cộng `src/shared` (13 file cross-cutting).
- Pattern hiện tại trong mỗi domain: file phẳng, đặt tên theo hậu tố không nhất quán quy tắc layer (`-index.ts` = entrypoint, `-runner.ts` = orchestration, `-repository.ts` = data access, còn lại là logic/analysis/client trộn lẫn không phân biệt).
- **Không có DI**: `src/shared/db.ts` là module-level lazy singleton (`getDb()`), đọc `process.env` trực tiếp bên trong module. 12+ file gọi `getDb()` trực tiếp bằng import path.
- `src/shared/notifier.ts` định nghĩa `interface Notifier` nhưng **không hề được dùng** ở đâu khác — dead code. Mọi nơi gọi thẳng `sendMessage`/`sendPhoto`/`sendDocument` từ `telegram.ts` bằng import path.
- `telegram.ts` (28KB) trộn lẫn: raw Telegram Bot API client + hàm build message theo domain chart (`buildSmcSignalMessage`, `buildPositionDecisionMessage`, ...) → đã leak domain logic vào "shared".
- Test hiện tại dùng `vi.mock("../../src/xxx.js", () => ({...}))` theo path — mock toàn bộ dependency graph của entrypoint. Đây là kiểu mock giòn (path-based), sẽ được thay bằng dependency injection qua factory (truyền fake object trực tiếp) khi refactor.
- Cả 3 domain có cùng shape orchestration: **fetch (API client/repository) → transform/analyze (business logic) → persist (repository) → notify (telegram)**, hiện đang viết lồng nhau trong 1 hàm runner, không tách lớp.

## Kiến trúc mục tiêu

Áp dụng cho từng domain (`charts`, `betting`, `lottery`):

```
src/<domain>/
  controller/     # (trước là *-index.ts) — entrypoint CLI/cron: parse argv/env, build composition root, gọi application, set exit code
  application/    # (trước là *-runner.ts) — use-case orchestrator: điều phối service + repository + notifier, KHÔNG chứa business rule
  service/        # business/domain logic thuần: analyzer, pipeline, engine, decision, indicators, setups/, smc/, format
  repository/     # data access Supabase — giữ nguyên naming *-repository.ts, thêm interface để mock dễ hơn
  client/         # external API client (betting-api, betting-gemini, lottery-scraper, ohlc-provider, screenshot, correct-score-api)
  model/          # (trước là *-types.ts) — pure type/interface definitions
```

```
src/shared/
  infra/          # db.ts (factory createSupabaseClient thay vì singleton ẩn), env.ts, logger.ts, retry.ts, rate-limit.ts, fetch-diagnostics.ts
  notification/   # telegram-client.ts (raw Bot API, implement Notifier interface thật sự), notifier.ts (interface, không còn dead code)
  ai/             # ai-env.ts, ai-model-fallback.ts, ai-usage.ts, openrouter.ts
  util/           # vn-time.ts, stats.ts, stats-report.ts, telegram-webhook-idempotency.ts
```

## Quyết định DI: factory function thủ công, KHÔNG dùng IoC container framework

**Không dùng** InversifyJS/tsyringe (decorator + `reflect-metadata`). Lý do:
- Runtime là script one-shot (tsx chạy rồi thoát theo cron), không phải server sống lâu — container framework tốn overhead khởi tạo & thêm dependency nặng không tương xứng lợi ích.
- Codebase hiện dùng arrow function, style tối giản; container decorator sẽ xung đột với nguyên tắc "không thêm abstraction ngoài nhu cầu" trong CLAUDE.md.
- Test hiện đại đã mock theo path — chuyển sang factory nhận dependency qua tham số là bước nâng cấp tự nhiên, không cần learning curve mới.

**Pattern áp dụng thống nhất:**
```ts
// repository/xxx-repository.ts
export function createXxxRepository(db: SupabaseClient) {
  return {
    async loadX(...) { ... },
    async saveX(...) { ... },
  };
}
export type XxxRepository = ReturnType<typeof createXxxRepository>;

// service/xxx-service.ts — pure hoặc nhận dependency tối thiểu (vd AI client)
export function createXxxService(deps: { aiClient: AiClient }) {
  return { async analyze(...) { ... } };
}

// application/xxx-application.ts — orchestrator, nhận toàn bộ dependency qua tham số
export function createXxxApplication(deps: {
  repository: XxxRepository;
  service: ReturnType<typeof createXxxService>;
  notifier: Notifier;
}) {
  return { async run() { /* điều phối, KHÔNG business rule */ } };
}

// controller/xxx-controller.ts — composition root, entrypoint thật (được gọi bởi npm script)
async function main() {
  const db = getDb();                          // real singleton, hoặc truyền từ ngoài khi test
  const repository = createXxxRepository(db);
  const service = createXxxService({ aiClient: createOpenRouterClient() });
  const notifier = createTelegramNotifier();
  const app = createXxxApplication({ repository, service, notifier });
  await app.run();
}
main();
```
Test gọi thẳng `createXxxApplication({ repository: fakeRepo, service: fakeService, notifier: fakeNotifier })` — không còn cần `vi.mock(path)` giòn.

## Chiến lược migrate: pilot trước, nhân rộng sau

Vì đây là thay đổi lớn (64 file nghiệp vụ), **không** giao Worker viết lại cả 3 domain cùng lúc mù quáng. Thứ tự:
1. Xây nền `shared/` trước (mọi domain phụ thuộc) — subtask 01, 02.
2. Pilot trên `betting` (domain nhỏ nhất, 14 file, đại diện đủ pattern) — subtask 03.
3. **Lead review pilot** (đối chiếu plan + code + test pass) trước khi tạo task.md cho `lottery` và `charts` — tránh lặp lỗi sai pattern ra 40 file còn lại.
4. Sau khi 03 approved: tạo `04-lottery-layering`, `05-charts-layering` (theo đúng pattern đã duyệt), `06-tests-migration`, `07-docs-update`.

Subtask 04–07 **chưa có task.md** — sẽ được Lead viết sau khi review xong 03, theo đúng rule "Lead không approve chỉ vì build pass, phải review đúng plan".

## Ràng buộc bắt buộc cho mọi subtask

- Đổi cấu trúc thư mục + nội danh nghĩa (rename `getX`/`saveX` → factory) nhưng **giữ nguyên hành vi nghiệp vụ 100%** — không sửa logic tính toán, không đổi business rule.
- Giữ nguyên tất cả `npm run <script>` trong `package.json` hoạt động — chỉ đổi path bên trong `scripts`, không đổi tên script.
- Không đổi schema Supabase, không đổi format message Telegram.
- Sau mỗi subtask: `npm run build && npm test` phải pass, không giảm test coverage hiện có.
- Không tự động migrate `lottery`/`charts` khi chưa có task.md riêng được Lead duyệt.

## Subtasks

| Subtask ID | Mô tả | Owner | Files chính | Dependency | Output kỳ vọng |
|---|---|---|---|---|---|
| [01-shared-infra](01-shared-infra/task.md) | Tạo `src/shared/infra/` với `db.ts` factory-based, di chuyển `env.ts`, `logger.ts`, `retry.ts`, `rate-limit.ts`, `fetch-diagnostics.ts`; giữ `getDb()` singleton wrapper để domain code cũ chưa migrate vẫn chạy | worker | `src/shared/infra/*`, `src/shared/db.ts` (re-export) | none | `infra/` layer sẵn sàng, build+test pass, không phá domain code hiện tại |
| [02-shared-notification](02-shared-notification/task.md) | Tách `telegram.ts` thành `notification/telegram-client.ts` (raw API, implement `Notifier` thật) + giữ hàm build-message domain-specific tại chỗ cũ (chưa động vào charts); xóa dead code hoặc kích hoạt `Notifier` interface | worker | `src/shared/notification/*`, `src/shared/telegram.ts`, `src/shared/notifier.ts` | 01 | `notification/` layer sẵn sàng, `Notifier` interface thực sự được dùng, build+test pass |
| [03-betting-pilot](03-betting-pilot/task.md) ✅ **APPROVED** (round 5, xem [review](../../reviews/layered-architecture/review-03-betting-pilot.md)) | Áp dụng full layer (`controller/application/service/repository/client/model`) cho `src/betting` làm pilot | worker | toàn bộ `src/betting/*`, `tests/betting/*` | 01, 02 | `src/betting` theo cấu trúc mới, DI factory pattern, test cập nhật, build+test pass, `npm run match-odds` / `fetch-matches-list` / `betting-backtest` vẫn chạy đúng |
| 04-lottery-layering | Nhân rộng pattern đã duyệt sang `src/lottery` | worker | TBD sau review 03 | 03 (approved) | *(task.md sẽ tạo sau khi 03 được Lead approve)* |
| 05-charts-layering | Nhân rộng pattern đã duyệt sang `src/charts` (domain phức tạp nhất, làm cuối) | worker | TBD sau review 03 | 03 (approved) | *(task.md sẽ tạo sau khi 03 được Lead approve)* |
| 06-tests-migration | Rà soát toàn bộ test còn dùng `vi.mock(path)` giòn, chuyển sang truyền fake dependency qua factory nơi đã layering | worker | `tests/**` | 03, 04, 05 | *(task.md sẽ tạo sau)* |
| 07-docs-update | Cập nhật `README.md`, `.project-summary.md`, `AGENTS.md` mô tả cấu trúc layer mới | worker | docs | 03, 04, 05 | *(task.md sẽ tạo sau)* |

## Rủi ro & lưu ý

- `telegram.ts` hiện leak domain type (`TradeSetup`, `AnalysisResult`) vào shared — việc tách hoàn toàn presentation-per-domain sẽ hoàn tất dần khi migrate từng domain (`charts` sẽ đưa `buildSmcSignalMessage` v.v. vào `src/charts/service/` ở subtask 05), subtask 02 chỉ tách phần raw API client trước.
- `lottery-predict-resync-index.ts` gọi `getDb()` trực tiếp không qua repository — cần đưa vào repository khi tới lượt lottery (subtask 04, ghi chú riêng trong task.md tương ứng).
- `lottery-ai-predict.ts` gần như file rỗng (12 byte) — kiểm tra có phải dead file, nếu đúng thì xóa khi tới lượt lottery, không xóa ở subtask này.
