import { createHmac } from "node:crypto";
import { withRetry } from "../../shared/retry.js";
import { withConfiguredRateLimit } from "../../shared/infra/rate-limit.js";
import { formatFetchErrorDetails } from "../../shared/infra/fetch-diagnostics.js";
import { createLogger } from "../../shared/infra/logger.js";
import {
  getConfiguredBinanceApiKey,
  getConfiguredBinanceApiSecret,
  getConfiguredBinanceFuturesBaseUrl,
} from "../model/binance-futures-config-env.js";

const logger = createLogger("charts:binance-futures-client");

export type BinanceOrderSide = "BUY" | "SELL";

export type BinanceEntryOrderType = "LIMIT" | "STOP_MARKET";

export type BinanceSymbolFilters = {
  stepSize: number;
  minQty: number;
  tickSize: number;
  minNotional: number;
};

export type BinanceOrderResult = {
  orderId: number;
  status: string;
  symbol: string;
};

// Tu 2025-12-09 Binance migrate cac lenh dieu kien (STOP_MARKET, TAKE_PROFIT_MARKET,
// STOP, TAKE_PROFIT, TRAILING_STOP_MARKET) sang Algo Order API rieng (/fapi/v1/algoOrder).
// Goi qua /fapi/v1/order cu se bi tu choi voi loi -4120 "Order type not supported for
// this endpoint. Please use the Algo Order API endpoints instead."
// Tap hop cac trang thai "da kich hoat" cua algo order — tuong duong FILLED cua order thuong.
// Verify thuc te tren testnet 2026-07-11: mot TAKE_PROFIT_MARKET algo order da khop that
// (positionAmt giam dung bang quantity dat) tra ve algoStatus "FINISHED", KHONG PHAI
// "TRIGGERED" — ban goc chi co "TRIGGERED" nen reconcileBinancePosition/reconcileBinancePosition
// (Volman) khong bao gio phat hien duoc fill that, vi the treo o HOLD vinh vien du da
// khop that tren san. Da verify rieng: lenh bi CANCEL tra ve "CANCELED" (khac han
// "FINISHED"), khong co rui ro nham lenh huy thanh lenh khop.
const ALGO_TRIGGERED_STATUSES = new Set(["TRIGGERED", "FINISHED"]);

function buildQueryString(
  params: Record<string, string | number | boolean>,
): string {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join("&");
}

function sign(queryString: string, secret: string): string {
  return createHmac("sha256", secret).update(queryString).digest("hex");
}

async function signedRequest<T>(
  method: "GET" | "POST" | "DELETE",
  path: string,
  params: Record<string, string | number | boolean> = {},
): Promise<T | Error> {
  const apiKey = getConfiguredBinanceApiKey();
  const apiSecret = getConfiguredBinanceApiSecret();
  if (!apiKey || !apiSecret) {
    return new Error("BINANCE_API_KEY/BINANCE_API_SECRET chua duoc cau hinh");
  }

  const baseUrl = getConfiguredBinanceFuturesBaseUrl();
  const timestamp = Date.now();
  // recvWindow 10000: mini PC chạy Windows Task Scheduler, clock có thể lệch nhẹ.
  // User vẫn phải đảm bảo NTP sync (lệch >10s sẽ lỗi -1021) — xem Preconditions trong plan.md.
  const queryString = buildQueryString({
    ...params,
    timestamp,
    recvWindow: 10000,
  });
  const signature = sign(queryString, apiSecret);
  const url = `${baseUrl}${path}?${queryString}&signature=${signature}`;

  try {
    return await withConfiguredRateLimit(
      { key: "binance-futures", envVar: "BINANCE_RATE_LIMIT_RPM", defaultRpm: 300 },
      () =>
        withRetry(
          async () => {
            const response = await fetch(url, {
              method,
              headers: { "X-MBX-APIKEY": apiKey },
            });
            const text = await response.text();
            let json: unknown;
            try {
              json = text ? JSON.parse(text) : {};
            } catch {
              throw new Error(
                `Binance Futures tra ve non-JSON (${response.status}): ${text.slice(0, 300)}`,
              );
            }
            if (!response.ok) {
              const apiMessage = (json as { msg?: string })?.msg;
              const code = (json as { code?: number })?.code;
              const error = new Error(
                `Binance Futures API loi ${response.status}${code ? ` (code ${code})` : ""} tai ${path}${apiMessage ? `: ${apiMessage}` : ""}`,
              );
              (error as any).status = response.status;
              (error as any).binanceCode = code;
              throw error;
            }
            return json as T;
          },
          {
            maxAttempts: 3,
            baseDelayMs: 1000,
            isRetryable: (error) => {
              const status = (error as { status?: number })?.status;
              return status !== 400 && status !== 401 && status !== 403;
            },
            onRetry: (error, attempt, maxAttempts, delayMs) => {
              logger.warn(
                `Binance Futures retry ${attempt}/${maxAttempts} sau ${delayMs}ms: ${formatFetchErrorDetails(error)}`,
              );
            },
          },
        ),
    );
  } catch (error) {
    if (error instanceof Error) return error;
    return new Error(
      `Loi mang khi goi Binance Futures ${path}: ${formatFetchErrorDetails(error)}`,
    );
  }
}

