import type { ChartConfig, ChartTimeframe } from "./chart-types-common.js";
import type { ChartTimeframeMode } from "./volman-config-env.js";
import { loadActiveChartSymbols } from "./chart-symbols-repository-volman.js";

const TIMEFRAME_CONFIGS: Array<{
  timeframe: ChartTimeframe;
  interval: string;
}> = [
  { timeframe: "D1", interval: "D" },
  { timeframe: "H4", interval: "240" },
  { timeframe: "H1", interval: "60" },
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

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 phút

let cachedCharts: ChartConfig[] | undefined;
let cachedAt: number | undefined;

function isCacheFresh(): boolean {
  return (
    cachedCharts !== undefined &&
    cachedAt !== undefined &&
    Date.now() - cachedAt < CACHE_TTL_MS
  );
}

export async function getCharts(): Promise<ChartConfig[]> {
  if (isCacheFresh()) return cachedCharts as ChartConfig[];

  const baseSymbols = await loadActiveChartSymbols();
  const dayOfWeek = new Date().getDay();
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

  cachedCharts = baseSymbols
    .filter((base) => !(isWeekend && base.symbol.startsWith("OANDA:")))
    .flatMap((base) =>
      TIMEFRAME_CONFIGS.map((timeframe) =>
        chart(base.name, base.symbol, timeframe.timeframe, timeframe.interval),
      ),
    );
  cachedAt = Date.now();

  return cachedCharts;
}

export async function getChartsForTimeframeMode(
  timeframeMode: ChartTimeframeMode,
  primaryTimeframe: ChartTimeframe,
): Promise<ChartConfig[]> {
  const charts = await getCharts();
  if (timeframeMode === "single") {
    return charts.filter((chart) => chart.timeframe === primaryTimeframe);
  }
  return charts;
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
