import { withRetry } from "../shared/retry.js";
import type { MatchAiAnalysis, MatchOddsPayload } from "./betting-types.js";
import { formatFullOddsAnalysisInput, formatOddsAnalysisInput } from "./odds-text-format.js";
import { createLogger } from "../shared/logger.js";
import { recordOpenRouterUsage } from "../shared/ai-usage.js";
import { callOpenRouter, type OpenRouterRequest } from "../shared/openrouter.js";

const logger = createLogger("betting:betting-ai");
const ANALYZE_MODEL = process.env.AI_TEXT_MODEL?.trim() || "deepseek/deepseek-v4-pro";
const FALLBACK_MODEL = process.env.AI_TEXT_FALLBACK_MODEL?.trim() || "deepseek/deepseek-v4-flash";
const VERIFY_MODEL = process.env.AI_VERIFY_MODEL?.trim() || "moonshotai/kimi-k2.6";
const ANALYZE_TIMEOUT_MS = parsePositiveEnv("BETTING_AI_ANALYZE_TIMEOUT_MS", 75_000);
const VERIFY_TIMEOUT_MS = parsePositiveEnv("BETTING_AI_VERIFY_TIMEOUT_MS", 45_000);
const REVISE_TIMEOUT_MS = parsePositiveEnv("BETTING_AI_REVISE_TIMEOUT_MS", 60_000);
const ANALYZE_WEB_RESULTS = 3;
const MAX_ANALYZE_TOKENS = 1_400;
const MAX_VERIFY_TOKENS = 400;
const MAX_REVISE_TOKENS = 1_300;

type OddsCandidate = {
  candidateId: string;
  market: string;
  marketKey: string;
  selection: string;
  odds: number;
};

export type VerificationReasonCode =
  | "CONFLICT"
  | "OVERCLAIM"
  | "INSUFFICIENT_SUPPORT"
  | "HARD_INVALID"
  | "OTHER";

type RequestRunResult = {
  response: Awaited<ReturnType<typeof callOpenRouter>>;
  usedFallback: boolean;
  model: string;
  requestCount: number;
};

const MARKET_KEYS = [
  "h2h",
  "asia_handicap",
  "asia_totals",
  "eu_totals",
  "btts",
  "team_goals_home",
  "team_goals_away",
  "corners_1x2",
  "corners_handicap",
  "corners_totals",
  "corners_totals_eu",
] as const;

function parsePositiveEnv(name: string, fallback: number): number {
  const configured = Number(process.env[name]);
  return Number.isFinite(configured) && configured > 0 ? configured : fallback;
}

function cleanResponse(text: string): string {
  return text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
}

function extractJsonObject(text: string): string {
  const cleaned = cleanResponse(text);
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  return start !== -1 && end > start ? cleaned.slice(start, end + 1) : cleaned;
}

function clampConfidence(value: unknown): number {
  const num = Number(value);
  return Number.isFinite(num) ? Math.max(0, Math.min(100, Math.round(num))) : 0;
}

function toText(value: unknown, fallback = ""): string {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text.length > 0 ? text : fallback;
}

function toArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  return [];
}

function isStandAsideRecommendation(value: string): boolean {
  return /đứng\s*ngoài|không\s+có\s+edge|không\s+thấy\s+edge|theo\s+dõi\s+thêm|chưa\s+có\s+kèo/i.test(
    value,
  );
}

function isProFallbackTrigger(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /timeout|aborted|empty content/i.test(message);
}

function isOpenRouterHttpRetryableMessage(message: string): boolean {
  return /OpenRouter request failed \((429|500|502|503|504)\):/i.test(message);
}

function isTransientRetryableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const status =
    error && typeof error === "object"
      ? (error as { status?: unknown; statusCode?: unknown; code?: unknown }).status ??
        (error as { status?: unknown; statusCode?: unknown; code?: unknown }).statusCode ??
        (error as { status?: unknown; statusCode?: unknown; code?: unknown }).code
      : undefined;

  if (
    typeof status === "number" &&
    Number.isFinite(status) &&
    [429, 500, 502, 503, 504].includes(status)
  ) {
    return true;
  }

  if (typeof status === "string" && /UNAVAILABLE|RESOURCE_EXHAUSTED/i.test(status)) {
    return true;
  }

  return (
    isOpenRouterHttpRetryableMessage(message) ||
    /"code"\s*:\s*(429|500|502|503|504)|UNAVAILABLE|RESOURCE_EXHAUSTED|overloaded|high demand|ETIMEDOUT|ECONNRESET|fetch failed|network error|socket hang up|aborted|timeout|empty content/i.test(
      message,
    )
  );
}

function isAnalyzeRetryableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const status =
    error && typeof error === "object"
      ? (error as { status?: unknown; statusCode?: unknown; code?: unknown }).status ??
        (error as { status?: unknown; statusCode?: unknown; code?: unknown }).statusCode ??
        (error as { status?: unknown; statusCode?: unknown; code?: unknown }).code
      : undefined;

  if (
    typeof status === "number" &&
    Number.isFinite(status) &&
    [429, 500, 502, 503, 504].includes(status)
  ) {
    return true;
  }

  if (typeof status === "string" && /UNAVAILABLE|RESOURCE_EXHAUSTED/i.test(status)) {
    return true;
  }

  return (
    isOpenRouterHttpRetryableMessage(message) ||
    /"code"\s*:\s*(429|500|502|503|504)|UNAVAILABLE|RESOURCE_EXHAUSTED|overloaded|high demand/i.test(
      message,
    )
  );
}

function getMarketLabel(key: (typeof MARKET_KEYS)[number]): string {
  switch (key) {
    case "h2h":
      return "1X2";
    case "asia_handicap":
      return "Chấp Châu Á";
    case "asia_totals":
      return "Tổng bàn châu Á";
    case "eu_totals":
      return "Tổng bàn châu Âu";
    case "btts":
      return "GG/NG";
    case "team_goals_home":
      return "Bàn chủ nhà";
    case "team_goals_away":
      return "Bàn khách";
    case "corners_1x2":
      return "Phạt góc 1X2";
    case "corners_handicap":
      return "Chấp góc";
    case "corners_totals":
      return "Tổng góc";
    case "corners_totals_eu":
      return "Tổng góc EU";
  }
}

function fmtNum(value: number): string {
  return String(value);
}

function fmtSignedPoint(value: number): string {
  return value > 0 ? `+${fmtNum(value)}` : fmtNum(value);
}

function normalizeMarketPoint(
  marketKey: (typeof MARKET_KEYS)[number],
  outcomeName: string,
  point: number | undefined,
): number | undefined {
  if (point === undefined) return undefined;
  return marketKey.includes("handicap") && outcomeName === "A" ? -point : point;
}

function describeSelection(
  payload: MatchOddsPayload,
  marketKey: (typeof MARKET_KEYS)[number],
  outcomeName: string,
  point: number | undefined,
): string {
  const normalizedPoint = normalizeMarketPoint(marketKey, outcomeName, point);
  const pointText =
    normalizedPoint === undefined ? "" : ` ${fmtSignedPoint(normalizedPoint)}`;

  switch (marketKey) {
    case "h2h":
      return outcomeName === "H"
        ? `${payload.home} thắng`
        : outcomeName === "A"
          ? `${payload.away} thắng`
          : "Hòa";
    case "asia_handicap":
      return outcomeName === "H"
        ? `${payload.home}${pointText}`
        : `${payload.away}${pointText}`;
    case "asia_totals":
    case "eu_totals":
    case "corners_totals":
    case "corners_totals_eu":
      return outcomeName === "Over"
        ? `Tài${pointText}`
        : `Xỉu${pointText}`;
    case "btts":
      return outcomeName === "GG"
        ? "Cả hai cùng ghi bàn"
        : "Không có bàn cho cả hai";
    case "team_goals_home":
      return outcomeName === "Over"
        ? `${payload.home} trên${pointText}`
        : `${payload.home} dưới${pointText}`;
    case "team_goals_away":
      return outcomeName === "Over"
        ? `${payload.away} trên${pointText}`
        : `${payload.away} dưới${pointText}`;
    case "corners_1x2":
      return outcomeName === "H"
        ? `${payload.home} thắng góc`
        : outcomeName === "A"
          ? `${payload.away} thắng góc`
          : "Hòa góc";
    case "corners_handicap":
      return outcomeName === "H"
        ? `${payload.home} chấp góc${pointText}`
        : `${payload.away} chấp góc${pointText}`;
  }
}

