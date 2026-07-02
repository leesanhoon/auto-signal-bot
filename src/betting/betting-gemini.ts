import { withRetry } from "../shared/retry.js";
import type { MatchAiAnalysis, MatchOddsPayload } from "./betting-types.js";
import { formatOddsAnalysisInput } from "./odds-text-format.js";
import { createLogger } from "../shared/logger.js";
import { recordOpenRouterUsage } from "../shared/ai-usage.js";
import { callOpenRouter } from "../shared/openrouter.js";

const logger = createLogger("betting:betting-ai");
const MODEL = process.env.AI_TEXT_MODEL?.trim() || "deepseek/deepseek-v4-flash";
const VERIFY_MODEL =
  process.env.AI_VERIFY_MODEL?.trim() || "moonshotai/kimi-k2.6";

const SYSTEM_PROMPT = `Bạn là chuyên gia đọc odds bóng đá. Có thể dùng web search để tra cứu phong độ, chấn thương, tin tức mới nhất của các đội để hỗ trợ phân tích.

Mục tiêu: tìm và xếp hạng các kèo nên cân nhắc có odds >1.80.

Cách làm:
1. Đọc đúng H=chủ nhà, A=đội khách, D=hòa, O=tài, U=xỉu, GG=hai đội ghi bàn, NG=không.
2. Dấu handicap sau H/A là handicap thật của chính đội đó; tuyệt đối không đảo dấu.
3. Đối chiếu market: 1X2 với handicap; totals với GG/NG và team goals; corners 1X2 với corners handicap/totals; correct_score_top chỉ hỗ trợ kịch bản.
4. Chọn tối đa 3 kèo ĐƠN có odds >1.80, xếp từ mạnh đến yếu. Chỉ chọn kèo được ít nhất 2 tín hiệu cùng market hỗ trợ và không có mâu thuẫn lớn.
5. Không ghép xiên. Không bảo đảm thắng. Nếu không có lựa chọn đạt điều kiện, ghi rõ "Đứng ngoài".

Quy tắc output:
- Tất cả field dạng text phải viết tiếng Việt có dấu, ngắn gọn, không markdown; không viết không dấu kiểu "Dung ngoai", "Khong co", "Nhan dinh".
- recommendation: danh sách ngắn dạng "1) Kèo @odds; 2) Kèo @odds". Odds phải tồn tại chính xác trong snapshot.
- confidence: độ tin cậy chung của danh sách, 0-100; không hạ confidence chỉ vì odds >=1.80.
- preferredScoreline là một tỷ số tham khảo phù hợp các kèo bàn thắng.
- keyPoints gồm đúng 2 bằng chứng odds quan trọng nhất; risks gồm đúng 2 mâu thuẫn/rủi ro.
- Không gọi chênh lệch odds là value chắc chắn; chỉ gọi là tín hiệu phù hợp.

Trả duy nhất JSON: {"match":string,"preferredScoreline":string,"scoreConfidence":number,"recommendation":string,"confidence":number,"picks":[{"market":string,"selection":string,"odds":number}],"marketViews":[{"market":string,"assessment":string,"odds":number|null}],"keyPoints":string[2],"risks":string[2],"summary":string}.
Mỗi pick phải là một kèo trong recommendation; market là tên ngắn như "Chấp Châu Á", "Tài/Xỉu", "GG/NG", "1X2", "Phạt góc".
marketViews phải tóm tắt 4-5 nhóm nếu có dữ liệu: "Chấp Châu Á", "GG/NG", "Tổng bàn", "Tỷ số", "Phạt góc". assessment ngắn gọn; odds là giá của lựa chọn được nhắc, hoặc null nếu không có hướng rõ. marketViews vẫn phải có khi picks rỗng.
Viết tiếng Việt có dấu, ngắn gọn, không markdown.`;

