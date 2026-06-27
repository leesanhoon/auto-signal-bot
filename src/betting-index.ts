import "./env.js";
import { fetchGamesByChamp } from "./betting-api.js";
import { extractMatches, filterUpcomingWithin, buildOddsPayload } from "./betting.js";
import { sendMessage, sendDocument } from "./telegram.js";

const HOURS_WINDOW = 4;

async function main(): Promise<void> {
  console.log("🏆 Match Odds Scanner — Starting...\n");

  console.log("📡 Lấy danh sách trận đấu...");
  const raw = await fetchGamesByChamp();
  const matches = extractMatches(raw);
  console.log(`✓ ${matches.length} trận đội tuyển quốc gia (đã loại placeholder)\n`);

  const upcoming = filterUpcomingWithin(matches, HOURS_WINDOW);
  console.log(`✓ ${upcoming.length} trận sắp đá trong ${HOURS_WINDOW}h tới\n`);

  if (upcoming.length === 0) {
    await sendMessage(`⏸ Không có trận đội tuyển quốc gia nào sắp đá trong ${HOURS_WINDOW}h tới.`);
    console.log("→ Không có trận nào. Đã gửi thông báo.");
    return;
  }

  console.log("📊 Lấy kèo chi tiết từng trận...");
  const payload = await buildOddsPayload(upcoming);

  if (payload.length === 0) {
    await sendMessage(`⚠️ Tìm thấy ${upcoming.length} trận sắp đá nhưng không lấy được kèo cho trận nào (có thể x-hd token đã hết hạn).`);
    console.log("→ Không lấy được kèo cho trận nào. Đã gửi cảnh báo.");
    return;
  }

  const buffer = Buffer.from(JSON.stringify(payload, null, 2));
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const matchNames = payload.map((m) => `${m.home} vs ${m.away}`).join(", ");
  const caption = `🏆 Kèo ${payload.length} trận sắp đá trong ${HOURS_WINDOW}h tới: ${matchNames}`;

  await sendDocument(buffer, `odds-${timestamp}.json`, caption);
  console.log(`\n✅ Đã gửi file kèo (${payload.length} trận) lên Telegram.`);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
