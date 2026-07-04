import { withRetry, isRetryableError, getErrorField, getStatusCode } from "../shared/retry.js";
import type {
  CombinedAnalysisPlan,
  CombinedAnalysisPlanMatch,
  MatchAiAnalysis,
  MatchOddsPayload,
  TotalGoalsPick,
  PredictedScore,
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
const MIN_PICK_ODDS = parsePositiveEnv("BETTING_MIN_PICK_ODDS", 1.8);
const ANALYZE_WEB_RESULTS = 3;
const MAX_ANALYZE_TOKENS = 1_400;

type RequestRunResult = {
  response: Awaited<ReturnType<typeof callOpenRouter>>;
  usedFallback: boolean;
  model: string;
  requestCount: number;
};

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



export function findMissingMatchIndexesForTest(
  matches: CombinedAnalysisPlanMatch[],
  payloadCount: number,
): number[] {
  return findMissingMatchIndexes(matches, payloadCount);
}

export function normalizeCombinedMatchForTest(
  match: Partial<CombinedAnalysisPlanMatch>,
  fallbackLabel: string,
): CombinedAnalysisPlanMatch {
  return normalizeCombinedMatch(match, fallbackLabel);
}

// ── Combined Analysis + Plan Generator (single prompt) ──

const COMBINED_TIMEOUT_MS = parsePositiveEnv(
  "BETTING_AI_COMBINED_TIMEOUT_MS",
  240_000,
);
const COMBINED_TOKENS = 5_000;

// ── Combined Analysis + Plan Generator (single prompt) ──

export function buildCombinedSystemPrompt(): string {
  return [
    "Bạn là chuyên gia phân tích odds bóng đá.",
    "Dưới đây là raw odds cho các trận đấu, kèm theo dữ liệu ngữ cảnh trận đấu (phong độ, so sánh đội, dự đoán).",
    "Kết hợp dữ liệu odds VÀ ngữ cảnh trận đấu để phân tích. Nếu không có dữ liệu ngữ cảnh, chỉ dựa vào odds.",
    "",
    "YÊU CẦU cho MỖI trận:",
    "1. Xem xét TẤT CẢ market có trong dữ liệu (asia_handicap, asia_totals, eu_totals, result_total_goals, btts, team_goals, corners, v.v., không giới hạn).",
    "2. Chọn ra các kèo có EDGE rõ ràng và odds hợp lý (không chọn lấy lệ để có nhiều kèo).",
    "   - Chỉ đề xuất kèo có odds > 1.8 (không lấy kèo odds thấp dù tỉ lệ thắng cao — ưu tiên kèo vừa có xác suất thắng tốt vừa có odds > 1.8).",
    "   - Mỗi kèo gồm: market (tên đúng theo dữ liệu, vd 'asia_handicap'), selection (lựa chọn, vd 'H+0.75'), odds (giá cược), confidence (0-100, xác suất thắng ước tính).",
    "   - Viết reason cụ thể: vì sao nên chơi kèo này (phong độ, chênh lệch đội, xu hướng, odds giá tốt, v.v.).",
    "   - QUAN TRỌNG: xếp hạng picks theo confidence giảm dần (kèo tin cậy nhất đầu tiên).",
    "   - Nếu không có kèo nào đủ tin cậy (edge không rõ ràng) → trả picks = [] (mảng rỗng = đứng ngoài).",
    "3. Dự đoán tỉ số chính xác (predictedScore) kèm % tự tin (0-100), dựa trên odds correct score và các market khác.",
    "4. (tuỳ chọn) 1 câu note ngắn nếu có điểm đáng chú ý khác.",
    "",
    "Không cần lên kế hoạch cược, không xiên, không kèo đơn, không chiến lược vốn.",
    "Không tự bịa dữ liệu ngoài input. Tất cả field text tiếng Việt có dấu, ngắn gọn, không markdown, không URL.",
  ].join("\n");
}

export function buildCombinedUserPrompt(payloads: MatchOddsPayload[]): string {
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
    `QUAN TRỌNG: mảng "matches" PHẢI có ĐÚNG ${payloads.length} phần tử, mỗi phần tử ứng với 1 trận theo matchIndex từ 0 đến ${payloads.length - 1}. KHÔNG được bỏ sót trận nào — nếu không có edge, picks = [] (mảng rỗng) nhưng vẫn phải có phần tử cho trận đó với predictedScore.`,
    "```json",
    JSON.stringify(
      {
        summary: "Tổng quan ngắn tất cả trận",
        matches: [
          {
            matchIndex: 0,
            matchLabel: "Portugal vs Croatia",
            kickoff: "Th 6 03/07 06:00",
            picks: [
              {
                market: "asia_handicap",
                selection: "H+0.5",
                odds: 1.92,
                confidence: 75,
                reason: "Đội nhà thắng 5 trận liên tiếp, phòng ngự mạnh, odds hợp lý",
              },
              {
                market: "eu_totals",
                selection: "Over 2.5",
                odds: 1.85,
                confidence: 65,
                reason: "Cả 2 đội ghi bàn trung bình cao, lịch sử đối đầu >2.5 bàn 80%",
              },
            ],
            predictedScore: { score: "2-1", confidence: 55 },
            note: "ghi chú ngắn optional",
          },
        ],
      },
      null,
      2,
    ),
    "```",
  ].join("\n");
}

