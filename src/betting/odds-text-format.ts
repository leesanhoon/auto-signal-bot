import type {
  CompactMarket,
  CompactOutcome,
  CombinedAnalysisPlan,
  MatchOddsPayload,
} from "./betting-types.js";
import type { BettingAnalysisSnapshot } from "./betting-analysis-repository.js";

function findMarket(
  payload: MatchOddsPayload,
  key: string,
): CompactMarket | undefined {
  return payload.odds.markets.find((m) => m.key === key);
}

function findOutcome(
  market: CompactMarket | undefined,
  name: string,
): CompactOutcome | undefined {
  return market?.outcomes.find((o) => o.name === name);
}

function fmtNum(n: number): string {
  return String(n);
}

function fmtSignedPoint(n: number): string {
  return n > 0 ? `+${fmtNum(n)}` : fmtNum(n);
}

function compactText(value: string, maxLength = 80): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength - 1).trimEnd()}…`
    : normalized;
}

export function sortMatchOddsByKickoff(
  payloads: MatchOddsPayload[],
): MatchOddsPayload[] {
  return [...payloads].sort((a, b) => a.kickoffUnix - b.kickoffUnix);
}

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

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${get("weekday")} ${get("day")}/${get("month")} ${get("hour")}:${get("minute")}`;
}

function format3Way(
  market: CompactMarket | undefined,
  label: string,
): string | undefined {
  if (!market) return undefined;
  const h = findOutcome(market, "H")?.price;
  const d = findOutcome(market, "D")?.price;
  const a = findOutcome(market, "A")?.price;
  if (h === undefined || d === undefined || a === undefined) return undefined;
  return `${label}: H=${h} D=${d} A=${a}`;
}

function formatAsiaHandicap(
  market: CompactMarket | undefined,
  label: string,
): string | undefined {
  if (!market) return undefined;
  const points = [
    ...new Set(
      market.outcomes
        .map((o) => o.point)
        .filter((p): p is number => p !== undefined),
    ),
  ].sort((a, b) => a - b);
  const parts: string[] = [];
  for (const point of points) {
    const sameLine = market.outcomes.filter((o) => o.point === point);
    const h = sameLine.find((o) => o.name === "H");
    const a = sameLine.find((o) => o.name === "A");
    if (h) parts.push(`H${fmtSignedPoint(point)}=${h.price}`);
    if (a) parts.push(`A${fmtSignedPoint(-point)}=${a.price}`);
  }
  return parts.length > 0 ? `${label}: ${parts.join(" ")}` : undefined;
}

