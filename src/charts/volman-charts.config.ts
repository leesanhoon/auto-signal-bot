import type { ChartConfig, ChartTimeframe } from "./chart-types-common.js";
import type { ChartTimeframeMode } from "./volman-config-env.js";

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
  { name: "VET/USDT", symbol: "BINANCE:VETUSDT" },
  { name: "THETA/USDT", symbol: "BINANCE:THETAUSDT" },
  { name: "EGLD/USDT", symbol: "BINANCE:EGLDUSDT" },
  { name: "FLOW/USDT", symbol: "BINANCE:FLOWUSDT" },
  { name: "SAND/USDT", symbol: "BINANCE:SANDUSDT" },
  { name: "MANA/USDT", symbol: "BINANCE:MANAUSDT" },
  { name: "AXS/USDT", symbol: "BINANCE:AXSUSDT" },
  { name: "ENJ/USDT", symbol: "BINANCE:ENJUSDT" },
  { name: "XTZ/USDT", symbol: "BINANCE:XTZUSDT" },
  { name: "KLAY/USDT", symbol: "BINANCE:KLAYUSDT" },
  { name: "GLMR/USDT", symbol: "BINANCE:GLMRUSDT" },
  { name: "MOVR/USDT", symbol: "BINANCE:MOVRUSDT" },
  { name: "MKR/USDT", symbol: "BINANCE:MKRUSDT" },
  { name: "COMP/USDT", symbol: "BINANCE:COMPUSDT" },
  { name: "SUSHI/USDT", symbol: "BINANCE:SUSHIUSDT" },
  { name: "1INCH/USDT", symbol: "BINANCE:1INCHUSDT" },
  { name: "BALANCER/USDT", symbol: "BINANCE:BALANCERUSDT" },
  { name: "GMX/USDT", symbol: "BINANCE:GMXUSDT" },
  { name: "PERP/USDT", symbol: "BINANCE:PERPUSDT" },
  { name: "SNX/USDT", symbol: "BINANCE:SNXUSDT" },
  { name: "GRT/USDT", symbol: "BINANCE:GRTUSDT" },
  { name: "BLUR/USDT", symbol: "BINANCE:BLURUSDT" },
  { name: "LOOKS/USDT", symbol: "BINANCE:LOOKSUSDT" },
  { name: "AGIX/USDT", symbol: "BINANCE:AGIXUSDT" },
  { name: "OCEAN/USDT", symbol: "BINANCE:OCEANUSDT" },
  { name: "FLOKI/USDT", symbol: "BINANCE:FLOKIUSDT" },
  { name: "DENT/USDT", symbol: "BINANCE:DENTUSDT" },
  { name: "SAFE/USDT", symbol: "BINANCE:SAFEUSDT" },
  { name: "MATIC/USDT", symbol: "BINANCE:MATICUSDT" },
  { name: "KCS/USDT", symbol: "BINANCE:KCSUSDT" },
  { name: "OKB/USDT", symbol: "BINANCE:OKBUSDT" },
  { name: "BGB/USDT", symbol: "BINANCE:BGBUSDT" },
  { name: "LEO/USDT", symbol: "BINANCE:LEOUSDT" },
  { name: "HT/USDT", symbol: "BINANCE:HTUSDT" },
  { name: "MANTA/USDT", symbol: "BINANCE:MANTAUSDT" },
  { name: "STARKNET/USDT", symbol: "BINANCE:STARKNETUSDT" },
  { name: "ROSE/USDT", symbol: "BINANCE:ROSEUSDT" },
  { name: "ARKM/USDT", symbol: "BINANCE:ARKMUSDT" },
  { name: "MNT/USDT", symbol: "BINANCE:MNTUSDT" },
  { name: "BLUR/USDT", symbol: "BINANCE:BLURUSDT" },
  { name: "PIXEL/USDT", symbol: "BINANCE:PIXELUSDT" },
  { name: "ENS/USDT", symbol: "BINANCE:ENSUSDT" },
  { name: "RSR/USDT", symbol: "BINANCE:RSRUSDT" },
  { name: "CVX/USDT", symbol: "BINANCE:CVXUSDT" },
  { name: "FXS/USDT", symbol: "BINANCE:FXSUSDT" },
  { name: "GSWAP/USDT", symbol: "BINANCE:GSWAPUSDT" },
  { name: "ASTR/USDT", symbol: "BINANCE:ASTRUSDT" },
  { name: "DIA/USDT", symbol: "BINANCE:DIAUSDT" },
  { name: "WOO/USDT", symbol: "BINANCE:WOOUSDT" },
  { name: "DIMO/USDT", symbol: "BINANCE:DIMOUSDT" },
  { name: "RDNT/USDT", symbol: "BINANCE:RDNTUSDT" },
  { name: "BEAM/USDT", symbol: "BINANCE:BEAMUSDT" },
  { name: "STRAX/USDT", symbol: "BINANCE:STRAXUSDT" },
  { name: "RARE/USDT", symbol: "BINANCE:RAREUSDT" },
  { name: "LUNA/USDT", symbol: "BINANCE:LUNAUSDT" },
  { name: "LUNC/USDT", symbol: "BINANCE:LUNCUSDT" },
  { name: "ORMAI/USDT", symbol: "BINANCE:ORMAIUSDT" },
  { name: "AUCTION/USDT", symbol: "BINANCE:AUCTIONUSDT" },
  { name: "GMT/USDT", symbol: "BINANCE:GMTUSDT" },
  { name: "GNS/USDT", symbol: "BINANCE:GNSUSDT" },
  { name: "ALICE/USDT", symbol: "BINANCE:ALICEUSDT" },
  { name: "IDEX/USDT", symbol: "BINANCE:IDEXUSDT" },
  { name: "WEB3/USDT", symbol: "BINANCE:WEB3USDT" },
  { name: "POND/USDT", symbol: "BINANCE:PONDUSDT" },
  { name: "HFT/USDT", symbol: "BINANCE:HFTUSDT" },
  { name: "AIDOGE/USDT", symbol: "BINANCE:AIDOGEUSDT" },
  { name: "ARKHAM/USDT", symbol: "BINANCE:ARKHAMUSDT" },
  { name: "SCNSOL/USDT", symbol: "BINANCE:SCNSOLUSDT" },
  { name: "PUNDIX/USDT", symbol: "BINANCE:PUNDIXUSDT" },
  { name: "MOVEZ/USDT", symbol: "BINANCE:MOVEZUSDT" },
  { name: "SAGA/USDT", symbol: "BINANCE:SAGAUSDT" },
  { name: "NOTCOIN/USDT", symbol: "BINANCE:NOTCOINUSDT" },
  { name: "HMSTR/USDT", symbol: "BINANCE:HMSTRUSDT" },
  { name: "USUAL/USDT", symbol: "BINANCE:USUALUSDT" },
  { name: "PIXEL/USDT", symbol: "BINANCE:PIXELUSDT" },
  { name: "MOVEZ/USDT", symbol: "BINANCE:MOVEZUSDT" },
  { name: "NAVI/USDT", symbol: "BINANCE:NAVIUSDT" },
  { name: "GYEN/USDT", symbol: "BINANCE:GYENUSDT" },
  { name: "BAKE/USDT", symbol: "BINANCE:BAKEUSDT" },
  { name: "BURGER/USDT", symbol: "BINANCE:BURGERUSDT" },
  { name: "MSWAP/USDT", symbol: "BINANCE:MSWAPUSDT" },
  { name: "VOXEL/USDT", symbol: "BINANCE:VOXELUSDT" },
  { name: "C98/USDT", symbol: "BINANCE:C98USDT" },
  { name: "ALPACA/USDT", symbol: "BINANCE:ALPACAUSDT" },
  { name: "BIFI/USDT", symbol: "BINANCE:BIFIUSDT" },
  { name: "AUTO/USDT", symbol: "BINANCE:AUTOUSDT" },
  { name: "FARM/USDT", symbol: "BINANCE:FARMUSDT" },
  { name: "PCS/USDT", symbol: "BINANCE:PCSUSDT" },
  { name: "MDX/USDT", symbol: "BINANCE:MDXUSDT" },
  { name: "MBOX/USDT", symbol: "BINANCE:MBOXUSDT" },
  { name: "WING/USDT", symbol: "BINANCE:WINGUSDT" },
  { name: "LINA/USDT", symbol: "BINANCE:LINAUSDT" },
  { name: "SAFEMOON/USDT", symbol: "BINANCE:SAFEMOONUSDT" },
  { name: "BABYDOGE/USDT", symbol: "BINANCE:BABYDOGEUSDT" },
  { name: "KISHU/USDT", symbol: "BINANCE:KISHUUSDT" },
  { name: "DOGECOIN/USDT", symbol: "BINANCE:DOGECOINUSDT" },
  { name: "SHINU/USDT", symbol: "BINANCE:SHINUUSDT" },
  { name: "AKITA/USDT", symbol: "BINANCE:AKITAUSDT" },
  { name: "SAITAMA/USDT", symbol: "BINANCE:SAITAMAUSDT" },
  { name: "ITACHI/USDT", symbol: "BINANCE:ITACHIUSDT" },
  { name: "HOKKAIDU/USDT", symbol: "BINANCE:HOKKAIIUSDT" },
  { name: "APTOS/USDT", symbol: "BINANCE:APTOSUSDT" },
  { name: "STEPN/USDT", symbol: "BINANCE:STEPNUSDT" },
  { name: "EPIK/USDT", symbol: "BINANCE:EPIKUSDT" },
  { name: "HI/USDT", symbol: "BINANCE:HIUSDT" },
  { name: "BABAPE/USDT", symbol: "BINANCE:BABAPEUSDT" },
  { name: "SHOG/USDT", symbol: "BINANCE:SHOGUSDT" },
  { name: "CHEEMS/USDT", symbol: "BINANCE:CHEEMSUSDT" },
  { name: "RETIK/USDT", symbol: "BINANCE:RETIKUSDT" },
  { name: "NEIRO/USDT", symbol: "BINANCE:NEIROUSDT" },
  { name: "BNX/USDT", symbol: "BINANCE:BNXUSDT" },
  { name: "MERLIN/USDT", symbol: "BINANCE:MERLINUSDT" },
  { name: "PRCL/USDT", symbol: "BINANCE:PRCLUSDT" },
  { name: "MAV/USDT", symbol: "BINANCE:MAVUSDT" },
  { name: "MERL/USDT", symbol: "BINANCE:MERLUSDT" },
  { name: "MEDI/USDT", symbol: "BINANCE:MEDIUSDT" },
  { name: "NYAN/USDT", symbol: "BINANCE:NYANUSDT" },
  { name: "QUNT/USDT", symbol: "BINANCE:QUNTUSDT" },
  { name: "RATH/USDT", symbol: "BINANCE:RATHUSDT" },

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
