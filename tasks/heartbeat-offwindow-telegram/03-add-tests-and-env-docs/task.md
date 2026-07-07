# Task 03 - Add tests and env docs for heartbeat/off-window behavior

## Muc tieu

Khoa behavior moi bang test va cap nhat tai lieu/env de van hanh vien biet can cau hinh gi.

## File du kien can sua

- `tests/charts/...` (chon file test phu hop voi `src/charts/index.ts` / `telegram` / cache repository)
- `.env.example`
- Co the them `tasks/.../context.md` neu can note van hanh

## Yeu cau test

Them/bo sung test cho cac case sau:

1. Ngoai close window + co cache hien tai -> van gui Telegram tu cache
2. Ngoai close window + khong co cache + manual run -> gui heartbeat/no-analysis message
3. Ngoai close window + auto run + khong co event khac -> gui heartbeat/no-analysis
4. Co setup text tu cache nhung khong co screenshot buffer -> van gui text, khong crash
5. Neu da co event trade/pending notification -> khong gui heartbeat dup

## Yeu cau docs/env

1. Cap nhat `.env.example`
   - Liet ke ro env charts/telegram/cache lien quan
   - Neu them env moi thi ghi default va y nghia

2. Trong `result.md`, tong hop bang ngan gon:
   - env bat buoc
   - env tuy chon
   - env chi dung cho backtest / AI / deterministic

## Verification

```bash
npm run test -- --run
npm run build
```

Ghi ket qua vao `result.md`.
