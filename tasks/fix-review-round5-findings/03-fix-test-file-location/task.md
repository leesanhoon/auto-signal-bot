# Task 03 — Di chuyển test file cho khớp cấu trúc src/ (LOW)

## Vấn đề

`tests/charts/irb-fallback.test.ts` test cho `src/charts/setups/irb.ts`
nhưng không nằm trong `tests/charts/setups/` — không khớp quy ước
"Tests: Vitest, trong `tests/` mirror `src/` structure" (CLAUDE.md). File
tương tự đã đúng chỗ: `tests/charts/setups/shared.test.ts` cho
`src/charts/setups/shared.ts`.

## Yêu cầu

Di chuyển `tests/charts/irb-fallback.test.ts` →
`tests/charts/setups/irb-fallback.test.ts`. Kiểm tra lại đường dẫn import
trong file (relative path tới `src/charts/setups/irb.js` sẽ cần đổi từ
`../../src/charts/setups/irb.js` thành `../../../src/charts/setups/irb.js`
— tự kiểm tra chính xác theo cấu trúc thư mục thực tế).

## Verification

```bash
npm run build
npm run test -- --run
```
Toàn bộ test suite phải pass, số lượng test không đổi (chỉ di chuyển file).

## Ghi kết quả

`result.md`: đường dẫn cũ/mới, kết quả build + test.
