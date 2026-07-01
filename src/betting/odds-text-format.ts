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
    if (a) parts.push(`A${fmtSignedPoint(point)}=${a.price}`);
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
  return formatOddsText(payload);
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
  return `Chap ${fmtSignedPoint(point)}: ${h.price}/${a.price}`;
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
  return `Tai/Xiu ${fmtNum(point)}: ${over.price}/${under.price}`;
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
  const mainOdds = formatMainOddsSummary(payload);
  const confidenceLabel =
    analysis.confidence >= 70
      ? "cao"
      : analysis.confidence >= 40
        ? "trung binh"
        : "thap";
  const scoreConfidenceLabel =
    analysis.scoreConfidence >= 70
      ? "cao"
      : analysis.scoreConfidence >= 40
        ? "trung binh"
        : "thap";
  const verificationLine =
    analysis.verifiedConfirmed !== undefined
      ? analysis.verifiedConfirmed
        ? `✅ Đã được xác nhận bởi chuyên gia (${analysis.verifiedConfidence ?? 0}%)${
            analysis.verifiedComment ? ` — ${analysis.verifiedComment}` : ""
          }`
        : analysis.revisedAfterReject
          ? `⚠️ Nhận định này được điều chỉnh sau khi chuyên gia từ chối (${analysis.verifiedConfidence ?? 0}%)${
              analysis.verifiedComment ? ` — ${analysis.verifiedComment}` : ""
            }`
          : `⚠️ Chuyên gia không xác nhận kết quả này (${analysis.verifiedConfidence ?? 0}%)${
              analysis.verifiedComment ? ` — ${analysis.verifiedComment}` : ""
            }`
      : "";

  const lines = [
    `*${payload.home} vs ${payload.away}*`,
    `Ti so uu tien: *${analysis.preferredScoreline}*`,
    `Tin cay ti so: *${analysis.scoreConfidence}%* (${scoreConfidenceLabel})`,
    `Khuyen nghi: *${analysis.recommendation}*`,
    `Do ro tin hieu: *${analysis.confidence}%* (${confidenceLabel})`,
    verificationLine,
    mainOdds ? `Keo chinh: ${mainOdds}` : "",
    "",
    `Tom tat: ${analysis.summary}`,
    "",
    "*Diem dang chu y:*",
    ...analysis.keyPoints.map((point) => `- ${point}`),
    "",
    "*Rui ro can luu y:*",
    ...analysis.risks.map((risk) => `- ${risk}`),
  ].filter((line) => line !== "");

  return lines.join("\n");
}

export function formatOddsFallbackMessage(
  payload: MatchOddsPayload,
  reason: string,
): string {
  return [
    `*${payload.home} vs ${payload.away}*`,
    `_Gemini tam thoi chua phan tich duoc tran nay: ${reason}_`,
    "",
    formatOddsDataMessage(payload),
  ].join("\n");
}

export function formatOddsDataMessage(payload: MatchOddsPayload): string {
  return ["*Du lieu odds tho:*", "```", formatOddsText(payload), "```"].join(
    "\n",
  );
}
