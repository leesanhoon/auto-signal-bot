import { withRetry, isRetryableError, getErrorField, getStatusCode } from "../shared/retry.js";
import type {
  BettingPlan,
  CombinedAnalysisPlan,
  CombinedAnalysisPlanMatch,
  MatchAiAnalysis,
  MatchOddsPayload,
} from "./betting-types.js";
import {
  formatFullOddsAnalysisInput,
  formatOddsAnalysisInput,
  formatMainOddsSummary,
} from "./odds-text-format.js";
import { createLogger } from "../shared/logger.js";
import { recordOpenRouterUsage } from "../shared/ai-usage.js";
import {
  callOpenRouter,
  type OpenRouterRequest,
} from "../shared/openrouter.js";
import { getConfiguredReasoningEffort } from "../shared/ai-env.js";

const logger = createLogger("betting:betting-ai");
const ANALYZE_MODEL =
  process.env.AI_TEXT_MODEL?.trim() || "deepseek/deepseek-v4-pro";
const FALLBACK_MODEL =
  process.env.AI_TEXT_FALLBACK_MODEL?.trim() || "deepseek/deepseek-v4-flash";
const ANALYZE_TIMEOUT_MS = parsePositiveEnv(
  "BETTING_AI_ANALYZE_TIMEOUT_MS",
  75_000,
);
const ANALYZE_WEB_RESULTS = 3;
const MAX_ANALYZE_TOKENS = 1_400;

type OddsCandidate = {
  candidateId: string;
  market: string;
  marketKey: string;
  selection: string;
  odds: number;
};

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
  "result_total_goals",
  "btts",
  "team_goals_home",
  "team_goals_away",
  "corners_1x2",
  "corners_handicap",
  "corners_totals",
  "corners_totals_eu",
] as const;

const PICKS_MARKET_SCOPE: "totals_only" | "all" =
  process.env.BETTING_PICKS_MARKET_SCOPE?.trim().toLowerCase() === "all"
    ? "all"
    : "totals_only";

// Regex nhận diện market Tài/Xỉu (tổng bàn thắng) từ text tự do AI trả về.
// Không dùng cho corners_totals/corners_totals_eu (đó là tổng góc, KHÔNG phải
// tổng bàn thắng) — chỉ áp dụng cho asia_totals, eu_totals, result_total_goals.
// Dùng "tổng"/"tong" đơn lẻ (không bắt buộc theo sau "bàn") để khớp cả label
// "KQ+Tổng" (result_total_goals) — việc loại trừ "tổng góc" đã được xử lý riêng
// ở isTotalsGoalsMarketText bên dưới.
const TOTALS_MARKET_REGEX = /tài|xỉu|tai|xiu|tổng|tong|over|under|o\/u/i;

function isTotalsGoalsMarketText(marketText: string): boolean {
  const normalized = marketText.toLowerCase();
  if (/góc|goc|corner/.test(normalized)) return false; // loại trừ tổng góc
  return TOTALS_MARKET_REGEX.test(normalized);
}

function parsePositiveEnv(name: string, fallback: number): number {
  const configured = Number(process.env[name]);
  return Number.isFinite(configured) && configured > 0 ? configured : fallback;
}

