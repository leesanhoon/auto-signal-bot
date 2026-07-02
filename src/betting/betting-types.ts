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