function formatAsiaTotals(
  market: CompactMarket | undefined,
  label: string,
): string | undefined {
  if (!market) return undefined;
  const points = [
    ...new Set(
      market.outcomes
        .map((o) => o.point)
        .filter((p): p is number => p !== undefined),
    ),
  ].sort((a, b) => a - b);
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

function formatResultTotal(
  market: CompactMarket | undefined,
): string | undefined {
  if (!market) return undefined;
  const points = [
    ...new Set(
      market.outcomes
        .map((o) => o.point)
        .filter((p): p is number => p !== undefined),
    ),
  ].sort((a, b) => a - b);
  const order = ["HO", "DO", "AO", "HU", "DU", "AU"];
  const parts: string[] = [];
  for (const point of points) {
    const sameLine = market.outcomes.filter((o) => o.point === point);
    for (const code of order) {
      const outcome = sameLine.find((x) => x.name === code);
      if (outcome)
        parts.push(`${code[0]}-${code[1]}${fmtNum(point)}=${outcome.price}`);
    }
  }
  return parts.length > 0 ? `KQ-TOT: ${parts.join(" ")}` : undefined;
}

export function formatOddsText(payload: MatchOddsPayload): string {
  const lines: string[] = [
    `${payload.home}(H) vs ${payload.away}(A) | ${formatKickoffDateTime(payload.kickoffUnix)}`,
  ];

  const h2hLine = format3Way(findMarket(payload, "h2h"), "H2H");
  if (h2hLine) lines.push(h2hLine);

  const hcpLine = formatAsiaHandicap(
    findMarket(payload, "asia_handicap"),
    "ASIA-HCP",
  );
  if (hcpLine) lines.push(hcpLine);

  const totLine = formatAsiaTotals(
    findMarket(payload, "asia_totals"),
    "ASIA-TOT",
  );
  if (totLine) lines.push(totLine);

  const euTotLine = formatAsiaTotals(
    findMarket(payload, "eu_totals"),
    "EU-TOT",
  );
  if (euTotLine) lines.push(euTotLine);

  const kqTotLine = formatResultTotal(
    findMarket(payload, "result_total_goals"),
  );
  if (kqTotLine) lines.push(kqTotLine);

  if (payload.correctScore && payload.correctScore.length > 0) {
    const cs = payload.correctScore
      .map((o) => `${o.score}=${o.price}`)
      .join(" ");
    lines.push(`CS: ${cs}`);
  }

  const bttsMarket = findMarket(payload, "btts");
  const gg = findOutcome(bttsMarket, "GG")?.price;
  const ng = findOutcome(bttsMarket, "NG")?.price;
  if (gg !== undefined && ng !== undefined)
    lines.push(`GG/NG: GG=${gg} NG=${ng}`);

  const teamGoalsHomeLine = formatAsiaTotals(
    findMarket(payload, "team_goals_home"),
    "TEAM-GOALS-H",
  );
  if (teamGoalsHomeLine) lines.push(teamGoalsHomeLine);

  const teamGoalsAwayLine = formatAsiaTotals(
    findMarket(payload, "team_goals_away"),
    "TEAM-GOALS-A",
  );
  if (teamGoalsAwayLine) lines.push(teamGoalsAwayLine);

  const cornersH2hLine = format3Way(
    findMarket(payload, "corners_1x2"),
    "CORNERS-H2H",
  );
  if (cornersH2hLine) lines.push(cornersH2hLine);

  const cornersHcpLine = formatAsiaHandicap(
    findMarket(payload, "corners_handicap"),
    "CORNERS-HCP",
  );
  if (cornersHcpLine) lines.push(cornersHcpLine);

  const cornersTotLine = formatAsiaTotals(
    findMarket(payload, "corners_totals"),
    "CORNERS-TOT",
  );
  if (cornersTotLine) lines.push(cornersTotLine);

  const cornersTotEuLine = formatAsiaTotals(
    findMarket(payload, "corners_totals_eu"),
    "CORNERS-TOT-EU",
  );
  if (cornersTotEuLine) lines.push(cornersTotEuLine);

  return lines.join("\n");
}

export function formatOddsAnalysisInput(payload: MatchOddsPayload): string {
  const lines: string[] = [];
  const marketKeys = [
    "h2h",
    "asia_handicap",
    "asia_totals",
    "eu_totals",
    "result_total_goals",
    "btts",
    "team_goals_home",
    "team_goals_away",
    "corners_1x2",
    "corners_handicap",
    "corners_totals",
    "corners_totals_eu",
  ];

  for (const key of marketKeys) {
    const market = findMarket(payload, key);
    if (!market) continue;
    const outcomes = market.outcomes
      .filter((o) => Number.isFinite(o.price) && o.price > 0)
      .map((outcome) => {
        const normalizedPoint =
          key.includes("handicap") &&
          outcome.name === "A" &&
          outcome.point !== undefined
            ? -outcome.point
            : outcome.point;
        const point =
          normalizedPoint === undefined
            ? ""
            : `@${fmtSignedPoint(normalizedPoint)}`;
        return `${outcome.name}${point}=${outcome.price}`;
      });
    if (outcomes.length > 0) lines.push(`${key}:${outcomes.join(",")}`);
  }

  if (payload.correctScore?.length) {
    const strongestScores = [...payload.correctScore]
      .filter((outcome) => Number.isFinite(outcome.price) && outcome.price > 0)
      .sort((left, right) => left.price - right.price)
      .slice(0, 8)
      .map((outcome) => `${outcome.score}=${outcome.price}`);
    if (strongestScores.length > 0)
      lines.push(`correct_score_top:${strongestScores.join(",")}`);
  }

  return lines.join("\n");
}

export function formatFullOddsAnalysisInput(payload: MatchOddsPayload): string {
  return JSON.stringify(
    {
      match: {
        gameId: payload.gameId,
        home: payload.home,
        away: payload.away,
        kickoffUnix: payload.kickoffUnix,
      },
      odds: payload.odds,
      correctScore: payload.correctScore ?? [],
    },
    null,
    2,
  );
}

function pickMainPoint(market: CompactMarket | undefined): number | undefined {
  if (!market) return undefined;
  const points = [
    ...new Set(
      market.outcomes
        .map((o) => o.point)
        .filter((p): p is number => p !== undefined),
    ),
  ].sort((a, b) => a - b);
  if (points.length === 0) return undefined;
  return points[Math.floor((points.length - 1) / 2)];
}

function mainHandicapText(
  market: CompactMarket | undefined,
): string | undefined {
  const point = pickMainPoint(market);
  if (point === undefined) return undefined;
  const h = market?.outcomes.find((o) => o.name === "H" && o.point === point);
  const a = market?.outcomes.find((o) => o.name === "A" && o.point === point);
  if (!h || !a) return undefined;
  return `Chấp ${fmtSignedPoint(point)}: ${h.price}/${a.price}`;
}

function mainTotalText(market: CompactMarket | undefined): string | undefined {
  const point = pickMainPoint(market);
  if (point === undefined) return undefined;
  const over = market?.outcomes.find(
    (o) => o.name === "Over" && o.point === point,
  );
  const under = market?.outcomes.find(
    (o) => o.name === "Under" && o.point === point,
  );
  if (!over || !under) return undefined;
  return `Tài/Xỉu ${fmtNum(point)}: ${over.price}/${under.price}`;
}

export function formatMainOddsSummary(
  payload: MatchOddsPayload,
): string | undefined {
  const h2h = findMarket(payload, "h2h");
  const h = findOutcome(h2h, "H")?.price;
  const d = findOutcome(h2h, "D")?.price;
  const a = findOutcome(h2h, "A")?.price;
  const h2hText =
    h !== undefined && d !== undefined && a !== undefined
      ? `1X2: ${h}/${d}/${a}`
      : undefined;

  const hcpText = mainHandicapText(findMarket(payload, "asia_handicap"));
  const totText =
    mainTotalText(findMarket(payload, "eu_totals")) ??
    mainTotalText(findMarket(payload, "asia_totals"));

  const bttsMarket = findMarket(payload, "btts");
  const gg = findOutcome(bttsMarket, "GG")?.price;
  const ng = findOutcome(bttsMarket, "NG")?.price;
  const bttsText =
    gg !== undefined && ng !== undefined ? `GG/NG: ${gg}/${ng}` : undefined;

  const parts = [h2hText, hcpText, totText, bttsText].filter(
    (s): s is string => s !== undefined,
  );
  return parts.length > 0 ? parts.join("  |  ") : undefined;
}

/**
 * Format odds data with emoji sections — dễ đọc hơn code block cũ.
 */
export function formatOddsDataMessage(payload: MatchOddsPayload): string {
  const lines: string[] = ["━━━━━━━━━━━━━━━━━━━━━━"];

  // 1X2
  const h2h = findMarket(payload, "h2h");
  const h = findOutcome(h2h, "H")?.price;
  const d = findOutcome(h2h, "D")?.price;
  const a = findOutcome(h2h, "A")?.price;
  if (h !== undefined && d !== undefined && a !== undefined) {
    const fav = Math.min(h, a, d);
    const favLabel =
      fav === h
        ? `${payload.home}🏠`
        : fav === a
          ? `${payload.away}✈️`
          : "Hòa🤝";
    lines.push(`📊 *1X2*`);
    lines.push(
      `🏠 ${payload.home}: ${h}  🤝 Hòa: ${d}  ✈️ ${payload.away}: ${a}`,
    );
    lines.push(`   👑 Ưu thế: ${favLabel} (ngắn nhất @${fav})`);
  }

  // Asian Handicap
  const hcp = findMarket(payload, "asia_handicap");
  if (hcp?.outcomes.length) {
    lines.push(`📐 *Asian Handicap*`);
    for (const o of hcp.outcomes) {
      const label = o.name === "H" ? payload.home : payload.away;
      const pt = o.point !== undefined ? fmtSignedPoint(o.point) : "";
      const adjustedPt =
        o.name === "A" && o.point !== undefined ? fmtSignedPoint(-o.point) : pt;
      lines.push(`   ${label} ${adjustedPt} @${o.price.toFixed(2)}`);
    }
  }

  // European Total (mốc .5)
  const euTot = findMarket(payload, "eu_totals");
  if (euTot?.outcomes.length) {
    lines.push(`⚽ *Tài/Xỉu (EU)*`);
    for (const o of euTot.outcomes) {
      const lbl = o.name === "Over" ? "🔴 Tài" : "🔵 Xỉu";
      lines.push(
        `   ${lbl} ${o.point !== undefined ? fmtNum(o.point) : ""} @${o.price.toFixed(2)}`,
      );
    }
  }

  // Asian Total (mốc .25/.75)
  const asiaTot = findMarket(payload, "asia_totals");
  if (asiaTot?.outcomes.length) {
    lines.push(`⚽ *Tài/Xỉu (Asian)*`);
    for (const o of asiaTot.outcomes) {
      const lbl = o.name === "Over" ? "🔴 Tài" : "🔵 Xỉu";
      lines.push(
        `   ${lbl} ${o.point !== undefined ? fmtNum(o.point) : ""} @${o.price.toFixed(2)}`,
      );
    }
  }

  // BTTS
  const bttsMarket = findMarket(payload, "btts");
  const gg = findOutcome(bttsMarket, "GG")?.price;
  const ng = findOutcome(bttsMarket, "NG")?.price;
  if (gg !== undefined && ng !== undefined) {
    lines.push(`🔄 *GG/NG*`);
    lines.push(`   ✅ GG (cả 2 ghi bàn): @${gg.toFixed(2)}`);
    lines.push(`   ❌ NG (1 đội trắng tay): @${ng.toFixed(2)}`);
  }

  // Correct Score (top 5)
  if (payload.correctScore?.length) {
    const topCs = [...payload.correctScore]
      .filter((o) => Number.isFinite(o.price) && o.price > 0)
      .sort((a, b) => a.price - b.price)
      .slice(0, 6);
    if (topCs.length > 0) {
      lines.push(`🎯 *Tỉ số chính xác* (top odds ngắn)`);
      for (const cs of topCs) {
        lines.push(`   ${cs.score} @${cs.price.toFixed(2)}`);
      }
    }
  }

  // Corners summary
  const corners = findMarket(payload, "corners_1x2");
  if (corners?.outcomes.length) {
    const ch = findOutcome(corners, "H")?.price;
    const cd = findOutcome(corners, "D")?.price;
    const ca = findOutcome(corners, "A")?.price;
    if (ch !== undefined && cd !== undefined && ca !== undefined) {
      lines.push(`🏁 *Phạt góc*`);
      lines.push(
        `   🏠 ${payload.home}: ${ch}  🤝 Hòa: ${cd}  ✈️ ${payload.away}: ${ca}`,
      );
    }
  }

  lines.push("━━━━━━━━━━━━━━━━━━━━━━");
  return lines.join("\n");
}

export function formatOddsFallbackMessage(
  payload: MatchOddsPayload,
  reason: string,
): string {
  const oddsMsg = formatOddsDataMessage(payload);
  return [
    `*${payload.home} vs ${payload.away}*`,
    `_AI tạm thời chưa phân tích được trận này: ${reason}_`,
    "",
    oddsMsg,
  ].join("\n");
}

/**
 * Format odds message for N matches in a combined view — dùng cho kèo ghép.
 * Hiển thị: thời gian, 1X2, HCP (1 mốc chính), Tài/Xỉu EU, GG/NG, Correct Score (top 4).
 * Sort theo kickoffUnix tăng dần.
 */
export function formatCombinedOddsMessage(
  payloads: MatchOddsPayload[],
): string {
  if (payloads.length === 0) return "Không có dữ liệu odds.";

  const sorted = sortMatchOddsByKickoff(payloads);

  // Get date for header from first match
  const firstDate = new Date(sorted[0].kickoffUnix * 1000);
  const dateParts = new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
  }).formatToParts(firstDate);
  const day = dateParts.find((p) => p.type === "day")?.value ?? "";
  const month = dateParts.find((p) => p.type === "month")?.value ?? "";
  const dateStr = `${day}/${month}`;

  const blockParts: string[] = [];
  blockParts.push(`━━━━━━ DỮ LIỆU ODDS / ${dateStr} ────────`);

  for (let i = 0; i < sorted.length; i++) {
    blockParts.push(formatOddsText(sorted[i]));
    if (i < sorted.length - 1) {
      blockParts.push("──────────────");
    }
  }

  return blockParts.join("\n\n");
}

