export type ApiFootballFixture = {
  fixture: { id: number; date: string };
  teams: {
    home: { name: string | null };
    away: { name: string | null };
  };
};

export type MatchAiAnalysis = {
  match: string;
  preferredScoreline: string;
  scoreConfidence: number;
  recommendation: string;
  confidence: number;
  keyPoints: string[];
  risks: string[];
  summary: string;
  picks?: Array<{
    candidateId?: string;
    market: string;
    selection: string;
    odds: number;
    reason?: string;
    confidence?: number;
    /** "parlay" = phù hợp xiên, "single" = kèo đơn, "both" = cả hai, undefined = mặc định */
    suitability?: "parlay" | "single" | "both";
    /** Gợi ý ghép xiên: "cùng cửa với trận X" hoặc "ngược cửa trận Y" */
    parlayNote?: string;
  }>;
  marketViews?: Array<{
    market: string;
    assessment: string;
    odds: number | null;
  }>;
  verificationStatus?: "confirmed" | "revised" | "failed" | "skipped";
  verifiedConfirmed?: boolean;
  verifiedConfidence?: number;
  verifiedComment?: string;
  revisedAfterReject?: boolean;
};

export type BettingPlanPick = {
  market: string;
  selection: string;
  odds: number;
  reason: string;
  suitability?: "parlay" | "single" | "both";
};

export type BettingParlayLeg = {
  matchIndex: number;
  matchLabel: string;
  pick: BettingPlanPick;
};

export type BettingParlay = {
  type: string; // "xiên N" | "xiên 2" | "xiên tỉ số"
  legs: BettingParlayLeg[];
  combinedOdds: number;
  stake: number;
  potentialWin: number;
};

export type BettingPlanSingle = {
  matchIndex: number;
  matchLabel: string;
  betType: string; // "Tỷ số chính xác" | "Main"
  pick: BettingPlanPick;
  stake: number;
  potentialWin: number;
};

export type BettingPlanMatch = {
  matchIndex: number;
  matchLabel: string;
  kickoff: string;
  analysis: string;
  topPicks: BettingPlanPick[];
};

export type BettingPlan = {
  matches: BettingPlanMatch[];
  parlays: BettingParlay[];
  remainingSingles: BettingPlanSingle[];
  summary: string;
};

export type CombinedAnalysisPlan = {
  summary: string;
  matches: CombinedAnalysisPlanMatch[];
  parlays: BettingParlay[];
  remainingSingles: BettingPlanSingle[];
};

export type MatchInfo = {
  gameId: string;
  home: string;
  away: string;
  kickoffUnix: number;
  /** Ngay thi dau theo gio VN, "YYYY-MM-DD". */
  date: string;
  /** Gio thi dau theo gio VN, "HH:mm". */
  kickoffTime: string;
};

export type CompactOutcome = {
  name: string;
  price: number;
  point?: number;
};

export type CompactMarket = {
  key: string;
  outcomes: CompactOutcome[];
};

export type CompactOdds = {
  updatedUnix: number;
  legend: string;
  markets: CompactMarket[];
};

export type CorrectScoreOutcome = { score: string; price: number };

/** Odds da rut gon (bo field trung lap, ma hoa ten doi) de tiet kiem token cho AI doc. */
export type MatchOddsPayload = {
  gameId: string;
  home: string;
  away: string;
  kickoffUnix: number;
  odds: CompactOdds;
  /** Market "Exact Score" (Correct Score) tu API-Football. */
  correctScore?: CorrectScoreOutcome[];
};

export type CombinedAnalysisPlanMatch = {
  matchIndex: number;
  matchLabel: string;
  kickoff: string;
  analysis: string;
  preferredScoreline: string;
  scoreConfidence: number;
  topPicks: BettingPlanPick[];
  keyPoints: string[];
  risks: string[];
};