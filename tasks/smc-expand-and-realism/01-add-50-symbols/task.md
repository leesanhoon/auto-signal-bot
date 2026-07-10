# Task 01: Thêm 50 symbols Binance vào config

Files được sửa (chỉ 2 file này, không file nào khác):
- `src/charts/smc-charts.config.ts`
- `src/charts/volman-charts.config.ts`

KHÔNG commit. KHÔNG thêm/bớt/đổi tên symbol ngoài danh sách dưới — mọi symbol đã được Lead verify TRADING trên Binance ngày 2026-07-10.

## Việc cần làm

Trong cả 2 file, mảng `BASE_CHARTS` có section `// Crypto — Binance spot ...` với 14 cặp hiện tại (BTC → BNB). GIỮ NGUYÊN 14 cặp đó, chèn thêm 50 entry sau vào cuối section crypto (trước section `// Commodities`), đúng format hiện có `{ name: "X/USDT", symbol: "BINANCE:XUSDT" },`:

```ts
{ name: "ZEC/USDT", symbol: "BINANCE:ZECUSDT" },
{ name: "TRX/USDT", symbol: "BINANCE:TRXUSDT" },
{ name: "XLM/USDT", symbol: "BINANCE:XLMUSDT" },
{ name: "AAVE/USDT", symbol: "BINANCE:AAVEUSDT" },
{ name: "UNI/USDT", symbol: "BINANCE:UNIUSDT" },
{ name: "ARB/USDT", symbol: "BINANCE:ARBUSDT" },
{ name: "NEAR/USDT", symbol: "BINANCE:NEARUSDT" },
{ name: "SUI/USDT", symbol: "BINANCE:SUIUSDT" },
{ name: "PEPE/USDT", symbol: "BINANCE:PEPEUSDT" },
{ name: "WLD/USDT", symbol: "BINANCE:WLDUSDT" },
{ name: "TAO/USDT", symbol: "BINANCE:TAOUSDT" },
{ name: "ENA/USDT", symbol: "BINANCE:ENAUSDT" },
{ name: "PAXG/USDT", symbol: "BINANCE:PAXGUSDT" },
{ name: "LINK/USDT", symbol: "BINANCE:LINKUSDT" },
{ name: "AVAX/USDT", symbol: "BINANCE:AVAXUSDT" },
{ name: "ICP/USDT", symbol: "BINANCE:ICPUSDT" },
{ name: "TIA/USDT", symbol: "BINANCE:TIAUSDT" },
{ name: "ONDO/USDT", symbol: "BINANCE:ONDOUSDT" },
{ name: "FIL/USDT", symbol: "BINANCE:FILUSDT" },
{ name: "SEI/USDT", symbol: "BINANCE:SEIUSDT" },
{ name: "FET/USDT", symbol: "BINANCE:FETUSDT" },
{ name: "HBAR/USDT", symbol: "BINANCE:HBARUSDT" },
{ name: "IOTA/USDT", symbol: "BINANCE:IOTAUSDT" },
{ name: "BONK/USDT", symbol: "BINANCE:BONKUSDT" },
{ name: "LDO/USDT", symbol: "BINANCE:LDOUSDT" },
{ name: "INJ/USDT", symbol: "BINANCE:INJUSDT" },
{ name: "EIGEN/USDT", symbol: "BINANCE:EIGENUSDT" },
{ name: "POL/USDT", symbol: "BINANCE:POLUSDT" },
{ name: "APT/USDT", symbol: "BINANCE:APTUSDT" },
{ name: "OP/USDT", symbol: "BINANCE:OPUSDT" },
{ name: "PENGU/USDT", symbol: "BINANCE:PENGUUSDT" },
{ name: "ORDI/USDT", symbol: "BINANCE:ORDIUSDT" },
{ name: "ALGO/USDT", symbol: "BINANCE:ALGOUSDT" },
{ name: "JTO/USDT", symbol: "BINANCE:JTOUSDT" },
{ name: "PENDLE/USDT", symbol: "BINANCE:PENDLEUSDT" },
{ name: "APE/USDT", symbol: "BINANCE:APEUSDT" },
{ name: "ETHFI/USDT", symbol: "BINANCE:ETHFIUSDT" },
{ name: "PYTH/USDT", symbol: "BINANCE:PYTHUSDT" },
{ name: "SHIB/USDT", symbol: "BINANCE:SHIBUSDT" },
{ name: "GALA/USDT", symbol: "BINANCE:GALAUSDT" },
{ name: "ZRO/USDT", symbol: "BINANCE:ZROUSDT" },
{ name: "RENDER/USDT", symbol: "BINANCE:RENDERUSDT" },
{ name: "CAKE/USDT", symbol: "BINANCE:CAKEUSDT" },
{ name: "CRV/USDT", symbol: "BINANCE:CRVUSDT" },
{ name: "CHZ/USDT", symbol: "BINANCE:CHZUSDT" },
{ name: "RUNE/USDT", symbol: "BINANCE:RUNEUSDT" },
{ name: "ATOM/USDT", symbol: "BINANCE:ATOMUSDT" },
{ name: "DYDX/USDT", symbol: "BINANCE:DYDXUSDT" },
{ name: "STRK/USDT", symbol: "BINANCE:STRKUSDT" },
{ name: "WIF/USDT", symbol: "BINANCE:WIFUSDT" },
```

Sau khi chèn, section crypto mỗi file phải có đúng **64 entries**, không trùng lặp.

## Verification (bắt buộc, ghi output vào result.md)

```bash
npm run build
npm run test
npm run backtest:smc
```

- Backtest phải chạy hết 64 cặp crypto + commodities/forex; ghi lại danh sách pair bị "Skip ... OHLC error" nếu có (kỳ vọng: không có pair crypto nào bị skip).
- Ghi summary backtest vào `tasks/smc-expand-and-realism/01-add-50-symbols/result.md`.

## Nếu bị chặn

Ghi `tasks/smc-expand-and-realism/01-add-50-symbols/blocked.md`, không đoán.