export function formatCombinedAnalysisMessage(
  payloads: MatchOddsPayload[],
  plan: CombinedAnalysisPlan,
): string {
  const sections: string[] = [];

  // Header with summary
  sections.push("💡 *TỔNG QUAN*");
  sections.push(plan.summary || "Không có tóm tắt.");

  const matchSections: string[] = [];
  for (const match of plan.matches) {
    const payload = payloads[match.matchIndex];
    if (!payload) continue;

    const lines: string[] = [];

    // Match header with divider
    lines.push("━━━━━━━━━━━━━━━━━━━━━━━━");
    lines.push(`🏟️  *${match.matchLabel}*`);
    lines.push(`📅 ${match.kickoff}`);
    lines.push("━━━━━━━━━━━━━━━━━━━━━━━━");

    // Main odds context - Single main pick for each market (1.8-2.3 range)
    lines.push("");
    lines.push("📊 *ODDS CHÍNH*");

    const oddsItems: string[] = [];

    // Handicap - tìm mốc tốt nhất trong vùng 1.8-2.3
    const hcp = findMarket(payload, "asia_handicap");
    if (hcp?.outcomes.length) {
      const filtered = hcp.outcomes.filter(o => o.price >= 1.8 && o.price <= 2.3);
      if (filtered.length > 0) {
        const points = [...new Set(filtered.map(o => Math.abs(o.point ?? 0)))];
        for (const pt of points.sort((a, b) => Math.abs(a - 0.75) - Math.abs(b - 0.75))) {
          const hOutcome = filtered.find(o => o.name === "H" && Math.abs(Math.abs(o.point ?? 0) - pt) < 0.01);
          const aOutcome = filtered.find(o => o.name === "A" && Math.abs(Math.abs(o.point ?? 0) - pt) < 0.01);
          if (hOutcome && aOutcome) {
            const sign = hOutcome.point ? (hOutcome.point > 0 ? "+" : "-") : "+";
            oddsItems.push(`Chấp: H${sign}${pt} @${hOutcome.price}  |  A${sign === "+" ? "-" : "+"}${pt} @${aOutcome.price}`);
            break;
          }
        }
      }
    }

    // Totals - chỉ lấy mốc 2.5 hoặc 2.0 nếu có
    const euTot = findMarket(payload, "eu_totals");
    if (euTot?.outcomes.length) {
      const validPoints = [2.5, 2.0, 2.75];
      for (const mainPt of validPoints) {
        const over = euTot.outcomes.find(o => o.name === "Over" && Math.abs((o.point ?? 0) - mainPt) < 0.01);
        const under = euTot.outcomes.find(o => o.name === "Under" && Math.abs((o.point ?? 0) - mainPt) < 0.01);
        if (over && under) {
          oddsItems.push(`Tài/Xỉu: Tài ${mainPt} @${over.price}  |  Xỉu ${mainPt} @${under.price}`);
          break;
        }
      }
    }

    if (oddsItems.length > 0) {
      lines.push(oddsItems.join("\n"));
    }

    // Picks section with ranking
    lines.push("");
    if (match.picks.length > 0) {
      lines.push(`🎯 *NHẬN ĐỊNH - ${match.picks.length} KÈOS NÊN CHƠI:*`);
      lines.push("");

      for (let i = 0; i < match.picks.length; i++) {
        const pick = match.picks[i];
        const prefix = i === 0 ? "👑 **#1 - CHÍNH THỨC**" : i === 1 ? "💚 **#2 - PHỤ**" : `🔵 **#${i + 1}**`;
        const confLevel = pick.confidence >= 80 ? "🔥" : pick.confidence >= 70 ? "✅" : "⚠️";

        lines.push(`${prefix}`);
        lines.push(`${confLevel} Confidence: ${pick.confidence}%`);
        lines.push(`   📌 ${pick.market}: *${pick.selection}* @ ${pick.odds}`);

        if (pick.reason) {
          lines.push(`   💬 "${pick.reason}"`);
        }

        if (i < match.picks.length - 1) lines.push("");
      }
    } else {
      lines.push("⚠️  *KHÔNG CÓ KÈO ĐỦ TIN CẬY*");
      lines.push("   → Nên đứng ngoài và theo dõi thêm");
    }

    // Predicted score
    lines.push("");
    const scoreIcon = match.predictedScore.confidence >= 70 ? "🎯" : "📊";
    lines.push(`${scoreIcon} *DỰ ĐOÁN TỈ SỐ:* ${match.predictedScore.score} (${match.predictedScore.confidence}% tự tin)`);

    // Note
    if (match.note) {
      lines.push(`📝 *GHI CHÚ:* ${match.note}`);
    }

    matchSections.push(lines.join("\n"));
  }

  if (matchSections.length > 0) {
    sections.push(matchSections.join("\n\n"));
  }

  return sections.join("\n\n");
}

