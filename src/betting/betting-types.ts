export type ApiFootballFixture = {
  fixture: { id: number; date: string };
  teams: {
    home: { name: string | null };
    away: { name: string | null };
  };
};

export type TotalGoalsPick = {
  market: string;
  selection: string;
  odds: number;
  reason?: string;
};

export type PredictedScore = {
  score: string;
  confidence: number;
};

export type MatchAiAnalysis = {
  match: string;
  totalGoalsPick: TotalGoalsPick | null;
  predictedScore: PredictedScore;
  note?: string;
  summary: string;
  // Backward compat fields (kept for betting-backtest.ts which we can't modify)
  preferredScoreline: string;
  scoreConfidence: number;
  recommendation: string;
  confidence: number;
  picks: Array<{
    market: string;
    selection: string;
    odds: number;
    reason?: string;
  }>;
  keyPoints: string[];
  risks: string[];
  // Verification fields
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

export type CombinedAnalysisPlanMatch = {
  matchIndex: number;
  matchLabel: string;
  kickoff: string;
  totalGoalsPick: TotalGoalsPick | null;
  predictedScore: PredictedScore;
  note?: string;
};

export type CombinedAnalysisPlan = {
  summary: string;
  matches: CombinedAnalysisPlanMatch[];
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