const exchangeInfoCache = new Map<string, BinanceSymbolFilters>();

export async function getExchangeInfoFilters(
  symbol: string,
): Promise<BinanceSymbolFilters | Error> {
  const cached = exchangeInfoCache.get(symbol);
  if (cached) return cached;

  const baseUrl = getConfiguredBinanceFuturesBaseUrl();
  const url = `${baseUrl}/fapi/v1/exchangeInfo`;
  let body: unknown;
  try {
    const response = await fetch(url);
    body = await response.json();
    if (!response.ok) {
      return new Error(`Binance Futures exchangeInfo tra ve ${response.status}`);
    }
  } catch (error) {
    return new Error(
      `Loi mang khi lay exchangeInfo: ${formatFetchErrorDetails(error)}`,
    );
  }

  const symbols =
    (body as { symbols?: Array<Record<string, unknown>> })?.symbols ?? [];
  for (const s of symbols) {
    const sym = s.symbol as string;
    const filters = (s.filters as Array<Record<string, unknown>>) ?? [];
    const lotSize = filters.find((f) => f.filterType === "LOT_SIZE");
    const priceFilter = filters.find((f) => f.filterType === "PRICE_FILTER");
    const minNotionalFilter = filters.find(
      (f) => f.filterType === "MIN_NOTIONAL",
    );
    const parsed: BinanceSymbolFilters = {
      stepSize: Number(lotSize?.stepSize ?? "0.001"),
      minQty: Number(lotSize?.minQty ?? "0"),
      tickSize: Number(priceFilter?.tickSize ?? "0.01"),
      minNotional: Number(minNotionalFilter?.notional ?? "5"),
    };
    exchangeInfoCache.set(sym, parsed);
  }

  const result = exchangeInfoCache.get(symbol);
  return (
    result ??
    new Error(`Khong tim thay symbol ${symbol} trong Binance Futures exchangeInfo`)
  );
}

export async function getAvailableBalanceUsdt(): Promise<number | Error> {
  const result = await signedRequest<
    Array<{ asset: string; availableBalance: string }>
  >("GET", "/fapi/v2/balance");
  if (result instanceof Error) return result;
  const usdt = result.find((b) => b.asset === "USDT");
  if (!usdt) return new Error("Khong tim thay so du USDT tren Binance Futures");
  const balance = Number(usdt.availableBalance);
  return Number.isFinite(balance)
    ? balance
    : new Error("Khong parse duoc so du USDT");
}

export async function setMarginType(
  symbol: string,
  marginType: "ISOLATED" | "CROSSED",
): Promise<true | Error> {
  const result = await signedRequest("POST", "/fapi/v1/marginType", {
    symbol,
    marginType,
  });
  if (result instanceof Error) {
    if (result.message.includes("code -4046")) return true; // "No need to change margin type."
    return result;
  }
  return true;
}

export async function setLeverage(
  symbol: string,
  leverage: number,
): Promise<true | Error> {
  const result = await signedRequest("POST", "/fapi/v1/leverage", {
    symbol,
    leverage,
  });
  if (result instanceof Error) return result;
  return true;
}

const maxLeverageCache = new Map<string, number>();

// Moi symbol co bracket doi leverage rieng (vd altcoin thanh khoan thap thuong
// gioi han thap hon nhieu so voi BTCUSDT). Bracket dau tien (notional thap nhat)
// luon la initialLeverage cao nhat duoc phep cho symbol do.
export async function getMaxLeverageForSymbol(
  symbol: string,
): Promise<number | Error> {
  const cached = maxLeverageCache.get(symbol);
  if (cached !== undefined) return cached;

  const result = await signedRequest<
    | Array<{ symbol: string; brackets: Array<{ initialLeverage: number }> }>
    | { symbol: string; brackets: Array<{ initialLeverage: number }> }
  >("GET", "/fapi/v1/leverageBracket", { symbol });
  if (result instanceof Error) return result;

  const entry = Array.isArray(result)
    ? result.find((r) => r.symbol === symbol)
    : result;
  const maxLeverage = entry?.brackets?.[0]?.initialLeverage;
  if (!maxLeverage || !Number.isFinite(maxLeverage)) {
    return new Error(`Khong lay duoc max leverage cho ${symbol} tu leverageBracket`);
  }

  maxLeverageCache.set(symbol, maxLeverage);
  return maxLeverage;
}

