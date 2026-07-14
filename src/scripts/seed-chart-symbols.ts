import "../shared/env.js";
import { getDb } from "../shared/db.js";
import { toBinanceSymbol } from "../charts/ohlc-provider.js";
import { getExchangeInfoFilters } from "../charts/binance-futures-client.js";

type SeedSymbol = {
  name: string;
  symbol: string;
  category: "crypto" | "commodity" | "major" | "cross";
  active: boolean;
};

// Transcribed verbatim from the pre-migration BASE_CHARTS array in
// src/charts/volman-charts.config.ts (git history has the original file).
// BINANCE: entries are validated against live Binance Futures exchangeInfo
// below before insert — duplicates/typos/delisted tickers are dropped there,
// not filtered here.
const SEED_DATA: SeedSymbol[] = [
  { name: "BTC/USDT", symbol: "BINANCE:BTCUSDT", category: "crypto", active: true },
  { name: "DASH/USDT", symbol: "BINANCE:DASHUSDT", category: "crypto", active: true },
  { name: "ETH/USDT", symbol: "BINANCE:ETHUSDT", category: "crypto", active: true },
  { name: "LTC/USDT", symbol: "BINANCE:LTCUSDT", category: "crypto", active: true },
  { name: "DOT/USDT", symbol: "BINANCE:DOTUSDT", category: "crypto", active: true },
  { name: "XRP/USDT", symbol: "BINANCE:XRPUSDT", category: "crypto", active: true },
  { name: "ADA/USDT", symbol: "BINANCE:ADAUSDT", category: "crypto", active: true },
  { name: "BCH/USDT", symbol: "BINANCE:BCHUSDT", category: "crypto", active: true },
  { name: "SOL/USDT", symbol: "BINANCE:SOLUSDT", category: "crypto", active: true },
  { name: "AVA/USDT", symbol: "BINANCE:AVAUSDT", category: "crypto", active: true },
  { name: "ETC/USDT", symbol: "BINANCE:ETCUSDT", category: "crypto", active: true },
  { name: "NEO/USDT", symbol: "BINANCE:NEOUSDT", category: "crypto", active: true },
  { name: "DOGE/USDT", symbol: "BINANCE:DOGEUSDT", category: "crypto", active: true },
  { name: "BNB/USDT", symbol: "BINANCE:BNBUSDT", category: "crypto", active: true },
  { name: "ZEC/USDT", symbol: "BINANCE:ZECUSDT", category: "crypto", active: true },
  { name: "TRX/USDT", symbol: "BINANCE:TRXUSDT", category: "crypto", active: true },
  { name: "XLM/USDT", symbol: "BINANCE:XLMUSDT", category: "crypto", active: true },
  { name: "AAVE/USDT", symbol: "BINANCE:AAVEUSDT", category: "crypto", active: true },
  { name: "UNI/USDT", symbol: "BINANCE:UNIUSDT", category: "crypto", active: true },
  { name: "ARB/USDT", symbol: "BINANCE:ARBUSDT", category: "crypto", active: true },
  { name: "NEAR/USDT", symbol: "BINANCE:NEARUSDT", category: "crypto", active: true },
  { name: "SUI/USDT", symbol: "BINANCE:SUIUSDT", category: "crypto", active: true },
  { name: "PEPE/USDT", symbol: "BINANCE:PEPEUSDT", category: "crypto", active: true },
  { name: "WLD/USDT", symbol: "BINANCE:WLDUSDT", category: "crypto", active: true },
  { name: "TAO/USDT", symbol: "BINANCE:TAOUSDT", category: "crypto", active: true },
  { name: "ENA/USDT", symbol: "BINANCE:ENAUSDT", category: "crypto", active: true },
  { name: "PAXG/USDT", symbol: "BINANCE:PAXGUSDT", category: "crypto", active: true },
  { name: "LINK/USDT", symbol: "BINANCE:LINKUSDT", category: "crypto", active: true },
  { name: "AVAX/USDT", symbol: "BINANCE:AVAXUSDT", category: "crypto", active: true },
  { name: "ICP/USDT", symbol: "BINANCE:ICPUSDT", category: "crypto", active: true },
  { name: "TIA/USDT", symbol: "BINANCE:TIAUSDT", category: "crypto", active: true },
  { name: "ONDO/USDT", symbol: "BINANCE:ONDOUSDT", category: "crypto", active: true },
  { name: "FIL/USDT", symbol: "BINANCE:FILUSDT", category: "crypto", active: true },
  { name: "SEI/USDT", symbol: "BINANCE:SEIUSDT", category: "crypto", active: true },
  { name: "FET/USDT", symbol: "BINANCE:FETUSDT", category: "crypto", active: true },
  { name: "HBAR/USDT", symbol: "BINANCE:HBARUSDT", category: "crypto", active: true },
  { name: "IOTA/USDT", symbol: "BINANCE:IOTAUSDT", category: "crypto", active: true },
  { name: "BONK/USDT", symbol: "BINANCE:BONKUSDT", category: "crypto", active: true },
  { name: "LDO/USDT", symbol: "BINANCE:LDOUSDT", category: "crypto", active: true },
  { name: "INJ/USDT", symbol: "BINANCE:INJUSDT", category: "crypto", active: true },
  { name: "EIGEN/USDT", symbol: "BINANCE:EIGENUSDT", category: "crypto", active: true },
  { name: "POL/USDT", symbol: "BINANCE:POLUSDT", category: "crypto", active: true },
  { name: "APT/USDT", symbol: "BINANCE:APTUSDT", category: "crypto", active: true },
  { name: "OP/USDT", symbol: "BINANCE:OPUSDT", category: "crypto", active: true },
  { name: "PENGU/USDT", symbol: "BINANCE:PENGUUSDT", category: "crypto", active: true },
  { name: "ORDI/USDT", symbol: "BINANCE:ORDIUSDT", category: "crypto", active: true },
  { name: "ALGO/USDT", symbol: "BINANCE:ALGOUSDT", category: "crypto", active: true },
  { name: "JTO/USDT", symbol: "BINANCE:JTOUSDT", category: "crypto", active: true },
  { name: "PENDLE/USDT", symbol: "BINANCE:PENDLEUSDT", category: "crypto", active: true },
  { name: "APE/USDT", symbol: "BINANCE:APEUSDT", category: "crypto", active: true },
  { name: "ETHFI/USDT", symbol: "BINANCE:ETHFIUSDT", category: "crypto", active: true },
  { name: "PYTH/USDT", symbol: "BINANCE:PYTHUSDT", category: "crypto", active: true },
  { name: "SHIB/USDT", symbol: "BINANCE:SHIBUSDT", category: "crypto", active: true },
  { name: "GALA/USDT", symbol: "BINANCE:GALAUSDT", category: "crypto", active: true },
  { name: "ZRO/USDT", symbol: "BINANCE:ZROUSDT", category: "crypto", active: true },
  { name: "RENDER/USDT", symbol: "BINANCE:RENDERUSDT", category: "crypto", active: true },
  { name: "CAKE/USDT", symbol: "BINANCE:CAKEUSDT", category: "crypto", active: true },
  { name: "CRV/USDT", symbol: "BINANCE:CRVUSDT", category: "crypto", active: true },
  { name: "CHZ/USDT", symbol: "BINANCE:CHZUSDT", category: "crypto", active: true },
  { name: "RUNE/USDT", symbol: "BINANCE:RUNEUSDT", category: "crypto", active: true },
  { name: "ATOM/USDT", symbol: "BINANCE:ATOMUSDT", category: "crypto", active: true },
  { name: "DYDX/USDT", symbol: "BINANCE:DYDXUSDT", category: "crypto", active: true },
  { name: "STRK/USDT", symbol: "BINANCE:STRKUSDT", category: "crypto", active: true },
  { name: "WIF/USDT", symbol: "BINANCE:WIFUSDT", category: "crypto", active: true },
  { name: "VET/USDT", symbol: "BINANCE:VETUSDT", category: "crypto", active: true },
  { name: "THETA/USDT", symbol: "BINANCE:THETAUSDT", category: "crypto", active: true },
  { name: "EGLD/USDT", symbol: "BINANCE:EGLDUSDT", category: "crypto", active: true },
  { name: "FLOW/USDT", symbol: "BINANCE:FLOWUSDT", category: "crypto", active: true },
  { name: "SAND/USDT", symbol: "BINANCE:SANDUSDT", category: "crypto", active: true },
  { name: "MANA/USDT", symbol: "BINANCE:MANAUSDT", category: "crypto", active: true },
  { name: "AXS/USDT", symbol: "BINANCE:AXSUSDT", category: "crypto", active: true },
  { name: "ENJ/USDT", symbol: "BINANCE:ENJUSDT", category: "crypto", active: true },
  { name: "XTZ/USDT", symbol: "BINANCE:XTZUSDT", category: "crypto", active: true },
  { name: "KLAY/USDT", symbol: "BINANCE:KLAYUSDT", category: "crypto", active: true },
  { name: "GLMR/USDT", symbol: "BINANCE:GLMRUSDT", category: "crypto", active: true },
  { name: "MOVR/USDT", symbol: "BINANCE:MOVRUSDT", category: "crypto", active: true },
  { name: "MKR/USDT", symbol: "BINANCE:MKRUSDT", category: "crypto", active: true },
  { name: "COMP/USDT", symbol: "BINANCE:COMPUSDT", category: "crypto", active: true },
  { name: "SUSHI/USDT", symbol: "BINANCE:SUSHIUSDT", category: "crypto", active: true },
  { name: "1INCH/USDT", symbol: "BINANCE:1INCHUSDT", category: "crypto", active: true },
  { name: "BALANCER/USDT", symbol: "BINANCE:BALANCERUSDT", category: "crypto", active: true },
  { name: "GMX/USDT", symbol: "BINANCE:GMXUSDT", category: "crypto", active: true },
  { name: "PERP/USDT", symbol: "BINANCE:PERPUSDT", category: "crypto", active: true },
  { name: "SNX/USDT", symbol: "BINANCE:SNXUSDT", category: "crypto", active: true },
  { name: "GRT/USDT", symbol: "BINANCE:GRTUSDT", category: "crypto", active: true },
  { name: "BLUR/USDT", symbol: "BINANCE:BLURUSDT", category: "crypto", active: true },
  { name: "LOOKS/USDT", symbol: "BINANCE:LOOKSUSDT", category: "crypto", active: true },
  { name: "AGIX/USDT", symbol: "BINANCE:AGIXUSDT", category: "crypto", active: true },
  { name: "OCEAN/USDT", symbol: "BINANCE:OCEANUSDT", category: "crypto", active: true },
  { name: "FLOKI/USDT", symbol: "BINANCE:FLOKIUSDT", category: "crypto", active: true },
  { name: "DENT/USDT", symbol: "BINANCE:DENTUSDT", category: "crypto", active: true },
  { name: "SAFE/USDT", symbol: "BINANCE:SAFEUSDT", category: "crypto", active: true },
  { name: "MATIC/USDT", symbol: "BINANCE:MATICUSDT", category: "crypto", active: true },
  { name: "KCS/USDT", symbol: "BINANCE:KCSUSDT", category: "crypto", active: true },
  { name: "OKB/USDT", symbol: "BINANCE:OKBUSDT", category: "crypto", active: true },
  { name: "BGB/USDT", symbol: "BINANCE:BGBUSDT", category: "crypto", active: true },
  { name: "LEO/USDT", symbol: "BINANCE:LEOUSDT", category: "crypto", active: true },
  { name: "HT/USDT", symbol: "BINANCE:HTUSDT", category: "crypto", active: true },
  { name: "MANTA/USDT", symbol: "BINANCE:MANTAUSDT", category: "crypto", active: true },
  { name: "STARKNET/USDT", symbol: "BINANCE:STARKNETUSDT", category: "crypto", active: true },
  { name: "ROSE/USDT", symbol: "BINANCE:ROSEUSDT", category: "crypto", active: true },
  { name: "ARKM/USDT", symbol: "BINANCE:ARKMUSDT", category: "crypto", active: true },
  { name: "MNT/USDT", symbol: "BINANCE:MNTUSDT", category: "crypto", active: true },
  { name: "PIXEL/USDT", symbol: "BINANCE:PIXELUSDT", category: "crypto", active: true },
  { name: "ENS/USDT", symbol: "BINANCE:ENSUSDT", category: "crypto", active: true },
  { name: "RSR/USDT", symbol: "BINANCE:RSRUSDT", category: "crypto", active: true },
  { name: "CVX/USDT", symbol: "BINANCE:CVXUSDT", category: "crypto", active: true },
  { name: "FXS/USDT", symbol: "BINANCE:FXSUSDT", category: "crypto", active: true },
  { name: "GSWAP/USDT", symbol: "BINANCE:GSWAPUSDT", category: "crypto", active: true },
  { name: "ASTR/USDT", symbol: "BINANCE:ASTRUSDT", category: "crypto", active: true },
  { name: "DIA/USDT", symbol: "BINANCE:DIAUSDT", category: "crypto", active: true },
  { name: "WOO/USDT", symbol: "BINANCE:WOOUSDT", category: "crypto", active: true },
  { name: "DIMO/USDT", symbol: "BINANCE:DIMOUSDT", category: "crypto", active: true },
  { name: "RDNT/USDT", symbol: "BINANCE:RDNTUSDT", category: "crypto", active: true },
  { name: "BEAM/USDT", symbol: "BINANCE:BEAMUSDT", category: "crypto", active: true },
  { name: "STRAX/USDT", symbol: "BINANCE:STRAXUSDT", category: "crypto", active: true },
  { name: "RARE/USDT", symbol: "BINANCE:RAREUSDT", category: "crypto", active: true },
  { name: "LUNA/USDT", symbol: "BINANCE:LUNAUSDT", category: "crypto", active: true },
  { name: "LUNC/USDT", symbol: "BINANCE:LUNCUSDT", category: "crypto", active: true },
  { name: "ORMAI/USDT", symbol: "BINANCE:ORMAIUSDT", category: "crypto", active: true },
  { name: "AUCTION/USDT", symbol: "BINANCE:AUCTIONUSDT", category: "crypto", active: true },
  { name: "GMT/USDT", symbol: "BINANCE:GMTUSDT", category: "crypto", active: true },
  { name: "GNS/USDT", symbol: "BINANCE:GNSUSDT", category: "crypto", active: true },
  { name: "ALICE/USDT", symbol: "BINANCE:ALICEUSDT", category: "crypto", active: true },
  { name: "IDEX/USDT", symbol: "BINANCE:IDEXUSDT", category: "crypto", active: true },
  { name: "WEB3/USDT", symbol: "BINANCE:WEB3USDT", category: "crypto", active: true },
  { name: "POND/USDT", symbol: "BINANCE:PONDUSDT", category: "crypto", active: true },
  { name: "HFT/USDT", symbol: "BINANCE:HFTUSDT", category: "crypto", active: true },
  { name: "AIDOGE/USDT", symbol: "BINANCE:AIDOGEUSDT", category: "crypto", active: true },
  { name: "ARKHAM/USDT", symbol: "BINANCE:ARKHAMUSDT", category: "crypto", active: true },
  { name: "SCNSOL/USDT", symbol: "BINANCE:SCNSOLUSDT", category: "crypto", active: true },
  { name: "PUNDIX/USDT", symbol: "BINANCE:PUNDIXUSDT", category: "crypto", active: true },
  { name: "MOVEZ/USDT", symbol: "BINANCE:MOVEZUSDT", category: "crypto", active: true },
  { name: "SAGA/USDT", symbol: "BINANCE:SAGAUSDT", category: "crypto", active: true },
  { name: "NOTCOIN/USDT", symbol: "BINANCE:NOTCOINUSDT", category: "crypto", active: true },
  { name: "HMSTR/USDT", symbol: "BINANCE:HMSTRUSDT", category: "crypto", active: true },
  { name: "USUAL/USDT", symbol: "BINANCE:USUALUSDT", category: "crypto", active: true },
  { name: "NAVI/USDT", symbol: "BINANCE:NAVIUSDT", category: "crypto", active: true },
  { name: "GYEN/USDT", symbol: "BINANCE:GYENUSDT", category: "crypto", active: true },
  { name: "BAKE/USDT", symbol: "BINANCE:BAKEUSDT", category: "crypto", active: true },
  { name: "BURGER/USDT", symbol: "BINANCE:BURGERUSDT", category: "crypto", active: true },
  { name: "MSWAP/USDT", symbol: "BINANCE:MSWAPUSDT", category: "crypto", active: true },
  { name: "VOXEL/USDT", symbol: "BINANCE:VOXELUSDT", category: "crypto", active: true },
  { name: "C98/USDT", symbol: "BINANCE:C98USDT", category: "crypto", active: true },
  { name: "ALPACA/USDT", symbol: "BINANCE:ALPACAUSDT", category: "crypto", active: true },
  { name: "BIFI/USDT", symbol: "BINANCE:BIFIUSDT", category: "crypto", active: true },
  { name: "AUTO/USDT", symbol: "BINANCE:AUTOUSDT", category: "crypto", active: true },
  { name: "FARM/USDT", symbol: "BINANCE:FARMUSDT", category: "crypto", active: true },
  { name: "PCS/USDT", symbol: "BINANCE:PCSUSDT", category: "crypto", active: true },
  { name: "MDX/USDT", symbol: "BINANCE:MDXUSDT", category: "crypto", active: true },
  { name: "MBOX/USDT", symbol: "BINANCE:MBOXUSDT", category: "crypto", active: true },
  { name: "WING/USDT", symbol: "BINANCE:WINGUSDT", category: "crypto", active: true },
  { name: "LINA/USDT", symbol: "BINANCE:LINAUSDT", category: "crypto", active: true },
  { name: "SAFEMOON/USDT", symbol: "BINANCE:SAFEMOONUSDT", category: "crypto", active: true },
  { name: "BABYDOGE/USDT", symbol: "BINANCE:BABYDOGEUSDT", category: "crypto", active: true },
  { name: "KISHU/USDT", symbol: "BINANCE:KISHUUSDT", category: "crypto", active: true },
  { name: "DOGECOIN/USDT", symbol: "BINANCE:DOGECOINUSDT", category: "crypto", active: true },
  { name: "SHINU/USDT", symbol: "BINANCE:SHINUUSDT", category: "crypto", active: true },
  { name: "AKITA/USDT", symbol: "BINANCE:AKITAUSDT", category: "crypto", active: true },
  { name: "SAITAMA/USDT", symbol: "BINANCE:SAITAMAUSDT", category: "crypto", active: true },
  { name: "ITACHI/USDT", symbol: "BINANCE:ITACHIUSDT", category: "crypto", active: true },
  { name: "HOKKAIDU/USDT", symbol: "BINANCE:HOKKAIIUSDT", category: "crypto", active: true },
  { name: "APTOS/USDT", symbol: "BINANCE:APTOSUSDT", category: "crypto", active: true },
  { name: "STEPN/USDT", symbol: "BINANCE:STEPNUSDT", category: "crypto", active: true },
  { name: "EPIK/USDT", symbol: "BINANCE:EPIKUSDT", category: "crypto", active: true },
  { name: "HI/USDT", symbol: "BINANCE:HIUSDT", category: "crypto", active: true },
  { name: "BABAPE/USDT", symbol: "BINANCE:BABAPEUSDT", category: "crypto", active: true },
  { name: "SHOG/USDT", symbol: "BINANCE:SHOGUSDT", category: "crypto", active: true },
  { name: "CHEEMS/USDT", symbol: "BINANCE:CHEEMSUSDT", category: "crypto", active: true },
  { name: "RETIK/USDT", symbol: "BINANCE:RETIKUSDT", category: "crypto", active: true },
  { name: "NEIRO/USDT", symbol: "BINANCE:NEIROUSDT", category: "crypto", active: true },
  { name: "BNX/USDT", symbol: "BINANCE:BNXUSDT", category: "crypto", active: true },
  { name: "MERLIN/USDT", symbol: "BINANCE:MERLINUSDT", category: "crypto", active: true },
  { name: "PRCL/USDT", symbol: "BINANCE:PRCLUSDT", category: "crypto", active: true },
  { name: "MAV/USDT", symbol: "BINANCE:MAVUSDT", category: "crypto", active: true },
  { name: "MERL/USDT", symbol: "BINANCE:MERLUSDT", category: "crypto", active: true },
  { name: "MEDI/USDT", symbol: "BINANCE:MEDIUSDT", category: "crypto", active: true },
  { name: "NYAN/USDT", symbol: "BINANCE:NYANUSDT", category: "crypto", active: true },
  { name: "QUNT/USDT", symbol: "BINANCE:QUNTUSDT", category: "crypto", active: true },
  { name: "RATH/USDT", symbol: "BINANCE:RATHUSDT", category: "crypto", active: true },

  { name: "XAU/USD", symbol: "OANDA:XAUUSD", category: "commodity", active: true },
  { name: "XAG/USD", symbol: "OANDA:XAGUSD", category: "commodity", active: false },

  { name: "EUR/USD", symbol: "OANDA:EURUSD", category: "major", active: true },
  { name: "GBP/USD", symbol: "OANDA:GBPUSD", category: "major", active: true },
  { name: "USD/JPY", symbol: "OANDA:USDJPY", category: "major", active: true },
  { name: "AUD/USD", symbol: "OANDA:AUDUSD", category: "major", active: true },
  { name: "USD/CHF", symbol: "OANDA:USDCHF", category: "major", active: true },
  { name: "USD/CAD", symbol: "OANDA:USDCAD", category: "major", active: true },
  { name: "NZD/USD", symbol: "OANDA:NZDUSD", category: "major", active: true },

  { name: "EUR/GBP", symbol: "OANDA:EURGBP", category: "cross", active: false },
  { name: "EUR/JPY", symbol: "OANDA:EURJPY", category: "cross", active: false },
  { name: "GBP/JPY", symbol: "OANDA:GBPJPY", category: "cross", active: false },
  { name: "AUD/JPY", symbol: "OANDA:AUDJPY", category: "cross", active: false },
  { name: "EUR/AUD", symbol: "OANDA:EURAUD", category: "cross", active: false },
  { name: "GBP/AUD", symbol: "OANDA:GBPAUD", category: "cross", active: false },
  { name: "EUR/CAD", symbol: "OANDA:EURCAD", category: "cross", active: false },

  { name: "CAD/JPY", symbol: "OANDA:CADJPY", category: "cross", active: false },
  { name: "CHF/JPY", symbol: "OANDA:CHFJPY", category: "cross", active: false },
  { name: "GBP/CHF", symbol: "OANDA:GBPCHF", category: "cross", active: false },
  { name: "EUR/NZD", symbol: "OANDA:EURNZD", category: "cross", active: false },
  { name: "GBP/NZD", symbol: "OANDA:GBPNZD", category: "cross", active: false },
  { name: "NZD/JPY", symbol: "OANDA:NZDJPY", category: "cross", active: false },
  { name: "AUD/CAD", symbol: "OANDA:AUDCAD", category: "cross", active: false },
  { name: "AUD/NZD", symbol: "OANDA:AUDNZD", category: "cross", active: false },
];

