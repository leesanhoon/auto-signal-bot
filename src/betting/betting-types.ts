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

export type MatchPick = {
  market: string;
  selection: string;
  odds: number;
  confidence: number;
  reason?: string;
};

export type PredictedScore = {
  score: string;
  confidence: number;
};

export type MatchAiAnalysis = {
  match: string;
  handicapPick: TotalGoalsPick | null;
  totalGoalsPick: TotalGoalsPick | null;
  picks: MatchPick[];
  predictedScore: PredictedScore;
  note?: string;
  summary: string;
  // Backward compat fields (kept for betting-backtest.ts which we can't modify)
  preferredScoreline: string;
  scoreConfidence: number;
  recommendation: string;
  confidence: number;
  keyPoints: string[];
  risks: string[];
  // Verification fields
  verificationStatus?: "confirmed" | "revised" | "failed" | "skipped";
  verifiedConfirmed?: boolean;
  verifiedConfidence?: number;
  verifiedComment?: string;
  revisedAfterReject?: boolean;
};

export type CombinedAnalysisPlanMatch = {
  matchIndex: number;
  matchLabel: string;
  kickoff: string;
  handicapPick: TotalGoalsPick | null;
  totalGoalsPick: TotalGoalsPick | null;
  picks: MatchPick[];
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

export type MatchOddsPayload = {
  gameId: string;
  home: string;
  away: string;
  kickoffUnix: number;
  odds: CompactOdds;
  /** Market "Exact Score" (Correct Score) tu API-Football. */
  correctScore?: CorrectScoreOutcome[];
};

