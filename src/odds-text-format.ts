import type { CompactMarket, CompactOutcome, MatchOddsPayload } from "./betting-types.js";

function findMarket(payload: MatchOddsPayload, key: string): CompactMarket | undefined {
  return payload.odds.markets.find((m) => m.key === key);
}

function findOutcome(market: CompactMarket | undefined, name: string): CompactOutcome | undefined {
  return market?.outcomes.find((o) => o.name === name);
}

/** Số nguyên hiển thị không có ".0" (vd: 3 không phải 3.0); số lẻ giữ nguyên (vd: 2.5). */
function fmtNum(n: number): string {
  return String(n);
}

/** Dấu "+" cho mốc dương, số âm đã tự có "-" sẵn (vd: -1.5, +1, +1.5). */
function fmtSignedPoint(n: number): string {
  return n > 0 ? `+${fmtNum(n)}` : fmtNum(n);
}

function formatKickoffTime(kickoffUnix: number): string {
  return new Date(kickoffUnix * 1000).toLocaleTimeString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function format3Way(market: CompactMarket | undefined, label: string): string | undefined {
  if (!market) return undefined;
  const h = findOutcome(market, "H")?.price;
  const d = findOutcome(market, "D")?.price;
  const a = findOutcome(market, "A")?.price;
  if (h === undefined || d === undefined || a === undefined) return undefined;
  return `${label}: H=${h} D=${d} A=${a}`;
}

/**
 * Build format text siêu gọn cho AI đọc — thay thế JSON. Mỗi market 1 dòng,
 * bỏ field thừa (key tên dài, last_update, point lặp lại không cần thiết).
 * Market thiếu trong response (do bookmaker không cung cấp) sẽ bị bỏ qua,
 * không in dòng rỗng.
 */
export function formatOddsText(payload: MatchOddsPayload): string {
  const lines: string[] = [
    `${payload.home}(H) vs ${payload.away}(A) | ${formatKickoffTime(payload.kickoffUnix)}`,
  ];

  const h2hLine = format3Way(findMarket(payload, "h2h"), "H2H");
  if (h2hLine) lines.push(h2hLine);

  const spreads = findMarket(payload, "spreads");
  const spreadsH = findOutcome(spreads, "H");
  const spreadsA = findOutcome(spreads, "A");
  const mainSpreadPoint = spreadsH?.point ?? spreadsA?.point;
  if (spreadsH && spreadsA && mainSpreadPoint !== undefined) {
    // "spreads" là handicap châu Á — bookmaker không cố định mốc ở 0, nên chỉ
    // gọi là DNB (Draw No Bet) khi mốc thực sự = 0; ngược lại ghi rõ mốc thật
    // (vd: HCP+1) để không đánh lừa AI đọc nhầm thành Draw No Bet.
    const label = mainSpreadPoint === 0 ? "DNB" : `HCP${fmtSignedPoint(mainSpreadPoint)}`;
    lines.push(`${label}: H=${spreadsH.price} A=${spreadsA.price}`);
  }

  const totals = findMarket(payload, "totals");
  const over = findOutcome(totals, "Over");
  const under = findOutcome(totals, "Under");
  const mainTotalPoint = over?.point ?? under?.point;
  if (over && under && mainTotalPoint !== undefined) {
    lines.push(`TOT: O${fmtNum(mainTotalPoint)}=${over.price} U${fmtNum(mainTotalPoint)}=${under.price}`);
  }

  const btts = findMarket(payload, "btts");
  const yes = findOutcome(btts, "Yes");
  const no = findOutcome(btts, "No");
  if (yes && no) {
    lines.push(`BTTS: Y=${yes.price} N=${no.price}`);
  }

  const altTotals = findMarket(payload, "alternate_totals");
  if (altTotals) {
    const overs = altTotals.outcomes
      .filter((o) => o.name === "Over" && o.point !== undefined && o.point !== mainTotalPoint)
      .sort((a, b) => (a.point ?? 0) - (b.point ?? 0));
    const unders = altTotals.outcomes
      .filter((o) => o.name === "Under" && o.point !== undefined && o.point !== mainTotalPoint)
      .sort((a, b) => (a.point ?? 0) - (b.point ?? 0));
    const parts = [
      ...overs.map((o) => `O${fmtNum(o.point!)}=${o.price}`),
      ...unders.map((o) => `U${fmtNum(o.point!)}=${o.price}`),
    ];
    if (parts.length > 0) lines.push(`ALT-TOT: ${parts.join(" ")}`);
  }

  const altSpreads = findMarket(payload, "alternate_spreads");
  if (altSpreads) {
    const homeSide = altSpreads.outcomes
      .filter((o) => o.name === "H" && o.point !== undefined && o.point !== mainSpreadPoint)
      .sort((a, b) => (a.point ?? 0) - (b.point ?? 0));
    const awaySide = altSpreads.outcomes
      .filter((o) => o.name === "A" && o.point !== undefined && o.point !== mainSpreadPoint)
      .sort((a, b) => (a.point ?? 0) - (b.point ?? 0));
    const parts = [
      ...homeSide.map((o) => `H${fmtSignedPoint(o.point!)}=${o.price}`),
      ...awaySide.map((o) => `A${fmtSignedPoint(o.point!)}=${o.price}`),
    ];
    if (parts.length > 0) lines.push(`ALT-SP: ${parts.join(" ")}`);
  }

  const h1Line = format3Way(findMarket(payload, "h2h_3_way_h1"), "H1");
  if (h1Line) lines.push(h1Line);

  const h2Line = format3Way(findMarket(payload, "h2h_3_way_h2"), "H2");
  if (h2Line) lines.push(h2Line);

  return lines.join("\n");
}
