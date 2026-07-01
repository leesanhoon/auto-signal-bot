import { GoogleGenAI } from "@google/genai";
import { withRetry } from "../shared/retry.js";
import { withConfiguredRateLimit } from "../shared/rate-limit.js";
import type { MatchAiAnalysis, MatchOddsPayload } from "./betting-types.js";
import { formatOddsAnalysisInput } from "./odds-text-format.js";
import { createLogger } from "../shared/logger.js";

const logger = createLogger("betting:betting-gemini");
const DEFAULT_MODEL = "gemini-2.5-flash";
const VERIFY_MODEL_PRIMARY = "gemini-2.5-pro";
const VERIFY_MODEL_FALLBACK = "gemini-3.5-flash";
const GEMINI_RATE_LIMIT = {
  key: "gemini",
  envVar: "GEMINI_RATE_LIMIT_RPM",
  defaultRpm: 15,
};

const SYSTEM_PROMPT = `Ban la chuyen gia phan tich odds bong da, uu tien ky luat va tinh thuc dung.

Nhiem vu:
- Chi phan tich dua tren odds snapshot duoc cung cap.
- Khong hoi lai nguoi dung.
- Khong duoc dung kien thuc ben ngoai nhu tin tuc, chan thuong, phong do, bang xep hang, hay lich su doi dau.
- Chi duoc suy luan tu cau truc keo, tuong quan gia, va xung dot giua cac market.

Dau ra:
- Tra ve duy nhat mot JSON hop le voi dung cac key sau:
  - match: string
  - preferredScoreline: string
  - scoreConfidence: number
  - recommendation: string
  - confidence: number
  - keyPoints: string[]
  - risks: string[]
  - summary: string

Quy tac:
- Toan bo gia tri string phai viet bang tieng Viet, khong dung tieng Anh.
- preferredScoreline phai la 1 ti so cu the, dang "1-0", "2-1", "1-1"...
- scoreConfidence danh gia rieng muc do tin cay cua ti so uu tien, tu 0-100.
- recommendation phai ngan, thuc dung, va noi ro huong xu ly tu odds.
- confidence danh gia do ro rang cua tin hieu odds, khong phai do chac chan cua ket qua tran dau.
- Neu odds can bang, nhieu xung dot, hoac khong co gia tri ro rang, phai ket luan khong co edge ro rang.
- keyPoints phai co 2 den 4 y ngan.
- risks phai co 2 den 4 y ngan.
- summary phai gon trong 1 den 2 cau.
- Khong duoc them markdown, loi chao, giai thich thua, hay key ngoai danh sach.`;

const VERIFY_PROMPT = `Ban la nguoi tham dinh doc lap cho mot phan tich odds bong da.

Nhiem vu:
- Danh gia xem phan tich ben duoi co hop ly va nhat quan voi snapshot odds hay khong.
- Chi dua tren odds snapshot va ket luan duoc cung cap.
- Khong dung kien thuc ben ngoai.
- Tra ve duy nhat JSON hop le voi keys:
  - confirmed: boolean
  - confidence: number
  - comment: string

Quy tac:
- confirmed = true neu ket luan co luan ly, nhat quan, va khong mau thuan lon voi odds.
- confirmed = false neu ket luan yeu, mau thuan, hoac khong co edge ro rang.
- confidence la do chac chan cua viec tham dinh, tu 0-100.
- comment ngan gon, noi ro vi sao dong y hoac bac bo.
- Khong duoc them markdown, giai thich thua, hay key ngoai danh sach.`;

const REVISE_PROMPT = `Ban la chuyen gia phan tich odds bong da, dang duoc yeu cau dua ra nhan dinh thay the
sau khi nhan dinh truoc do bi tham dinh tu choi.

Nhiem vu:
- Chi dua tren odds snapshot va ly do tu choi duoc cung cap.
- Khong dung kien thuc ben ngoai (tin tuc, chan thuong, phong do, bang xep hang, lich su doi dau).
- Dua ra mot nhan dinh moi, khac voi nhan dinh cu, khac phuc duoc van de da bi tu choi.
- Neu odds khong co edge ro rang, phai ket luan trung thuc la khong co edge ro rang voi confidence thap.
- Tra ve duy nhat mot JSON hop le voi dung cac key: match, preferredScoreline, scoreConfidence,
  recommendation, confidence, keyPoints, risks, summary (cung dinh nghia nhu phan tich ban dau).
- Khong duoc them markdown, loi chao, giai thich thua, hay key ngoai danh sach.`;