/**
 * Format message từ danh sách BettingAnalysisSnapshot đã cache (không gọi AI).
 * Dùng khi cache hit cho tất cả gameIds trong payload.
 */
export function formatCachedAnalysisMessage(
  payloads: MatchOddsPayload[],
  snapshots: BettingAnalysisSnapshot[],
): string {
  const snapshotByGameId = new Map(snapshots.map((s) => [s.gameId, s]));
  const sections: string[] = [];

  // Header with summary
  sections.push("💡 *TỔNG QUAN (TỪ CACHE)*");
  const first = snapshots[0];
  if (first?.analysis?.summary) {
    sections.push(first.analysis.summary);
  } else {
    sections.push("Không có tóm tắt.");
  }

  // Danh sách từng trận
  const matchSections: string[] = [];
  for (const payload of payloads) {
    const snap = snapshotByGameId.get(payload.gameId);
    if (!snap) continue;
    const analysis = snap.analysis;

    const lines: string[] = [];

    // Match header with divider
    lines.push("━━━━━━━━━━━━━━━━━━━━━━━━");
    lines.push(`🏟️  *${analysis.match}*`);
    lines.push("━━━━━━━━━━━━━━━━━━━━━━━━");

    // Main odds context - Single main pick for each market (1.8-2.3 range)
    lines.push("");
    lines.push("📊 *ODDS CHÍNH*");

    const oddsItems: string[] = [];

    // Handicap - tìm mốc tốt nhất trong vùng 1.8-2.3
    const hcp = findMarket(payload, "asia_handicap");
    if (hcp?.outcomes.length) {
      const filtered = hcp.outcomes.filter(o => o.price >= 1.8 && o.price <= 2.3);
      if (filtered.length > 0) {
        const points = [...new Set(filtered.map(o => Math.abs(o.point ?? 0)))];
        for (const pt of points.sort((a, b) => Math.abs(a - 0.75) - Math.abs(b - 0.75))) {
          const hOutcome = filtered.find(o => o.name === "H" && Math.abs(Math.abs(o.point ?? 0) - pt) < 0.01);
          const aOutcome = filtered.find(o => o.name === "A" && Math.abs(Math.abs(o.point ?? 0) - pt) < 0.01);
          if (hOutcome && aOutcome) {
            const sign = hOutcome.point ? (hOutcome.point > 0 ? "+" : "-") : "+";
            oddsItems.push(`Chấp: H${sign}${pt} @${hOutcome.price}  |  A${sign === "+" ? "-" : "+"}${pt} @${aOutcome.price}`);
            break;
          }
        }
      }
    }

    // Totals - chỉ lấy mốc 2.5 hoặc 2.0 nếu có
    const euTot = findMarket(payload, "eu_totals");
    if (euTot?.outcomes.length) {
      const validPoints = [2.5, 2.0, 2.75];
      for (const mainPt of validPoints) {
        const over = euTot.outcomes.find(o => o.name === "Over" && Math.abs((o.point ?? 0) - mainPt) < 0.01);
        const under = euTot.outcomes.find(o => o.name === "Under" && Math.abs((o.point ?? 0) - mainPt) < 0.01);
        if (over && under) {
          oddsItems.push(`Tài/Xỉu: Tài ${mainPt} @${over.price}  |  Xỉu ${mainPt} @${under.price}`);
          break;
        }
      }
    }

    if (oddsItems.length > 0) {
      lines.push(oddsItems.join("\n"));
    }

    // Picks section with ranking
    lines.push("");
    if (analysis.picks.length > 0) {
      lines.push(`🎯 *NHẬN ĐỊNH - ${analysis.picks.length} KÈOS NÊN CHƠI:*`);
      lines.push("");

      for (let i = 0; i < analysis.picks.length; i++) {
        const pick = analysis.picks[i];
        const prefix = i === 0 ? "👑 **#1 - CHÍNH THỨC**" : i === 1 ? "💚 **#2 - PHỤ**" : `🔵 **#${i + 1}**`;
        const confLevel = pick.confidence >= 80 ? "🔥" : pick.confidence >= 70 ? "✅" : "⚠️";

        lines.push(`${prefix}`);
        lines.push(`${confLevel} Confidence: ${pick.confidence}%`);
        lines.push(`   📌 ${pick.market}: *${pick.selection}* @ ${pick.odds}`);

        if (pick.reason) {
          lines.push(`   💬 "${pick.reason}"`);
        }

        if (i < analysis.picks.length - 1) lines.push("");
      }
    } else {
      lines.push("⚠️  *KHÔNG CÓ KÈO ĐỦ TIN CẬY*");
      lines.push("   → Nên đứng ngoài và theo dõi thêm");
    }

    // Predicted score
    lines.push("");
    const scoreIcon = analysis.predictedScore.confidence >= 70 ? "🎯" : "📊";
    lines.push(`${scoreIcon} *DỰ ĐOÁN TỈ SỐ:* ${analysis.predictedScore.score} (${analysis.predictedScore.confidence}% tự tin)`);

    // Note
    if (analysis.note) {
      lines.push(`📝 *GHI CHÚ:* ${analysis.note}`);
    }

    matchSections.push(lines.join("\n"));
  }

  if (matchSections.length > 0) {
    sections.push(matchSections.join("\n\n"));
  }

  return sections.join("\n\n");
}
