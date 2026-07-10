import type {
  TradeSetup,
  PairSummary,
} from "./chart-types-smc.js";
import type {
  PendingOrder,
  ChartOrderType,
} from "./chart-types-common.js";
import { cleanResponse, extractJsonObject, clampConfidence } from "./analyzer-common.js";

function normalizePairKey(value: string): string {
  return value.replace(/[\s\/_.:-]+/g, "").toUpperCase();
}

function parsePrice(value: string): number | null {
  const parsed = Number(
    String(value ?? "")
      .replace(/,/g, "")
      .trim(),
  );
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatPrice(value: number): string {
  const precision = value >= 1000 ? 2 : value >= 100 ? 2 : value >= 10 ? 3 : 5;
  return value.toFixed(precision);
}

export function applyPriceSanityChecks(
  setup: TradeSetup,
  lastPrice: number | null,
): { setup: TradeSetup | null; note?: string } {
  if (lastPrice === null || !Number.isFinite(lastPrice)) {
    return { setup };
  }

  const entry = parsePrice(setup.entry);
  const stopLoss = parsePrice(setup.stopLoss);
  const takeProfit1 = parsePrice(setup.takeProfit1);
  const takeProfit2 = setup.takeProfit2 ? parsePrice(setup.takeProfit2) : null;

  const currentPriceContext = `Giá thật hiện tại: ${formatPrice(lastPrice)}`;

  if (entry === null || stopLoss === null || takeProfit1 === null) {
    return {
      setup: {
        ...setup,
        lastPrice,
      },
    };
  }

  const marketNowDeviation =
    Math.abs(lastPrice - entry) / Math.max(lastPrice, entry);
  if (setup.orderType === "MARKET_NOW" && marketNowDeviation > 0.005) {
    return {
      setup: null,
      note: `Loại setup ${setup.pair} vì MARKET_NOW lệch quá xa so với giá thật ${formatPrice(lastPrice)}.`,
    };
  }

  if (setup.direction === "LONG" && lastPrice <= stopLoss) {
    return {
      setup: null,
      note: `Loại setup ${setup.pair} vì giá thật ${formatPrice(lastPrice)} đã nằm dưới stop loss.`,
    };
  }

  if (setup.direction === "SHORT" && lastPrice >= stopLoss) {
    return {
      setup: null,
      note: `Loại setup ${setup.pair} vì giá thật ${formatPrice(lastPrice)} đã nằm trên stop loss.`,
    };
  }

  const updatedSetup: TradeSetup = {
    ...setup,
    lastPrice,
  };

  if (
    setup.direction === "LONG" &&
    takeProfit2 !== null &&
    lastPrice >= takeProfit2
  ) {
    updatedSetup.summary += ` | Giá đã vượt TP2 ${formatPrice(takeProfit2)}.`;
  } else if (
    setup.direction === "SHORT" &&
    takeProfit2 !== null &&
    lastPrice <= takeProfit2
  ) {
    updatedSetup.summary += ` | Giá đã vượt TP2 ${formatPrice(takeProfit2)}.`;
  } else if (setup.direction === "LONG" && lastPrice >= takeProfit1) {
    updatedSetup.summary += ` | Giá đã chạm/vượt TP1 ${formatPrice(takeProfit1)}.`;
  } else if (setup.direction === "SHORT" && lastPrice <= takeProfit1) {
    updatedSetup.summary += ` | Giá đã chạm/vượt TP1 ${formatPrice(takeProfit1)}.`;
  }

  return { setup: updatedSetup };
}

export function buildPendingOrderCheckPrompt(
  order: PendingOrder,
  lastPrice: number | null = null,
): string {
  return [
    "You assess whether a pending forex setup has triggered, failed, or is still pending.",
    "Return only JSON with keys status, confidence, comment.",
    "Possible status values: TRIGGERED, CANCELLED, PENDING.",
    "Use the attached chart and the order details below.",
    `- Pair: ${order.pair}`,
    `- Direction: ${order.direction}`,
    `- Order type: ${order.orderType}`,
    `- Setup: ${order.setup ?? ""}`,
    `- Primary timeframe: ${order.primaryTimeframe ?? "H4"}`,
    `- Entry: ${order.entry}`,
    `- Stop loss: ${order.stopLoss}`,
    `- Take profit 1: ${order.takeProfit1}`,
    `- Take profit 2: ${order.takeProfit2 ?? ""}`,
    `- Confidence: ${order.confidence ?? 0}%`,
    `- Reasons: ${(order.reasons ?? []).slice(0, 3).join(" | ")}`,
    `- Risks: ${(order.risks ?? []).slice(0, 3).join(" | ")}`,
    `- Last price: ${lastPrice ?? "unknown"}`,
    "",
    "TRIGGERED: price has touched or broken the entry in the correct direction and the setup still looks valid.",
    "CANCELLED: price moved against the setup, hit stop-loss before entry, or the structure is no longer valid.",
    "PENDING: entry has not been reached yet and the structure remains valid.",
    "Use Vietnamese with accents in comment.",
  ].join("\n");
}

function toText(value: unknown, fallback = ""): string {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text.length > 0 ? text : fallback;
}

function toArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v));
  if (typeof value === "string") return [value];
  return [];
}

