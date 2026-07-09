# Task 01: Shared Infra Layer

**Đọc trước:** [`../plan.md`](../plan.md) và [`../context.md`](../context.md) — bắt buộc, chứa quy tắc bất biến và mẫu DI.

## Mục tiêu

Tạo `src/shared/infra/` chứa các module hạ tầng, chuyển `db.ts` sang dạng factory-based nhưng **vẫn giữ `getDb()` singleton hoạt động y hệt cũ** để toàn bộ code chưa migrate (charts, lottery, phần lớn betting) tiếp tục chạy không lỗi.

## Việc cần làm

1. Tạo thư mục `src/shared/infra/`.
2. Di chuyển các file sau vào `src/shared/infra/` (giữ nguyên nội dung, chỉ sửa import path nếu cần):
   - `src/shared/env.ts` → `src/shared/infra/env.ts`
   - `src/shared/logger.ts` → `src/shared/infra/logger.ts`
   - `src/shared/retry.ts` → `src/shared/infra/retry.ts`
   - `src/shared/rate-limit.ts` → `src/shared/infra/rate-limit.ts`
   - `src/shared/fetch-diagnostics.ts` → `src/shared/infra/fetch-diagnostics.ts`
3. Xử lý `src/shared/db.ts`:
   - Tạo `src/shared/infra/db.ts` với nội dung:
     ```ts
     import { createClient, type SupabaseClient } from "@supabase/supabase-js";
     import ws from "ws";

     export interface SupabaseConfig {
       url: string;
       key: string;
     }

     export function createSupabaseClient(config: SupabaseConfig): SupabaseClient {
       return createClient(config.url, config.key, { realtime: { transport: ws as any } });
     }

     function getConfigFromEnv(): SupabaseConfig {
       const url = process.env.SUPABASE_URL;
       const key = process.env.SUPABASE_KEY;
       if (!url || !key) {
         throw new Error("SUPABASE_URL and SUPABASE_KEY environment variables are required");
       }
       return { url, key };
     }

     let client: SupabaseClient | undefined;

     export function getDb(): SupabaseClient {
       if (!client) {
         client = createSupabaseClient(getConfigFromEnv());
       }
       return client;
     }
     ```
     (Đây là refactor giữ nguyên hành vi `getDb()` cũ + thêm factory `createSupabaseClient` để domain sau này có thể dùng DI thật khi cần test — nhưng **không bắt buộc domain nào phải đổi sang factory ở subtask này**.)
   - Xoá nội dung cũ trong `src/shared/db.ts`, thay bằng re-export để mọi import cũ (`from "../shared/db.js"`) không bị vỡ:
     ```ts
     export { getDb, createSupabaseClient, type SupabaseConfig } from "./infra/db.js";
     ```
4. **Không sửa bất kỳ file nào trong `src/charts/`, `src/betting/`, `src/lottery/`** ở subtask này — chúng vẫn import `from "../shared/db.js"`, `from "../shared/logger.js"`, v.v. và phải tiếp tục hoạt động nhờ re-export ở bước 3 và các module đã move.
   - Lưu ý: các file cũ import trực tiếp `src/shared/env.ts`, `src/shared/logger.ts`, `src/shared/retry.ts`, `src/shared/rate-limit.ts`, `src/shared/fetch-diagnostics.ts` theo path cũ — vì các file này bị move hẳn (không phải copy), bạn PHẢI thêm re-export tương tự tại vị trí cũ cho từng file, ví dụ `src/shared/env.ts`:
     ```ts
     export * from "./infra/env.ts";
     ```
     (kiểm tra từng file gốc export gì — named export hay default — để viết re-export đúng dạng; dùng `.ts` hay `.js` cho phù hợp convention import hiện tại của dự án, kiểm tra file lân cận đã có sẵn để theo đúng convention)
   - Grep toàn repo (`src/`, `tests/`) để tìm hết chỗ import 5 file này theo path cũ, xác nhận không có import path nào bị vỡ sau khi thêm re-export.

## Việc KHÔNG được làm

- Không đổi logic bên trong `env.ts`, `logger.ts`, `retry.ts`, `rate-limit.ts`, `fetch-diagnostics.ts` — chỉ di chuyển vị trí.
- Không đổi tên export nào.
- Không sửa test hiện có trừ khi path import trong test trỏ trực tiếp vào các file đã move (nếu có, cập nhật path cho đúng, không đổi nội dung test).
- Không tạo `src/shared/notification/` hay đụng vào `telegram.ts`/`notifier.ts` — đó là subtask 02.

## Acceptance Criteria

- `npm run build` (tsc) pass, không lỗi type.
- `npm test` (vitest run) pass, số lượng test không giảm so với trước khi bắt đầu (chạy `npm test` trước khi sửa để biết baseline, ghi số lượng test pass vào `result.md`).
- `src/shared/infra/{env,logger,retry,rate-limit,fetch-diagnostics,db}.ts` tồn tại và chứa đúng nội dung gốc (chỉ đổi vị trí/re-export theo hướng dẫn).
- `src/shared/{env,logger,retry,rate-limit,fetch-diagnostics,db}.ts` vẫn tồn tại dưới dạng file re-export mỏng (không xoá, để không phá import cũ).
- Không có file nào trong `src/charts/`, `src/betting/`, `src/lottery/` bị sửa.

## Kết quả cần ghi vào `result.md`

- Danh sách file đã tạo/sửa (path đầy đủ).
- Output `npm run build` và `npm test` (số test pass trước/sau).
- Xác nhận đã grep kiểm tra không còn import path nào bị vỡ.
- Nếu bị chặn ở bất kỳ bước nào (vd export dạng lạ không re-export được đơn giản) → ghi `blocked.md`, không tự ý đổi cách khác mà không ghi rõ.