function cleanResponse(text: string): string {
  return text
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();
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
  if (Array.isArray(value))
    return value.map((item) => String(item).trim()).filter(Boolean);
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

function isAnalyzeRetryableError(error: unknown): boolean {
  const statusCode = getStatusCode(error);
  if (statusCode !== undefined && [429, 500, 502, 503, 504].includes(statusCode)) {
    return true;
  }

  const status = getErrorField(error, "status");
  if (typeof status === "string" && /UNAVAILABLE|RESOURCE_EXHAUSTED/i.test(status)) {
    return true;
  }

  const message = error instanceof Error ? error.message : String(error);
  if (/OpenRouter request failed \((429|500|502|503|504)\):/i.test(message)) return true;
  if (/"code"\s*:\s*(429|500|502|503|504)/.test(message)) return true;
  if (/UNAVAILABLE|RESOURCE_EXHAUSTED|overloaded|high demand/i.test(message)) return true;

  return false;
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
    case "result_total_goals":
      return "KQ+Tổng";
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
      return outcomeName === "Over" ? `Tài${pointText}` : `Xỉu${pointText}`;
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
    case "result_total_goals": {
      const resultCode = outcomeName.charAt(0);
      const totalCode = outcomeName.charAt(1);
      const resultText =
        resultCode === "H"
          ? payload.home
          : resultCode === "A"
            ? payload.away
            : "Hòa";
      const totalText = totalCode === "O" ? "Tài" : "Xỉu";
      return `${resultText} & ${totalText}${pointText}`;
    }
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

  // Correct Score candidates (từ payload.correctScore riêng, không nằm trong odds.markets)
  if (payload.correctScore?.length) {
    for (const outcome of payload.correctScore) {
      if (!Number.isFinite(outcome.price) || outcome.price <= 0) continue;
      const candidateId = `P${String(index).padStart(2, "0")}`;
      candidates.push({
        candidateId,
        market: "Tỷ số chính xác",
        marketKey: "correct_score",
        selection: outcome.score,
        odds: outcome.price,
      });
      index += 1;
      if (index > 50) break; // safety limit
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
    "Phân tích khách quan xu hướng odds, kèo đáng chú ý, rủi ro.",
    "Nếu không rõ edge thì nói Đứng ngoài.",
    "",
    "HƯỚNG DẪN CHỌN KÈO XIÊN (PARLAY):",
    "- Kèo xiên cần odds trung bình ~1.5–2.5 mỗi chân, không quá thấp (dưới 1.3) cũng không quá cao (trên 4.0).",
    "- Ưu tiên: 1X2 (Home/Draw/Away), GG/NG, Tài/Xỉu (EU mốc .5) vì dễ ghép và thanh toán đơn giản.",
    "- Tránh kèo Chấp Á .25/.75 cho xiên vì thanh toán nửa/nửa phức tạp.",
    "- Có thể gợi ý ghép cùng cửa (ví dụ: all Home thắng) hoặc ngược cửa (mix) qua parlayNote.",
    "- Kèo 'đơn' phù hợp khi odds cao (≥3.0) hoặc tỉ số chính xác (cược riêng, không ghép xiên).",
    "",
    "Với mỗi pick, set suitability='parlay' nếu kèo dễ ghép xiên, 'single' nếu chơi đơn, 'both' nếu chơi được cả hai.",
    "Nếu có thể, thêm parlayNote gợi ý ghép: 'Ghép với [trận] cửa [X]'.",
    "",
    "Không cần tự validate lại qua model khác. Không tự bịa dữ liệu ngoài input.",
    "Tất cả field text bằng tiếng Việt có dấu, ngắn gọn, không markdown, không URL.",
  ].join("\n");
}

function buildAnalyzeUserPrompt(): string {
  return [
    "Trả duy nhất JSON với keys match, preferredScoreline, scoreConfidence, recommendation, confidence, picks, keyPoints, risks, summary.",
    "picks là mảng tối đa 3 kèo AI thấy đáng chú ý; mỗi pick gồm market, selection, odds, reason.",
    'Mỗi pick CẦN có thêm: suitability ("parlay" | "single" | "both"), parlayNote (gợi ý ghép xiên, để trống nếu không có).',
    "Nếu không có kèo rõ, picks là [] và recommendation là Đứng ngoài.",
    "keyPoints và risks mỗi mảng 1-3 phần tử.",
  ].join(" ");
}

function getCandidateById(
  candidatePool: OddsCandidate[],
  candidateId: string,
): OddsCandidate | undefined {
  const normalized = candidateId.trim().toUpperCase();
  return candidatePool.find(
    (candidate) => candidate.candidateId === normalized,
  );
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
      /** "parlay" | "single" | "both" */
      suitability?: unknown;
      parlayNote?: unknown;
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
    const odds =
      Number.isFinite(directOdds) && directOdds > 0
        ? directOdds
        : (candidate?.odds ?? 0);
    if (!market || !selection || !Number.isFinite(odds) || odds <= 0) continue;

    const resolvedId = candidate?.candidateId || candidateId || undefined;
    if (resolvedId && used.has(resolvedId)) continue;

    const suitabilityRaw = raw.suitability;
    const suitabilityVal =
      suitabilityRaw === "parlay" ||
      suitabilityRaw === "single" ||
      suitabilityRaw === "both"
        ? suitabilityRaw
        : undefined;
    const parlayNoteVal = toText(raw.parlayNote) || undefined;

    picks.push({
      candidateId: resolvedId,
      market,
      selection,
      odds,
      reason: toText(raw.reason) || undefined,
      confidence: Number.isFinite(Number(raw.confidence))
        ? clampConfidence(raw.confidence)
        : undefined,
      ...(suitabilityVal ? { suitability: suitabilityVal } : {}),
      ...(parlayNoteVal ? { parlayNote: parlayNoteVal } : {}),
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
  isRetryable: (error: unknown) => boolean = isRetryableError,
): Promise<{
  response: Awaited<ReturnType<typeof callOpenRouter>>;
  requestCount: number;
}> {
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
    const { response, requestCount } = await callOpenRouterWithCount(
      request,
      isAnalyzeRetryableError,
    );
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

    const { response: fallbackResponse, requestCount: fallbackCount } =
      await callOpenRouterWithCount(
        options.fallbackRequest!,
        isAnalyzeRetryableError,
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
  stage: "analyze" | "combined",
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
  stage: "analyze" | "combined",
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

function buildAnalyzeRequest(
  payload: MatchOddsPayload,
  model: string,
): OpenRouterRequest {
  return {
    model,
    systemPrompt: buildAnalyzeSystemPrompt(),
    userContent: [
      {
        type: "text",
        text: `${buildAnalyzeUserText(payload)}\n\n${buildAnalyzeUserPrompt()}`,
      },
    ],
    maxTokens: MAX_ANALYZE_TOKENS,
    temperature: 0.2,
    responseFormat: { type: "json_object" },
    timeoutMs: ANALYZE_TIMEOUT_MS,
    reasoning: { effort: "none", exclude: true },
    plugins:
      model === ANALYZE_MODEL
        ? [{ id: "web", max_results: ANALYZE_WEB_RESULTS }]
        : undefined,
  };
}

function parseMatchAnalysisResponseInternal(
  text: string,
  payload: MatchOddsPayload,
): MatchAiAnalysis | null {
  try {
    const parsed = JSON.parse(
      extractJsonObject(text),
    ) as Partial<MatchAiAnalysis>;
    return normalizeAnalysisAfterHydration(parsed, payload);
  } catch {
    return null;
  }
}

function sanitizeStringList(value: unknown, fallback: string): string[] {
  if (!Array.isArray(value)) return [fallback];
  const items = value
    .map((item) => String(item).trim())
    .filter(Boolean)
    .slice(0, 2);
  return items.length > 0 ? items : [fallback];
}

function normalizeAnalysisAfterHydration(
  parsed: Partial<MatchAiAnalysis>,
  payload: MatchOddsPayload,
): MatchAiAnalysis {
  const directPicks = parseDirectPicks(parsed.picks, payload);
  const recommendation =
    toText(parsed.recommendation) ||
    (directPicks.length > 0 ? "Theo dõi các kèo AI đề xuất." : "Đứng ngoài.");
  return {
    match: toText(parsed.match, `${payload.home} vs ${payload.away}`),
    preferredScoreline: toText(
      parsed.preferredScoreline,
      "Chưa có tỷ số ưu tiên",
    ),
    scoreConfidence: clampConfidence(parsed.scoreConfidence),
    recommendation,
    confidence: clampConfidence(parsed.confidence),
    picks: directPicks,
    marketViews: Array.isArray(parsed.marketViews)
      ? (parsed.marketViews as MatchAiAnalysis["marketViews"])
      : [],
    keyPoints: sanitizeStringList(
      parsed.keyPoints,
      "Không tách được các điểm odds nổi bật.",
    ),
    risks: sanitizeStringList(
      parsed.risks,
      "Cẩn thận vì dữ liệu odds chưa cho thấy edge rõ ràng.",
    ),
    summary: toText(
      parsed.summary,
      "Không có đủ thông tin để rút ra kết luận ổn định.",
    ),
  };
}

export function buildAnalyzeMatchOddsRequest(
  payload: MatchOddsPayload,
): OpenRouterRequest {
  return buildAnalyzeRequest(payload, ANALYZE_MODEL);
}

export function buildMatchAnalysisCandidatePool(
  payload: MatchOddsPayload,
): Array<{
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
  logStageMetrics(
    "analyze",
    payload,
    run.model,
    latencyMs,
    run.response,
    run.requestCount,
    run.usedFallback,
  );
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
    throw new Error(
      `OpenRouter parse failed. Raw: ${run.response.text.slice(0, 300)}`,
    );
  }
  return parsed;
}

export function parseMatchAnalysisResponse(
  text: string,
  payload: MatchOddsPayload,
): MatchAiAnalysis | null {
  return parseMatchAnalysisResponseInternal(text, payload);
}

// ── Betting Plan Generator ─────────────────────────────────

const PLAN_MODEL =
  process.env.AI_TEXT_MODEL?.trim() || "deepseek/deepseek-v4-pro";
const PLAN_FALLBACK_MODEL =
  process.env.AI_TEXT_FALLBACK_MODEL?.trim() || "deepseek/deepseek-v4-flash";
const PLAN_TIMEOUT_MS = parsePositiveEnv("BETTING_AI_PLAN_TIMEOUT_MS", 180_000);
const PLAN_TOKENS = 4_000;

const COMBINED_TIMEOUT_MS = parsePositiveEnv(
  "BETTING_AI_COMBINED_TIMEOUT_MS",
  240_000,
);
const COMBINED_TOKENS = 16_000;

function buildPlanSystemPrompt(matchCount: number): string {
  const totalCapital = matchCount * 1_000_000;
  const parlayStake = 50_000;
  const pairCount = (matchCount * (matchCount - 1)) / 2;
  const parlayBudget = parlayStake * (1 + pairCount + 1); // xiên all + xiên 2 + xiên tỉ số
  const remaining = totalCapital - parlayBudget;
  const perMatchSingle = Math.floor(remaining / (matchCount * 2)); // 1 main + 1 tỉ số per match

  return [
    "Bạn là chuyên gia lên kế hoạch đặt cược bóng đá.",
    "Dựa vào odds và phân tích từng trận, hãy lên kế hoạch tổng thể.",
    "",
    "CHIẾN LƯỢC VỐN:",
    `- Tổng vốn: ${totalCapital.toLocaleString("vi-VN")}đ (${matchCount}tr × ${matchCount} trận)`,
    `- Mỗi xiên: ${parlayStake.toLocaleString("vi-VN")}đ`,
    `- Xiên all ${matchCount} trận: ${parlayStake.toLocaleString("vi-VN")}đ`,
    `- Xiên 2 (${pairCount} tổ hợp): ${(parlayStake * pairCount).toLocaleString("vi-VN")}đ`,
    `- Xiên tỉ số: ${parlayStake.toLocaleString("vi-VN")}đ`,
    `- Tổng xiên: ~${parlayBudget.toLocaleString("vi-VN")}đ`,
    `- Còn lại: ${remaining.toLocaleString("vi-VN")}đ → chia đều ${matchCount} trận`,
    `- Mỗi trận: 1 kèo main + 1 kèo tỉ số (${perMatchSingle.toLocaleString("vi-VN")}đ mỗi kèo)`,
    "",
    "QUY TẮC CHỌN KÈO CHO XIÊN:",
    "- Xiên ALL: chọn 1 kèo CHẮC NHẤT mỗi trận (GG/NG, Tài/Xỉu EU, 1X2 ngắn). Odds mỗi chân ~1.3–2.0.",
    "- Xiên 2: ghép 2 trận có cùng xu hướng (vd: cả 2 đội mạnh hơn đều thắng, hoặc cả 2 đều Under).",
    "- Xiên tỉ số: chọn tỉ số chính xác mỗi trận mà AI tự tin nhất.",
    "- Không ghép kèo Chấp Á mốc .25/.75 vào xiên (thanh toán nửa phức tạp).",
    "- Mỗi xiên 2 nên chọn kèo từ 2 trận KHÁC NHAU.",
    "- Chỉ ghép xiên khi edge rõ rệt từ odds.",
    "",
    "QUY TẮC KÈO ĐƠN (remainingSingles):",
    "- Kèo main: odds > 1.80 (1X2, Châu Á, Tổng bàn, GG/NG).",
    "- Kèo tỉ số chính xác: odds > 3.0.",
    "- Chỉ chọn khi odds cho thấy edge rõ.",
    "",
    "Tất cả field text bằng tiếng Việt có dấu, ngắn gọn.",
  ].join("\n");
}

function buildPlanUserPrompt(
  payloads: MatchOddsPayload[],
  analyses: MatchAiAnalysis[],
): string {
  const matchBlocks = payloads.map((payload, i) => {
    const analysis = analyses[i];
    const kickoff = new Date(payload.kickoffUnix * 1000).toLocaleString(
      "vi-VN",
      {
        timeZone: "Asia/Ho_Chi_Minh",
        weekday: "short",
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      },
    );
    const picksText = (analysis?.picks ?? [])
      .map(
        (p) =>
          `  - ${p.market}: ${p.selection} @${p.odds}${p.reason ? ` (${p.reason})` : ""}`,
      )
      .join("\n");
    return [
      `--- TRẬN ${i + 1}: ${payload.home} vs ${payload.away} ---`,
      `Giờ: ${kickoff}`,
      `Phân tích: ${analysis?.recommendation ?? "N/A"} (conf: ${analysis?.confidence ?? 0}%)`,
      `Tỉ số ưu tiên: ${analysis?.preferredScoreline ?? "N/A"}`,
      analysis?.picks?.length
        ? `Kèo nổi bật:\n${picksText}`
        : "Kèo nổi bật: Không có",
      `Odds chính: ${formatMainOddsSummary(payload) ?? "N/A"}`,
    ].join("\n");
  });

  return [
    "Dưới đây là dữ liệu odds và phân tích AI cho các trận hôm nay:",
    "",
    ...matchBlocks,
    "",
    "YÊU CẦU:",
    "Trả JSON theo schema:",
    `{
  "matches": [
    {
      "matchIndex": 0,
      "matchLabel": "Spain vs Austria",
      "kickoff": "Th 5 03/07 19:00",
      "analysis": "phân tích ngắn 1-2 câu",
      "topPicks": [
              {"market": "Tỷ số chính xác", "selection": "2-0", "odds": 6.5, "reason": "lý do ngắn", "suitability": "single"}
            ]
    }
  ],
  "parlays": [
    {
      "type": "xiên 3",
      "legs": [
        {"matchIndex": 0, "matchLabel": "Spain vs Austria", "pick": {"market": "GG/NG", "selection": "NG", "odds": 1.62, "reason": "ngắn"}}
      ],
      "combinedOdds": 4.5,
      "stake": 50000,
      "potentialWin": 225000
    }
  ],
  "remainingSingles": [
    {
      "matchIndex": 0,
      "matchLabel": "Spain vs Austria",
      "betType": "Tỷ số chính xác",
      "pick": {"market": "Tỷ số chính xác", "selection": "2-0", "odds": 6.5, "reason": "ngắn"},
      "stake": 800000,
      "potentialWin": 5200000
    }
  ],
  "summary": "tổng kết ngắn tiếng Việt"
}`,
    "combinedOdds = tích odds các chân trong xiên. stake = tiền đặt. potentialWin = stake * combinedOdds.",
    "Đảm bảo tổng stake của parlays + remainingSingles ≤ tổng vốn.",
    "Nếu không có đủ kèo tốt thì parlays hoặc remainingSingles có thể là mảng rỗng.",
  ].join("\n");
}

export function parseBettingPlanResponse(text: string): BettingPlan | null {
  try {
    const parsed = JSON.parse(extractJsonObject(text)) as Partial<BettingPlan>;
    if (!Array.isArray(parsed.matches)) return null;
    if (!Array.isArray(parsed.parlays)) return null;
    if (!Array.isArray(parsed.remainingSingles)) return null;
    return {
      matches: parsed.matches,
      parlays: parsed.parlays,
      remainingSingles: parsed.remainingSingles,
      summary: parsed.summary ?? "",
    };
  } catch {
    return null;
  }
}

export async function generateBettingPlan(
  payloads: MatchOddsPayload[],
  analyses: MatchAiAnalysis[],
): Promise<BettingPlan | null> {
  if (payloads.length === 0 || payloads.length !== analyses.length) return null;
  const validAnalyses = analyses.filter(
    (a): a is MatchAiAnalysis => a !== null,
  );
  if (validAnalyses.length === 0) return null;

  const primaryRequest: OpenRouterRequest = {
    model: PLAN_MODEL,
    systemPrompt: buildPlanSystemPrompt(payloads.length),
    userContent: [
      { type: "text", text: buildPlanUserPrompt(payloads, validAnalyses) },
    ],
    maxTokens: PLAN_TOKENS,
    temperature: 0.3,
    responseFormat: { type: "json_object" },
    timeoutMs: PLAN_TIMEOUT_MS,
    reasoning: { effort: getConfiguredReasoningEffort("medium") },
  };

  const fallbackRequest: OpenRouterRequest = {
    ...primaryRequest,
    model: PLAN_FALLBACK_MODEL,
  };

  let request = primaryRequest;
  let usedFallback = false;
  try {
    const { response } = await callOpenRouterWithCount(
      primaryRequest,
      isRetryableError,
    );
    const plan = parseBettingPlanResponse(response.text);
    if (!plan) {
      logger.warn(
        `  ! Plan parse failed for primary model. Raw (first 1000): ${response.text.slice(0, 1000)}`,
      );
    }
    return plan;
  } catch (primaryError) {
    if (!isProFallbackTrigger(primaryError)) {
      logger.warn(
        `  ! Betting plan primary model failed (non-retryable): ${primaryError instanceof Error ? primaryError.message : String(primaryError)}`,
      );
      return null;
    }
    logger.warn(
      `  ! Primary plan model failed, trying fallback: ${primaryError instanceof Error ? primaryError.message : String(primaryError)}`,
    );
    request = fallbackRequest;
    usedFallback = true;
  }

  // Fallback attempt
  try {
    const { response } = await callOpenRouterWithCount(
      request,
      isRetryableError,
    );
    const plan = parseBettingPlanResponse(response.text);
    if (!plan) {
      logger.warn(
        `  ! Plan parse failed for fallback model. Raw (first 1000): ${response.text.slice(0, 1000)}`,
      );
    }
    logger.info(
      `  ✓ Betting plan generated with fallback model ${request.model}${usedFallback ? " (after primary timeout)" : ""}`,
    );
    return plan;
  } catch (error) {
    logger.warn(
      `  ! Betting plan generation failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

// ── Combined Analysis + Plan Generator (single prompt) ──

function buildCombinedSystemPrompt(matchCount: number): string {
  const totalCapital = matchCount * 1_000_000;
  const parlayStake = 50_000;
  const pairCount = (matchCount * (matchCount - 1)) / 2;
  const parlayBudget = parlayStake * (1 + pairCount + 1);
  const remaining = totalCapital - parlayBudget;
  const perMatchSingle = Math.floor(remaining / (matchCount * 2));

  return [
    "Bạn là chuyên gia phân tích odds và lên kế hoạch đặt cược bóng đá.",
    `Dưới đây là raw odds cho ${matchCount} trận đấu.`,
    "Chỉ dựa vào dữ liệu odds/correct score được cung cấp.",
    "Phân tích khách quan xu hướng odds, kèo đáng chú ý, rủi ro.",
    "Nếu không rõ edge thì nói Đứng ngoài.",
    "",
    "YÊU CẦU:",
    ...(PICKS_MARKET_SCOPE === "totals_only"
      ? [
          "QUAN TRỌNG - GIỚI HẠN KÈO CHỌN (topPicks):",
          "- topPicks CHỈ được chọn từ market Tài/Xỉu tổng bàn thắng: Tổng bàn châu Á" +
            " (asia_totals), Tổng bàn châu Âu (eu_totals), hoặc Kết quả + Tổng bàn" +
            " (result_total_goals).",
          "- KHÔNG chọn 1X2, Chấp châu Á, GG/NG, Bàn đội, Phạt góc (kể cả tổng góc)," +
            " hay bất kỳ market nào khác cho topPicks.",
          "- Nếu không thấy edge rõ ở market Tài/Xỉu cho 1 trận, để topPicks = [] cho trận đó," +
            " không chọn tạm market khác để lấp đầy.",
          "- Giới hạn này CHỈ áp dụng cho topPicks. Các chân trong parlays và" +
            " remainingSingles (xiên, tỉ số chính xác) vẫn áp dụng quy tắc chọn kèo như" +
            " mô tả bên dưới (không bị giới hạn tài/xỉu).",
          "",
        ]
      : []),
    "1. Phân tích từng trận: nhận định ngắn, tỉ số dự đoán, kèo nổi bật.",
    "2. Lên kế hoạch cược tổng thể với chiến lược vốn bên dưới.",
    "",
    "CHIẾN LƯỢC VỐN:",
    `- Tổng vốn: ${totalCapital.toLocaleString("vi-VN")}đ (${matchCount}tr × 1 triệu)` +
      ` - ${parlayStake.toLocaleString("vi-VN")}đ mỗi xiên`,
    `- Xiên all ${matchCount} trận + xiên 2 (${pairCount} tổ hợp) + xiên tỉ số`,
    `- Tổng xiên: ~${parlayBudget.toLocaleString("vi-VN")}đ`,
    `- Mỗi trận: 1 kèo main + 1 kèo tỉ số (${perMatchSingle.toLocaleString("vi-VN")}đ mỗi kèo)`,
    "",
    "QUY TẮC CHỌN KÈO CHO XIÊN:",
    "- Xiên ALL: chọn 1 kèo CHẮC NHẤT mỗi trận (GG/NG, Tài/Xỉu EU, 1X2 ngắn). Odds mỗi chân ~1.3–2.0.",
    "- Xiên 2: ghép 2 trận có cùng xu hướng (vd: cả 2 đội mạnh hơn đều thắng, hoặc cả 2 đều Under).",
    "- Xiên tỉ số: chọn tỉ số chính xác mỗi trận mà AI tự tin nhất.",
    "- Không ghép kèo Chấp Á mốc .25/.75 vào xiên (thanh toán nửa phức tạp).",
    "- Mỗi xiên 2 nên chọn kèo từ 2 trận KHÁC NHAU.",
    "- Chỉ ghép xiên khi edge rõ rệt từ odds.",
    "",
    "QUY TẮC KÈO ĐƠN:",
    "- Kèo main: odds > 1.80 (1X2, Châu Á, Tổng bàn, GG/NG).",
    "- Kèo tỉ số chính xác: odds > 3.0.",
    "- Chỉ chọn khi odds cho thấy edge rõ.",
    "",
    "HƯỚNG DẪN CHỌN KÈO XIÊN (PARLAY):",
    "- Kèo xiên cần odds trung bình ~1.5–2.5 mỗi chân, không quá thấp (dưới 1.3) cũng không quá cao (trên 4.0).",
    "- Ưu tiên: 1X2 (Home/Draw/Away), GG/NG, Tài/Xỉu (EU mốc .5) vì dễ ghép và thanh toán đơn giản.",
    "- Tránh kèo Chấp Á .25/.75 cho xiên vì thanh toán nửa/nửa phức tạp.",
    "- Có thể gợi ý ghép cùng cửa (ví dụ: all Home thắng) hoặc ngược cửa (mix) qua parlayNote.",
    "- Kèo 'đơn' phù hợp khi odds cao (≥3.0) hoặc tỉ số chính xác (cược riêng, không ghép xiên).",
    "",
    "Nếu có thể, thêm parlayNote gợi ý ghép: 'Ghép với [trận] cửa [X]'.",
    "Không cần tự validate lại qua model khác. Không tự bịa dữ liệu ngoài input.",
    "Tất cả field text bằng tiếng Việt có dấu, ngắn gọn, không markdown, không URL.",
  ].join("\n");
}

function buildCombinedUserPrompt(payloads: MatchOddsPayload[]): string {
  const matchBlocks = payloads.map((payload, i) => {
    const kickoff = new Date(payload.kickoffUnix * 1000).toLocaleString(
      "vi-VN",
      {
        timeZone: "Asia/Ho_Chi_Minh",
        weekday: "short",
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      },
    );
    const oddsText = formatOddsAnalysisInput(payload);
    return [
      `=== TRẬN ${i + 1}: ${payload.home} vs ${payload.away} (${kickoff}) ===`,
      oddsText,
    ].join("\n");
  });

  return [
    ...matchBlocks,
    "",
    "YÊU CẦU:",
    "Trả JSON duy nhất theo schema bên dưới.",
    "Mỗi match trong matches cần có matchIndex, matchLabel, kickoff, analysis, preferredScoreline, scoreConfidence, topPicks, keyPoints, risks.",
    PICKS_MARKET_SCOPE === "totals_only"
      ? "topPicks mỗi trận tối đa 3 kèo nổi bật, CHỈ market Tài/Xỉu tổng bàn thắng" +
        " (Tổng bàn châu Á / Tổng bàn châu Âu / KQ+Tổng), mỗi pick gồm market, selection," +
        " odds, suitability, reason."
      : "topPicks mỗi trận tối đa 3 kèo nổi bật, mỗi pick gồm market, selection, odds, suitability, reason.",
    "Nếu không có kèo rõ, topPicks là [].",
    "parlays và remainingSingles tuân theo cấu trúc BettingPlan (xiên + đơn).",
    "Đảm bảo tổng stake ≤ tổng vốn.",
    "```json",
    JSON.stringify(
      {
        summary: "Tổng quan các trận...",
        matches: [
          {
            matchIndex: 0,
            matchLabel: "Portugal vs Croatia",
            kickoff: "Th 6 03/07 06:00",
            analysis: "Phân tích ngắn 1-2 câu",
            preferredScoreline: "2-1",
            scoreConfidence: 55,
            topPicks: [
              {
                market: "Tổng bàn châu Âu",
                selection: "Tài 2.5",
                odds: 1.85,
                suitability: "single",
                reason: "lý do ngắn",
              },
            ],
            keyPoints: ["điểm 1", "điểm 2"],
            risks: ["rủi ro 1"],
          },
        ],
        parlays: [
          {
            type: "xiên 3",
            legs: [
              {
                matchIndex: 0,
                matchLabel: "Portugal vs Croatia",
                pick: {
                  market: "GG/NG",
                  selection: "NG",
                  odds: 1.62,
                  reason: "ngắn",
                },
              },
            ],
            combinedOdds: 4.5,
            stake: 50000,
            potentialWin: 225000,
          },
        ],
        remainingSingles: [
          {
            matchIndex: 0,
            matchLabel: "Portugal vs Croatia",
            betType: "Tỷ số chính xác",
            pick: {
              market: "Tỷ số chính xác",
              selection: "2-0",
              odds: 6.5,
              reason: "ngắn",
            },
            stake: 800000,
            potentialWin: 5200000,
          },
        ],
      },
      null,
      2,
    ),
    "```",
    "combinedOdds = tích odds các chân trong xiên. stake = tiền đặt. potentialWin = stake * combinedOdds.",
    "Nếu không có đủ kèo tốt thì parlays hoặc remainingSingles có thể là mảng rỗng.",
  ].join("\n");
}

function filterTopPicksToTotalsOnly(
  matches: CombinedAnalysisPlanMatch[],
): CombinedAnalysisPlanMatch[] {
  if (PICKS_MARKET_SCOPE !== "totals_only") return matches;

  return matches.map((match) => {
    const originalPicks = Array.isArray(match.topPicks) ? match.topPicks : [];
    const filteredPicks = originalPicks.filter((pick) =>
      isTotalsGoalsMarketText(String(pick.market ?? "")),
    );

    const removedCount = originalPicks.length - filteredPicks.length;
    if (removedCount > 0) {
      const removedMarkets = originalPicks
        .filter((pick) => !isTotalsGoalsMarketText(String(pick.market ?? "")))
        .map((pick) => `${pick.market}/${pick.selection}`)
        .join(", ");
      logger.warn(
        `  ! Loại bỏ ${removedCount} pick không phải Tài/Xỉu ở "${match.matchLabel}": ${removedMarkets}`,
      );
    }

    return { ...match, topPicks: filteredPicks };
  });
}

function parseCombinedAnalysisResponse(
  text: string,
  _payloads: MatchOddsPayload[],
): CombinedAnalysisPlan | null {
  try {
    const cleaned = extractJsonObject(text);
    const parsed = JSON.parse(cleaned) as Partial<CombinedAnalysisPlan>;

    if (!Array.isArray(parsed.matches) || parsed.matches.length === 0) {
      logger.warn(
        `  ! Combined analysis parse failed: matches array missing or empty`,
      );
      return null;
    }

    for (const match of parsed.matches) {
      if (
        typeof match.matchIndex !== "number" ||
        typeof match.analysis !== "string" ||
        !Array.isArray(match.topPicks)
      ) {
        logger.warn(
          `  ! Combined analysis parse failed: match missing required fields (matchIndex, analysis, topPicks)`,
        );
        return null;
      }
    }

    return {
      summary: parsed.summary ?? "",
      matches: filterTopPicksToTotalsOnly(parsed.matches),
      parlays: Array.isArray(parsed.parlays) ? parsed.parlays : [],
      remainingSingles: Array.isArray(parsed.remainingSingles)
        ? parsed.remainingSingles
        : [],
    };
  } catch (err) {
    logger.warn(
      `  ! Combined analysis parse error: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

export async function generateCombinedAnalysis(
  payloads: MatchOddsPayload[],
): Promise<CombinedAnalysisPlan | null> {
  if (payloads.length === 0) return null;
  const startedAt = Date.now();

  const primaryRequest: OpenRouterRequest = {
    model: ANALYZE_MODEL,
    systemPrompt: buildCombinedSystemPrompt(payloads.length),
    userContent: [{ type: "text", text: buildCombinedUserPrompt(payloads) }],
    maxTokens: COMBINED_TOKENS,
    temperature: 0.3,
    responseFormat: { type: "json_object" },
    timeoutMs: COMBINED_TIMEOUT_MS,
    reasoning: { effort: getConfiguredReasoningEffort("medium") },
    plugins: [{ id: "web", max_results: ANALYZE_WEB_RESULTS }],
  };

  const fallbackRequest: OpenRouterRequest = {
    ...primaryRequest,
    model: PLAN_FALLBACK_MODEL,
    plugins: undefined,
  };

  try {
    const { response, requestCount } = await callOpenRouterWithCount(
      primaryRequest,
      isRetryableError,
    );
    const latencyMs = Date.now() - startedAt;
    logStageMetrics(
      "combined",
      payloads[0],
      primaryRequest.model,
      latencyMs,
      response,
      requestCount,
      false,
    );
    recordStageUsage("combined", response, primaryRequest.model, {
      latencyMs,
      requestCount,
      fallbackUsed: false,
      timeoutMs: COMBINED_TIMEOUT_MS,
      finishReason: response.finishReason ?? "stop",
    });

    if (response.finishReason === "length") {
      logger.warn(
        `  ! Combined analysis truncated (finish_reason=length, ${response.usage.completionTokens} tokens) for ${payloads[0].home} vs ${payloads[0].away}; trying fallback model`,
      );
      throw Object.assign(
        new Error(
          `combined response truncated (finish_reason=length, ${response.usage.completionTokens} tokens)`,
        ),
        {
          requestCount,
          forceFallback: true,
        },
      );
    }

    const plan = parseCombinedAnalysisResponse(response.text, payloads);
    if (!plan) {
      logger.warn(
        `  ! Combined analysis parse failed for primary. Raw (first 1000): ${response.text.slice(0, 1000)}`,
      );
    }
    return plan;
  } catch (primaryError) {
    const forcedFallback =
      (primaryError as Error & { forceFallback?: boolean }).forceFallback ===
      true;
    if (!forcedFallback && !isProFallbackTrigger(primaryError)) {
      logger.warn(
        `  ! Combined analysis primary model failed (non-retryable): ${primaryError instanceof Error ? primaryError.message : String(primaryError)}`,
      );
      return null;
    }

    logger.warn(
      `  ! Primary combined analysis model failed, trying fallback: ${primaryError instanceof Error ? primaryError.message : String(primaryError)}`,
    );

    const primaryRequestCount = Number(
      (primaryError as Error & { requestCount?: number }).requestCount ?? 0,
    );

    try {
      const { response, requestCount } = await callOpenRouterWithCount(
        fallbackRequest,
        isRetryableError,
      );
      const totalRequestCount = primaryRequestCount + requestCount;
      const latencyMs = Date.now() - startedAt;
      logStageMetrics(
        "combined",
        payloads[0],
        fallbackRequest.model,
        latencyMs,
        response,
        totalRequestCount,
        true,
      );
      recordStageUsage("combined", response, fallbackRequest.model, {
        latencyMs,
        requestCount: totalRequestCount,
        fallbackUsed: true,
        timeoutMs: COMBINED_TIMEOUT_MS,
        finishReason: response.finishReason ?? "stop",
      });

      if (response.finishReason === "length") {
        logger.warn(
          `  ! Combined analysis truncated (finish_reason=length, ${response.usage.completionTokens} tokens) for fallback model ${fallbackRequest.model}; giving up`,
        );
        return null;
      }

      const plan = parseCombinedAnalysisResponse(response.text, payloads);
      if (!plan) {
        logger.warn(
          `  ! Combined analysis parse failed for fallback. Raw (first 1000): ${response.text.slice(0, 1000)}`,
        );
      }
      return plan;
    } catch (error) {
      logger.warn(
        `  ! Combined analysis generation failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }
}