function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not set");
  return new GoogleGenAI({ apiKey });
}

function getModelName(): string {
  return process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;
}

function buildGenerationConfig(model: string, maxOutputTokens: number) {
  const config: {
    temperature: number;
    topP: number;
    maxOutputTokens: number;
    responseMimeType: "application/json";
    thinkingConfig?: { thinkingBudget: number };
  } = {
    temperature: 0.2,
    topP: 0.9,
    maxOutputTokens,
    responseMimeType: "application/json",
  };

  if (model === "gemini-2.5-pro") {
    config.maxOutputTokens = Math.max(maxOutputTokens, 900);
    config.thinkingConfig = { thinkingBudget: 128 };
  } else {
    config.thinkingConfig = { thinkingBudget: 0 };
  }

  return config;
}

function cleanResponse(text: string): string {
  return text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
}

function extractJsonObject(text: string): string {
  const cleaned = cleanResponse(text);
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    return cleaned.slice(start, end + 1);
  }
  return cleaned;
}

function clampConfidence(value: unknown): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.min(100, Math.round(num)));
}

function sanitizeStringList(value: unknown, fallback: string): string[] {
  if (!Array.isArray(value)) return [fallback];
  const items = value
    .map((item) => String(item).trim())
    .filter((item) => item.length > 0)
    .slice(0, 4);
  return items.length > 0 ? items : [fallback];
}

function parseVerificationResponse(
  text: string,
): { confirmed: boolean; confidence: number; comment: string } | null {
  const cleaned = extractJsonObject(text);

  try {
    const parsed = JSON.parse(cleaned) as { confirmed?: unknown; confidence?: unknown; comment?: unknown };
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
  const shortReason = rejectionComment.trim() || "Nhan dinh truoc do khong vuot qua buoc tham dinh.";
  const trimmedReason = shortReason.length > 160 ? `${shortReason.slice(0, 157)}...` : shortReason;

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
    summary: `Nhan dinh goc bi tu choi trong buoc tham dinh doc lap. Ban thay the nay chuyen sang goc nhin bao thu vi odds chua cho edge ro rang.`,
  };
}

export function parseMatchAnalysisResponse(text: string, payload: MatchOddsPayload): MatchAiAnalysis | null {
  const cleaned = extractJsonObject(text);

  try {
    const parsed = JSON.parse(cleaned) as Partial<MatchAiAnalysis>;
    return {
      match: String(parsed.match || `${payload.home} vs ${payload.away}`),
      preferredScoreline: String(parsed.preferredScoreline || "Chua co ti so uu tien"),
      scoreConfidence: clampConfidence((parsed as { scoreConfidence?: unknown }).scoreConfidence),
      recommendation: String(parsed.recommendation || "Khong co goi y ro rang tu odds."),
      confidence: clampConfidence(parsed.confidence),
      keyPoints: sanitizeStringList(parsed.keyPoints, "Khong tach duoc cac diem odds noi bat."),
      risks: sanitizeStringList(parsed.risks, "Can than vi du lieu odds chua cho thay mot edge ro rang."),
      summary: String(parsed.summary || "Khong co du thong tin de rut ra ket luan on dinh."),
    };
  } catch {
    return null;
  }
}

export async function analyzeMatchOdds(payload: MatchOddsPayload): Promise<MatchAiAnalysis> {
  const ai = getClient();
  const model = getModelName();
  const oddsText = formatOddsAnalysisInput(payload);

  const request = () =>
    withConfiguredRateLimit(GEMINI_RATE_LIMIT, async () =>
      ai.models.generateContent({
        model,
        contents: [
          {
            role: "user",
            parts: [
              {
                text:
                  `${SYSTEM_PROMPT}\n\n` +
                  `Match: ${payload.home} vs ${payload.away}\n` +
                  `Kickoff Unix: ${payload.kickoffUnix}\n\n` +
                  `Hay phan tich odds snapshot sau va tra ve JSON ngay bay gio.\n\n` +
                  `Odds snapshot:\n${oddsText}`,
              },
            ],
          },
        ],
        config: buildGenerationConfig(model, 600),
      }),
    );

  const response = await withRetry(request, {
    onRetry: (error, attempt, maxAttempts, delayMs) => {
      logger.warn(
        `  ! Gemini match analysis temporary error for ${payload.home} vs ${payload.away} (${attempt}/${maxAttempts}), retrying in ${delayMs}ms: ${
          error instanceof Error ? error.message : error
        }`,
      );
    },
  });

  const parsed = parseMatchAnalysisResponse(response.text ?? "", payload);
  if (!parsed) {
    throw new Error(`Gemini parse failed. Raw: ${(response.text ?? "").slice(0, 300)}`);
  }
  return parsed;
}

