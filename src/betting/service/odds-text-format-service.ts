import type {
  CompactMarket,
  CompactOutcome,
  CombinedAnalysisPlan,
  MatchOddsPayload,
} from "../model/betting-types.js";
import type { BettingAnalysisSnapshot } from "../repository/betting-analysis-repository.js";

function findMarket(
  payload: MatchOddsPayload,
  key: string,
): CompactMarket | undefined {
  return payload.odds.markets.find((market) => market.key === key);
}

function findOutcome(
  market: CompactMarket | undefined,
  name: string,
): CompactOutcome | undefined {
  return market?.outcomes.find((outcome) => outcome.name === name);
}

function fmtNum(value: number): string {
  return String(value);
}

function fmtSignedPoint(value: number): string {
  return value > 0 ? `+${fmtNum(value)}` : fmtNum(value);
}

function compactText(value: string, maxLength = 80): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength - 1).trimEnd()}...`
    : normalized;
}

export function sortMatchOddsByKickoff(
  payloads: MatchOddsPayload[],
): MatchOddsPayload[] {
  return [...payloads].sort((left, right) => left.kickoffUnix - right.kickoffUnix);
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
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("weekday")} ${get("day")}/${get("month")} ${get("hour")}:${get("minute")}`;
}

function format3Way(
  market: CompactMarket | undefined,
  label: string,
): string | undefined {
  if (!market) return undefined;
  const home = findOutcome(market, "H")?.price;
  const draw = findOutcome(market, "D")?.price;
  const away = findOutcome(market, "A")?.price;
  if (home === undefined || draw === undefined || away === undefined) return undefined;
  return `${label}: H=${home} D=${draw} A=${away}`;
}

function formatAsiaHandicap(
  market: CompactMarket | undefined,
  label: string,
): string | undefined {
  if (!market) return undefined;
  const points = [
    ...new Set(
      market.outcomes
        .map((outcome) => outcome.point)
        .filter((point): point is number => point !== undefined),
    ),
  ].sort((left, right) => left - right);
  const parts: string[] = [];
  for (const point of points) {
    const sameLine = market.outcomes.filter((outcome) => outcome.point === point);
    const home = sameLine.find((outcome) => outcome.name === "H");
    const away = sameLine.find((outcome) => outcome.name === "A");
    if (home) parts.push(`H${fmtSignedPoint(point)}=${home.price}`);
    if (away) parts.push(`A${fmtSignedPoint(-point)}=${away.price}`);
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
        .map((outcome) => outcome.point)
        .filter((point): point is number => point !== undefined),
    ),
  ].sort((left, right) => left - right);
  const parts: string[] = [];
  for (const point of points) {
    const sameLine = market.outcomes.filter((outcome) => outcome.point === point);
    const over = sameLine.find((outcome) => outcome.name === "Over");
    const under = sameLine.find((outcome) => outcome.name === "Under");
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
        .map((outcome) => outcome.point)
        .filter((point): point is number => point !== undefined),
    ),
  ].sort((left, right) => left - right);
  const order = ["HO", "DO", "AO", "HU", "DU", "AU"];
  const parts: string[] = [];
  for (const point of points) {
    const sameLine = market.outcomes.filter((outcome) => outcome.point === point);
    for (const code of order) {
      const outcome = sameLine.find((candidate) => candidate.name === code);
      if (outcome) parts.push(`${code[0]}-${code[1]}${fmtNum(point)}=${outcome.price}`);
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

  const handicapLine = formatAsiaHandicap(
    findMarket(payload, "asia_handicap"),
    "ASIA-HCP",
  );
  if (handicapLine) lines.push(handicapLine);

  const asiaTotalsLine = formatAsiaTotals(
    findMarket(payload, "asia_totals"),
    "ASIA-TOT",
  );
  if (asiaTotalsLine) lines.push(asiaTotalsLine);

  const euTotalsLine = formatAsiaTotals(
    findMarket(payload, "eu_totals"),
    "EU-TOT",
  );
  if (euTotalsLine) lines.push(euTotalsLine);

  const resultTotalLine = formatResultTotal(
    findMarket(payload, "result_total_goals"),
  );
  if (resultTotalLine) lines.push(resultTotalLine);

  if (payload.correctScore && payload.correctScore.length > 0) {
    lines.push(`CS: ${payload.correctScore.map((outcome) => `${outcome.score}=${outcome.price}`).join(" ")}`);
  }

  const bttsMarket = findMarket(payload, "btts");
  const gg = findOutcome(bttsMarket, "GG")?.price;
  const ng = findOutcome(bttsMarket, "NG")?.price;
  if (gg !== undefined && ng !== undefined) {
    lines.push(`GG/NG: GG=${gg} NG=${ng}`);
  }

  const homeGoalsLine = formatAsiaTotals(
    findMarket(payload, "team_goals_home"),
    "TEAM-GOALS-H",
  );
  if (homeGoalsLine) lines.push(homeGoalsLine);

  const awayGoalsLine = formatAsiaTotals(
    findMarket(payload, "team_goals_away"),
    "TEAM-GOALS-A",
  );
  if (awayGoalsLine) lines.push(awayGoalsLine);

  const cornersH2hLine = format3Way(
    findMarket(payload, "corners_1x2"),
    "CORNERS-H2H",
  );
  if (cornersH2hLine) lines.push(cornersH2hLine);

  const cornersHandicapLine = formatAsiaHandicap(
    findMarket(payload, "corners_handicap"),
    "CORNERS-HCP",
  );
  if (cornersHandicapLine) lines.push(cornersHandicapLine);

  const cornersTotalsLine = formatAsiaTotals(
    findMarket(payload, "corners_totals"),
    "CORNERS-TOT",
  );
  if (cornersTotalsLine) lines.push(cornersTotalsLine);

  const cornersEuTotalsLine = formatAsiaTotals(
    findMarket(payload, "corners_totals_eu"),
    "CORNERS-TOT-EU",
  );
  if (cornersEuTotalsLine) lines.push(cornersEuTotalsLine);

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
      .filter((outcome) => Number.isFinite(outcome.price) && outcome.price > 0)
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
    if (strongestScores.length > 0) {
      lines.push(`correct_score_top:${strongestScores.join(",")}`);
    }
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
        .map((outcome) => outcome.point)
        .filter((point): point is number => point !== undefined),
    ),
  ].sort((left, right) => left - right);
  if (points.length === 0) return undefined;
  return points[Math.floor((points.length - 1) / 2)];
}

