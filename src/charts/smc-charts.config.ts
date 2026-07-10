import type { ChartConfig, ChartTimeframe } from "./chart-types-common.js";
import type {
  ChartTimeframeMode,
} from "./smc-config-env.js";

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
  { name: "ETH/USDT", symbol: "BINANCE:ETHUSDT" },

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

export const CHARTS: ChartConfig[] = BASE_CHARTS.flatMap((base) =>
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
