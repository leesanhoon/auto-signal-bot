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

// Neu set, risk moi lenh la so USDT co dinh (uu tien hon BINANCE_RISK_PERCENT_PER_TRADE)
// — phu hop voi von nho, khong muon risk % thay doi theo balance.
export function getConfiguredBinanceRiskUsdPerTrade(): number | undefined {
  const raw = process.env.BINANCE_RISK_USD_PER_TRADE?.trim();
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

// Khuyến nghị test end-to-end với testnet trước khi live:
// BINANCE_FUTURES_BASE_URL=https://testnet.binancefuture.com (API key testnet riêng)
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

export function isBinanceLiveTradingEnabledSmc(): boolean {
  return readBooleanEnv("BINANCE_LIVE_TRADING_ENABLED_SMC", false);
}

export function isBinanceLiveTradingEnabledVolman(): boolean {
  return readBooleanEnv("BINANCE_LIVE_TRADING_ENABLED_VOLMAN", false);
}
