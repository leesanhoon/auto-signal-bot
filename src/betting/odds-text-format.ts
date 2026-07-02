import type {
  CompactMarket,
  CompactOutcome,
  MatchAiAnalysis,
  MatchOddsPayload,
} from "./betting-types.js";

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
    const outcomes = market.outcomes.map((outcome) => {
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

export function formatMatchAnalysisMessage(
  payload: MatchOddsPayload,
  analysis: MatchAiAnalysis,
): string {
  const isStandAside =
    /[dđ][uứ]ng\s*(ngo[aà]i|l[aạ]i)|kh[oô]ng\s+(c[oó]\s+)?(k[eè]o|edge)/i.test(
      analysis.recommendation,
    );
  const confidenceLabel =
    analysis.confidence >= 70
      ? "CAO"
      : analysis.confidence >= 40
        ? "TRUNG BÌNH"
        : "THẤP";
  const compact = (value: string, maxLength = 140): string => {
    const normalized = value.replace(/\s+/g, " ").trim();
    return normalized.length > maxLength
      ? `${normalized.slice(0, maxLength - 1).trimEnd()}…`
      : normalized;
  };
  const keyPoints = analysis.keyPoints.filter(Boolean).slice(0, 2);
  const risks = analysis.risks.filter(Boolean).slice(0, 2);
  const confidenceStars =
    analysis.confidence >= 80
      ? "⭐⭐⭐⭐⭐"
      : analysis.confidence >= 65
        ? "⭐⭐⭐⭐"
        : analysis.confidence >= 50
          ? "⭐⭐⭐"
          : analysis.confidence >= 35
            ? "⭐⭐"
            : "⭐";
  const picks = (analysis.picks ?? []).slice(0, 3);
  const verifyLabel =
    analysis.verificationStatus === "confirmed"
      ? "✅ *Thẩm định:* đạt"
    : analysis.verificationStatus === "revised"
            ? "🔄 *Thẩm định:* đã hiệu chỉnh"
        : analysis.verificationStatus === "failed"
          ? "⚠️ *Thẩm định:* lỗi model"
          : analysis.verificationStatus === "skipped"
            ? "🤖 *Chế độ:* AI phân tích trực tiếp"
            : "🤖 *Chế độ:* AI phân tích trực tiếp";
  const sections: string[] = [
    [
      `🏟 *${payload.home} (H) vs ${payload.away} (A)*`,
      `⭐ *Độ tin cậy: ${confidenceLabel}* ${confidenceStars}`,
      verifyLabel,
    ].join("\n"),
  ];

  if (picks.length > 0) {
    sections.push(
      [
        "🎯 *KÈO ĐỀ XUẤT*",
        ...picks.map((pick, index) => {
          const reason = pick.reason ? `\n   _Lý do:_ ${compact(pick.reason, 100)}` : "";
          return `${index + 1}. *${compact(pick.selection, 60)}*  \`@${pick.odds}\`\n   _${compact(pick.market, 35)}_${reason}`;
        }),
      ].join("\n"),
    );
  } else if (!isStandAside) {
    sections.push(`🎯 *KÈO ĐỀ XUẤT*\n• ${compact(analysis.recommendation, 120)}`);
  }
  sections.push(`⚽ *Tỷ số dự đoán:* ${analysis.preferredScoreline} _(${analysis.scoreConfidence}%)_`);

  if (keyPoints.length > 0) sections.push(`🔎 *Nhận định:* ${compact(keyPoints[0])}`);
  if (risks.length > 0) sections.push(`⚠️ *Rủi ro:* ${compact(risks[0])}`);

  return sections.join("\n\n");
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

export function formatOddsDataMessage(payload: MatchOddsPayload): string {
  return ["*Dữ liệu odds thô:*", "```", formatOddsText(payload), "```"].join(
    "\n",
  );
}
