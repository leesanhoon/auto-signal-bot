import { beforeEach, describe, expect, test, vi } from "vitest";

// ── Mock supabase client ─────────────────────────────────────────────
// Dùng vi.hoisted() để tạo state có thể thay đổi trong từng test
// mà vẫn dùng được bên trong vi.mock() (hoisted lên trên import).
const repoState = vi.hoisted(() => ({
  maybeSingleResult: null as {
    data: { drawn: boolean } | null;
    error: { message: string } | null;
  } | null,
  from: vi.fn(),
}));

vi.mock("../../src/shared/infra/db.js", () => ({
  getDb: () => ({ from: repoState.from }),
}));

const lotteryRepo = await import(
  "../../src/lottery/lottery-draw-status-repository.js"
);

// ── Tests ────────────────────────────────────────────────────────────
describe("lottery-draw-status-repository", () => {
  beforeEach(() => {
    repoState.from.mockReset();

    // Chain giả lập supabase: mỗi method trả về chính chain để nối tiếp.
    const chain: Record<string, ReturnType<typeof vi.fn>> = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      maybeSingle: vi.fn(async () => repoState.maybeSingleResult),
      upsert: vi.fn(async () => ({ error: null })),
    };

    repoState.from.mockReturnValue(chain);
  });

  // ── loadDrawStatus ─────────────────────────────────────────────────
  describe("loadDrawStatus", () => {
    test("trả true khi data.drawn=true và không có lỗi", async () => {
      repoState.maybeSingleResult = { data: { drawn: true }, error: null };

      const result = await lotteryRepo.loadDrawStatus("2026-07-03", "mien-bac");

      expect(result).toBe(true);
    });

    test("trả false khi data.drawn=false và không có lỗi", async () => {
      repoState.maybeSingleResult = { data: { drawn: false }, error: null };

      const result = await lotteryRepo.loadDrawStatus("2026-07-03", "mien-bac");

      expect(result).toBe(false);
    });

    test("trả null khi có error", async () => {
      repoState.maybeSingleResult = {
        data: null,
        error: { message: "DB error" },
      };

      const result = await lotteryRepo.loadDrawStatus("2026-07-03", "mien-bac");

      expect(result).toBeNull();
    });

    test("trả null khi data là null/không có cache", async () => {
      repoState.maybeSingleResult = { data: null, error: null };

      const result = await lotteryRepo.loadDrawStatus("2026-07-03", "mien-bac");

      expect(result).toBeNull();
    });

    test("trả null khi getDb/query throw exception", async () => {
      // from() throw → cả chain đổ vỡ, catch trong source bắt và trả null
      repoState.from.mockImplementation(() => {
        throw new Error("Network error");
      });

      const result = await lotteryRepo.loadDrawStatus("2026-07-03", "mien-bac");

      expect(result).toBeNull();
    });

    test("gọi đúng .from() .select() .eq() chain với tham số", async () => {
      repoState.maybeSingleResult = { data: { drawn: true }, error: null };

      await lotteryRepo.loadDrawStatus("2026-07-03", "mien-bac");

      expect(repoState.from).toHaveBeenCalledWith("lottery_draw_status_cache");
      expect(repoState.from().select).toHaveBeenCalledWith("drawn");
      // Hai lần gọi .eq() trên cùng một mock, phân biệt bằng index
      expect(repoState.from().select().eq.mock.calls[0]).toEqual([
        "date",
        "2026-07-03",
      ]);
      expect(repoState.from().select().eq.mock.calls[1]).toEqual([
        "region",
        "mien-bac",
      ]);
    });
  });

  // ── saveDrawStatus ─────────────────────────────────────────────────
  describe("saveDrawStatus", () => {
    test("gọi upsert với đúng payload (date, region, drawn, checked_at hợp lệ)", async () => {
      await lotteryRepo.saveDrawStatus("2026-07-03", "mien-bac", true);

      expect(repoState.from).toHaveBeenCalledWith("lottery_draw_status_cache");
      const upsertPayload = repoState.from().upsert.mock.calls[0][0];
      expect(upsertPayload).toMatchObject({
        date: "2026-07-03",
        region: "mien-bac",
        drawn: true,
      });
      // checked_at phải là ISO string parse được
      expect(new Date(upsertPayload.checked_at).getTime()).not.toBeNaN();
      // onConflict option
      expect(repoState.from().upsert.mock.calls[0][1]).toEqual({
        onConflict: "date,region",
      });
    });

    test("không throw khi upsert trả lỗi (fail silently)", async () => {
      // saveDrawStatus không kiểm tra .error, chỉ await rồi return void
      repoState
        .from()
        .upsert.mockResolvedValue({ error: { message: "DB error" } });

      await expect(
        lotteryRepo.saveDrawStatus("2026-07-03", "mien-bac", true),
      ).resolves.toBeUndefined();
    });

    test("không throw khi getDb/from throw exception", async () => {
      // Catch trong source bắt silent, không throw ra ngoài
      repoState.from.mockImplementation(() => {
        throw new Error("Network error");
      });

      await expect(
        lotteryRepo.saveDrawStatus("2026-07-03", "mien-bac", true),
      ).resolves.toBeUndefined();
    });
  });
});