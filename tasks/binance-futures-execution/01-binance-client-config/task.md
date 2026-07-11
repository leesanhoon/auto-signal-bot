# Task 01: Binance Futures REST client + env config

## Bối cảnh

Repo hiện chỉ có 1 chỗ gọi Binance: `src/charts/ohlc-provider.ts` (dòng 376-479) fetch **public spot klines** (`api.binance.com`, không cần API key) để lấy dữ liệu nến. Task này tạo **client mới, hoàn toàn tách biệt**, gọi **USDS-M Futures REST API** (`fapi.binance.com`), có ký HMAC bằng API key/secret, để đặt lệnh thật. KHÔNG sửa `ohlc-provider.ts`.

## Việc cần làm

### File 1: `src/charts/binance-futures-config-env.ts` (tạo mới)

Copy chính xác nội dung sau:

```ts
function readBooleanEnv(key: string, defaultValue: boolean): boolean {
  const raw = process.env[key]?.trim().toLowerCase();
  if (!raw) return defaultValue;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return defaultValue;
}

export function isBinanceLiveTradingEnabled(): boolean {
  return readBooleanEnv("BINANCE_LIVE_TRADING_ENABLED", false);
}

export function getConfiguredBinanceLeverage(): number {
  const raw = process.env.BINANCE_LEVERAGE?.trim();
  if (!raw) return 5;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 5;
}

export function getConfiguredBinanceMarginType(): "ISOLATED" | "CROSSED" {
  const raw = process.env.BINANCE_MARGIN_TYPE?.trim().toUpperCase();
  return raw === "CROSSED" ? "CROSSED" : "ISOLATED";
}

export function getConfiguredBinanceRiskPercentPerTrade(): number {
  const raw = process.env.BINANCE_RISK_PERCENT_PER_TRADE?.trim();
  if (!raw) return 1;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

export function getConfiguredBinanceFuturesBaseUrl(): string {
  const raw = process.env.BINANCE_FUTURES_BASE_URL?.trim();
  return raw && raw.length > 0 ? raw : "https://fapi.binance.com";
}

export function getConfiguredBinanceApiKey(): string | undefined {
  return process.env.BINANCE_API_KEY?.trim();
}

export function getConfiguredBinanceApiSecret(): string | undefined {
  return process.env.BINANCE_API_SECRET?.trim();
}
```

### File 2: `src/charts/binance-futures-client.ts` (tạo mới)

Copy chính xác nội dung sau (client ký HMAC-SHA256, tái dùng `withRetry`/`withConfiguredRateLimit`/`formatFetchErrorDetails`/`createLogger` — 4 helper này đã tồn tại sẵn trong repo, import đúng path như dưới):

```ts
import { createHmac } from "node:crypto";
import { withRetry } from "../shared/retry.js";
import { withConfiguredRateLimit } from "../shared/rate-limit.js";
import { formatFetchErrorDetails } from "../shared/fetch-diagnostics.js";
import { createLogger } from "../shared/logger.js";
import {
  getConfiguredBinanceApiKey,
  getConfiguredBinanceApiSecret,
  getConfiguredBinanceFuturesBaseUrl,
} from "./binance-futures-config-env.js";

const logger = createLogger("charts:binance-futures-client");

export type BinanceOrderSide = "BUY" | "SELL";

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
  const queryString = buildQueryString({
    ...params,
    timestamp,
    recvWindow: 5000,
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

export async function placeStopMarketOrder(
  symbol: string,
  side: BinanceOrderSide,
  stopPrice: number,
): Promise<BinanceOrderResult | Error> {
  const result = await signedRequest<{
    orderId: number;
    status: string;
    symbol: string;
  }>("POST", "/fapi/v1/order", {
    symbol,
    side,
    type: "STOP_MARKET",
    stopPrice,
    closePosition: true,
  });
  if (result instanceof Error) return result;
  return { orderId: result.orderId, status: result.status, symbol: result.symbol };
}

export async function placeTakeProfitMarketOrder(
  symbol: string,
  side: BinanceOrderSide,
  stopPrice: number,
  quantity: number,
): Promise<BinanceOrderResult | Error> {
  const result = await signedRequest<{
    orderId: number;
    status: string;
    symbol: string;
  }>("POST", "/fapi/v1/order", {
    symbol,
    side,
    type: "TAKE_PROFIT_MARKET",
    stopPrice,
    quantity,
    reduceOnly: true,
  });
  if (result instanceof Error) return result;
  return { orderId: result.orderId, status: result.status, symbol: result.symbol };
}

export async function cancelOrder(
  symbol: string,
  orderId: number,
): Promise<true | Error> {
  const result = await signedRequest("DELETE", "/fapi/v1/order", {
    symbol,
    orderId,
  });
  if (result instanceof Error) {
    if (result.message.includes("code -2011")) return true; // "Unknown order sent" = da huy/khop roi
    return result;
  }
  return true;
}

export async function getOrderStatus(
  symbol: string,
  orderId: number,
): Promise<{ status: string; avgPrice: string } | Error> {
  const result = await signedRequest<{ status: string; avgPrice: string }>(
    "GET",
    "/fapi/v1/order",
    { symbol, orderId },
  );
  if (result instanceof Error) return result;
  return result;
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
```

## Ràng buộc

- KHÔNG sửa `src/charts/ohlc-provider.ts` hay bất kỳ file nào khác.
- KHÔNG thêm dependency npm mới (`node:crypto` là built-in Node, không cần cài).
- Mọi hàm public phải trả `T | Error`, KHÔNG throw ra ngoài (đúng convention toàn repo — xem `ohlc-provider.ts`).
- Không tự ý đổi tên export hay signature khác với liệt kê ở trên (subtask 03/04/05 sẽ import đúng các tên này).

## Cách verify

```bash
npm run build
```
Phải pass không lỗi TypeScript (chú ý: `tsconfig` dùng strict mode, để ý các cast `as any` chỉ dùng ở chỗ đã ghi trong code mẫu).

## Output

Ghi vào `tasks/binance-futures-execution/01-binance-client-config/result.md`:
- Đường dẫn 2 file đã tạo
- Kết quả `npm run build`

Nếu bị chặn (ví dụ thiếu helper `formatFetchErrorDetails`/`withRetry`/`withConfiguredRateLimit`/`createLogger` không đúng path như trên) → ghi `blocked.md`, không tự đoán path khác.