function buildCandidatePool(payload: MatchOddsPayload): OddsCandidate[] {
  const candidates: OddsCandidate[] = [];
  let index = 1;

  for (const key of MARKET_KEYS) {
    const market = payload.odds.markets.find((m) => m.key === key);
    if (!market) continue;

    for (const outcome of market.outcomes) {
      if (!Number.isFinite(outcome.price) || outcome.price <= 0) continue;
      const candidateId = `P${String(index).padStart(2, "0")}`;
      candidates.push({
        candidateId,
        market: getMarketLabel(key),
        marketKey: key,
        selection: describeSelection(payload, key, outcome.name, outcome.point),
        odds: outcome.price,
      });
      index += 1;
    }
  }

  return candidates;
}

function buildCandidatePoolText(payload: MatchOddsPayload): string {
  const candidates = buildCandidatePool(payload);
  if (candidates.length === 0) return "CANDIDATES: none";

  return [
    "CANDIDATES:",
    ...candidates.map((candidate) => {
      const odds = candidate.odds.toFixed(2);
      return `${candidate.candidateId} | ${candidate.market} | ${candidate.selection} | ${odds}`;
    }),
  ].join("\n");
}

function buildAnalyzeUserText(payload: MatchOddsPayload): string {
  return formatFullOddsAnalysisInput(payload);
}

function buildAnalyzeSystemPrompt(): string {
  return [
    "Bạn là chuyên gia phân tích odds bóng đá.",
    "Chỉ dựa vào dữ liệu odds/correct score được cung cấp trong user message.",
    "Hãy phân tích khách quan xu hướng odds, kèo đáng chú ý, rủi ro và nếu không rõ edge thì nói đứng ngoài.",
    "Không cần tự validate lại qua model khác. Không tự bịa dữ liệu ngoài input.",
    "Tất cả field text bằng tiếng Việt có dấu, ngắn gọn, không markdown, không URL.",
  ].join(" ");
}

function buildAnalyzeUserPrompt(): string {
  return [
    "Trả duy nhất JSON với keys match, preferredScoreline, scoreConfidence, recommendation, confidence, picks, keyPoints, risks, summary.",
    "picks là mảng tối đa 3 kèo AI thấy đáng chú ý; mỗi pick gồm market, selection, odds, reason.",
    "Nếu không có kèo rõ, picks là [] và recommendation là Đứng ngoài.",
    "keyPoints và risks mỗi mảng 1-3 phần tử.",
  ].join(" ");
}

function buildVerificationPrompt(setup: MatchAiAnalysis, payload: MatchOddsPayload): string {
  return [
    `Kiểm tra kèo đã hydrate từ snapshot odds.`,
    `Match: ${payload.home} vs ${payload.away}`,
    `Recommendation: ${setup.recommendation}`,
    `Picks: ${(setup.picks ?? []).map((pick) => `${pick.candidateId ?? "-"}:${pick.market} ${pick.selection} @${pick.odds}`).join(" | ")}`,
    `Xác nhận khi mọi pick đều tồn tại trong snapshot, odds > 1.80 và không có mâu thuẫn lớn.`,
    `QUY TẮC THANH TOÁN KÈO CHÂU ÂU:`,
    `- Over/Under X.5: thắng/thua ĐỦ tiền. Không có hòa nửa.`,
    `- Under X.5 thắng nếu tổng bàn ≤ X.`,
    `- Over X.5 thắng nếu tổng bàn ≥ X+1.`,
    `QUY TẮC THANH TOÁN KÈO CHÂU Á:`,
    `- X.25: nếu tổng bàn = X, thua nửa (Over) hoặc thắng nửa (Under).`,
    `- X.75: nếu tổng bàn = X+1, thua nửa (Under) hoặc thắng nửa (Over).`,
    `Ví dụ: Under 2.5 thắng với tỷ số 2-0, 1-1, 0-0, 1-0 (tổng ≤ 2).`,
    `Trả reasonCode là một trong CONFLICT, OVERCLAIM, INSUFFICIENT_SUPPORT, HARD_INVALID, OTHER.`,
    `Nếu không có pick hợp lệ hoặc chỉ là đứng ngoài, bác bỏ với reasonCode HARD_INVALID.`,
    `Chỉ trả JSON với keys confirmed, confidence, reasonCode, comment.`,
    `Comment ngắn, có dấu tiếng Việt.`,
  ].join("\n");
}