const VERIFY_PROMPT = `Bạn thẩm định độc lập danh sách kèo từ snapshot odds và có thể dùng web search để kiểm tra thông tin thực tế (phong độ, chấn thương).
Xác nhận khi tất cả điều sau đúng:
1. Mỗi kèo đề xuất có odds >1.80 và odds khớp chính xác snapshot.
2. Không sai side, sai dấu handicap, nhầm kèo bàn thắng với kèo corners, hoặc ghép xiên.
3. Mỗi kèo có ít nhất 2 tín hiệu liên quan hỗ trợ, không mâu thuẫn lớn với market đối chiếu.
4. Tối đa 3 kèo và confidence không overclaim.
Bác bỏ nếu chỉ vì odds cao mà chọn, odds/line không tồn tại, hoặc logic market mâu thuẫn.
Tất cả field dạng text phải viết tiếng Việt có dấu; không dùng tiếng Việt không dấu.
Trả duy nhất JSON {"confirmed":boolean,"confidence":number,"comment":string}; comment một câu ngắn, nếu bác bỏ chỉ rõ kèo và lỗi quan trọng nhất.`;

const REVISE_PROMPT = `Sửa danh sách kèo bị bác bỏ, dùng snapshot, lý do thẩm định, và có thể dùng web search để tra cứu thông tin bổ sung.
Loại kèo sai thay vì bắt buộc chọn kèo ngược lại. Danh sách mới tối đa 3 kèo đơn, mỗi kèo odds >1.80, odds/line phải tồn tại trong snapshot và có ít nhất 2 tín hiệu hỗ trợ.
Nếu không còn kèo đạt điều kiện, recommendation là "Đứng ngoài".
Kết quả phải là một phân tích độc lập cho người dùng: không nhắc đến bước verify/thẩm định, nhận định cũ, việc bị bác bỏ, hay lỗi của vòng trước trong bất kỳ field nào.
Tất cả field dạng text phải viết tiếng Việt có dấu; không dùng tiếng Việt không dấu.
Trả duy nhất JSON cùng schema phân tích: match, preferredScoreline, scoreConfidence, recommendation, confidence, picks, marketViews, keyPoints[2], risks[2], summary. Nếu đứng ngoài thì picks là mảng rỗng nhưng marketViews vẫn tóm tắt 4-5 nhóm thị trường. Viết ngắn gọn.`;

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
function sanitizeStringList(value: unknown, fallback: string): string[] {
  if (!Array.isArray(value)) return [fallback];
  const items = value
    .map((item) => String(item).trim())
    .filter(Boolean)
    .slice(0, 2);
  return items.length > 0 ? items : [fallback];
}

function sanitizePicks(value: unknown): MatchAiAnalysis["picks"] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const candidate = item as {
        market?: unknown;
        selection?: unknown;
        odds?: unknown;
      };
      const market = String(candidate.market ?? "").trim();
      const selection = String(candidate.selection ?? "").trim();
      const odds = Number(candidate.odds);
      return market && selection && Number.isFinite(odds) && odds > 0
        ? { market, selection, odds }
        : null;
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .slice(0, 3);
}

function sanitizeMarketViews(value: unknown): MatchAiAnalysis["marketViews"] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const candidate = item as {
        market?: unknown;
        assessment?: unknown;
        odds?: unknown;
      };
      const market = String(candidate.market ?? "").trim();
      const assessment = String(candidate.assessment ?? "").trim();
      const parsedOdds =
        candidate.odds === null ||
        candidate.odds === undefined ||
        candidate.odds === ""
          ? null
          : Number(candidate.odds);
      if (
        !market ||
        !assessment ||
        (parsedOdds !== null &&
          (!Number.isFinite(parsedOdds) || parsedOdds <= 0))
      ) {
        return null;
      }
      return { market, assessment, odds: parsedOdds };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .slice(0, 5);
}

function parseVerificationResponse(
  text: string,
): { confirmed: boolean; confidence: number; comment: string } | null {
  try {
    const parsed = JSON.parse(extractJsonObject(text)) as {
      confirmed?: unknown;
      confidence?: unknown;
      comment?: unknown;
    };
    return {
      confirmed: Boolean(parsed.confirmed),
      confidence: clampConfidence(parsed.confidence),
      comment: String(parsed.comment || ""),
    };
  } catch {
    return null;
  }
}

