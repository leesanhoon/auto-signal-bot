import "../../shared/infra/env.js";
import { createBettingApiClient } from "../client/betting-api-client.js";
import { getDb } from "../../shared/infra/db.js";
import { createMatchRepository } from "../repository/match-repository.js";
import { createBettingService } from "../service/betting-service.js";
import { notifyError } from "../../shared/notification/telegram-client.js";
import { createLogger } from "../../shared/infra/logger.js";
import type { MatchInfo } from "../model/betting-types.js";

const logger = createLogger("betting:fetch-matches-list-index");
const DAYS_AHEAD = 2;

function utcDateOffsetStr(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function main(): Promise<void> {
  logger.info(`📡 Fetch Matches List — Starting (${DAYS_AHEAD} ngày tới)...\n`);

  const bettingApiClient = createBettingApiClient();
  const bettingService = createBettingService({ bettingApiClient });
  const matchRepository = createMatchRepository(getDb());

  const allMatches: MatchInfo[] = [];
  for (let offset = -1; offset < DAYS_AHEAD; offset++) {
    const dateStr = utcDateOffsetStr(offset);
    const raw = await bettingApiClient.fetchFixtures(dateStr);
    const matches = bettingService.extractMatches(raw);
    allMatches.push(...matches);
    logger.info(`  ✓ UTC ${dateStr}: ${matches.length} trận`);
  }

  await matchRepository.saveMatches(allMatches);

  const byDate = new Map<string, number>();
  for (const m of allMatches) byDate.set(m.date, (byDate.get(m.date) ?? 0) + 1);
  logger.info(`\n✓ ${allMatches.length} trận đấu (đã lưu DB), theo ngày VN:`);
  for (const [date, count] of [...byDate.entries()].sort()) logger.info(`  - ${date}: ${count} trận`);
}

main().catch(async (error) => {
  logger.error("Fatal error:", error);
  await notifyError("Fetch Matches List", error);
  process.exit(1);
});
