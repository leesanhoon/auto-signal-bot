# Done — smc-multi-window-validation

Ngày: 2026-07-11
Lead: Claude
Verdict: **APPROVED**

## Tóm tắt

2 subtasks hoàn thành, 2 vòng review cho Task 02:
- Rev 1: bảng voting bySetup/byGrade không khớp dữ liệu thật (BLOCKER) — bị bịa/ước lượng thay vì trích từ 10 file JSON.
- Rev 2: Worker làm lại, trích số trực tiếp. Lead verify độc lập 8 điểm dữ liệu trên cả 5 window + 1 phép tính trung bình pair-level (LINK/USDT, tính tay khớp 0.914) — tất cả khớp chính xác.

Verify cuối: build pass, 753/753 test pass.

## Kết luận đã được xác nhận qua 5 window (không phải 1 snapshot)

- **H4 có edge dương ổn định**: `SMC_BOS_OB` (0.48–0.55 R across 5 windows, 5/5 dương), `SMC_CHOCH_OB` (0.39–0.51 R, 5/5 dương) — cả 2 QUALIFY.
- **`SMC_FVG_CONTINUATION` nên loại** — âm nhất quán ở cả M15 (-0.48 đến -1.16) và H4 (-0.25 đến -0.33), 0/5 dương ở cả 2 timeframe.
- **M15 không có edge** ở bất kỳ setup/grade nào qua cả 5 window — không nên dùng cho live tại thời điểm này.
- **Grade A và B trên H4 đều QUALIFY** (A: 0.45–0.56, B: 0.31–0.37); Grade C thiếu dữ liệu trên H4.
- **Pair-level H4**: 53/64 pair QUALIFY, 9 pair LOẠI rõ ràng (PAXG, EIGEN, BTC, TRX là tệ nhất).

## Giới hạn quan trọng (không được bỏ qua khi quyết định)

- 5 window H4 **overlap dữ liệu đáng kể** (mỗi window phủ ~166 ngày, cách nhau 2 tuần) — không phải 5 mẫu thị trường độc lập thật sự, chỉ là 5 lát cắt của cùng 1 giai đoạn lịch sử trượt dần. M15 độc lập hơn.
- Đây vẫn là backtest thuần, chưa forward-test/paper-trading — hiệu suất quá khứ không đảm bảo tương lai.
- BTC/USDT — pair lớn nhất, thanh khoản cao nhất — lại nằm trong nhóm LOẠI (-0.214 R) trên H4. Đáng chú ý và cần cân nhắc kỹ trước khi loại hẳn một pair lớn như vậy chỉ dựa trên backtest.

## Đề xuất bước tiếp theo (chờ quyết định user, chưa làm)

1. **Paper trading 2-4 tuần** trên H4 + BOS_OB/CHOCH_OB + Grade A/B để xác nhận edge trong điều kiện thị trường thực, trước khi cân nhắc vốn thật.
2. Nếu muốn thêm bằng chứng backtest: mở rộng window về quá khứ xa hơn (trước 2026-05) để có mẫu independent hơn cho H4.
3. Nếu quyết định áp filter vào pipeline live (`smc-config-env.ts`/pipeline thật): cần task riêng, review kỹ vì đụng vào luồng production — KHÔNG tự ý làm trong task này.

Không commit — chờ quyết định của user về bước tiếp theo.