function normalizeCombinedMatch(
  match: Partial<CombinedAnalysisPlanMatch>,
  fallbackLabel: string,
): CombinedAnalysisPlanMatch {
  // Parse picks array
  const picksRaw = match.picks as any;
  let picks: Array<{
    market: string;
    selection: string;
    odds: number;
    confidence: number;
    reason?: string;
  }> = [];

  if (Array.isArray(picksRaw)) {
    picks = picksRaw
      .map((pick: any) => {
        if (typeof pick !== "object") return null;
        const market = toText(pick.market);
        const selection = toText(pick.selection);
        const odds = Number(pick.odds);
        const confidence = clampConfidence(pick.confidence);
        if (market && selection && Number.isFinite(odds) && odds > MIN_PICK_ODDS) {
          return {
            market,
            selection,
            odds,
            confidence,
            reason: toText(pick.reason) || undefined,
          };
        }
        return null;
      })
      .filter((p): p is any => p !== null);
  }

  const predictedScoreRaw = match.predictedScore as any;
  let predictedScore: PredictedScore = { score: "Chưa dự đoán", confidence: 0 };
  if (predictedScoreRaw && typeof predictedScoreRaw === "object") {
    const score = toText(predictedScoreRaw.score, "Chưa dự đoán");
    const confidence = clampConfidence(predictedScoreRaw.confidence);
    predictedScore = { score, confidence };
  }

  return {
    matchIndex: match.matchIndex as number,
    matchLabel: toText(match.matchLabel, fallbackLabel),
    kickoff: toText(match.kickoff, ""),
    handicapPick: null,
    totalGoalsPick: null,
    picks,
    predictedScore,
    note: toText(match.note) || undefined,
  };
}

function findMissingMatchIndexes(
  matches: CombinedAnalysisPlanMatch[],
  payloadCount: number,
): number[] {
  if (payloadCount === 0) return [];

  const presentIndexes = new Set<number>();
  for (const match of matches) {
    if (typeof match.matchIndex === "number") {
      presentIndexes.add(match.matchIndex);
    }
  }

  const missing: number[] = [];
  for (let i = 0; i < payloadCount; i++) {
    if (!presentIndexes.has(i)) {
      missing.push(i);
    }
  }

  return missing;
}


function parseCombinedAnalysisResponse(
  text: string,
  payloads: MatchOddsPayload[],
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
        !match.predictedScore ||
        typeof match.predictedScore !== "object"
      ) {
        logger.warn(
          `  ! Combined analysis parse failed: match missing required fields (matchIndex, predictedScore)`,
        );
        return null;
      }
    }

    const normalizedMatches = parsed.matches.map((m) =>
      normalizeCombinedMatch(m, "Trận " + m.matchIndex),
    );

    const missingIndexes = findMissingMatchIndexes(normalizedMatches, payloads.length);
    if (missingIndexes.length > 0) {
      logger.warn(
        `  ! Combined analysis parse failed: missing match indexes: ${missingIndexes.join(", ")}`,
      );
      return null;
    }

    return {
      summary: parsed.summary ?? "",
      matches: normalizedMatches,
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
    systemPrompt: buildCombinedSystemPrompt(),
    userContent: [{ type: "text", text: buildCombinedUserPrompt(payloads) }],
    maxTokens: COMBINED_TOKENS,
    temperature: 0.3,
    responseFormat: { type: "json_object" },
    timeoutMs: COMBINED_TIMEOUT_MS,
    reasoning: { effort: getConfiguredReasoningEffort("medium") },
    plugins: [{ id: "web", max_results: 3 }],
  };

  const fallbackRequest: OpenRouterRequest = {
    ...primaryRequest,
    model: FALLBACK_MODEL,
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