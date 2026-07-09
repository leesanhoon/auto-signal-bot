# Shared Context — Layered Architecture Refactor

Tham chiếu bởi mọi `task.md` trong `tasks/layered-architecture/`. Đọc file này trước khi thực thi bất kỳ subtask nào.

## Nguyên tắc bất biến (áp dụng mọi subtask)

1. **Giữ nguyên hành vi 100%** — đây là refactor cấu trúc, không phải sửa logic. Không đổi công thức tính toán, không đổi thứ tự side-effect quan sát được (thứ tự gọi Telegram/DB), không đổi format message gửi Telegram, không đổi schema Supabase.
2. **Không đổi tên `npm run <script>` trong `package.json`** — chỉ đổi `path` bên trong (vd `"analyze": "tsx src/charts/index.ts"` → `"analyze": "tsx src/charts/controller/index.ts"`).
3. **Không sửa `.github/workflows/*.yml`** — các workflow gọi `npm run <script>`, không gọi path trực tiếp, nên không cần đổi miễn `npm run` giữ nguyên tên.
4. Sau khi xong: `npm run build` (tsc) và `npm test` (vitest run) phải pass. Không được giảm số lượng test hiện có (có thể thêm, không được xoá test đang pass trừ khi file bị xoá vì thật sự dead code — phải nêu rõ trong `result.md`).
5. Dùng `import ... from "./x.js"` (đuôi `.js` dù file là `.ts`) — dự án dùng ESM `"type": "module"`, giữ đúng convention import hiện tại.

## Mẫu DI bắt buộc (factory function, không dùng IoC framework)

```ts
// repository/xxx-repository.ts
import type { SupabaseClient } from "@supabase/supabase-js";

export function createXxxRepository(db: SupabaseClient) {
  return {
    async loadX(id: string) { /* ... */ },
    async saveX(data: X) { /* ... */ },
  };
}
export type XxxRepository = ReturnType<typeof createXxxRepository>;
```

```ts
// service/xxx-service.ts — business logic, nhận dependency tối thiểu (nếu cần AI/HTTP client)
export function createXxxService(deps: { aiClient: AiClient }) {
  return {
    async analyze(input: Input): Promise<Output> { /* ... */ },
  };
}
```

```ts
// application/xxx-application.ts — orchestrator, KHÔNG chứa business rule, chỉ điều phối
export function createXxxApplication(deps: {
  repository: XxxRepository;
  service: ReturnType<typeof createXxxService>;
  notifier: Notifier;
}) {
  return {
    async run(): Promise<void> {
      const data = await deps.repository.loadX(...);
      const result = await deps.service.analyze(data);
      await deps.repository.saveX(result);
      await deps.notifier.sendMessage(formatMessage(result));
    },
  };
}
```

```ts
// controller/xxx-controller.ts — composition root, là file mà npm script trỏ tới
import { getDb } from "../../shared/infra/db.js";
import { createXxxRepository } from "../repository/xxx-repository.js";
import { createXxxService } from "../service/xxx-service.js";
import { createTelegramNotifier } from "../../shared/notification/telegram-client.js";
import { createXxxApplication } from "../application/xxx-application.js";

async function main() {
  const db = getDb();
  const app = createXxxApplication({
    repository: createXxxRepository(db),
    service: createXxxService({ aiClient: /* ... */ }),
    notifier: createTelegramNotifier(),
  });
  await app.run();
}

main();
```

Test gọi trực tiếp `createXxxApplication({ repository: fakeRepo, service: fakeService, notifier: fakeNotifier })` thay vì `vi.mock("../../src/xxx.js", ...)`.

## Naming/layer mapping tham khảo (áp dụng khi phân loại file cũ vào layer mới)

| File cũ (hậu tố/pattern) | Layer mới | Ghi chú |
|---|---|---|
| `*-index.ts` (entrypoint gọi bởi `npm run`) | `controller/` | Trở thành composition root mỏng, không chứa logic |
| `*-runner.ts` (hàm `runXxx()`) | `application/` | Orchestration, gọi service+repository+notifier |
| `*-repository.ts` | `repository/` | Giữ nguyên naming file, đổi export sang factory `createXxxRepository(db)` |
| `*-types.ts` | `model/` | Pure type, không đổi nội dung, chỉ di chuyển |
| File gọi HTTP ra ngoài (vd `betting-api.ts`, `lottery-scraper.ts`, `ohlc-provider.ts`, `screenshot.ts`, `betting-gemini.ts`) | `client/` | External API client |
| File business logic thuần (analyzer, pipeline, engine, decision, indicators, format, setups/, smc/) | `service/` | Có thể là factory nếu cần dependency, hoặc giữ pure function nếu không cần |

## Cấu trúc thư mục shared (kết quả subtask 01+02)

```
src/shared/
  infra/          db.ts, env.ts, logger.ts, retry.ts, rate-limit.ts, fetch-diagnostics.ts
  notification/   telegram-client.ts, notifier.ts
  ai/             ai-env.ts, ai-model-fallback.ts, ai-usage.ts, openrouter.ts
  util/           vn-time.ts, stats.ts, stats-report.ts, telegram-webhook-idempotency.ts
```

## Khảo sát domain betting (dùng cho subtask 03)

Danh sách file `src/betting/` hiện tại và layer đích:

| File hiện tại | Layer đích | Ghi chú |
|---|---|---|
| `betting-index.ts` | `controller/betting-index.ts` | entrypoint, gọi `runOddsCheck()` |
| `fetch-matches-list-index.ts` | `controller/fetch-matches-list-index.ts` | entrypoint riêng |
| `betting-backtest-runner.ts` | `controller/betting-backtest-runner.ts` | CLI wrapper cho backtest — coi như controller (đây là entrypoint của `npm run betting-backtest`) |
| `odds-runner.ts` (`runOddsCheck()`) | `application/odds-application.ts` | orchestration chính: fetch → payload → cache → AI → notify → persist |
| `betting.ts` (`extractMatches`, `pickNearestUpcomingMatch(es)`, `buildOddsPayload`) | `service/betting-service.ts` | business logic thuần |
| `betting-backtest.ts` | `service/betting-backtest-service.ts` | backtest logic |
| `odds-compact.ts` | `service/odds-compact-service.ts` | pure transform |
| `odds-text-format.ts` | `service/odds-text-format-service.ts` | presentation/formatting — vẫn là service vì đây là format nội dung nghiệp vụ, không phải raw Telegram API |
| `correct-score-api.ts` | `service/correct-score-service.ts` | pure transform (tên cũ gây hiểu nhầm là API client nhưng thực chất xử lý data đã fetch) |
| `betting-analysis-repository.ts` | `repository/betting-analysis-repository.ts` | đổi export sang `createBettingAnalysisRepository(db)` |
| `match-repository.ts` | `repository/match-repository.ts` | đổi export sang `createMatchRepository(db)` |
| `betting-api.ts` | `client/betting-api-client.ts` | HTTP client API-Football |
| `betting-gemini.ts` | `client/betting-ai-client.ts` | AI client qua OpenRouter |
| `betting-types.ts` | `model/betting-types.ts` | pure types, di chuyển nguyên trạng |

Test tương ứng tại `tests/betting/*.test.ts` cần di chuyển/đổi mock theo cùng cấu trúc (xem chi tiết trong `03-betting-pilot/task.md`).
