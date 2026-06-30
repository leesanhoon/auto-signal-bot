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
  verifiedConfirmed?: boolean;
  verifiedConfidence?: number;
  verifiedComment?: string;
};

export type MatchInfo = {
  gameId: string;
  home: string;
  away: string;
  kickoffUnix: number;
  /** Ngày thi đấu theo giờ VN, "YYYY-MM-DD". */
  date: string;
  /** Giờ thi đấu theo giờ VN, "HH:mm". */
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

/** Odds đã rút gọn (bỏ field trùng lặp, mã hóa tên đội) để tiết kiệm token cho AI đọc. */
export type MatchOddsPayload = {
  gameId: string;
  home: string;
  away: string;
  kickoffUnix: number;
  odds: CompactOdds;
  /** Market "Exact Score" (Correct Score) từ API-Football. */
  correctScore?: CorrectScoreOutcome[];
};