function buildRevisePrompt(
  payload: MatchOddsPayload,
  original: MatchAiAnalysis,
  rejectionComment: string,
): string {
  return [
    `Sửa phân tích theo snapshot odds.`,
    `Match: ${payload.home} vs ${payload.away}`,
    `Rejected reason: ${rejectionComment}`,
    `Original recommendation: ${original.recommendation}`,
    `Original picks: ${(original.picks ?? []).map((pick) => `${pick.candidateId ?? "-"}:${pick.market} ${pick.selection} @${pick.odds}`).join(" | ")}`,
    `Nếu không còn kèo đạt chuẩn thì recommendation phải là "Đứng ngoài".`,
    `Không nhắc tới việc bị bác bỏ hay bước thẩm định.`,
    `Trả đúng schema phân tích như analyze, nhưng không cần marketViews.`,
    `Picks chỉ được dùng candidateId từ snapshot.`,
  ].join("\n");
}

function parseVerificationResponse(
  text: string,
): { confirmed: boolean; confidence: number; reasonCode: VerificationReasonCode; comment: string } | null {
  try {
    const parsed = JSON.parse(extractJsonObject(text)) as {
      confirmed?: unknown;
      confidence?: unknown;
      reasonCode?: unknown;
      comment?: unknown;
    };
    const reasonCode: VerificationReasonCode =
      parsed.reasonCode === "CONFLICT" ||
      parsed.reasonCode === "OVERCLAIM" ||
      parsed.reasonCode === "INSUFFICIENT_SUPPORT" ||
      parsed.reasonCode === "HARD_INVALID" ||
      parsed.reasonCode === "OTHER"
        ? parsed.reasonCode
        : "OTHER";
    return {
      confirmed: Boolean(parsed.confirmed),
      confidence: clampConfidence(parsed.confidence),
      reasonCode,
      comment: toText(parsed.comment),
    };
  } catch {
    return null;
  }
}

function getCandidateById(
  candidatePool: OddsCandidate[],
  candidateId: string,
): OddsCandidate | undefined {
  const normalized = candidateId.trim().toUpperCase();
  return candidatePool.find((candidate) => candidate.candidateId === normalized);
}