function mainHandicapText(
  market: CompactMarket | undefined,
): string | undefined {
  const point = pickMainPoint(market);
  if (point === undefined) return undefined;
  const home = market?.outcomes.find((outcome) => outcome.name === "H" && outcome.point === point);
  const away = market?.outcomes.find((outcome) => outcome.name === "A" && outcome.point === point);
  if (!home || !away) return undefined;
  return `Chấp ${fmtSignedPoint(point)}: ${home.price}/${away.price}`;
}

function mainTotalText(market: CompactMarket | undefined): string | undefined {
  const point = pickMainPoint(market);
  if (point === undefined) return undefined;
  const over = market?.outcomes.find(
    (outcome) => outcome.name === "Over" && outcome.point === point,
  );
  const under = market?.outcomes.find(
    (outcome) => outcome.name === "Under" && outcome.point === point,
  );
  if (!over || !under) return undefined;
  return `Tài/Xỉu ${fmtNum(point)}: ${over.price}/${under.price}`;
}

export function formatMainOddsSummary(
  payload: MatchOddsPayload,
): string | undefined {
  const h2h = findMarket(payload, "h2h");
  const home = findOutcome(h2h, "H")?.price;
  const draw = findOutcome(h2h, "D")?.price;
  const away = findOutcome(h2h, "A")?.price;
  const h2hText =
    home !== undefined && draw !== undefined && away !== undefined
      ? `1X2: ${home}/${draw}/${away}`
      : undefined;

  const handicapText = mainHandicapText(findMarket(payload, "asia_handicap"));
  const totalsText =
    mainTotalText(findMarket(payload, "eu_totals")) ??
    mainTotalText(findMarket(payload, "asia_totals"));

  const bttsMarket = findMarket(payload, "btts");
  const gg = findOutcome(bttsMarket, "GG")?.price;
  const ng = findOutcome(bttsMarket, "NG")?.price;
  const bttsText =
    gg !== undefined && ng !== undefined ? `GG/NG: ${gg}/${ng}` : undefined;

  const parts = [h2hText, handicapText, totalsText, bttsText].filter(
    (part): part is string => part !== undefined,
  );
  return parts.length > 0 ? parts.join("  |  ") : undefined;
}

