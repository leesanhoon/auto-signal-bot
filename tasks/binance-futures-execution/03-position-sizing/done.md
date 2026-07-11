# Done — 03-position-sizing

**Status:** APPROVED

`binance-position-sizing.ts`: `computeOrderQuantity` đúng công thức risk 1%, kiểm tra đủ minQty/minNotional/margin vượt balance. `roundToTickSize` và `splitTpQuantities` (bổ sung theo review plan để fix bug price precision / LOT_SIZE) implement đúng — round-down tp1 theo stepSize, dồn dư về tp2 để tổng luôn khớp `totalQuantity`.

`npm run build` pass, test coverage đủ 5+2 case theo task.md.