function parseDirectPicks(
  rawPicks: unknown,
  payload: MatchOddsPayload,
): NonNullable<MatchAiAnalysis["picks"]> {
  if (!Array.isArray(rawPicks)) return [];

  const candidatePool = buildCandidatePool(payload);
  const used = new Set<string>();
  const picks: NonNullable<MatchAiAnalysis["picks"]> = [];

  for (const item of rawPicks) {
    if (!item || typeof item !== "object") continue;
    const raw = item as {
      candidateId?: unknown;
      market?: unknown;
      selection?: unknown;
      odds?: unknown;
      reason?: unknown;
      confidence?: unknown;
    };

    const candidateId = toText(raw.candidateId).toUpperCase();
    const directMarket = toText(raw.market);
    const directSelection = toText(raw.selection);
    const directOdds = Number(raw.odds);
    const candidate =
      candidateId && getCandidateById(candidatePool, candidateId)
        ? getCandidateById(candidatePool, candidateId)
        : resolveLegacyPick(raw, candidatePool);

    const market = directMarket || candidate?.market || "";
    const selection = directSelection || candidate?.selection || "";
    const odds = Number.isFinite(directOdds) && directOdds > 0 ? directOdds : candidate?.odds ?? 0;
    if (!market || !selection || !Number.isFinite(odds) || odds <= 0) continue;

    const resolvedId = candidate?.candidateId || candidateId || undefined;
    if (resolvedId && used.has(resolvedId)) continue;

    picks.push({
      candidateId: resolvedId,
      market,
      selection,
      odds,
      reason: toText(raw.reason) || undefined,
      confidence: Number.isFinite(Number(raw.confidence)) ? clampConfidence(raw.confidence) : undefined,
    });
    if (resolvedId) used.add(resolvedId);
    if (picks.length >= 3) break;
  }

  return picks;
}

function resolveLegacyPick(
  raw: { market?: unknown; selection?: unknown; odds?: unknown },
  candidatePool: OddsCandidate[],
): OddsCandidate | undefined {
  const market = toText(raw.market);
  const selection = toText(raw.selection);
  const odds = Number(raw.odds);
  if (!market || !selection || !Number.isFinite(odds)) return undefined;

  return candidatePool.find(
    (candidate) =>
      candidate.market === market &&
      candidate.selection === selection &&
      Math.abs(candidate.odds - odds) < 0.0001,
  );
}

async function callOpenRouterWithCount(
  request: OpenRouterRequest,
  isRetryable: (error: unknown) => boolean = isTransientRetryableError,
): Promise<{ response: Awaited<ReturnType<typeof callOpenRouter>>; requestCount: number }> {
  let requestCount = 0;
  try {
    const response = await withRetry(
      async () => {
        requestCount += 1;
        return callOpenRouter(request);
      },
      {
        maxAttempts: 2,
        baseDelayMs: 1_000,
        isRetryable,
      },
    );
    return { response, requestCount };
  } catch (error) {
    if (error instanceof Error) {
      (error as Error & { requestCount?: number }).requestCount = requestCount;
    }
    throw error;
  }
}

async function runOpenRouterStage(
  request: OpenRouterRequest,
  options: {
    fallbackRequest?: OpenRouterRequest;
    fallbackOnError?: (error: unknown) => boolean;
  } = {},
): Promise<RequestRunResult> {
  try {
    const { response, requestCount } = await callOpenRouterWithCount(request, isAnalyzeRetryableError);
    return {
      response,
      usedFallback: false,
      model: request.model,
      requestCount,
    };
  } catch (error) {
    if (!options.fallbackRequest || !options.fallbackOnError?.(error)) {
      throw error;
    }

    logger.warn(
      `  ! ${request.model} failed, retrying with fallback ${options.fallbackRequest.model}: ${error instanceof Error ? error.message : error}`,
    );

    const { response: fallbackResponse, requestCount: fallbackCount } = await callOpenRouterWithCount(
      options.fallbackRequest!,
      isTransientRetryableError,
    );
    const primaryRequestCount = Number(
      (error as Error & { requestCount?: number }).requestCount ?? 0,
    );

    return {
      response: fallbackResponse,
      usedFallback: true,
      model: options.fallbackRequest.model,
      requestCount: primaryRequestCount + fallbackCount,
    };
  }
}

function recordStageUsage(
  stage: "analyze" | "verify" | "revise",
  response: Awaited<ReturnType<typeof callOpenRouter>>,
  model: string,
  metadata: Record<string, unknown>,
): void {
  void recordOpenRouterUsage(response, {
    model,
    source: "betting",
    metadata: {
      stage,
      ...metadata,
      inputTokens: response.usage.promptTokens,
      outputTokens: response.usage.completionTokens,
    },
  });
}

