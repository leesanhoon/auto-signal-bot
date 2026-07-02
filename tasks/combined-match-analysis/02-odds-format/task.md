# Task: 02 — Add formatCombinedOddsMessage

## Objective
Thêm hàm `formatCombinedOddsMessage()` vào `src/betting/odds-text-format.ts` để format odds cả N trận thành 1 message Telegram đẹp, dễ đọc.

## Instructions

1. **Đọc** `src/betting/odds-text-format.ts` để hiểu cấu trúc: `formatOddsDataMessage()`, `formatOddsText()`, `formatMainOddsSummary()`, các helper `findMarket()`, `findOutcome()`, `fmtNum()`, `fmtSignedPoint()`.

2. **Import thêm** `CombinedAnalysisPlan` từ `./betting-types.js` (sẽ dùng ở subtask 04).

3. **Thêm hàm `formatCombinedOddsMessage(payloads: MatchOddsPayload[]): string`**:
   - Đầu ra là 1 string Telegram Markdown
   - Dùng emoji section headers, align đẹp
   - Format mẫu (tham khảo, worker có thể cải thiện):
     ```
     ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     📊 *PHÂN TÍCH KÈO — 3 TRẬN NGÀY 03/07*
     ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

     ⏰ 06:00
     🏟 *Portugal vs Croatia*
     📊 1X2: 🏠 1.72  🤝 3.96  ✈️ 5.55
     📐 Chấp: 🏠 -0.75 @1.83 / ✈️ +0.75 @1.97
     ⚽ Tài/Xỉu: O2.5 @1.75 / U2.5 @2.15
     🔄 GG/NG: ✅1.74 / ❌2.00
     🎯 Tỉ số: 1-1@6.5 | 2-1@7 | 1-0@7 | 2-0@8.5

     ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

     ⏰ 10:00
     🏟 *Switzerland vs Algeria*
     📊 1X2: 🏠 2.08  🤝 3.35  ✈️ 4.24
     📐 Chấp: 🏠 -0.25 @1.74 / ✈️ +0.25 @2.17
     ⚽ Tài/Xỉu: O2.5 @2.21 / U2.5 @1.71
     🔄 GG/NG: ✅1.95 / ❌1.78
     🎯 Tỉ số: 1-1@5.5 | 1-0@6 | 2-0@9 | 2-1@8

     ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

     ⏰ 02:00
     🏟 *Spain vs Austria*
     📊 1X2: 🏠 1.33  🤝 5.70  ✈️ 11.10
     📐 Chấp: 🏠 -1 @1.43 / ✈️ +1 @2.77
     ⚽ Tài/Xỉu: O2.5 @1.72 / U2.5 @2.19
     🔄 GG/NG: ✅2.19 / ❌1.62
     🎯 Tỉ số: 2-0@6 | 1-0@6.5 | 2-1@8 | 1-1@9.5
     ```
   - Mỗi trận chỉ hiển thị: 1X2, Asian Handicap (1 mốc chính), EU Tài/Xỉu, GG/NG, Correct Score (top 4 odds ngắn nhất)
   - Dùng separator `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━` giữa các trận
   - Sort theo giờ đá (kickoffUnix tăng dần)
   - Header dòng đầu: `📊 *PHÂN TÍCH KÈO — {N} TRẬN NGÀY {date}*`

4. **Thêm export** cho hàm mới.

## Tips
- Dùng `Array.from(new Set(...))` thay vì spread `[...new Set(...)]` để tránh pre-existing lint về downlevelIteration
- Dùng `toLocaleString("vi-VN")` cho số tiền
- Nếu payloads rỗng, trả về `"Không có dữ liệu odds."`

## Acceptance Criteria
- [ ] `formatCombinedOddsMessage(payloads)` trả về string Markdown đẹp, có emoji, separator, header
- [ ] Mỗi trận hiển thị: 1X2, HCP (1 mốc), Tài/Xỉu EU, GG/NG, CS (top 4)
- [ ] Sort theo kickoffUnix
- [ ] Build không lỗi mới

## Files to Touch
- `src/betting/odds-text-format.ts` — thêm 1 function mới + import

## Out of Scope
- Không sửa hàm hiện có
- Không thay đổi logic gửi Telegram