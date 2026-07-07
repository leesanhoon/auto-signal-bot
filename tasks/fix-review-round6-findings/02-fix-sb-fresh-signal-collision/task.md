# Task 02 — Fix SB signal chín trùng index với fresh signal bị âm thầm loại (MEDIUM)

## Vấn đề (đã xác nhận)

`src/charts/setup-backtest.ts`: khi `pendingSb` "chín" (đến lúc gọi
`detectSb`, dòng ~162-180), nó bị xóa (`pendingSb = null`, dòng ~179) TRƯỚC
khi check `canRunFreshDetectors` (dòng ~182). Nếu `openTrade` cũng đang
`null` lúc này, `canRunFreshDetectors` trở thành `true` NGAY TRONG CÙNG
iteration — 6 detector chuẩn chạy, kết quả của chúng bị gộp chung vào
`readySignals` cùng với SB signal vừa chín (nếu có), rồi
`resolveSetupConflicts` (dòng ~196) coi CẢ HAI là "cạnh tranh nhau" (vì cùng
`pair`) và chỉ giữ lại 1 — dù chúng là 2 cơ hội giao dịch hoàn toàn độc lập,
tình cờ trùng index. Không có log nào ghi lại việc bị loại.

## Yêu cầu

Tách riêng việc xử lý 2 nguồn signal này thay vì gộp chung vào
`resolveSetupConflicts`:

1. Nếu CẢ pendingSb VÀ fresh detector cùng có kết quả ở CÙNG 1 `index`: ưu
   tiên SB signal (vì nó đã "chờ" lâu hơn, đại diện cho 1 sự kiện đã theo dõi
   từ trước) — vào lệnh cho SB TRƯỚC, còn fresh signal thì GIỮ LẠI (không bỏ
   qua) để xử lý ở index KẾ TIẾP (đẩy vào 1 slot tạm, ví dụ tái sử dụng ý
   tưởng "deferred 1 index" — miễn không bị mất hẳn).

   Cách đơn giản hơn (khuyến nghị nếu cách trên phức tạp): nếu
   `openTrade === null` sau khi xử lý xong `pendingSb` trong CÙNG iteration
   này, và `pendingSb` VỪA tạo ra 1 SB trade (đã vào lệnh) → set
   `canRunFreshDetectors = false` cho CHÍNH iteration này (không chạy 6
   detector chuẩn ở đây nữa, để index sau mới chạy — vì đã có `openTrade` mới
   từ SB) — đây là cách tự nhiên nhất, vì về logic, ngay khi SB vào lệnh,
   `openTrade` sẽ được set (dòng ~204-215), nên `canRunFreshDetectors` (nếu
   TÍNH LẠI SAU KHI xử lý pendingSb, thay vì tính 1 lần duy nhất ở dòng ~182
   TRƯỚC KHI biết pendingSb có tạo ra signal hay không) sẽ tự động là `false`
   — kiểm tra lại thứ tự code, có thể chỉ cần DI CHUYỂN việc gán `openTrade`
   cho SB signal (dòng ~204-215) lên TRƯỚC bước chạy 6 detector chuẩn
   (dòng ~183-194), thay vì để 6 detector chạy dựa trên
   `canRunFreshDetectors` đã tính TỪ TRƯỚC (dòng ~182) mà chưa biết SB có vào
   lệnh hay không.

2. Nếu SB signal KHÔNG tạo ra trade (detectSb trả null) ở `pendingSb`, thì
   dòng chảy như hiện tại là ĐÚNG — fresh detector vẫn được chạy bình thường,
   không có gì phải sửa cho case này.

## KHÔNG làm

- Không đổi logic `detectSb`, `isFalseBreak`.
- Không đổi cách `resolveSetupConflicts` tự nó group theo `pair` (đây là
  behavior đúng cho việc chọn 1 trong nhiều signal CÙNG 1 index từ 6 detector
  chuẩn — chỉ cần tách riêng SB ra khỏi vòng resolve chung với fresh
  detector khi chúng không thực sự "cạnh tranh" nhau).

## Verification

```bash
npm run build
npm run test -- --run
```

**BẮT BUỘC** viết test: dựng tình huống SB signal chín ĐÚNG tại 1 index, VÀ
1 fresh signal (setup khác) cũng đủ điều kiện kích hoạt tại CHÍNH index đó —
xác nhận CẢ HAI đều được ghi nhận (không phải chỉ 1, và không phải cả 2
cùng lúc vi phạm "không chồng lệnh" — SB vào trước, fresh signal xử lý ở
index kế tiếp hoặc theo cách bạn đã chọn ở trên).

## Ghi kết quả

`result.md`: cách đã chọn, đoạn code đã sửa, test mới, kết quả build + test.