function logStageMetrics(
  stage: "analyze" | "verify" | "revise",
  payload: MatchOddsPayload,
  model: string,
  latencyMs: number,
  response: Awaited<ReturnType<typeof callOpenRouter>>,
  requestCount: number,
  usedFallback: boolean,
): void {
  logger.info(
    `  ✓ ${stage} ${payload.home} vs ${payload.away}: ${latencyMs}ms, model=${model}, requests=${requestCount}, input=${response.usage.promptTokens}, output=${response.usage.completionTokens}, fallback=${usedFallback ? "yes" : "no"}`,
  );
}

function buildAnalyzeRequest(payload: MatchOddsPayload, model: string): OpenRouterRequest {
  return {
    model,
    systemPrompt: buildAnalyzeSystemPrompt(),
    userContent: [{ type: "text", text: `${buildAnalyzeUserText(payload)}\n\n${buildAnalyzeUserPrompt()}` }],
    maxTokens: MAX_ANALYZE_TOKENS,
    temperature: 0.2,
    responseFormat: { type: "json_object" },
    timeoutMs: ANALYZE_TIMEOUT_MS,
    reasoning: { effort: "none", exclude: true },
    plugins: model === ANALYZE_MODEL ? [{ id: "web", max_results: ANALYZE_WEB_RESULTS }] : undefined,
  };
}

function buildVerifyRequest(payload: MatchOddsPayload, analysis: MatchAiAnalysis): OpenRouterRequest {
  return {
    model: VERIFY_MODEL,
    systemPrompt: "Bạn là bộ thẩm định odds độc lập. Chỉ trả JSON ngắn.",
    userContent: [
      {
        type: "text",
        text: `${formatOddsAnalysisInput(payload)}\n\nanalysis=${JSON.stringify({
          preferredScoreline: analysis.preferredScoreline,
          scoreConfidence: analysis.scoreConfidence,
          recommendation: analysis.recommendation,
          confidence: analysis.confidence,
          picks: analysis.picks ?? [],
        })}\n\n${buildVerificationPrompt(analysis, payload)}`,
      },
    ],
    maxTokens: MAX_VERIFY_TOKENS,
    temperature: 0.2,
    responseFormat: { type: "json_object" },
    timeoutMs: VERIFY_TIMEOUT_MS,
    reasoning: { effort: "none", exclude: true },
  };
}

function buildReviseRequest(
  payload: MatchOddsPayload,
  original: MatchAiAnalysis,
  rejectionComment: string,
): OpenRouterRequest {
  return {
    model: VERIFY_MODEL,
    systemPrompt: "Bạn là bộ tái phân tích odds độc lập. Chỉ trả JSON ngắn.",
    userContent: [
      {
        type: "text",
        text: `${formatOddsAnalysisInput(payload)}\n\n${buildCandidatePoolText(payload)}\n\nrejected=${JSON.stringify({
          preferredScoreline: original.preferredScoreline,
          scoreConfidence: original.scoreConfidence,
          recommendation: original.recommendation,
          confidence: original.confidence,
          picks: original.picks ?? [],
        })}\n\nreason=${rejectionComment}\n\n${buildRevisePrompt(payload, original, rejectionComment)}`,
      },
    ],
    maxTokens: MAX_REVISE_TOKENS,
    temperature: 0.2,
    responseFormat: { type: "json_object" },
    timeoutMs: REVISE_TIMEOUT_MS,
    reasoning: { effort: "none", exclude: true },
  };
}

function parseMatchAnalysisResponseInternal(
  text: string,
  payload: MatchOddsPayload,
): MatchAiAnalysis | null {
  try {
    const parsed = JSON.parse(extractJsonObject(text)) as Partial<MatchAiAnalysis>;
    return normalizeAnalysisAfterHydration(parsed, payload);
  } catch {
    return null;
  }
}

function sanitizeStringList(value: unknown, fallback: string): string[] {
  if (!Array.isArray(value)) return [fallback];
  const items = value.map((item) => String(item).trim()).filter(Boolean).slice(0, 2);
  return items.length > 0 ? items : [fallback];
}

