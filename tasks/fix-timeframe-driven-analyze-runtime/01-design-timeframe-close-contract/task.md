# Task 01 - Design contract cho analyze theo nen da dong va timeframe cau hinh

## Muc tieu

Chot thiet ke ky thuat truoc khi sua code runtime/workflow:

- scanner phan tich dua tren nen da dong cua timeframe duoc cau hinh
- CI `analyze` chay theo cadence phu hop timeframe config
- khong con hardcode H4 close semantics trong runtime moi

Task nay la task design/spec implementation-oriented.
Worker duoc phep sua code ngay neu thiet ke ro rang va can it thay doi de chot contract, nhung uu tien la ghi spec/chot huong cho cac buoc sau.

## Van de da xac nhan

### 1. Runtime van hardcode H4

Files lien quan:

- `src/charts/chart-cache.ts`
- `src/charts/index.ts`

Hien tai co:

- `getCurrentH4CandleCloseKey()`
- `isWithinCandleCloseWindow(...)`
- close window message va skip logic deu noi ve H4

Dieu nay khong con dung voi intent:

- `single + M15`
- `single + D1`
- va ca ky vong "dung timeframe da cau hinh"

### 2. CI schedule la static

`.github/workflows/analyze.yml` da nhan duoc vars:

- `CHART_ENGINE_MODE`
- `CHART_TIMEFRAME_MODE`
- `CHART_PRIMARY_TIMEFRAME`

Nhung cron van la static H4 cadence.

GitHub Actions `schedule` khong the doi dong theo `vars` luc runtime.
Nen worker phai chon phuong an phu hop thay vi co gang "dynamic cron" khong kha thi.

## Yeu cau design bat buoc

1. Chot abstraction timeframe-aware cho close semantics.

Can xac dinh ro:

- timeframe nao la timeframe trigger
- cach tinh candle close key cho `M15`, `H4`, `D1`
- cach xac dinh close window sau khi nen dong
- cache key hien tai se gan voi close key moi nhu the nao

2. Chot semantics cho `multi` mode.

Can tra loi ro:

- `multi` mode se trigger theo timeframe nao?
- co giu legacy H4 semantics khong?
- neu giu, can ghi ro ly do va tac dong

3. Chot phuong an CI cadence.

Vi cron khong dynamic theo vars, worker can chon mot trong cac huong:

- `analyze` chay moi 15 phut trong ngay giao dich; runtime tu check close window theo timeframe config
- hoac tach workflow/profile rieng cho M15/H4/D1

Uu tien:

- workflow don gian
- semantics de hieu
- dung voi yeu cau "CI se chay theo timeframe da cau hinh neu cau hinh theo thoi gian dong nen"

## Deliverable mong muon

1. Cap nhat `tasks/fix-timeframe-driven-analyze-runtime/plan.md` neu can tinh chinh contract.
2. Ghi `result.md` that ro:
   - contract moi cho `single M15`
   - contract moi cho `single H4`
   - contract moi cho `single D1`
   - contract cho `multi`
   - cron/cadence CI de xuat
   - file nao se can sua tiep theo

3. Neu worker da thuc hien mot phan implementation nho de chot contract, phai ghi ro:
   - da sua gi
   - phan nao con lai cho task sau

## Goi y thiet ke

Mot huong hop ly la:

- tao helper timeframe-aware thay cho `getCurrentH4CandleCloseKey()`
- runtime trigger timeframe:
  - `single`: dung `CHART_PRIMARY_TIMEFRAME`
  - `multi`: tam giu `H4` neu muon preserve legacy
- CI cadence:
  - chay moi 15 phut trong ngay giao dich
  - runtime chi phan tich khi dang trong close window cua trigger timeframe

Huong nay giai quyet duoc:

- M15: co co hoi chay moi lan nen dong
- H4/D1: van duoc runtime gate dung
- khong can dynamic cron trong YAML

Nhung worker phai tu danh gia va ghi ro tradeoff.

## Khong lam

- Khong doi logic setup detection ngoai pham vi can thiet
- Khong redesign toan bo cache repository schema neu khong can
- Khong sua workflow khac ngoai `analyze` trong task design nay, tru khi can de minh hoa contract
