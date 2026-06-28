import type { ChartConfig } from "../shared/types.js";

function chart(name: string, symbol: string): ChartConfig {
  return { name: `${name} H4`, symbol, interval: "240", description: `${name} — H4` };
}

export const CHARTS: ChartConfig[] = [
  // Commodities
  chart("XAU/USD", "OANDA:XAUUSD"),
  chart("XAG/USD", "OANDA:XAGUSD"),

  // Major pairs — highest liquidity, tight spreads
  chart("EUR/USD", "OANDA:EURUSD"),
  chart("GBP/USD", "OANDA:GBPUSD"),
  chart("USD/JPY", "OANDA:USDJPY"),
  chart("AUD/USD", "OANDA:AUDUSD"),
  chart("USD/CHF", "OANDA:USDCHF"),
  chart("USD/CAD", "OANDA:USDCAD"),
  chart("NZD/USD", "OANDA:NZDUSD"),

  // Cross pairs — good price action patterns
  chart("EUR/GBP", "OANDA:EURGBP"),
  chart("EUR/JPY", "OANDA:EURJPY"),
  chart("GBP/JPY", "OANDA:GBPJPY"),
  chart("AUD/JPY", "OANDA:AUDJPY"),
  chart("EUR/AUD", "OANDA:EURAUD"),
  chart("GBP/AUD", "OANDA:GBPAUD"),
  chart("EUR/CAD", "OANDA:EURCAD"),

  // Additional volatile crosses — strong momentum setups
  chart("CAD/JPY", "OANDA:CADJPY"),
  chart("CHF/JPY", "OANDA:CHFJPY"),
  chart("GBP/CHF", "OANDA:GBPCHF"),
  chart("EUR/NZD", "OANDA:EURNZD"),
  chart("GBP/NZD", "OANDA:GBPNZD"),
  chart("NZD/JPY", "OANDA:NZDJPY"),
  chart("AUD/CAD", "OANDA:AUDCAD"),
  chart("AUD/NZD", "OANDA:AUDNZD"),
];

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
  hide_volume: true,
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
