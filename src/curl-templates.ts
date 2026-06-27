import { sendMessage } from "./telegram.js";
import { loadSentTemplateIds, markTemplateSent } from "./cache.js";
import type { MatchInfo } from "./betting-types.js";

/** Khớp với danh sách 17 market giữ lại trong src/betting.ts (EXCLUDED_MARKETS). */
const MARKETS =
  "h2h,spreads,totals,btts,double_chance,alternate_spreads,alternate_totals," +
  "alternate_spreads_h1,alternate_spreads_h2,alternate_totals_h1,alternate_totals_h2," +
  "btts_h1,btts_h2,double_chance_h1,double_chance_h2,h2h_3_way_h1,h2h_3_way_h2";

function vnDate(kickoffUnix: number): string {
  return new Date(kickoffUnix * 1000).toLocaleDateString("en-CA", { timeZone: "Asia/Ho_Chi_Minh" });
}

function buildCurlCommand(match: MatchInfo): string {
  return (
    `https://api.the-odds-api.com/v4/sports/soccer_fifa_world_cup/events/${match.gameId}/odds/` +
    `?regions=eu&markets=${MARKETS}&oddsFormat=decimal` +
    `&bookmakers=onexbet&apiKey=fce29e1915838032f11e3f812494abcb`
  );
}

function buildMessage(match: MatchInfo): string {
  const kickoffVN = new Date(match.kickoffUnix * 1000).toLocaleString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  return `⚽ *${match.home} vs ${match.away}*\n⏰ ${kickoffVN}\n\n\`\`\`\n${buildCurlCommand(match)}\n\`\`\``;
}

/**
 * Gửi lệnh curl lấy odds thủ công cho các trận trong "ngày thi đấu" gần nhất
 * (ngày của trận sắp diễn ra sớm nhất — vì giờ đá có thể rơi vào rạng sáng
 * hôm sau theo giờ VN nên không dùng "hôm nay" theo lịch tuyệt đối). Mỗi
 * trận chỉ gửi đúng 1 lần (đánh dấu qua data/sent-curl-templates.json), an
 * toàn để gọi lại ở mọi lần bot chạy — lần sau sẽ tự bỏ qua trận đã gửi.
 */
export async function sendDailyCurlTemplates(matches: MatchInfo[], now: number = Date.now()): Promise<void> {
  const upcoming = matches.filter((m) => m.kickoffUnix * 1000 > now);
  if (upcoming.length === 0) return;

  const targetDate = vnDate(Math.min(...upcoming.map((m) => m.kickoffUnix)));
  const todayMatches = matches.filter((m) => vnDate(m.kickoffUnix) === targetDate);

  const sentIds = loadSentTemplateIds();
  const toSend = todayMatches.filter((m) => !sentIds.has(m.gameId));
  if (toSend.length === 0) return;

  console.log(`📋 Gửi lệnh curl thủ công cho ${toSend.length} trận ngày ${targetDate}...`);
  for (const match of toSend) {
    await sendMessage(buildMessage(match));
    markTemplateSent(match.gameId, sentIds);
    await new Promise((resolve) => setTimeout(resolve, 600));
  }
}
