export type RawGameEntry = {
  CI: number;
  O1: string;
  O2: string;
  S: number;
  [key: string]: unknown;
};

export type MatchInfo = {
  gameId: number;
  home: string;
  away: string;
  kickoffUnix: number;
};

export type MatchOddsPayload = {
  gameId: number;
  home: string;
  away: string;
  kickoffUnix: number;
  odds: unknown;
};