export function formatOddsDataMessage(payload: MatchOddsPayload): string {
  const lines: string[] = ["======================"];

  const h2h = findMarket(payload, "h2h");
  const home = findOutcome(h2h, "H")?.price;
  const draw = findOutcome(h2h, "D")?.price;
  const away = findOutcome(h2h, "A")?.price;
  if (home !== undefined && draw !== undefined && away !== undefined) {
    const favorite = Math.min(home, away, draw);
    const favoriteLabel =
      favorite === home
        ? `${payload.home}`
        : favorite === away
          ? `${payload.away}`
          : "Hòa";
    lines.push("[1X2]");
    lines.push(`${payload.home}: ${home}  Hòa: ${draw}  ${payload.away}: ${away}`);
    lines.push(`Ưu thế: ${favoriteLabel} (ngắn nhất @${favorite})`);
  }

  const handicap = findMarket(payload, "asia_handicap");
  if (handicap?.outcomes.length) {
    lines.push("[Asian Handicap]");
    for (const outcome of handicap.outcomes) {
      const label = outcome.name === "H" ? payload.home : payload.away;
      const point = outcome.point !== undefined ? fmtSignedPoint(outcome.point) : "";
      const adjustedPoint =
        outcome.name === "A" && outcome.point !== undefined ? fmtSignedPoint(-outcome.point) : point;
      lines.push(`${label} ${adjustedPoint} @${outcome.price.toFixed(2)}`);
    }
  }

  const euTotals = findMarket(payload, "eu_totals");
  if (euTotals?.outcomes.length) {
    lines.push("[Tài/Xỉu (EU)]");
    for (const outcome of euTotals.outcomes) {
      const label = outcome.name === "Over" ? "Tài" : "Xỉu";
      lines.push(`${label} ${outcome.point !== undefined ? fmtNum(outcome.point) : ""} @${outcome.price.toFixed(2)}`);
    }
  }

  const asiaTotals = findMarket(payload, "asia_totals");
  if (asiaTotals?.outcomes.length) {
    lines.push("[Tài/Xỉu (Asian)]");
    for (const outcome of asiaTotals.outcomes) {
      const label = outcome.name === "Over" ? "Tài" : "Xỉu";
      lines.push(`${label} ${outcome.point !== undefined ? fmtNum(outcome.point) : ""} @${outcome.price.toFixed(2)}`);
    }
  }

  const bttsMarket = findMarket(payload, "btts");
  const gg = findOutcome(bttsMarket, "GG")?.price;
  const ng = findOutcome(bttsMarket, "NG")?.price;
  if (gg !== undefined && ng !== undefined) {
    lines.push("[GG/NG]");
    lines.push(`GG (cả 2 ghi bàn): @${gg.toFixed(2)}`);
    lines.push(`NG (1 đội trắng tay): @${ng.toFixed(2)}`);
  }

  if (payload.correctScore?.length) {
    const topCorrectScores = [...payload.correctScore]
      .filter((outcome) => Number.isFinite(outcome.price) && outcome.price > 0)
      .sort((left, right) => left.price - right.price)
      .slice(0, 6);
    if (topCorrectScores.length > 0) {
      lines.push("[Tỉ số chính xác]");
      for (const correctScore of topCorrectScores) {
        lines.push(`${correctScore.score} @${correctScore.price.toFixed(2)}`);
      }
    }
  }

  const corners = findMarket(payload, "corners_1x2");
  if (corners?.outcomes.length) {
    const cornersHome = findOutcome(corners, "H")?.price;
    const cornersDraw = findOutcome(corners, "D")?.price;
    const cornersAway = findOutcome(corners, "A")?.price;
    if (cornersHome !== undefined && cornersDraw !== undefined && cornersAway !== undefined) {
      lines.push("[Phạt góc]");
      lines.push(`${payload.home}: ${cornersHome}  Hòa: ${cornersDraw}  ${payload.away}: ${cornersAway}`);
    }
  }

  lines.push("======================");
  return lines.join("\n");
}

export function formatOddsFallbackMessage(
  payload: MatchOddsPayload,
  reason: string,
): string {
  return [
    `*${payload.home} vs ${payload.away}*`,
    `_AI tạm thời chưa phân tích được trận này: ${reason}_`,
    "",
    formatOddsDataMessage(payload),
  ].join("\n");
}

