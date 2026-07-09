# Task 05 — GitHub Actions: thêm concurrency group cho 2 workflow analyze

**Vấn đề:** `.github/workflows/analyze.yml` và `.github/workflows/analyze-smc.yml` không có `concurrency` group. GitHub scheduled run có thể delay 3-10 phút; với SMC chạy mỗi 15 phút, hai run có thể chồng nhau → phân tích trùng và gửi Telegram đôi trước khi cache kịp ghi.

**Mục tiêu:** mỗi workflow chỉ có tối đa 1 run chạy tại một thời điểm; run mới xếp hàng chờ (KHÔNG cancel run đang chạy — run đang chạy có thể đang ghi position vào DB).

**KHÔNG làm:** không đổi cron, không đổi steps/env/secrets, không đụng workflow nào khác.

## Bước 1 — `.github/workflows/analyze.yml`

Thêm block sau, đặt sau `on:` block (trước `jobs:`):

```yaml
concurrency:
  group: analyze-volman
  cancel-in-progress: false
```

## Bước 2 — `.github/workflows/analyze-smc.yml`

Tương tự:

```yaml
concurrency:
  group: analyze-smc
  cancel-in-progress: false
```

## Bước 3 — Validate

Không có test unit cho workflow. Validate YAML bằng:

```bash
node -e "const y=require('js-yaml');const f=require('fs');for(const p of ['.github/workflows/analyze.yml','.github/workflows/analyze-smc.yml']){y.load(f.readFileSync(p,'utf8'));console.log(p,'OK')}"
```

(js-yaml có sẵn trong node_modules qua dependencies; nếu không có, dùng `npx yaml-lint` hoặc chỉ cần `node --input-type=module` đọc file và kiểm tra thủ công indent — ghi rõ cách validate trong result.md.)

Chạy thêm:

```bash
npm run build
npm run test
```

(để chứng minh không đụng code; kỳ vọng pass nguyên trạng.)

Ghi kết quả vào `tasks/smc-volman-review-fixes/05-workflow-concurrency/result.md`. Nếu blocked → `blocked.md`.
