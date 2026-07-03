# Plan Storage

Thư mục này lưu các file kế hoạch được tạo bởi subagent `planner`.

## Quy ước đặt tên file
- Format: `YYYY-MM-DD-<task-name>.md`
- Ví dụ: `2026-07-04-add-telegram-webhook.md`, `2026-07-05-fix-betting-timeout.md`

## Cấu trúc Plan

```markdown
# Plan: <Tên task>

## Mục tiêu
[Mô tả mục tiêu cuối cùng - 1-2 câu rõ ràng]

## Các bước
1. [Bước 1 - cụ thể, có thứ tự]
2. [Bước 2]
3. [Bước N]

## Files cần sửa/tạo
- `path/to/file1.ts` - Sửa dòng X-Y: [mô tả ngắn]
- `path/to/file2.ts` - Tạo mới: [mô tả ngắn]
- `tests/feature.test.ts` - Thêm test case: [mô tả ngắn]

## Rủi ro & Lưu ý
- [Rủi ro 1 - edge case nào có thể sai]
- [Rủi ro 2 - performance, breaking change, etc.]

## Test cases
- [ ] [Test case 1]
- [ ] [Test case 2]
- [ ] [Test case N]

## Ước tính thời gian
~X mins (executor reference)
```

## Ví dụ Plan Hoàn Chỉnh

```markdown
# Plan: Add AI Usage Alert to Telegram

## Mục tiêu
Gửi cảnh báo qua Telegram khi chi phí AI vượt ngưỡng hàng ngày (>$5 hoặc >1M tokens).

## Các bước
1. Thêm env var: `AI_USAGE_DAILY_COST_LIMIT_USD` và `AI_USAGE_DAILY_TOKEN_LIMIT`
2. Edit `src/shared/ai-usage.ts` - hàm `recordAiUsage()` - thêm check threshold
3. Edit `src/shared/ai-usage.ts` - tạo hàm `buildAiUsageAlertMessage()`
4. Call hàm alert từ `recordAiUsage()` nếu vượt ngưỡng
5. Update `.env.example` với new env var
6. Thêm test case trong `tests/shared/ai-usage.test.ts`

## Files cần sửa/tạo
- `src/shared/ai-usage.ts` - Edit hàm `recordAiUsage()` (dòng 489-541), thêm hàm `buildAiUsageAlertMessage()`, hàm `maybeSendAiUsageAlert()`
- `.env.example` - Thêm 2 env var mới
- `tests/shared/ai-usage.test.ts` - Thêm test case cho alert message builder

## Rủi ro & Lưu ý
- Telegram send có thể fail (network) → catch error, log warning, không throw
- Env var không set → threshold không áp dụng (graceful)
- Duplicate alert: dùng Set để track đã alert hôm nay chưa (tránh spam)

## Test cases
- [ ] Alert message generate đúng format
- [ ] Không gửi alert nếu dưới threshold
- [ ] Gửi alert 1 lần/ngày thôi (không spam)
- [ ] Fail to send → log warning, không crash

## Ước tính thời gian
~25 mins (3 files, logic không phức tạp, có test)
```

## Workflow Sử Dụng

1. **Planner tạo plan**:
   ```
   /agent planner
   Yêu cầu: Thêm feature X
   
   → Planner output: Đây là plan cho task này
   → Planner save: .claude/plans/2026-07-04-feature-x.md
   ```

2. **Executor thực thi**:
   ```
   /agent executor
   Plan: .claude/plans/2026-07-04-feature-x.md
   
   → Executor read plan
   → Executor code từng step
   → Executor báo: ✅ Done. Files sửa: X, Y. Test pass.
   ```

3. **Planner review**:
   ```
   @planner review code từ executor
   
   → OK hoặc báo: "Cần fix X, Y"
   ```

## Ghi Chú

- **Planner tạo plan chi tiết**: Executor sẽ follow chính xác
- **Không mơ hồ**: "Sửa function tùy" ❌ → "Edit function X dòng 42-67, thêm logic Y" ✅
- **Rủi ro cụ thể**: "Có thể fail" ❌ → "Env var không set → threshold bypass, test với env var = 0" ✅
- **Archive cũ**: Khi task done, có thể di chuyển file plan vào subfolder `archived/` (optional)
