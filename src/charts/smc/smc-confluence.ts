import type { ChartTimeframe } from "../chart-types.js";
import type { Candle } from "../ohlc-provider.js";
import { fetchOhlcHistory } from "../ohlc-provider.js";
import { detectStructureBreak, findSwingPoints } from "./smc-structure.js";
import type { SmcDirection } from "./smc-types.js";

export type TimeframeBias = {
  timeframe: ChartTimeframe;
  direction: SmcDirection | null;
};

export function detectTimeframeBias(candles: Candle[], lookback = 30): SmcDirection | null {
  if (candles.length < 10) return null;
  const swings = findSwingPoints(candles, { left: 2, right: 2 });
  const startIndex = Math.max(4, candles.length - lookback);

  let lastDirection: SmcDirection | null = null;
  for (let i = startIndex; i < candles.length; i += 1) {
    const event = detectStructureBreak(candles, swings, i);
    if (event) lastDirection = event.direction;
  }
  return lastDirection;
}

export type ConfluenceResult = {
  agreementCount: number;
  biases: TimeframeBias[];
  agreeingTimeframes: ChartTimeframe[];
};

export async function checkMultiTimeframeConfluence(
  symbol: string,
  primaryDirection: SmcDirection,
): Promise<ConfluenceResult> {
  const timeframes: ChartTimeframe[] = ["H1", "M30"];
  const results = await Promise.all(
    timeframes.map(async (tf) => {
      const candles = await fetchOhlcHistory(symbol, tf, 100);
      if (candles instanceof Error) {
        return { timeframe: tf, direction: null as SmcDirection | null };
      }
      return { timeframe: tf, direction: detectTimeframeBias(candles) };
    }),
  );

  const agreeingTimeframes = results
    .filter((r) => r.direction === primaryDirection)
    .map((r) => r.timeframe);

  return {
    agreementCount: agreeingTimeframes.length,
    biases: results,
    agreeingTimeframes,
  };
}