function normalizeOrderType(value: unknown, direction: unknown): ChartOrderType {
  const raw = String(value ?? "").trim().toUpperCase();
  if (
    raw === "MARKET_NOW" ||
    raw === "BUY_STOP" ||
    raw === "SELL_STOP" ||
    raw === "BUY_LIMIT" ||
    raw === "SELL_LIMIT" ||
    raw === "WAIT_FOR_CONFIRMATION"
  ) {
    return raw;
  }
  return String(direction ?? "").toUpperCase() === "SHORT"
    ? "SELL_STOP"
    : "BUY_STOP";
}

function normalizeDirection(value: unknown): "LONG" | "SHORT" {
  const raw = String(value ?? "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  if (["LONG", "BUY", "MUA", "LEN", "TANG", "UP"].includes(raw)) return "LONG";
  if (["SHORT", "SELL", "BAN", "XUONG", "GIAM", "DOWN"].includes(raw))
    return "SHORT";
  return raw.includes("SHORT") || raw.includes("SELL") ? "SHORT" : "LONG";
}

function normalizeTimeframe(value: unknown) {
  const raw = String(value ?? "").trim().toUpperCase();
  return raw === "D1" || raw === "H4" || raw === "M15" || raw === "M30" || raw === "H1" ? raw : "H4";
}

function normalizePendingStatus(
  value: unknown,
): "TRIGGERED" | "CANCELLED" | "PENDING" {
  const raw = String(value ?? "").trim().toUpperCase();
  if (raw === "TRIGGERED" || raw === "CANCELLED" || raw === "PENDING")
    return raw;
  return "PENDING";
}

export function parseAnalysisResponse(
  text: string,
  options: { lastPriceByPair?: Map<string, number | null> } = {},
): {
  summaries: PairSummary[];
  setups: TradeSetup[];
  noSetupReason: string;
} {
  try {
    const parsed = JSON.parse(extractJsonObject(text)) as Partial<{
      summaries: unknown;
      setups: unknown;
      noSetupReason: string;
    }>;
    const rawSetups = Array.isArray(parsed.setups) ? parsed.setups : [];
    const noSetupNotes: string[] = [];
    const normalizedSetups = rawSetups
      .filter((s): s is Record<string, unknown> => s !== null && typeof s === "object")
      .map((s): TradeSetup | null => {
        const direction = normalizeDirection(s.direction);
        const setup = {
          ...s,
          direction,
          reasons: toArray(s.reasons),
          risks: toArray(s.risks),
          primaryTimeframe: normalizeTimeframe(s.primaryTimeframe),
          orderType: normalizeOrderType(s.orderType, direction),
        } as unknown as TradeSetup;
        const lastPrice =
          options.lastPriceByPair?.get(normalizePairKey(setup.pair)) ?? null;
        const checked = applyPriceSanityChecks(setup, lastPrice);
        if (!checked.setup && checked.note) {
          noSetupNotes.push(checked.note);
          return null;
        }
        return checked.setup;
      });
    return {
      summaries: Array.isArray(parsed.summaries) ? parsed.summaries : [],
      setups: normalizedSetups.filter((setup): setup is TradeSetup => Boolean(setup)),
      noSetupReason: [toText(parsed.noSetupReason), ...noSetupNotes]
        .filter(Boolean)
        .join("\n"),
    };
  } catch {
    return {
      summaries: [],
      setups: [],
      noSetupReason: "Failed to parse AI response. Raw: " + text.slice(0, 300),
    };
  }
}

export function parsePendingOrderCheckResponse(text: string): {
  status: "TRIGGERED" | "CANCELLED" | "PENDING";
  confidence: number;
  comment: string;
} | null {
  const cleaned = extractJsonObject(text);
  try {
    const parsed = JSON.parse(cleaned) as {
      status?: unknown;
      confidence?: unknown;
      comment?: unknown;
    };
    return {
      status: normalizePendingStatus(parsed.status),
      confidence: clampConfidence(parsed.confidence),
      comment: toText(parsed.comment),
    };
  } catch {
    return null;
  }
}