function buildFallbackRevisedAnalysis(
  payload: MatchOddsPayload,
  original: MatchAiAnalysis,
  rejectionComment: string,
): MatchAiAnalysis {
  const shortReason =
    rejectionComment.trim() ||
    "Nhận định trước đó không vượt qua bước thẩm định.";
  const trimmedReason =
    shortReason.length > 160 ? `${shortReason.slice(0, 157)}...` : shortReason;
  return {
    match: `${payload.home} vs ${payload.away}`,
    preferredScoreline: original.preferredScoreline || "1-1",
    scoreConfidence: Math.min(original.scoreConfidence || 0, 45),
    recommendation: "Không có edge rõ ràng, nên đứng ngoài và theo dõi thêm.",
    confidence: Math.min(original.confidence || 0, 45),
    keyPoints: [
      "Bước thẩm định độc lập đã bác bỏ nhận định ban đầu.",
      "Odds hiện tại chưa cho thấy một edge rõ ràng để vào kèo.",
      "Ưu tiên kỷ luật và chờ thêm dữ liệu trước khi hành động.",
    ],
    risks: [
      trimmedReason,
      "Nhận định thay thế được hạ mức tin cậy để tránh overclaim.",
      "Thị trường hiện tại có thể đang cân bằng hoặc xung đột giữa các market.",
    ],
    summary:
      "Nhận định gốc bị từ chối trong bước thẩm định độc lập. Bản thay thế này chuyển sang góc nhìn bảo thủ vì odds chưa cho edge rõ ràng.",
  };
}

export function parseMatchAnalysisResponse(
  text: string,
  payload: MatchOddsPayload,
): MatchAiAnalysis | null {
  try {
    const parsed = JSON.parse(
      extractJsonObject(text),
    ) as Partial<MatchAiAnalysis>;
    const confidence = clampConfidence(parsed.confidence);
    return {
      match: String(parsed.match || `${payload.home} vs ${payload.away}`),
      preferredScoreline: String(
        parsed.preferredScoreline || "Chưa có tỷ số ưu tiên",
      ),
      scoreConfidence: clampConfidence(parsed.scoreConfidence),
      recommendation: String(parsed.recommendation || "Đứng ngoài."),
      confidence,
      picks: sanitizePicks(parsed.picks),
      marketViews: sanitizeMarketViews(parsed.marketViews),
      keyPoints: sanitizeStringList(
        parsed.keyPoints,
        "Không tách được các điểm odds nổi bật.",
      ),
      risks: sanitizeStringList(
        parsed.risks,
        "Cẩn thận vì dữ liệu odds chưa cho thấy một edge rõ ràng.",
      ),
      summary: String(
        parsed.summary || "Không có đủ thông tin để rút ra kết luận ổn định.",
      ),
    };
  } catch {
    return null;
  }
}

export async function analyzeMatchOdds(
  payload: MatchOddsPayload,
): Promise<MatchAiAnalysis> {
  const oddsText = formatOddsAnalysisInput(payload);
  const response = await withRetry(
    () =>
      callOpenRouter({
        model: MODEL,
        systemPrompt: SYSTEM_PROMPT,
        userContent: [
          {
            type: "text",
            text: `match=${payload.home} vs ${payload.away}\nkickoff=${payload.kickoffUnix}\n${oddsText}`,
          },
        ],
        maxTokens: 8000,
        temperature: 0.2,
        responseFormat: { type: "json_object" },
        reasoning: { effort: "low", exclude: true },
        plugins: [{ id: "web", max_results: 5 }],
      }),
    {
      onRetry: (error, attempt, maxAttempts, delayMs) =>
        logger.warn(
          `  ! OpenRouter match analysis temporary error for ${payload.home} vs ${payload.away} (${attempt}/${maxAttempts}), retrying in ${delayMs}ms: ${error instanceof Error ? error.message : error}`,
        ),
    },
  );
  void recordOpenRouterUsage(response, { model: MODEL, source: "betting" });
  const parsed = parseMatchAnalysisResponse(response.text, payload);
  if (!parsed)
    throw new Error(
      `OpenRouter parse failed. Raw: ${response.text.slice(0, 300)}`,
    );
  return parsed;
}

