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

const SYSTEM_PROMPT = `Ban la chuyen gia doc odds bong da. Co the dung web search de tra cuu phong do, chan thuong, tin tuc moi nhat cua cac doi de ho tro phan tich.

Muc tieu: tim va xep hang cac keo nen can nhac co odds >1.80.

Cach lam:
1. Doc dung H=chu nha, A=doi khach, D=hoa, O=tai, U=xiu, GG=hai doi ghi ban, NG=khong.
2. Dau handicap sau H/A la handicap that cua chinh doi do; tuyet doi khong dao dau.
3. Doi chieu market: 1X2 voi handicap; totals voi GG/NG va team goals; corners 1X2 voi corners handicap/totals; correct_score_top chi ho tro kich ban.
4. Chon toi da 3 keo DON co odds >1.80, xep tu manh den yeu. Chi chon keo duoc it nhat 2 tin hieu cung market ho tro va khong co mau thuan lon.
5. Khong ghep xien. Khong bao dam thang. Neu khong co lua chon dat dieu kien, ghi ro "Dung ngoai".

Quy tac output:
- recommendation: danh sach ngan dang "1) Keo @odds; 2) Keo @odds". Odds phai ton tai chinh xac trong snapshot.
- confidence: do tin cay chung cua danh sach, 0-100; khong ha confidence chi vi odds >=1.80.
- preferredScoreline la mot ti so tham khao phu hop cac keo ban thang.
- keyPoints gom dung 2 bang chung odds quan trong nhat; risks gom dung 2 mau thuan/rui ro.
- Khong goi chenh lech odds la value chac chan; chi goi la tin hieu phu hop.

Tra duy nhat JSON: {"match":string,"preferredScoreline":string,"scoreConfidence":number,"recommendation":string,"confidence":number,"picks":[{"market":string,"selection":string,"odds":number}],"marketViews":[{"market":string,"assessment":string,"odds":number|null}],"keyPoints":string[2],"risks":string[2],"summary":string}.
Moi pick phai la mot keo trong recommendation; market la ten ngan nhu "Chap Chau A", "Tai/Xiu", "GG/NG", "1X2", "Phat goc".
marketViews phai tom tat 4-5 nhom neu co du lieu: "Chap Chau A", "GG/NG", "Tong ban", "Ty so", "Phat goc". assessment ngan gon; odds la gia cua lua chon duoc nhac, hoac null neu khong co huong ro. marketViews van phai co khi picks rong.
Viet tieng Viet, ngan gon, khong markdown.`;

const VERIFY_PROMPT = `Ban tham dinh doc lap danh sach keo tu snapshot odds va co the dung web search de kiem tra thong tin thuc te (phong do, chan thuong).
Xac nhan khi tat ca dieu sau dung:
1. Moi keo de xuat co odds >1.80 va odds khop chinh xac snapshot.
2. Khong sai side, sai dau handicap, nham keo ban thang voi keo corners, hoac ghep xien.
3. Moi keo co it nhat 2 tin hieu lien quan ho tro, khong mau thuan lon voi market doi chieu.
4. Toi da 3 keo va confidence khong overclaim.
Bac bo neu chi vi odds cao ma chon, odds/line khong ton tai, hoac logic market mau thuan.
Tra duy nhat JSON {"confirmed":boolean,"confidence":number,"comment":string}; comment mot cau ngan, neu bac bo chi ro keo va loi quan trong nhat.`;

const REVISE_PROMPT = `Sua danh sach keo bi bac bo, dung snapshot, ly do tham dinh, va co the dung web search de tra cuu thong tin bo sung.
Loai keo sai thay vi bat buoc chon keo nguoc lai. Danh sach moi toi da 3 keo don, moi keo odds >1.80, odds/line phai ton tai trong snapshot va co it nhat 2 tin hieu ho tro.
Neu khong con keo dat dieu kien, recommendation la "Dung ngoai".
Ket qua phai la mot phan tich doc lap cho nguoi dung: khong nhac den buoc verify/tham dinh, nhan dinh cu, viec bi bac bo, hay loi cua vong truoc trong bat ky field nao.
Tra duy nhat JSON cung schema phan tich: match, preferredScoreline, scoreConfidence, recommendation, confidence, picks, marketViews, keyPoints[2], risks[2], summary. Neu dung ngoai thi picks la mang rong nhung marketViews van tom tat 4-5 nhom thi truong. Viet ngan gon.`;

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
    "Nhan dinh truoc do khong vuot qua buoc tham dinh.";
  const trimmedReason =
    shortReason.length > 160 ? `${shortReason.slice(0, 157)}...` : shortReason;
  return {
    match: `${payload.home} vs ${payload.away}`,
    preferredScoreline: original.preferredScoreline || "1-1",
    scoreConfidence: Math.min(original.scoreConfidence || 0, 45),
    recommendation: "Khong co edge ro rang, nen dung ngoai va theo doi them.",
    confidence: Math.min(original.confidence || 0, 45),
    keyPoints: [
      "Buoc tham dinh doc lap da bac bo nhan dinh ban dau.",
      "Odds hien tai chua cho thay mot edge ro rang de vao keo.",
      "Uu tien ky luat va cho them du lieu truoc khi hanh dong.",
    ],
    risks: [
      trimmedReason,
      "Nhan dinh thay the duoc ha muc tin cay de tranh overclaim.",
      "Thi truong hien tai co the dang can bang hoac xung dot giua cac market.",
    ],
    summary:
      "Nhan dinh goc bi tu choi trong buoc tham dinh doc lap. Ban thay the nay chuyen sang goc nhin bao thu vi odds chua cho edge ro rang.",
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
        parsed.preferredScoreline || "Chua co ti so uu tien",
      ),
      scoreConfidence: clampConfidence(parsed.scoreConfidence),
      recommendation: String(parsed.recommendation || "Dung ngoai."),
      confidence,
      picks: sanitizePicks(parsed.picks),
      marketViews: sanitizeMarketViews(parsed.marketViews),
      keyPoints: sanitizeStringList(
        parsed.keyPoints,
        "Khong tach duoc cac diem odds noi bat.",
      ),
      risks: sanitizeStringList(
        parsed.risks,
        "Can than vi du lieu odds chua cho thay mot edge ro rang.",
      ),
      summary: String(
        parsed.summary || "Khong co du thong tin de rut ra ket luan on dinh.",
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