export function formatCombinedOddsMessage(
  payloads: MatchOddsPayload[],
): string {
  if (payloads.length === 0) return "Không có dữ liệu odds.";

  const sorted = sortMatchOddsByKickoff(payloads);
  const firstDate = new Date(sorted[0].kickoffUnix * 1000);
  const dateParts = new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
  }).formatToParts(firstDate);
  const day = dateParts.find((part) => part.type === "day")?.value ?? "";
  const month = dateParts.find((part) => part.type === "month")?.value ?? "";
  const dateStr = `${day}/${month}`;

  const blockParts: string[] = [];
  blockParts.push(`━━━━━━ DỮ LIỆU ODDS / ${dateStr} --------`);

  for (let i = 0; i < sorted.length; i += 1) {
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
  sections.push("💡 *TỔNG QUAN*");
  sections.push(plan.summary || "Không có tóm tắt.");

  const matchSections: string[] = [];
  for (const match of plan.matches) {
    const payload = payloads[match.matchIndex];
    if (!payload) continue;

    const lines: string[] = [];
    lines.push("────────────────────────");
    lines.push(`🏟️  *${match.matchLabel}*`);
    lines.push(`🕒 ${match.kickoff}`);
    lines.push("────────────────────────");
    lines.push("");
    lines.push("📊 *ODDS CHÍNH*");

    const oddsItems: string[] = [];
    const handicap = findMarket(payload, "asia_handicap");
    if (handicap?.outcomes.length) {
      const filtered = handicap.outcomes.filter((outcome) => outcome.price >= 1.8 && outcome.price <= 2.3);
      if (filtered.length > 0) {
        const points = [...new Set(filtered.map((outcome) => Math.abs(outcome.point ?? 0)))];
        for (const point of points.sort((left, right) => Math.abs(left - 0.75) - Math.abs(right - 0.75))) {
          const home = filtered.find((outcome) => outcome.name === "H" && Math.abs(Math.abs(outcome.point ?? 0) - point) < 0.01);
          const away = filtered.find((outcome) => outcome.name === "A" && Math.abs(Math.abs(outcome.point ?? 0) - point) < 0.01);
          if (home && away) {
            const sign = home.point ? (home.point > 0 ? "+" : "-") : "+";
            oddsItems.push(`Chấp: H${sign}${point} @${home.price}  |  A${sign === "+" ? "-" : "+"}${point} @${away.price}`);
            break;
          }
        }
      }
    }

    const euTotals = findMarket(payload, "eu_totals");
    if (euTotals?.outcomes.length) {
      const validPoints = [2.5, 2.0, 2.75];
      for (const point of validPoints) {
        const over = euTotals.outcomes.find((outcome) => outcome.name === "Over" && Math.abs((outcome.point ?? 0) - point) < 0.01);
        const under = euTotals.outcomes.find((outcome) => outcome.name === "Under" && Math.abs((outcome.point ?? 0) - point) < 0.01);
        if (over && under) {
          oddsItems.push(`Tài/Xỉu: Tài ${point} @${over.price}  |  Xỉu ${point} @${under.price}`);
          break;
        }
      }
    }

    if (oddsItems.length > 0) lines.push(oddsItems.join("\n"));

    lines.push("");
    if (match.picks.length > 0) {
      lines.push(`🎯 *NHẬN ĐỊNH - ${match.picks.length} KÈO NÊN CHƠI:*`);
      lines.push("");
      for (let i = 0; i < match.picks.length; i += 1) {
        const pick = match.picks[i];
        const prefix = i === 0 ? "🏆 **#1 - CHÍNH THỨC**" : i === 1 ? "🥈 **#2 - PHỤ**" : `📌 **#${i + 1}**`;
        lines.push(prefix);
        lines.push(`Confidence: ${pick.confidence}%`);
        lines.push(`- ${pick.market}: *${pick.selection}* @ ${pick.odds}`);
        if (pick.reason) lines.push(`- "${compactText(pick.reason)}"`);
        if (i < match.picks.length - 1) lines.push("");
      }
    } else {
      lines.push("⏸️ *KHÔNG CÓ KÈO ĐỦ TIN CẬY*");
      lines.push("Nên đứng ngoài và theo dõi thêm");
    }

    lines.push("");
    lines.push(`🔮 *DỰ ĐOÁN TỈ SỐ:* ${match.predictedScore.score} (${match.predictedScore.confidence}% tự tin)`);
    if (match.note) lines.push(`📝 *GHI CHÚ:* ${match.note}`);

    matchSections.push(lines.join("\n"));
  }

  if (matchSections.length > 0) sections.push(matchSections.join("\n\n"));
  return sections.join("\n\n");
}

