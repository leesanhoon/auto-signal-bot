import { beforeEach, describe, expect, test, vi } from "vitest";

// ── Mock supabase client ─────────────────────────────────────────────
const repoState = vi.hoisted(() => ({
  results: [] as Array<{ data: any[]; error: any }>,
  resultIndex: 0,
  from: vi.fn(),
}));

vi.mock("../../src/shared/infra/db.js", () => ({
  getDb: () => ({ from: repoState.from }),
}));

const lotteryRepo = await import("../../src/lottery/repository/lottery-repository.js");

// ── Tests ────────────────────────────────────────────────────────────
describe("lottery-repository", () => {
  beforeEach(() => {
    repoState.from.mockReset();
    repoState.results = [];
    repoState.resultIndex = 0;

    // Chain giả lập supabase: hỗ trợ .select().eq().range().
    // Mỗi lần gọi .range() trả về response từ results array.
    const chain: Record<string, ReturnType<typeof vi.fn>> = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      range: vi.fn(async () => {
        const result = repoState.results[repoState.resultIndex];
        repoState.resultIndex++;
        return result || { data: [], error: null };
      }),
    };

    repoState.from.mockReturnValue(chain);
  });

  // ── loadWeekdayHistory ─────────────────────────────────────────────
  describe("loadWeekdayHistory", () => {
    test("trả lại data khi response đơn trang (< 1000 rows)", async () => {
      const mockData = [
        {
          date: "2026-07-15",
          weekday: 3,
          region: "mien-bac",
          province: "Ha Noi",
          prizes: { prize1: "123" },
        },
        {
          date: "2026-07-08",
          weekday: 3,
          region: "mien-trung",
          province: "Da Nang",
          prizes: { prize1: "456" },
        },
      ];
      repoState.results = [{ data: mockData, error: null }];

      const result = await lotteryRepo.loadWeekdayHistory(3);

      expect(result).toEqual(mockData);
      expect(result.length).toBe(2);
    });

    test("tập hợp data từ nhiều trang khi response đa trang (>= 1000 rows)", async () => {
      // Trang 1: 1000 rows (full page)
      const page1 = Array.from({ length: 1000 }, (_, i) => ({
        date: `2026-07-${String(i).padStart(2, "0")}`,
        weekday: 3,
        region: "mien-bac",
        province: "Ha Noi",
        prizes: { prize1: String(i) },
      }));

      // Trang 2: 500 rows (partial page, stop pagination)
      const page2 = Array.from({ length: 500 }, (_, i) => ({
        date: `2026-08-${String(i).padStart(2, "0")}`,
        weekday: 3,
        region: "mien-bac",
        province: "Ha Noi",
        prizes: { prize1: String(1000 + i) },
      }));

      repoState.results = [
        { data: page1, error: null },
        { data: page2, error: null },
      ];

      const result = await lotteryRepo.loadWeekdayHistory(3);

      expect(result.length).toBe(1500);
      expect(result[0].date).toBe("2026-07-00");
      expect(result[1000].date).toBe("2026-08-00");
      expect(result[1499].date).toBe("2026-08-499");
    });

    test("dừng pagination khi nhận empty array", async () => {
      const mockData = [
        {
          date: "2026-07-15",
          weekday: 3,
          region: "mien-bac",
          province: "Ha Noi",
          prizes: { prize1: "123" },
        },
      ];
      repoState.results = [
        { data: mockData, error: null },
        { data: [], error: null }, // Stop on empty
      ];

      const result = await lotteryRepo.loadWeekdayHistory(3);

      expect(result).toEqual(mockData);
      expect(result.length).toBe(1);
      // Verify .range() được gọi đúng 1 lần (chỉ lần đầu)
      expect(repoState.from().range.mock.calls.length).toBe(1);
    });

    test("throw error khi Supabase trả lỗi", async () => {
      repoState.results = [
        {
          data: null,
          error: { message: "Database error" },
        },
      ];

      await expect(lotteryRepo.loadWeekdayHistory(3)).rejects.toThrow(
        /loadWeekdayHistory failed.*Database error/,
      );
    });

    test("gọi đúng .eq('weekday', 3) và .range() với offset đúng", async () => {
      repoState.results = [{ data: [], error: null }];

      await lotteryRepo.loadWeekdayHistory(3);

      expect(repoState.from).toHaveBeenCalledWith("lottery_draws");
      expect(repoState.from().select).toHaveBeenCalledWith(
        "date, weekday, region, province, prizes",
      );
      expect(repoState.from().select().eq).toHaveBeenCalledWith("weekday", 3);
      // .range(0, 999)
      expect(repoState.from().select().eq().range).toHaveBeenCalledWith(0, 999);
    });

    test("gọi .range() với offset đúng cho trang thứ 2", async () => {
      // Page 1: full 1000 rows
      const page1 = Array.from({ length: 1000 }, (_, i) => ({
        date: `2026-07-${String(i).padStart(2, "0")}`,
        weekday: 3,
        region: "mien-bac",
        province: "Ha Noi",
        prizes: { prize1: String(i) },
      }));
      // Page 2: 100 rows (stop)
      const page2 = Array.from({ length: 100 }, (_, i) => ({
        date: `2026-08-${String(i).padStart(2, "0")}`,
        weekday: 3,
        region: "mien-bac",
        province: "Ha Noi",
        prizes: { prize1: String(1000 + i) },
      }));

      repoState.results = [
        { data: page1, error: null },
        { data: page2, error: null },
      ];

      await lotteryRepo.loadWeekdayHistory(3);

      const rangeCalls = repoState.from().select().eq().range.mock.calls;
      expect(rangeCalls[0]).toEqual([0, 999]); // Page 1
      expect(rangeCalls[1]).toEqual([1000, 1999]); // Page 2
    });
  });

  // ── loadRegionHistory ────────────────────────────────────────────────
  describe("loadRegionHistory", () => {
    test("trả lại data khi response đơn trang (< 1000 rows)", async () => {
      const mockData = [
        {
          date: "2026-07-15",
          weekday: 3,
          region: "mien-bac",
          province: "Ha Noi",
          prizes: { prize1: "123" },
        },
        {
          date: "2026-07-16",
          weekday: 4,
          region: "mien-bac",
          province: "Ha Noi",
          prizes: { prize1: "456" },
        },
      ];
      repoState.results = [{ data: mockData, error: null }];

      const result = await lotteryRepo.loadRegionHistory("mien-bac");

      expect(result).toEqual(mockData);
      expect(result.length).toBe(2);
    });

    test("tập hợp data từ nhiều trang khi response đa trang", async () => {
      // Trang 1: 1000 rows
      const page1 = Array.from({ length: 1000 }, (_, i) => ({
        date: `2026-07-${String(i).padStart(2, "0")}`,
        weekday: i % 7,
        region: "mien-trung",
        province: "Da Nang",
        prizes: { prize1: String(i) },
      }));

      // Trang 2: 300 rows (partial)
      const page2 = Array.from({ length: 300 }, (_, i) => ({
        date: `2026-08-${String(i).padStart(2, "0")}`,
        weekday: (i + 1000) % 7,
        region: "mien-trung",
        province: "Da Nang",
        prizes: { prize1: String(1000 + i) },
      }));

      repoState.results = [
        { data: page1, error: null },
        { data: page2, error: null },
      ];

      const result = await lotteryRepo.loadRegionHistory("mien-trung");

      expect(result.length).toBe(1300);
      expect(result[0].region).toBe("mien-trung");
      expect(result[1299].region).toBe("mien-trung");
    });

    test("dừng pagination khi nhận empty array", async () => {
      const mockData = [
        {
          date: "2026-07-15",
          weekday: 3,
          region: "mien-nam",
          province: "HCM",
          prizes: { prize1: "789" },
        },
      ];
      repoState.results = [
        { data: mockData, error: null },
        { data: [], error: null },
      ];

      const result = await lotteryRepo.loadRegionHistory("mien-nam");

      expect(result).toEqual(mockData);
      expect(result.length).toBe(1);
      expect(repoState.from().range.mock.calls.length).toBe(1);
    });

    test("throw error khi Supabase trả lỗi", async () => {
      repoState.results = [
        {
          data: null,
          error: { message: "Connection failed" },
        },
      ];

      await expect(
        lotteryRepo.loadRegionHistory("mien-bac"),
      ).rejects.toThrow(/loadRegionHistory failed.*Connection failed/);
    });

    test("gọi đúng .eq('region', 'mien-bac') và .range() với offset", async () => {
      repoState.results = [{ data: [], error: null }];

      await lotteryRepo.loadRegionHistory("mien-bac");

      expect(repoState.from).toHaveBeenCalledWith("lottery_draws");
      expect(repoState.from().select).toHaveBeenCalledWith(
        "date, weekday, region, province, prizes",
      );
      expect(repoState.from().select().eq).toHaveBeenCalledWith(
        "region",
        "mien-bac",
      );
      expect(repoState.from().select().eq().range).toHaveBeenCalledWith(0, 999);
    });

    test("gọi .range() với offset đúng cho trang thứ 2 và 3", async () => {
      // Page 1: 1000 rows
      const page1 = Array.from({ length: 1000 }, (_, i) => ({
        date: `2026-07-${String(i).padStart(2, "0")}`,
        weekday: i % 7,
        region: "mien-nam",
        province: "HCM",
        prizes: { prize1: String(i) },
      }));
      // Page 2: 1000 rows
      const page2 = Array.from({ length: 1000 }, (_, i) => ({
        date: `2026-08-${String(i).padStart(2, "0")}`,
        weekday: (i + 1000) % 7,
        region: "mien-nam",
        province: "HCM",
        prizes: { prize1: String(1000 + i) },
      }));
      // Page 3: 200 rows (stop)
      const page3 = Array.from({ length: 200 }, (_, i) => ({
        date: `2026-09-${String(i).padStart(2, "0")}`,
        weekday: (i + 2000) % 7,
        region: "mien-nam",
        province: "HCM",
        prizes: { prize1: String(2000 + i) },
      }));

      repoState.results = [
        { data: page1, error: null },
        { data: page2, error: null },
        { data: page3, error: null },
      ];

      await lotteryRepo.loadRegionHistory("mien-nam");

      const rangeCalls = repoState.from().select().eq().range.mock.calls;
      expect(rangeCalls[0]).toEqual([0, 999]); // Page 1
      expect(rangeCalls[1]).toEqual([1000, 1999]); // Page 2
      expect(rangeCalls[2]).toEqual([2000, 2999]); // Page 3
    });
  });
});