function normalizeAnalysisAfterHydration(
  parsed: Partial<MatchAiAnalysis>,
  payload: MatchOddsPayload,
): MatchAiAnalysis {
  const directPicks = parseDirectPicks(parsed.picks, payload);
  const recommendation = toText(parsed.recommendation) || (
    directPicks.length > 0 ? "Theo dõi các kèo AI đề xuất." : "Đứng ngoài."
  );
  return {
    match: toText(parsed.match, `${payload.home} vs ${payload.away}`),
    preferredScoreline: toText(parsed.preferredScoreline, "Chưa có tỷ số ưu tiên"),
    scoreConfidence: clampConfidence(parsed.scoreConfidence),
    recommendation,
    confidence: clampConfidence(parsed.confidence),
    picks: directPicks,
    marketViews: Array.isArray(parsed.marketViews)
      ? (parsed.marketViews as MatchAiAnalysis["marketViews"])
      : [],
    keyPoints: sanitizeStringList(parsed.keyPoints, "Không tách được các điểm odds nổi bật."),
    risks: sanitizeStringList(parsed.risks, "Cẩn thận vì dữ liệu odds chưa cho thấy edge rõ ràng."),
    summary: toText(parsed.summary, "Không có đủ thông tin để rút ra kết luận ổn định."),
  };
}

export function buildAnalyzeMatchOddsRequest(payload: MatchOddsPayload): OpenRouterRequest {
  return buildAnalyzeRequest(payload, ANALYZE_MODEL);
}

export function buildVerifyMatchAnalysisRequest(
  payload: MatchOddsPayload,
  analysis: MatchAiAnalysis,
): OpenRouterRequest {
  return buildVerifyRequest(payload, analysis);
}

export function buildReviseMatchAnalysisRequest(
  payload: MatchOddsPayload,
  original: MatchAiAnalysis,
  rejectionComment: string,
): OpenRouterRequest {
  return buildReviseRequest(payload, original, rejectionComment);
}

export function buildMatchAnalysisCandidatePool(payload: MatchOddsPayload): Array<{
  candidateId: string;
  market: string;
  marketKey: string;
  selection: string;
  odds: number;
}> {
  return buildCandidatePool(payload);
}

export function isStandAsideAnalysis(recommendation: string): boolean {
  return isStandAsideRecommendation(recommendation);
}

export function parseMatchAnalysisResponseForTest(
  text: string,
  payload: MatchOddsPayload,
): MatchAiAnalysis | null {
  return parseMatchAnalysisResponseInternal(text, payload);
}

export async function analyzeMatchOdds(
  payload: MatchOddsPayload,
): Promise<MatchAiAnalysis> {
  const startedAt = Date.now();
  const primaryRequest = buildAnalyzeMatchOddsRequest(payload);
  const fallbackRequest = {
    ...buildAnalyzeRequest(payload, FALLBACK_MODEL),
    plugins: undefined,
  };

  const run = await runOpenRouterStage(primaryRequest, {
    fallbackRequest,
    fallbackOnError: isProFallbackTrigger,
  });
  const latencyMs = Date.now() - startedAt;
  logStageMetrics("analyze", payload, run.model, latencyMs, run.response, run.requestCount, run.usedFallback);
  recordStageUsage("analyze", run.response, run.model, {
    latencyMs,
    requestCount: run.requestCount,
    fallbackUsed: run.usedFallback,
    timeoutMs: ANALYZE_TIMEOUT_MS,
    webResults: run.usedFallback ? 0 : ANALYZE_WEB_RESULTS,
    analyzeModel: ANALYZE_MODEL,
    fallbackModel: FALLBACK_MODEL,
  });
  const parsed = parseMatchAnalysisResponseInternal(run.response.text, payload);
  if (!parsed) {
    throw new Error(`OpenRouter parse failed. Raw: ${run.response.text.slice(0, 300)}`);
  }
  return parsed;
}

