# Done — 05-position-reconciliation

**Status:** APPROVED

`reconcileBinancePosition` đối chiếu code thật:
- Case `binanceExecutionStatus === "failed"` trả `decision: "CLOSE"` — đóng đúng bản ghi DB, tránh treo HOLD mãi mãi.
- Dời SL về breakeven: đặt SL mới trước, chỉ hủy SL cũ sau khi đặt mới thành công (đúng thứ tự bất biến); giá breakeven qua `roundToTickSize`; `newStopLoss` chỉ set khi dời SL thành công, không ghi sai DB khi fail.
- `check-open-trades-runner-volman.ts` rẽ nhánh đúng theo `position.binanceSymbol`, không đổi hành vi forex/commodity.

`npm run build && npm run test` pass.
