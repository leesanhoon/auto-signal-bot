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

/** Ngày + giờ đầy đủ, thứ tự cố định (vd: "T7 28/06 19:00"). */
function formatKickoffDateTime(kickoffUnix: number): string {
  const date = new Date(kickoffUnix * 1000);
  const parts = new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("weekday")} ${get("day")}/${get("month")} ${get("hour")}:${get("minute")}`;
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
function formatAsiaHandicap(market: CompactMarket | undefined, label: string): string | undefined {
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
  return parts.length > 0 ? `${label}: ${parts.join(" ")}` : undefined;
}

/** Liệt kê đầy đủ mọi mốc Over/Under, sort theo point tăng dần, Over rồi Under mỗi mốc. */
function formatAsiaTotals(market: CompactMarket | undefined, label: string): string | undefined {
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
  return parts.length > 0 ? `${label}: ${parts.join(" ")}` : undefined;
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
    `${payload.home}(H) vs ${payload.away}(A) | ${formatKickoffDateTime(payload.kickoffUnix)}`,
  ];

  const h2hLine = format3Way(findMarket(payload, "h2h"), "H2H");
  if (h2hLine) lines.push(h2hLine);

  const hcpLine = formatAsiaHandicap(findMarket(payload, "asia_handicap"), "ASIA-HCP");
  if (hcpLine) lines.push(hcpLine);

  const totLine = formatAsiaTotals(findMarket(payload, "asia_totals"), "ASIA-TOT");
  if (totLine) lines.push(totLine);

  const euTotLine = formatAsiaTotals(findMarket(payload, "eu_totals"), "EU-TOT");
  if (euTotLine) lines.push(euTotLine);

  const kqTotLine = formatResultTotal(findMarket(payload, "result_total_goals"));
  if (kqTotLine) lines.push(kqTotLine);

  if (payload.correctScore && payload.correctScore.length > 0) {
    const cs = payload.correctScore.map((o) => `${o.score}=${o.price}`).join(" ");
    lines.push(`CS: ${cs}`);
  }

  const bttsMarket = findMarket(payload, "btts");
  const gg = findOutcome(bttsMarket, "GG")?.price;
  const ng = findOutcome(bttsMarket, "NG")?.price;
  if (gg !== undefined && ng !== undefined) lines.push(`GG/NG: GG=${gg} NG=${ng}`);

  const teamGoalsHomeLine = formatAsiaTotals(findMarket(payload, "team_goals_home"), "TEAM-GOALS-H");
  if (teamGoalsHomeLine) lines.push(teamGoalsHomeLine);

  const teamGoalsAwayLine = formatAsiaTotals(findMarket(payload, "team_goals_away"), "TEAM-GOALS-A");
  if (teamGoalsAwayLine) lines.push(teamGoalsAwayLine);

  const cornersH2hLine = format3Way(findMarket(payload, "corners_1x2"), "CORNERS-H2H");
  if (cornersH2hLine) lines.push(cornersH2hLine);

  const cornersHcpLine = formatAsiaHandicap(findMarket(payload, "corners_handicap"), "CORNERS-HCP");
  if (cornersHcpLine) lines.push(cornersHcpLine);

  const cornersTotLine = formatAsiaTotals(findMarket(payload, "corners_totals"), "CORNERS-TOT");
  if (cornersTotLine) lines.push(cornersTotLine);

  const cornersTotEuLine = formatAsiaTotals(findMarket(payload, "corners_totals_eu"), "CORNERS-TOT-EU");
  if (cornersTotEuLine) lines.push(cornersTotEuLine);

  return lines.join("\n");
}

/** Mốc point gần tâm nhất trong danh sách đã sort — vì compactOdds đã trim ±2 mốc quanh equilibrium, mốc giữa chính là kèo "main". */
function pickMainPoint(market: CompactMarket | undefined): number | undefined {
  if (!market) return undefined;
  const points = [...new Set(market.outcomes.map((o) => o.point).filter((p): p is number => p !== undefined))].sort(
    (a, b) => a - b,
  );
  if (points.length === 0) return undefined;
  return points[Math.floor((points.length - 1) / 2)];
}

function mainHandicapText(market: CompactMarket | undefined): string | undefined {
  const point = pickMainPoint(market);
  if (point === undefined) return undefined;
  const h = market!.outcomes.find((o) => o.name === "H" && o.point === point);
  const a = market!.outcomes.find((o) => o.name === "A" && o.point === point);
  if (!h || !a) return undefined;
  return `Chấp ${fmtSignedPoint(point)}: ${h.price}/${a.price}`;
}

function mainTotalText(market: CompactMarket | undefined): string | undefined {
  const point = pickMainPoint(market);
  if (point === undefined) return undefined;
  const over = market!.outcomes.find((o) => o.name === "Over" && o.point === point);
  const under = market!.outcomes.find((o) => o.name === "Under" && o.point === point);
  if (!over || !under) return undefined;
  return `T/X ${fmtNum(point)}: ${over.price}/${under.price}`;
}

/**
 * Tóm tắt vài kèo main (1X2, chấp, tài xỉu — mốc gần tâm nhất) thành 1 dòng ngắn,
 * dùng cho tin nhắn tổng hợp Telegram (không phải block copy gửi AI, nên không cần tối ưu token).
 */
export function formatMainOddsSummary(payload: MatchOddsPayload): string | undefined {
  const h2h = findMarket(payload, "h2h");
  const h = findOutcome(h2h, "H")?.price;
  const d = findOutcome(h2h, "D")?.price;
  const a = findOutcome(h2h, "A")?.price;
  const h2hText = h !== undefined && d !== undefined && a !== undefined ? `1X2: ${h}/${d}/${a}` : undefined;

  const hcpText = mainHandicapText(findMarket(payload, "asia_handicap"));
  const totText = mainTotalText(findMarket(payload, "eu_totals")) ?? mainTotalText(findMarket(payload, "asia_totals"));

  const bttsMarket = findMarket(payload, "btts");
  const gg = findOutcome(bttsMarket, "GG")?.price;
  const ng = findOutcome(bttsMarket, "NG")?.price;
  const bttsText = gg !== undefined && ng !== undefined ? `GG/NG: ${gg}/${ng}` : undefined;

  const parts = [h2hText, hcpText, totText, bttsText].filter((s): s is string => s !== undefined);
  return parts.length > 0 ? parts.join("  |  ") : undefined;
}
