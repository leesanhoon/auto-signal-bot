# Task 01 — Fix nút Telegram "Dự đoán xổ số theo miền" trỏ vào workflow không tồn tại

**Vấn đề:** Trong `supabase/functions/telegram-webhook/index.ts`, object `COMMANDS` (dòng ~40-85) có 3 entry:

```ts
  lottery_predict_mien_nam: {
    file: "lottery-predict-mien-nam.yml",
    description: "dự đoán xổ số Miền Nam",
  },
  lottery_predict_mien_trung: {
    file: "lottery-predict-mien-trung.yml",
    description: "dự đoán xổ số Miền Trung",
  },
  lottery_predict_mien_bac: {
    file: "lottery-predict-mien-bac.yml",
    description: "dự đoán xổ số Miền Bắc",
  },
```

Các file `lottery-predict-mien-nam.yml`, `lottery-predict-mien-trung.yml`, `lottery-predict-mien-bac.yml` **không tồn tại** trong `.github/workflows/`. Chỉ có một `lottery-predict.yml` duy nhất, workflow này đã hỗ trợ sẵn `workflow_dispatch.inputs.region` với options `all | mien-bac | mien-trung | mien-nam` (xem `.github/workflows/lottery-predict.yml` dòng 9-19).

Khi user bấm nút "Miền Bắc" / "Miền Trung" / "Miền Nam" trong submenu "🔮 Dự đoán xổ số ▸" (`buildLotteryPredictSubmenuKeyboard()`, callback_data `run:lottery_predict_mien_bac` v.v.), hàm `dispatchWorkflow` gọi GitHub API tới file không tồn tại → GitHub trả lỗi 404, Telegram hiện `❌ Không thể kích hoạt dự đoán xổ số Miền X`.

**Mục tiêu:** cả 3 nút gọi đúng `lottery-predict.yml` kèm input `region` tương ứng, tận dụng logic chọn miền đã có sẵn trong workflow đó — **không** tạo thêm file `.yml` mới.

**KHÔNG làm:** không đổi `lottery-predict.yml`, không đổi callback data, không đổi UI/keyboard, không đụng các COMMANDS khác (`analyze`, `match_odds`, `lottery`, `lottery_predict`, `performance_report`, `lottery_verify`).

## Bước 1 — Sửa `supabase/functions/telegram-webhook/index.ts`

Thay 3 entry trên (giữ nguyên vị trí, key không đổi) thành:

```ts
  lottery_predict_mien_nam: {
    file: "lottery-predict.yml",
    description: "dự đoán xổ số Miền Nam",
    parseInputs: () => ({ region: "mien-nam" }),
  },
  lottery_predict_mien_trung: {
    file: "lottery-predict.yml",
    description: "dự đoán xổ số Miền Trung",
    parseInputs: () => ({ region: "mien-trung" }),
  },
  lottery_predict_mien_bac: {
    file: "lottery-predict.yml",
    description: "dự đoán xổ số Miền Bắc",
    parseInputs: () => ({ region: "mien-bac" }),
  },
```

Lưu ý: type `WorkflowConfig.parseInputs` là `(args: string[]) => Record<string, string>`. Với 3 entry này, `args` luôn là mảng rỗng (xem `parseCallbackData`, nhánh khác `lottery_verify` trả `args: []`) nên hàm không cần tham số — viết `() => ({...})` là hợp lệ (tham số dư thừa không bắt buộc trong TypeScript khi gọi qua kiểu hàm tương thích).

## Bước 2 — Validate

Không có test unit cho thư mục `supabase/functions/` (chạy Deno runtime riêng, không nằm trong `npm test`). Validate bằng:

```bash
npm run build
npm run test
```

(để chứng minh không vô tình phá code TypeScript của phần Node — kỳ vọng pass nguyên trạng vì không đụng `src/`).

Nếu có Deno cài sẵn, thêm bước kiểm tra cú pháp riêng cho function:

```bash
deno check supabase/functions/telegram-webhook/index.ts
```

Nếu không có Deno, ghi rõ trong `result.md` là bỏ qua bước này và lý do.

## Bước 3 — KHÔNG tự deploy

**Không chạy** `npx supabase functions deploy telegram-webhook`. Đây là hành động ảnh hưởng tới webhook đang chạy live trên production, cần user tự chạy sau khi review code. Chỉ ghi rõ trong `result.md` rằng cần lệnh này để áp dụng thay đổi, và Lead/user sẽ tự quyết định thời điểm deploy.

Ghi kết quả vào `tasks/mini-pc-migration-followups/01-telegram-lottery-predict-region-fix/result.md`. Nếu blocked → `blocked.md`.