export async function placeMarketOrder(
  symbol: string,
  side: BinanceOrderSide,
  quantity: number,
  options: { reduceOnly?: boolean } = {},
): Promise<BinanceOrderResult | Error> {
  const result = await signedRequest<{
    orderId: number;
    status: string;
    symbol: string;
  }>("POST", "/fapi/v1/order", {
    symbol,
    side,
    type: "MARKET",
    quantity,
    ...(options.reduceOnly ? { reduceOnly: true } : {}),
  });
  if (result instanceof Error) return result;
  return { orderId: result.orderId, status: result.status, symbol: result.symbol };
}

// STOP_MARKET/TAKE_PROFIT_MARKET la lenh dieu kien -> phai dat qua Algo Order API.
// orderId tra ve o day thuc chat la algoId (dung chung field name de downstream
// (DB, reconcile) khong can biet phan biet order thuong vs algo order).
export async function placeStopMarketOrder(
  symbol: string,
  side: BinanceOrderSide,
  stopPrice: number,
  options: { workingType?: "MARK_PRICE" | "CONTRACT_PRICE" } = {},
): Promise<BinanceOrderResult | Error> {
  const result = await signedRequest<{
    algoId: number;
    algoStatus: string;
    symbol: string;
  }>("POST", "/fapi/v1/algoOrder", {
    algoType: "CONDITIONAL",
    symbol,
    side,
    type: "STOP_MARKET",
    triggerPrice: stopPrice,
    closePosition: true,
    ...(options.workingType ? { workingType: options.workingType } : {}),
  });
  if (result instanceof Error) return result;
  return { orderId: result.algoId, status: result.algoStatus, symbol: result.symbol };
}

export async function placeTakeProfitMarketOrder(
  symbol: string,
  side: BinanceOrderSide,
  stopPrice: number,
  options: { workingType?: "MARK_PRICE" | "CONTRACT_PRICE" } = {},
): Promise<BinanceOrderResult | Error> {
  const result = await signedRequest<{
    algoId: number;
    algoStatus: string;
    symbol: string;
  }>("POST", "/fapi/v1/algoOrder", {
    algoType: "CONDITIONAL",
    symbol,
    side,
    type: "TAKE_PROFIT_MARKET",
    triggerPrice: stopPrice,
    closePosition: true,
    ...(options.workingType ? { workingType: options.workingType } : {}),
  });
  if (result instanceof Error) return result;
  return { orderId: result.algoId, status: result.algoStatus, symbol: result.symbol };
}

export async function placeLimitOrder(
  symbol: string,
  side: BinanceOrderSide,
  price: number,
  quantity: number,
  options: { reduceOnly?: boolean; timeInForce?: "GTC" | "IOC" | "FOK" } = {},
): Promise<BinanceOrderResult | Error> {
  const result = await signedRequest<{
    orderId: number;
    status: string;
    symbol: string;
  }>("POST", "/fapi/v1/order", {
    symbol,
    side,
    type: "LIMIT",
    price,
    quantity,
    timeInForce: options.timeInForce ?? "GTC",
    ...(options.reduceOnly ? { reduceOnly: true } : {}),
  });
  if (result instanceof Error) return result;
  return { orderId: result.orderId, status: result.status, symbol: result.symbol };
}

export async function placeStopMarketEntryOrder(
  symbol: string,
  side: BinanceOrderSide,
  stopPrice: number,
  quantity: number,
  options: { workingType?: "MARK_PRICE" | "CONTRACT_PRICE" } = {},
): Promise<BinanceOrderResult | Error> {
  const result = await signedRequest<{
    algoId: number;
    algoStatus: string;
    symbol: string;
  }>("POST", "/fapi/v1/algoOrder", {
    algoType: "CONDITIONAL",
    symbol,
    side,
    type: "STOP_MARKET",
    triggerPrice: stopPrice,
    quantity,
    ...(options.workingType ? { workingType: options.workingType } : {}),
  });
  if (result instanceof Error) return result;
  return { orderId: result.algoId, status: result.algoStatus, symbol: result.symbol };
}

