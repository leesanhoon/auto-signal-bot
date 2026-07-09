# Review: SMC Correctness Fixes (subtasks 01-05)

## Phương pháp review

- Đọc lại `plan.md` + toàn bộ 5 `task.md` + 5 `result.md`.
- Đọc trực tiếp `git diff` của `src/charts/smc/smc-pipeline.ts` và `tests/charts/smc/smc-pipeline.test.ts` (không chỉ tin result.md).
- Tự chạy `npm run build` và `npm test` (toàn repo) để verify độc lập, không chỉ dựa vào output Worker báo cáo.

## Kết quả verify độc lập

```
npm run build   → tsc pass, không lỗi type
npm test        → Test Files 64 passed (64), Tests 673 passed (673)
```

Khớp với số liệu Worker báo cáo ở `05-session-killzone-gate/result.md`.

## Đối chiếu từng subtask với plan/task.md

| Subtask | Đúng scope? | Đúng yêu cầu kỹ thuật? | Test có cover đúng? |
|---|---|---|---|
| 01-fvg-direction-bug | ✅ chỉ sửa `smc-pipeline.ts` | ✅ dùng `hasConfirmingStructure = structure !== null && structure.direction === dir`, đúng yêu cầu | ✅ 2 case (cùng hướng / ngược hướng) |
| 02-ob-stop-buffer | ✅ | ✅ buffer `atrProxy * 0.2`, đúng hệ số yêu cầu; entryZone giữ nguyên không cộng buffer | ✅ 2 case LONG/SHORT, so khớp `calculateExpectedAtr` |
| 03-premium-discount-gate | ✅ chỉ áp dụng setup OB | ✅ đúng logic phạt -15 khi sai zone, giữ nguyên khi đúng zone/equilibrium/null | ✅ 3 case (premium/discount/equilibrium) |
| 04-liquidity-target-tp | ✅ | ✅ `isValidLiquidityTarget` check đúng phía + reward > risk, fallback đúng khi không hợp lệ | ✅ 4 case (valid, quá gần, không có target, sai phía) |
| 05-session-killzone-gate | ✅ | ✅ áp dụng cả 3 setup, đúng thứ tự (sau premium/discount), penalty đúng bảng ASIA/-5, OFF_HOURS/-10 | ✅ 3 case + rà soát fixture cũ hợp lý |

Tất cả 5 subtask đều **không đụng file ngoài phạm vi** (`smc-structure.ts`, `smc-liquidity-context.ts`, `smc-session.ts`, `smc-signal-assembly.ts` giữ nguyên — verify bằng `git diff --stat` chỉ có 2 file thay đổi).

## Vấn đề phát hiện khi review (đã báo cáo qua ReportFindings)

1. **Score BOS bị lệch 84→80 âm thầm** ([smc-pipeline.ts:186](../../src/charts/smc/smc-pipeline.ts#L186)): trước đây setup BOS đúng zone có `confidence: 80` nhưng `score: 84` (asymmetric, hiển thị "Score 84/100" cho user). Sau subtask 03, `scoreBase = baseConfidence` khiến score đúng zone tụt còn 80. Task 03 của Lead viết ví dụ sai ("BOS: 80 → 65") ngầm giả định score gốc là 80 — đây là lỗi trong task.md do Lead viết, không phải Worker tự ý sai lệch. Grade cuối cùng không đổi (`gradeFromScore(84)` = `gradeFromScore(80)` = "A") nên không phá logic nghiệp vụ, nhưng số hiển thị cho user đã âm thầm đổi.
   - **Quyết định**: Chấp nhận (không yêu cầu sửa lại) — hợp nhất confidence/score thành một nguồn duy nhất (`baseConfidence`) là đơn giản hoá hợp lý, không gây sai lệch grade, và giảm rủi ro 2 con số lệch nhau về sau. Nếu muốn giữ đúng 84 gốc cần thêm 1 task fix riêng — không bắt buộc.
2. **Biến `grade` chết ở dòng 188** (`smc-pipeline.ts:188`): tính xong không dùng, bị `sessionAdjusted.grade` ghi đè. `scoreBase` cũng là alias thừa của `baseConfidence`.
   - **Quyết định**: Yêu cầu dọn dẹp nhỏ (xoá 2 dòng thừa `const grade = ...` và inline `scoreBase` thành `baseConfidence`) — không ảnh hưởng hành vi, chỉ là code sạch. Không cần Worker chạy lại toàn bộ subtask, chỉ cần 1 patch nhỏ.

## Quyết định

**APPROVED với 1 fix nhỏ bắt buộc trước khi coi task hoàn tất**: xoá dead code `const grade = gradeFromScore(score);` (dòng 188, không dùng) và `scoreBase` alias thừa (dòng 186) trong `src/charts/smc/smc-pipeline.ts`. Đây là dọn dẹp cosmetic, không cần viết lại test, không ảnh hưởng behavior — không cần vòng review lại, chỉ cần Worker áp dụng patch rồi chạy `npm run build && npm test` xác nhận vẫn 673 test pass.

Vấn đề #1 (score 84→80) được ghi nhận là chấp nhận được, không chặn approval.

## Việc cần làm tiếp theo

- Worker: xoá 2 dòng dead code nêu trên, cập nhật `result.md` tương ứng với evidence build/test mới.
- Sau khi patch xong: đóng task `smc-correctness-fixes` bằng `done.md`.

## Round 2 — verify fix dead code

- Đọc lại `src/charts/smc/smc-pipeline.ts:178-191`: xác nhận `const grade = gradeFromScore(score)` (dead) và alias `scoreBase` đã bị xoá; `score` giờ tính thẳng từ `baseConfidence` (`const score = isWrongPremiumDiscountZone ? baseConfidence - 15 : baseConfidence;`).
- Tự chạy lại `npm run build` (pass) và `npm test` toàn repo: **Test Files 64 passed (64), Tests 673 passed (673)** — không đổi so với round 1, không có regression.
- Không còn finding nào mở.

## Kết luận cuối cùng: APPROVED — task `smc-correctness-fixes` hoàn tất.