export function formatCachedAnalysisMessage(
  payloads: MatchOddsPayload[],
  snapshots: BettingAnalysisSnapshot[],
): string {
  const snapshotByGameId = new Map(snapshots.map((snapshot) => [snapshot.gameId, snapshot]));
  const sections: string[] = [];
  sections.push("💡 *TỔNG QUAN (TỪ CACHE)*");
  const first = snapshots[0];
  sections.push(first?.analysis?.summary || "Không có tóm tắt.");

  const matchSections: string[] = [];
  for (const payload of payloads) {
    const snapshot = snapshotByGameId.get(payload.gameId);
    if (!snapshot) continue;
    const analysis = snapshot.analysis;
    const lines: string[] = [];

    lines.push("────────────────────────");
    lines.push(`🏟️  *${analysis.match}*`);
    lines.push("────────────────────────");
    lines.push("");
    lines.push("📊 *ODDS CHÍNH*");

    const oddsItems: string[] = [];
    const handicap = findMarket(payload, "asia_handicap");
    if (handicap?.outcomes.length) {
      const filtered = handicap.outcomes.filter((outcome) => outcome.price >= 1.8 && outcome.price <= 2.3);
      if (filtered.length > 0) {
        const points = [...new Set(filtered.map((outcome) => Math.abs(outcome.point ?? 0)))];
        for (const point of points.sort((left, right) => Math.abs(left - 0.75) - Math.abs(right - 0.75))) {
          const home = filtered.find((outcome) => outcome.name === "H" && Math.abs(Math.abs(outcome.point ?? 0) - point) < 0.01);
          const away = filtered.find((outcome) => outcome.name === "A" && Math.abs(Math.abs(outcome.point ?? 0) - point) < 0.01);
          if (home && away) {
            const sign = home.point ? (home.point > 0 ? "+" : "-") : "+";
            oddsItems.push(`Chấp: H${sign}${point} @${home.price}  |  A${sign === "+" ? "-" : "+"}${point} @${away.price}`);
            break;
          }
        }
      }
    }

    const euTotals = findMarket(payload, "eu_totals");
    if (euTotals?.outcomes.length) {
      const validPoints = [2.5, 2.0, 2.75];
      for (const point of validPoints) {
        const over = euTotals.outcomes.find((outcome) => outcome.name === "Over" && Math.abs((outcome.point ?? 0) - point) < 0.01);
        const under = euTotals.outcomes.find((outcome) => outcome.name === "Under" && Math.abs((outcome.point ?? 0) - point) < 0.01);
        if (over && under) {
          oddsItems.push(`Tài/Xỉu: Tài ${point} @${over.price}  |  Xỉu ${point} @${under.price}`);
          break;
        }
      }
    }

    if (oddsItems.length > 0) lines.push(oddsItems.join("\n"));

    lines.push("");
    if (analysis.picks.length > 0) {
      lines.push(`🎯 *NHẬN ĐỊNH - ${analysis.picks.length} KÈO NÊN CHƠI:*`);
      lines.push("");
      for (let i = 0; i < analysis.picks.length; i += 1) {
        const pick = analysis.picks[i];
        const prefix = i === 0 ? "🏆 **#1 - CHÍNH THỨC**" : i === 1 ? "🥈 **#2 - PHỤ**" : `📌 **#${i + 1}**`;
        lines.push(prefix);
        lines.push(`Confidence: ${pick.confidence}%`);
        lines.push(`- ${pick.market}: *${pick.selection}* @ ${pick.odds}`);
        if (pick.reason) lines.push(`- "${compactText(pick.reason)}"`);
        if (i < analysis.picks.length - 1) lines.push("");
      }
    } else {
      lines.push("⏸️ *KHÔNG CÓ KÈO ĐỦ TIN CẬY*");
      lines.push("Nên đứng ngoài và theo dõi thêm");
    }

    lines.push("");
    lines.push(`🔮 *DỰ ĐOÁN TỈ SỐ:* ${analysis.predictedScore.score} (${analysis.predictedScore.confidence}% tự tin)`);
    if (analysis.note) lines.push(`📝 *GHI CHÚ:* ${analysis.note}`);

    matchSections.push(lines.join("\n"));
  }

  if (matchSections.length > 0) sections.push(matchSections.join("\n\n"));
  return sections.join("\n\n");
}