export async function verifyMatchAnalysis(
  payload: MatchOddsPayload,
  analysis: MatchAiAnalysis,
): Promise<{ confirmed: boolean; confidence: number; comment: string }> {
  const oddsText = formatOddsAnalysisInput(payload);
  const verifyInput = {
    preferredScoreline: analysis.preferredScoreline,
    scoreConfidence: analysis.scoreConfidence,
    recommendation: analysis.recommendation,
    confidence: analysis.confidence,
    keyPoints: analysis.keyPoints,
    risks: analysis.risks,
    picks: analysis.picks ?? [],
    marketViews: analysis.marketViews ?? [],
  };
  const response = await withRetry(
    () =>
      callOpenRouter({
        model: VERIFY_MODEL,
        systemPrompt: VERIFY_PROMPT,
        userContent: [
          {
            type: "text",
            text: `${oddsText}\nanalysis=${JSON.stringify(verifyInput)}`,
          },
        ],
        maxTokens: 4000,
        temperature: 0.2,
        responseFormat: { type: "json_object" },
        reasoning: { effort: "none", exclude: true },
        plugins: [{ id: "web", max_results: 5 }],
      }),
    {
      onRetry: (error, attempt, maxAttempts, delayMs) =>
        logger.warn(
          `  ! OpenRouter match verify temporary error for ${payload.home} vs ${payload.away} (${attempt}/${maxAttempts}), retrying in ${delayMs}ms: ${error instanceof Error ? error.message : error}`,
        ),
    },
  );
  void recordOpenRouterUsage(response, {
    model: VERIFY_MODEL,
    source: "betting",
  });
  const parsed = parseVerificationResponse(response.text);
  if (!parsed) {
    throw new Error(
      `OpenRouter verify parse failed. Raw: ${response.text.slice(0, 300)}`,
    );
  }
  return parsed;
}

export async function reviseMatchAnalysis(
  payload: MatchOddsPayload,
  original: MatchAiAnalysis,
  rejectionComment: string,
): Promise<MatchAiAnalysis> {
  const oddsText = formatOddsAnalysisInput(payload);
  const originalInput = {
    preferredScoreline: original.preferredScoreline,
    scoreConfidence: original.scoreConfidence,
    recommendation: original.recommendation,
    confidence: original.confidence,
    picks: original.picks ?? [],
    marketViews: original.marketViews ?? [],
  };
  const response = await withRetry(
    () =>
      callOpenRouter({
        model: VERIFY_MODEL,
        systemPrompt: REVISE_PROMPT,
        userContent: [
          {
            type: "text",
            text: `${oddsText}\nrejected=${JSON.stringify(originalInput)}\nreason=${rejectionComment}`,
          },
        ],
        maxTokens: 4000,
        temperature: 0.2,
        responseFormat: { type: "json_object" },
        reasoning: { effort: "none", exclude: true },
        plugins: [{ id: "web", max_results: 5 }],
      }),
    {
      onRetry: (error, attempt, maxAttempts, delayMs) =>
        logger.warn(
          `  ! OpenRouter match revise temporary error for ${payload.home} vs ${payload.away} (${attempt}/${maxAttempts}), retrying in ${delayMs}ms: ${error instanceof Error ? error.message : error}`,
        ),
    },
  );
  void recordOpenRouterUsage(response, {
    model: VERIFY_MODEL,
    source: "betting",
  });
  const parsed = parseMatchAnalysisResponse(response.text, payload);
  if (!parsed) {
    logger.warn(
      `  ! OpenRouter revise parse failed for ${payload.home} vs ${payload.away}; using conservative fallback`,
    );
    return buildFallbackRevisedAnalysis(payload, original, rejectionComment);
  }
  return parsed;
}
