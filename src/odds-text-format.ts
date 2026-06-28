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

/** Liệt kê đầy đủ mọi mốc Asian Handicap, sort theo point tăng dần, H rồi A mỗi mốc. */
function formatAsiaHandicap(market: CompactMarket | undefined): string | undefined {
  if (!market) return undefined;
  const points = [...new Set(market.outcomes.map((o) => o.point).filter((p): p is number => p !== undefined))].sort(
    (a, b) => a - b,
  );
  const parts: string[] = [];
  for (const point of points) {
    const sameLine = market.outcomes.filter((o) => o.point === point);
    const h = sameLine.find((o) => o.name === "H");
    const a = sameLine.find((o) => o.name === "A");
    if (h) parts.push(`H${fmtSignedPoint(point)}=${h.price}`);
    if (a) parts.push(`A${fmtSignedPoint(point)}=${a.price}`);
  }
  return parts.length > 0 ? `ASIA-HCP: ${parts.join(" ")}` : undefined;
}

/** Liệt kê đầy đủ mọi mốc Goals Over/Under, sort theo point tăng dần, Over rồi Under mỗi mốc. */
function formatAsiaTotals(market: CompactMarket | undefined): string | undefined {
  if (!market) return undefined;
  const points = [...new Set(market.outcomes.map((o) => o.point).filter((p): p is number => p !== undefined))].sort(
    (a, b) => a - b,
  );
  const parts: string[] = [];
  for (const point of points) {
    const sameLine = market.outcomes.filter((o) => o.point === point);
    const over = sameLine.find((o) => o.name === "Over");
    const under = sameLine.find((o) => o.name === "Under");
    if (over) parts.push(`O${fmtNum(point)}=${over.price}`);
    if (under) parts.push(`U${fmtNum(point)}=${under.price}`);
  }
  return parts.length > 0 ? `ASIA-TOT: ${parts.join(" ")}` : undefined;
}

/** Combo Kết quả + Tổng điểm — liệt kê đầy đủ mọi mốc, dạng "H-U1.5=3.32 H-O2.5=3.0 A-U1.5=5.4 ...". */
function formatResultTotal(market: CompactMarket | undefined): string | undefined {
  if (!market) return undefined;
  const points = [...new Set(market.outcomes.map((o) => o.point).filter((p): p is number => p !== undefined))].sort(
    (a, b) => a - b,
  );
  const order = ["HO", "DO", "AO", "HU", "DU", "AU"];
  const parts: string[] = [];
  for (const point of points) {
    const sameLine = market.outcomes.filter((o) => o.point === point);
    for (const code of order) {
      const o = sameLine.find((x) => x.name === code);
      if (o) parts.push(`${code[0]}-${code[1]}${fmtNum(point)}=${o.price}`);
    }
  }
  return parts.length > 0 ? `KQ-TOT: ${parts.join(" ")}` : undefined;
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

  const hcpLine = formatAsiaHandicap(findMarket(payload, "asia_handicap"));
  if (hcpLine) lines.push(hcpLine);

  const totLine = formatAsiaTotals(findMarket(payload, "asia_totals"));
  if (totLine) lines.push(totLine);

  const kqTotLine = formatResultTotal(findMarket(payload, "result_total_goals"));
  if (kqTotLine) lines.push(kqTotLine);

  if (payload.correctScore && payload.correctScore.length > 0) {
    const cs = payload.correctScore.map((o) => `${o.score}=${o.price}`).join(" ");
    lines.push(`CS: ${cs}`);
  }

  return lines.join("\n");
}
