# Task 03: Cập nhật tests và chạy lại baseline

Prerequisite: Task 01 và 02 đã hoàn thành.
File được sửa: `tests/charts/smc/smc-backtest.test.ts` (và chỉ file test này).
KHÔNG sửa src. Nếu test lộ ra bug trong src → ghi blocked.md, không tự sửa src. KHÔNG commit.

## Việc cần làm

### 1. Sửa các test hiện có bị fail

Chạy `npm run test` — các test trong `tests/charts/smc/smc-backtest.test.ts` fail do hành vi mới (fill từ `triggerIndex + 1`, TP không xét trên nến fill, outcome `expired_hold`). Cập nhật fixture/expectation cho khớp hành vi mới theo mô tả trong `tasks/smc-backtest-fixes/plan.md`. Không xoá test case nào trừ khi nó kiểm tra chính hành vi look-ahead cũ (khi đó chuyển nó thành test khẳng định hành vi mới).

### 2. Thêm test mới (bắt buộc, dùng vitest theo pattern các test hiện có)

a. **Không fill trên nến signal**: fixture có nến tại `triggerIndex` chạm entry zone nhưng 5 nến sau không chạm → outcome `expired`.

b. **Không TP trên nến fill**: nến fill chạm entry zone và có high vượt TP2 (case LONG) → trade KHÔNG đóng tại nến fill; nếu nến sau chạm TP1 thì outcome `tp1` với `exitIndex = fillIndex + 1`.

c. **SL vẫn được xét trên nến fill**: nến fill chạm entry zone và low xuyên SL (case LONG) → outcome `stop`, `exitIndex = fillIndex`.

d. **expired_hold giải phóng slot**: fixture có trade không chạm SL/TP trong 96 nến sau fill → outcome `expired_hold`, `exitIndex = fillIndex + 96`, RR tính theo close; và một signal xuất hiện sau đó KHÔNG bị skip.

### 3. Verification đầy đủ

```bash
npm run build
npm run test
npm run backtest:smc
```

### 4. Ghi result.md

`tasks/smc-backtest-fixes/03-update-tests-and-rerun/result.md` phải có:

- Danh sách test đã sửa/thêm và kết quả pass.
- Bảng so sánh backtest trước/sau fix (số liệu "trước" lấy từ plan.md: 437 signals, 291 trades, winRate 84.54%, avgRR 1.68, avgBarsHeld 1.2) với summary mới từ lần chạy `npm run backtest:smc`.
- Xác nhận 3 acceptance criteria: không trade nào tp* với `exitIndex === entryIndex`; không trade fill tại `triggerIndex`; SHIB không còn bị khoá slot.

## Nếu bị chặn

Ghi `tasks/smc-backtest-fixes/03-update-tests-and-rerun/blocked.md`, không đoán.
