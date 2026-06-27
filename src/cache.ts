import fs from "fs";
import path from "path";
import type { MatchInfo, MatchOddsPayload } from "./betting-types.js";

const DATA_DIR = path.join(process.cwd(), "data");
const MATCHES_CACHE_FILE = path.join(DATA_DIR, "matches-list.json");
const ODDS_CACHE_DIR = path.join(DATA_DIR, "odds");
const SENT_TEMPLATES_FILE = path.join(DATA_DIR, "sent-curl-templates.json");

const ODDS_CACHE_GRACE_SECONDS = 2 * 60 * 60;

export type DailyMatchesCache = { date: string; matches: MatchInfo[] };

export function getVietnamDateString(now: number = Date.now()): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(now));
}

export function loadDailyMatchesCache(): DailyMatchesCache | null {
  try {
    const raw = fs.readFileSync(MATCHES_CACHE_FILE, "utf-8");
    return JSON.parse(raw) as DailyMatchesCache;
  } catch {
    return null;
  }
}

export function saveDailyMatchesCache(matches: MatchInfo[], now: number = Date.now()): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const cache: DailyMatchesCache = { date: getVietnamDateString(now), matches };
  fs.writeFileSync(MATCHES_CACHE_FILE, JSON.stringify(cache, null, 2), "utf-8");
}

export function isDailyCacheValid(cache: DailyMatchesCache | null, now: number = Date.now()): boolean {
  return cache !== null && cache.date === getVietnamDateString(now);
}

export function hasOddsCache(gameId: string): boolean {
  return fs.existsSync(path.join(ODDS_CACHE_DIR, `${gameId}.json`));
}

export function saveOddsCache(payload: MatchOddsPayload): void {
  fs.mkdirSync(ODDS_CACHE_DIR, { recursive: true });
  const filepath = path.join(ODDS_CACHE_DIR, `${payload.gameId}.json`);
  fs.writeFileSync(filepath, JSON.stringify(payload), "utf-8");
}

export function loadSentTemplateIds(): Set<string> {
  try {
    const raw = fs.readFileSync(SENT_TEMPLATES_FILE, "utf-8");
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

export function markTemplateSent(gameId: string, sentIds: Set<string>): void {
  sentIds.add(gameId);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SENT_TEMPLATES_FILE, JSON.stringify([...sentIds], null, 2), "utf-8");
}

export function cleanupExpiredOddsCache(now: number = Date.now()): void {
  if (!fs.existsSync(ODDS_CACHE_DIR)) return;

  const nowSeconds = now / 1000;
  for (const filename of fs.readdirSync(ODDS_CACHE_DIR)) {
    const filepath = path.join(ODDS_CACHE_DIR, filename);
    try {
      const payload = JSON.parse(fs.readFileSync(filepath, "utf-8")) as MatchOddsPayload;
      if (payload.kickoffUnix + ODDS_CACHE_GRACE_SECONDS < nowSeconds) {
        fs.unlinkSync(filepath);
        console.log(`  🗑 Đã xóa cache hết hạn: ${filename}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`  ⚠ File cache lỗi, bỏ qua (không xóa): ${filename} — ${message}`);
    }
  }
}
