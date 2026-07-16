import type { CompactPrizes, LotteryDrawRecord, LotteryRegion } from "../model/lottery-types.js";
import { REGION_URL_CODE, weekdayPageUrl } from "../service/lottery-schedule.js";

/** Nhãn giải (thứ tự xuất hiện trên xoso.com.vn) → key trong CompactPrizes. */
const LABEL_TO_KEY: Record<string, keyof CompactPrizes> = {
  "ĐB": "db",
  "1": "g1",
  "2": "g2",
  "3": "g3",
  "4": "g4",
  "5": "g5",
  "6": "g6",
  "7": "g7",
  "8": "g8",
};

function emptyPrizes(): CompactPrizes {
  return { db: "", g1: "", g2: [], g3: [], g4: [], g5: [], g6: [], g7: [], g8: [] };
}

/** Lấy HTML trang tổng hợp ~7 tuần gần nhất, đúng 1 miền + đúng 1 thứ, từ xoso.com.vn (free, không cần key). */
export async function fetchWeekdayPage(region: LotteryRegion, weekday: number): Promise<string> {
  const url = weekdayPageUrl(region, weekday);
  const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!response.ok) {
    throw new Error(`xoso.com.vn trả về lỗi (${response.status}) cho ${url}`);
  }
  return response.text();
}

/**
 * Lấy HTML của đúng 1 ngày cụ thể (vd `xsmb-22-06-2026.html`) — dùng để backfill lịch sử sâu
 * (vd 1 năm), vì trang "theo thứ" (`weekdayPageUrl`) chỉ chứa sẵn ~1-7 tuần gần nhất tuỳ miền.
 * Trang 1-ngày dùng đúng marker `kqngay_DDMMYYYY` như trang theo-thứ nên tái dùng `parseWeekdayPage`
 * được luôn (chỉ có 1 block duy nhất).
 */
export async function fetchDayPage(region: LotteryRegion, dateStr: string): Promise<string> {
  const [y, m, d] = dateStr.split("-");
  const url = `https://xoso.com.vn/${REGION_URL_CODE[region]}-${d}-${m}-${y}.html`;
  const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!response.ok) {
    throw new Error(`xoso.com.vn trả về lỗi (${response.status}) cho ${url}`);
  }
  return response.text();
}

/**
 * Lấy + parse + lọc kết quả thật đúng 1 ngày, bỏ record rỗng (chưa quay/lỗi parse) — dùng chung
 * cho lottery-runner/lottery-predict-runner/lottery-verify-runner thay vì mỗi nơi lặp lại
 * `fetchDayPage` + `parseWeekdayPage` + filter riêng.
 */
export async function fetchActualRecords(region: LotteryRegion, dateStr: string, weekday: number): Promise<LotteryDrawRecord[]> {
  const html = await fetchDayPage(region, dateStr);
  return parseWeekdayPage(html, region, weekday).filter((r) => r.prizes.db !== "");
}

type Block = { dateStr: string; html: string };

/**
 * Tách HTML (đã gộp 1 dòng) thành các block theo ngày. Marker `kqngay_DDMMYYYY[_kq]><table...`
 * luôn nằm ngay trước bảng kết quả của đúng ngày đó — chỉ lấy đúng 1 `<table>...</table>` mỗi
 * marker, KHÔNG lấy tới marker kế tiếp, vì cuối trang còn nhiều widget khác (thống kê, liên quan)
 * dùng lại cùng class "prizeN" có thể bị gộp nhầm vào block cuối nếu cắt theo khoảng giữa 2 marker.
 */
function splitBlocksByDate(flatHtml: string): Block[] {
  // Thứ tự attribute trong tag khác nhau giữa các trang ("...kq><table ..." hoặc
  // "...kq class=...><table ..."), nên cho phép tối đa 1 attribute khác xen giữa, miễn
  // cùng nằm trong tag chứa marker (không vượt quá dấu `>` đầu tiên) rồi mới tới `<table`.
  const re = /kqngay_(\d{2})(\d{2})(\d{4})(?:_kq)?[^<>]*><table/g;
  const blocks: Block[] = [];
  const seenDates = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(flatHtml))) {
    const dateStr = `${m[3]}-${m[2]}-${m[1]}`;
    if (seenDates.has(dateStr)) continue;
    seenDates.add(dateStr);

    const tableStart = m.index + m[0].length - "<table".length;
    const tableEnd = flatHtml.indexOf("</table>", tableStart);
    if (tableEnd === -1) continue;
    blocks.push({ dateStr, html: flatHtml.slice(tableStart, tableEnd + "</table>".length) });
  }
  return blocks;
}

/** Miền Bắc: 1 đài duy nhất, class "special-prize"/"prizeN" (không có cột tỉnh). */
function parseSingleStationBlock(blockHtml: string): CompactPrizes {
  const grab = (cls: string): string[] =>
    [...blockHtml.matchAll(new RegExp(`class=${cls}>\\s*([0-9]+)`, "g"))].map((x) => x[1]);
  return {
    db: grab("special-prize")[0] ?? "",
    g1: grab("prize1")[0] ?? "",
    g2: grab("prize2"),
    g3: grab("prize3"),
    g4: grab("prize4"),
    g5: grab("prize5"),
    g6: grab("prize6"),
    g7: grab("prize7"),
    g8: [],
  };
}

/** Miền Trung/Nam: nhiều đài/cột, class "xs_prizeN" + attr `data-loto=`, header có tên tỉnh. */
function parseMultiStationBlock(blockHtml: string): { province: string; prizes: CompactPrizes }[] {
  const provinceNames = [...blockHtml.matchAll(/<h3><a title="Xổ số ([^"]+)"/g)].map((x) => x[1]);
  if (provinceNames.length === 0) return [];

  const stations = provinceNames.map((province) => ({ province, prizes: emptyPrizes() }));

  const bodyStart = blockHtml.indexOf("<tbody>");
  const body = bodyStart >= 0 ? blockHtml.slice(bodyStart) : blockHtml;
  const rows = body.split("<tr>").slice(1);

  for (const row of rows) {
    const labelMatch = row.match(/^<th>([^<]+)</);
    if (!labelMatch) continue;
    const key = LABEL_TO_KEY[labelMatch[1]];
    if (!key) continue;

    const cells = row.split("<td>").slice(1, 1 + stations.length);
    cells.forEach((cell, i) => {
      const numbers = [...cell.matchAll(/data-loto=([0-9]+)/g)].map((x) => x[1]);
      if (numbers.length === 0) return;
      if (key === "db" || key === "g1") {
        stations[i].prizes[key] = numbers[0];
      } else {
        stations[i].prizes[key] = numbers;
      }
    });
  }

  return stations;
}

/** Scrape + parse toàn bộ block (mỗi ngày) của trang "theo thứ" thành các LotteryDrawRecord. */
export function parseWeekdayPage(html: string, region: LotteryRegion, weekday: number): LotteryDrawRecord[] {
  const flat = html.replace(/[\r\n]/g, "");
  const blocks = splitBlocksByDate(flat);
  const records: LotteryDrawRecord[] = [];

  for (const block of blocks) {
    if (region === "mien-bac") {
      records.push({
        date: block.dateStr,
        weekday,
        region,
        province: "Miền Bắc",
        prizes: parseSingleStationBlock(block.html),
      });
    } else {
      for (const station of parseMultiStationBlock(block.html)) {
        records.push({
          date: block.dateStr,
          weekday,
          region,
          province: station.province,
          prizes: station.prizes,
        });
      }
    }
  }

  return records;
}