export async function placeTrailingStopMarketOrder(
  symbol: string,
  side: BinanceOrderSide,
  callbackRate: number,
  quantity: number,
  activationPrice?: number,
  options: { workingType?: "MARK_PRICE" | "CONTRACT_PRICE" } = {},
): Promise<BinanceOrderResult | Error> {
  const result = await signedRequest<{
    algoId: number;
    algoStatus: string;
    symbol: string;
  }>("POST", "/fapi/v1/algoOrder", {
    algoType: "CONDITIONAL",
    symbol,
    side,
    type: "TRAILING_STOP_MARKET",
    callbackRate,
    quantity,
    reduceOnly: true,
    ...(activationPrice !== undefined ? { activationPrice } : {}),
    ...(options.workingType ? { workingType: options.workingType } : {}),
  });
  if (result instanceof Error) return result;
  return { orderId: result.algoId, status: result.algoStatus, symbol: result.symbol };
}

// CHI dung cho algo order (SL/TP dat qua placeStopMarketOrder/placeTakeProfitMarketOrder
// o tren) — orderId truyen vao thuc chat la algoId. Entry/close order (MARKET thuong)
// khong bao gio can cancel (khong phai lenh cho khop).
export async function cancelOrder(
  symbol: string,
  orderId: number,
): Promise<true | Error> {
  const result = await signedRequest("DELETE", "/fapi/v1/algoOrder", {
    symbol,
    algoId: orderId,
  });
  if (result instanceof Error) {
    if (result.message.includes("code -2011")) return true; // "Unknown order sent" = da huy/khop roi
    return result;
  }
  return true;
}

// CHI dung cho algo order (SL/TP) — orderId truyen vao thuc chat la algoId.
// algoStatus khac status cua order thuong: khi trigger, algoStatus chuyen thanh
// "TRIGGERED" (KHONG phai "FILLED"). Chuan hoa ve "FILLED" o day de code downstream
// (reconcileBinancePosition, check status.status === "FILLED") khong can sua.
export async function getOrderStatus(
  symbol: string,
  orderId: number,
): Promise<{ status: string; avgPrice: string } | Error> {
  const result = await signedRequest<{ algoStatus: string; symbol: string }>(
    "GET",
    "/fapi/v1/algoOrder",
    { symbol, algoId: orderId },
  );
  if (result instanceof Error) return result;
  const status = ALGO_TRIGGERED_STATUSES.has(result.algoStatus)
    ? "FILLED"
    : result.algoStatus;
  return { status, avgPrice: "" };
}

// Lấy trạng thái của regular order (LIMIT orders placed via /fapi/v1/order)
// Khác getOrderStatus — cái này chỉ dùng cho algo orders (SL/TP).
export async function getRegularOrderStatus(
  symbol: string,
  orderId: number,
): Promise<{ status: string; executedQty: string } | Error> {
  const result = await signedRequest<{ status: string; executedQty: string; symbol: string }>(
    "GET",
    "/fapi/v1/order",
    { symbol, orderId },
  );
  if (result instanceof Error) return result;
  return { status: result.status, executedQty: result.executedQty };
}

// Hủy regular order (LIMIT orders placed via /fapi/v1/order)
// Khác cancelOrder — cái này chỉ dùng cho algo orders (SL/TP).
export async function cancelRegularOrder(
  symbol: string,
  orderId: number,
): Promise<true | Error> {
  const result = await signedRequest("DELETE", "/fapi/v1/order", {
    symbol,
    orderId,
  });
  if (result instanceof Error) {
    if (result.message.includes("code -2011")) return true; // "Unknown order sent" = already cancelled/filled
    return result;
  }
  return true;
}

// Trả về true nếu account đang ở Hedge mode (dualSidePosition) — plan này CHỈ hỗ trợ
// One-way mode, mọi lệnh không gửi positionSide sẽ fail -4061 nếu ở Hedge mode.
export async function isHedgeModeEnabled(): Promise<boolean | Error> {
  const result = await signedRequest<{ dualSidePosition: boolean }>(
    "GET",
    "/fapi/v1/positionSide/dual",
  );
  if (result instanceof Error) return result;
  return result.dualSidePosition === true;
}

export async function getPositionAmount(
  symbol: string,
): Promise<number | Error> {
  const result = await signedRequest<Array<{ symbol: string; positionAmt: string }>>(
    "GET",
    "/fapi/v2/positionRisk",
    { symbol },
  );
  if (result instanceof Error) return result;
  const row = result.find((r) => r.symbol === symbol);
  if (!row) return 0;
  const amt = Number(row.positionAmt);
  return Number.isFinite(amt) ? amt : new Error("Khong parse duoc positionAmt");
}