export async function verifyMatchAnalysis(
  payload: MatchOddsPayload,
  analysis: MatchAiAnalysis,
): Promise<{ confirmed: boolean; confidence: number; comment: string }> {
  const ai = getClient();
  const oddsText = formatOddsAnalysisInput(payload);
  const verifyInput = {
    match: analysis.match,
    preferredScoreline: analysis.preferredScoreline,
    scoreConfidence: analysis.scoreConfidence,
    recommendation: analysis.recommendation,
    confidence: analysis.confidence,
    keyPoints: analysis.keyPoints,
    risks: analysis.risks,
    summary: analysis.summary,
  };

  const buildRequest = (model: string) => () =>
    withConfiguredRateLimit(GEMINI_RATE_LIMIT, async () =>
      ai.models.generateContent({
        model,
        contents: [
          {
            role: "user",
            parts: [
              {
                text:
                  `${VERIFY_PROMPT}\n\n` +
                  `Odds snapshot:\n${oddsText}\n\n` +
                  `Phan tich can tham dinh:\n${JSON.stringify(verifyInput, null, 2)}`,
              },
            ],
          },
        ],
        config: buildGenerationConfig(model, 500),
      }),
    );

  const callVerifyModel = async (model: string): Promise<{ confirmed: boolean; confidence: number; comment: string }> => {
    const response = await withRetry(buildRequest(model), {
      onRetry: (error, attempt, maxAttempts, delayMs) => {
        logger.warn(
          `  ! Gemini match verify temporary error with ${model} for ${payload.home} vs ${payload.away} (${attempt}/${maxAttempts}), retrying in ${delayMs}ms: ${
            error instanceof Error ? error.message : error
          }`,
        );
      },
    });

    const parsed = parseVerificationResponse(response.text ?? "");
    if (!parsed) {
      throw new Error(`Gemini verify parse failed for model ${model}. Raw: ${(response.text ?? "").slice(0, 300)}`);
    }

    return parsed;
  };

  try {
    return await callVerifyModel(VERIFY_MODEL_PRIMARY);
  } catch (primaryError) {
    logger.warn(
      `  ! Gemini match verify failed with ${VERIFY_MODEL_PRIMARY} for ${payload.home} vs ${payload.away}, falling back to ${VERIFY_MODEL_FALLBACK}: ${
        primaryError instanceof Error ? primaryError.message : primaryError
      }`,
    );
    return await callVerifyModel(VERIFY_MODEL_FALLBACK);
  }
}

export async function reviseMatchAnalysis(
  payload: MatchOddsPayload,
  original: MatchAiAnalysis,
  rejectionComment: string,
): Promise<MatchAiAnalysis> {
  const ai = getClient();
  const oddsText = formatOddsAnalysisInput(payload);

  const request = () =>
    withConfiguredRateLimit(GEMINI_RATE_LIMIT, async () =>
      ai.models.generateContent({
        model: VERIFY_MODEL_FALLBACK,
        contents: [
          {
            role: "user",
            parts: [
              {
                text:
                  `${REVISE_PROMPT}\n\n` +
                  `Odds snapshot:\n${oddsText}\n\n` +
                  `Nhan dinh ban dau (da bi tu choi):\n${JSON.stringify(original, null, 2)}\n\n` +
                  `Ly do tu choi:\n${rejectionComment}`,
              },
            ],
          },
        ],
        config: buildGenerationConfig(VERIFY_MODEL_FALLBACK, 600),
      }),
    );

  const response = await withRetry(request, {
    onRetry: (error, attempt, maxAttempts, delayMs) => {
      logger.warn(
        `  ! Gemini match revise temporary error for ${payload.home} vs ${payload.away} (${attempt}/${maxAttempts}), retrying in ${delayMs}ms: ${
          error instanceof Error ? error.message : error
        }`,
      );
    },
  });

  const parsed = parseMatchAnalysisResponse(response.text ?? "", payload);
  if (!parsed) {
    logger.warn(
      `  ! Gemini revise parse failed for ${payload.home} vs ${payload.away}, falling back to conservative revision. Raw: ${(response.text ?? "").slice(0, 300)}`,
    );
    return buildFallbackRevisedAnalysis(payload, original, rejectionComment);
  }
  return parsed;
}



