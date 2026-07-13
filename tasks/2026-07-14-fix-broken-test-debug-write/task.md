# Task — Sửa `npm run test` lỗi ENOENT do test ghi file debug ra thư mục không tồn tại

## Bối cảnh

`npm run test` fail với lỗi:

```
FAIL  tests/charts/setup-chart-renderer.test.ts > Chart renderer > buildSetupChartSvg > builds SVG with candlesticks, EMA, geometry, and price lines
Error: ENOENT: no such file or directory, open 'H:\LeeSanHoon\auto-signal-bot\tasks\2026-07-14-chart-all-setups\05-renderer-restyle-and-draw-all\sample-output.svg'
```

Nguyên nhân: [tests/charts/setup-chart-renderer.test.ts:118-124](../../tests/charts/setup-chart-renderer.test.ts)
có đoạn code ghi SVG ra ổ đĩa để debug thủ công (KHÔNG phải assertion, không ảnh hưởng kết quả test):

```ts
const sampleOutputPath = fileURLToPath(
  new URL(
    "../../tasks/2026-07-14-chart-all-setups/05-renderer-restyle-and-draw-all/sample-output.svg",
    import.meta.url,
  ),
);
writeFileSync(sampleOutputPath, svg, "utf8");
```

Thư mục `tasks/2026-07-14-chart-all-setups/05-renderer-restyle-and-draw-all/` thuộc về 1 task cũ, KHÔNG
được git track (thư mục `tasks/` nói chung không có gì đảm bảo tồn tại lâu dài — đây chỉ là artifact
tạm thời của quy trình Lead/Worker), và đã bị xoá khỏi ổ đĩa ở thời điểm hiện tại → `writeFileSync` lỗi
vì thư mục cha không còn. Test phụ thuộc vào 1 đường dẫn bên ngoài `tests/` là fragile — không nên tồn
tại trong test suite.

## Việc cần làm

Xoá HẲN đoạn ghi file debug này (dòng 118-124 trong task snapshot, có thể lệch vài dòng nếu file đã đổi
— tìm theo đúng nội dung code nêu trên) khỏi
[tests/charts/setup-chart-renderer.test.ts](../../tests/charts/setup-chart-renderer.test.ts). Đây
KHÔNG phải assertion (không có `expect()` nào dùng `sampleOutputPath`/biến `svg` sau đoạn này trong
cùng test) — chỉ là tiện ích debug thủ công của người viết test trước đây, xoá không ảnh hưởng độ phủ
test. Xoá luôn 2 dòng import không còn dùng nếu sau khi xoá đoạn trên, `writeFileSync` và
`fileURLToPath` không còn được dùng ở đâu khác trong file (kiểm tra kỹ trước khi xoá import — nếu vẫn
được dùng ở chỗ khác trong cùng file thì giữ lại import).

## Ràng buộc — KHÔNG được làm

- KHÔNG đổi bất kỳ `expect()` nào trong test này hoặc test khác.
- KHÔNG đổi logic `buildSetupChartSvg` hay bất kỳ source code nào trong `src/`.
- KHÔNG tạo lại thư mục `tasks/2026-07-14-chart-all-setups/` — nó không cần thiết cho test, đây chính
  là root cause cần loại bỏ phụ thuộc, không phải khôi phục.

## Verify

1. `npm run build` — pass.
2. `npm run test` — phải pass toàn bộ, đặc biệt xác nhận
   `tests/charts/setup-chart-renderer.test.ts` pass đủ 4 test (không giảm số lượng test, chỉ bỏ
   side-effect ghi file).

## Ghi kết quả

Ghi `result.md` trong thư mục này: diff, kết quả `npm run test` đầy đủ (số test file/test pass).