async function main(): Promise<void> {
  const rows: Array<{ name: string; symbol: string; category: string; is_active: boolean }> = [];
  const skipped: Array<{ name: string; symbol: string; reason: string }> = [];

  for (const entry of SEED_DATA) {
    const futuresSymbol = toBinanceSymbol(entry.symbol);

    if (futuresSymbol === null) {
      // Not a BINANCE: symbol (forex/commodity via OANDA:) — no Futures check applies.
      rows.push({
        name: entry.name,
        symbol: entry.symbol,
        category: entry.category,
        is_active: entry.active,
      });
      continue;
    }

    const filters = await getExchangeInfoFilters(futuresSymbol);
    if (filters instanceof Error) {
      skipped.push({ name: entry.name, symbol: entry.symbol, reason: filters.message });
      continue;
    }

    rows.push({
      name: entry.name,
      symbol: entry.symbol,
      category: entry.category,
      is_active: entry.active,
    });
  }

  console.log("=== Seed chart_symbols_volman ===");
  console.log(`${rows.length} symbol(s) sẽ được insert/update.`);
  console.log(`${skipped.length} symbol(s) bị loại vì không pass Binance Futures exchangeInfo:`);
  for (const s of skipped) {
    console.log(`  - ${s.name} (${s.symbol}): ${s.reason}`);
  }

  const { error } = await (getDb().from("chart_symbols_volman") as any).upsert(rows, {
    onConflict: "symbol",
  });

  if (error) {
    console.error(`[FATAL] Upsert thất bại: ${error.message ?? String(error)}`);
    process.exitCode = 1;
    return;
  }

  console.log(`\nHoàn tất. Đã upsert ${rows.length} symbol vào chart_symbols_volman.`);
}

main().catch((error) => {
  console.error(`[FATAL] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
