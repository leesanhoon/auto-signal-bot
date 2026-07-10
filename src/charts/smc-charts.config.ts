import type { ChartConfig, ChartTimeframe } from "./chart-types-common.js";
import type { ChartTimeframeMode } from "./smc-config-env.js";

const TIMEFRAME_CONFIGS: Array<{
  timeframe: ChartTimeframe;
  interval: string;
}> = [
  { timeframe: "D1", interval: "D" },
  { timeframe: "H4", interval: "240" },
  { timeframe: "M15", interval: "15" },
];

function chart(
  name: string,
  symbol: string,
  timeframe: ChartTimeframe,
  interval: string,
): ChartConfig {
  return {
    name: `${name} ${timeframe}`,
    symbol,
    interval,
    description: `${name} — ${timeframe}`,
    timeframe,
  };
}

const BASE_CHARTS: Array<{ name: string; symbol: string }> = [
  // Crypto — Binance spot (24/7, public API, khong can API key)
  { name: "BTC/USDT", symbol: "BINANCE:BTCUSDT" },
  { name: "DASH/USDT", symbol: "BINANCE:DASHUSDT" },
  { name: "ETH/USDT", symbol: "BINANCE:ETHUSDT" },
  { name: "LTC/USDT", symbol: "BINANCE:LTCUSDT" },
  { name: "DOT/USDT", symbol: "BINANCE:DOTUSDT" },
  { name: "XRP/USDT", symbol: "BINANCE:XRPUSDT" },
  { name: "ADA/USDT", symbol: "BINANCE:ADAUSDT" },
  { name: "BCH/USDT", symbol: "BINANCE:BCHUSDT" },
  { name: "SOL/USDT", symbol: "BINANCE:SOLUSDT" },
  { name: "AVA/USDT", symbol: "BINANCE:AVAUSDT" },
  { name: "ETC/USDT", symbol: "BINANCE:ETCUSDT" },
  { name: "NEO/USDT", symbol: "BINANCE:NEOUSDT" },
  { name: "DOGE/USDT", symbol: "BINANCE:DOGEUSDT" },
  { name: "BNB/USDT", symbol: "BINANCE:BNBUSDT" },
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

  // Commodities
  { name: "XAU/USD", symbol: "OANDA:XAUUSD" },
  // { name: "XAG/USD", symbol: "OANDA:XAGUSD" },

  // Major pairs — highest liquidity, tight spreads
  { name: "EUR/USD", symbol: "OANDA:EURUSD" },
  { name: "GBP/USD", symbol: "OANDA:GBPUSD" },
  { name: "USD/JPY", symbol: "OANDA:USDJPY" },
  { name: "AUD/USD", symbol: "OANDA:AUDUSD" },
  { name: "USD/CHF", symbol: "OANDA:USDCHF" },
  { name: "USD/CAD", symbol: "OANDA:USDCAD" },
  { name: "NZD/USD", symbol: "OANDA:NZDUSD" },

  // Cross pairs — good price action patterns
  // { name: "EUR/GBP", symbol: "OANDA:EURGBP" },
  // { name: "EUR/JPY", symbol: "OANDA:EURJPY" },
  // { name: "GBP/JPY", symbol: "OANDA:GBPJPY" },
  // { name: "AUD/JPY", symbol: "OANDA:AUDJPY" },
  // { name: "EUR/AUD", symbol: "OANDA:EURAUD" },
  // { name: "GBP/AUD", symbol: "OANDA:GBPAUD" },
  // { name: "EUR/CAD", symbol: "OANDA:EURCAD" },

  // Additional volatile crosses — strong momentum setups
  // { name: "CAD/JPY", symbol: "OANDA:CADJPY" },
  // { name: "CHF/JPY", symbol: "OANDA:CHFJPY" },
  // { name: "GBP/CHF", symbol: "OANDA:GBPCHF" },
  // { name: "EUR/NZD", symbol: "OANDA:EURNZD" },
  // { name: "GBP/NZD", symbol: "OANDA:GBPNZD" },
  // { name: "NZD/JPY", symbol: "OANDA:NZDJPY" },
  // { name: "AUD/CAD", symbol: "OANDA:AUDCAD" },
  // { name: "AUD/NZD", symbol: "OANDA:AUDNZD" },
];

export const CHARTS: ChartConfig[] = BASE_CHARTS.filter((base) => {
  const dayOfWeek = new Date().getDay();
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
  if (isWeekend && base.symbol.startsWith("OANDA:")) {
    return false;
  }
  return true;
}).flatMap((base) =>
  TIMEFRAME_CONFIGS.map((timeframe) =>
    chart(base.name, base.symbol, timeframe.timeframe, timeframe.interval),
  ),
);

export function getChartsForTimeframeMode(
  timeframeMode: ChartTimeframeMode,
  primaryTimeframe: ChartTimeframe,
): ChartConfig[] {
  if (timeframeMode === "single") {
    return CHARTS.filter((chart) => chart.timeframe === primaryTimeframe);
  }
  return CHARTS;
}

export function buildChartHtml(c: ChartConfig): string {
  return `<!DOCTYPE html>
<html><head><style>body{margin:0;background:#131722;}#tv_chart{width:100%;height:100vh;}</style></head>
<body>
<div id="tv_chart"></div>
<script src="https://s3.tradingview.com/tv.js"></script>
<script>
new TradingView.widget({
  container_id: "tv_chart",
  autosize: true,
  symbol: "${c.symbol}",
  interval: "${c.interval}",
  timezone: "Etc/UTC",
  theme: "dark",
  style: "1",
  locale: "en",
  hide_top_toolbar: false,
  hide_side_toolbar: false,
  hide_volume: false,
  allow_symbol_change: false,
  save_image: false,
  withdateranges: true,
  studies: [
    { id: "MAExp@tv-basicstudies", inputs: { length: 20 } }
  ]
});
</script>
</body></html>`;
}
