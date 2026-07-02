# Bug report: OpenRouter match-odds

## Trạng thái

Resolved — 2026-07-02 01:14 (Asia/Ho_Chi_Minh).

- Đã tắt reasoning cho luồng betting bằng `reasoning.effort = "none"`.
- Đã tăng `maxTokens` từ 600 lên 1600.
- OpenRouter client hiện từ chối response rỗng kèm `finish_reason`,
  `native_finish_reason` và token usage để retry/chẩn đoán.
- Đã áp dụng migration constraint `openrouter` lên Supabase production.
- Chạy lại thành công 3/3 trận và xác nhận 3 dòng usage mới trong `ai_usage`.

## Thời điểm kiểm tra

- Thời gian: 2026-07-02 01:08–01:09 (Asia/Ho_Chi_Minh)
- Lệnh: `npm run match-odds`
- Model: `deepseek/deepseek-v4-flash`
- Kết quả tiến trình: exit code `0`

## Tóm tắt

Luồng lấy odds và gửi Telegram chạy đến cuối, nhưng có hai lỗi:

1. Hai trong ba phản hồi OpenRouter có `message.content` rỗng, khiến parser thất bại.
2. Supabase chưa chấp nhận provider `openrouter`, khiến toàn bộ bản ghi AI usage bị từ chối.

## Bug 1: OpenRouter trả nội dung rỗng

### Mức độ

High — hai trong ba trận không nhận được phân tích AI và phải dùng raw-odds fallback.

### Kết quả thực tế

```text
OpenRouter failed for Belgium vs Senegal:
OpenRouter parse failed. Raw:

OpenRouter failed for USA vs Bosnia & Herzegovina:
OpenRouter parse failed. Raw:
```

Trận `Spain vs Austria` được phân tích thành công.

### Kết quả mong đợi

Mọi response thành công từ OpenRouter phải chứa JSON hợp lệ trong
`choices[0].message.content`, hoặc client phải báo lỗi response cụ thể thay vì
chuyển chuỗi rỗng cho parser.

### Khả năng nguyên nhân

- `max_tokens: 600` có thể bị model dùng hết cho reasoning trước khi sinh nội dung.
- Client hiện chỉ đọc `message.content`; không lưu `finish_reason`, `reasoning`,
  error metadata hoặc response body phục vụ chẩn đoán.
- Structured output của provider/model có thể trả response thành công nhưng
  không sinh nội dung trong một số request.

### Hướng xử lý đề xuất

1. Ghi nhận `finish_reason`, `usage` và các trường response an toàn khi
   `message.content` rỗng.
2. Ném lỗi `OpenRouter response contained empty content` ngay trong client.
3. Tăng `maxTokens` cho betting hoặc cấu hình reasoning thấp/tắt reasoning nếu
   model hỗ trợ.
4. Retry response rỗng như một lỗi tạm thời.

## Bug 2: Supabase từ chối provider `openrouter`

### Mức độ

Medium — phân tích vẫn chạy, nhưng mất toàn bộ dữ liệu observability và chi phí.

### Kết quả thực tế

Lỗi xuất hiện cho cả ba request:

```text
new row for relation "ai_usage" violates check constraint
"ai_usage_provider_check"
```

Input bị từ chối:

```text
provider: openrouter
model: deepseek/deepseek-v4-flash
source: betting
```

### Nguyên nhân

Database đang chạy constraint cũ chỉ cho phép `gemini` và `claude`. Migration
`supabase/migrations/20260702010000_add_openrouter_ai_provider.sql` chưa được áp
dụng lên Supabase đang cấu hình trong `.env`.

### Hướng xử lý

Áp dụng migration:

```sql
alter table public.ai_usage
  drop constraint if exists ai_usage_provider_check;

alter table public.ai_usage
  add constraint ai_usage_provider_check
  check (provider in ('gemini', 'claude', 'openrouter'));
```

Sau đó chạy lại `npm run match-odds` và kiểm tra bảng `ai_usage`.

## Các phần chạy thành công

- Đọc được 3 trận sắp tới.
- Lấy đủ 11 market và Correct Score từ 1xBet cho cả 3 trận.
- OpenRouter phân tích thành công trận `Spain vs Austria`.
- Runner hoàn thành và gửi dữ liệu Telegram.