export async function verifyMatchAnalysis(
  payload: MatchOddsPayload,
  analysis: MatchAiAnalysis,
): Promise<{ confirmed: boolean; confidence: number; reasonCode: VerificationReasonCode; comment: string }> {
  const startedAt = Date.now();
  const request = buildVerifyMatchAnalysisRequest(payload, analysis);
  const { response, requestCount } = await callOpenRouterWithCount(request, isTransientRetryableError);
  const parsed = parseVerificationResponse(response.text);
  const latencyMs = Date.now() - startedAt;
  logStageMetrics("verify", payload, request.model, latencyMs, response, requestCount, false);
  recordStageUsage("verify", response, request.model, {
    latencyMs,
    requestCount,
    fallbackUsed: false,
    timeoutMs: VERIFY_TIMEOUT_MS,
    reasonCode: parsed?.reasonCode ?? "OTHER",
  });
  if (!parsed) {
    throw new Error(`OpenRouter verify parse failed. Raw: ${response.text.slice(0, 300)}`);
  }
  return parsed;
}

function shouldRevise(reasonCode: VerificationReasonCode): boolean {
  return (
    reasonCode === "CONFLICT" ||
    reasonCode === "OVERCLAIM" ||
    reasonCode === "INSUFFICIENT_SUPPORT"
  );
}

function buildFallbackRevisedAnalysis(
  payload: MatchOddsPayload,
  original: MatchAiAnalysis,
  rejectionComment: string,
): MatchAiAnalysis {
  const shortReason =
    rejectionComment.trim() || "Nhận định trước đó không vượt qua bước thẩm định.";
  const trimmedReason =
    shortReason.length > 160 ? `${shortReason.slice(0, 157)}...` : shortReason;
  return {
    match: `${payload.home} vs ${payload.away}`,
    preferredScoreline: original.preferredScoreline || "1-1",
    scoreConfidence: Math.min(original.scoreConfidence || 0, 45),
    recommendation: "Đứng ngoài.",
    confidence: Math.min(original.confidence || 0, 45),
    keyPoints: [
      "Bước thẩm định độc lập đã bác bỏ nhận định ban đầu.",
      "Odds hiện tại chưa cho thấy edge rõ ràng để vào kèo.",
    ],
    risks: [
      trimmedReason,
      "Nhận định thay thế được hạ mức tin cậy để tránh overclaim.",
    ],
    summary:
      "Nhận định gốc bị từ chối trong bước thẩm định độc lập. Bản thay thế chuyển sang góc nhìn bảo thủ vì odds chưa cho edge rõ ràng.",
    picks: [],
  };
}

export async function reviseMatchAnalysis(
  payload: MatchOddsPayload,
  original: MatchAiAnalysis,
  rejectionComment: string,
): Promise<MatchAiAnalysis> {
  const startedAt = Date.now();
  const request = buildReviseMatchAnalysisRequest(payload, original, rejectionComment);
  const { response, requestCount } = await callOpenRouterWithCount(request, isTransientRetryableError);
  const latencyMs = Date.now() - startedAt;
  logStageMetrics("revise", payload, request.model, latencyMs, response, requestCount, false);
  recordStageUsage("revise", response, request.model, {
    latencyMs,
    requestCount,
    fallbackUsed: false,
    timeoutMs: REVISE_TIMEOUT_MS,
    finishReason: response.finishReason ?? "stop",
  });
  if (response.finishReason === "length") {
    logger.warn(
      `  ! OpenRouter revise output truncated (finish_reason=length, ${response.usage.completionTokens} tokens) for ${payload.home} vs ${payload.away}; using conservative fallback`,
    );
    return buildFallbackRevisedAnalysis(payload, original, rejectionComment);
  }
  const parsed = parseMatchAnalysisResponseInternal(response.text, payload);
  if (!parsed) {
    logger.warn(
      `  ! OpenRouter revise parse failed for ${payload.home} vs ${payload.away}; using conservative fallback`,
    );
    return buildFallbackRevisedAnalysis(payload, original, rejectionComment);
  }
  return parsed;
}

export function parseMatchAnalysisResponse(
  text: string,
  payload: MatchOddsPayload,
): MatchAiAnalysis | null {
  return parseMatchAnalysisResponseInternal(text, payload);
}
