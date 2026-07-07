# Task 01 - Chot contract off-window heartbeat flow (LEAD->WORKER)

## Muc tieu

Phan tich code hien tai va de xuat contract cu the cho 3 truong hop:

1. Trong close window H4
2. Ngoai close window + manual run
3. Ngoai close window + auto run

Worker khong can implement code o task nay neu chua can, nhung phai chot ro contract de task 02 co the code khong mo ho.

## File can doc ky

- `src/charts/index.ts`
- `src/charts/chart-cache.ts`
- `src/charts/chart-cache-repository.ts`
- `src/shared/telegram.ts`
- `src/charts/check-open-trades-runner.ts`
- `src/charts/check-pending-orders-runner.ts`

## Yeu cau dau ra

Ghi `result.md` voi:

1. Contract de xuat cho `manual run`
   - co tim latest cache hay khong
   - neu khong co cache thi gui message gi
   - co gui setup text khi cache khong co screenshot hay khong

2. Contract de xuat cho `auto run`
   - xac dinh "khong co event trade/pending nao can gui" bang cach nao
   - heartbeat gui o thoi diem nao
   - can hay khong can config env bat/tat

3. Danh sach helper/ham can them hoac doi
   - vi du: `loadLatestChartAnalysisCache`, `buildHeartbeatMessage`, `RunContext`

4. Rui ro / canh bao
   - tranh gui trung Telegram lien tuc moi lan cron chay
   - tranh gui cache sai engine mode
   - tranh thong diep mo ho giua "khong co setup" va "khong co phan tich moi"

## Khong lam

- Chua sua code runtime o task nay neu chua can.
- Khong doi logic setup detection.

## Verification

Khong bat buoc chay test neu chi phan tich contract.
