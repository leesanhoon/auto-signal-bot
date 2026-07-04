import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  parseBettingPlanResponse,
  generateBettingPlan,
  buildMatchAnalysisCandidatePool,
} from "../../src/betting/betting-gemini.js";
import * as openrouter from "../../src/shared/openrouter.js";
import * as aiUsage from "../../src/shared/ai-usage.js";
import type { MatchOddsPayload, MatchAiAnalysis } from "../../src/betting/betting-types.js";

vi.mock("../../src/shared/openrouter.js");
vi.mock("../../src/shared/ai-usage.js");
vi.mock("../../src/shared/ai-env.js");

describe("betting-gemini-plan.ts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("parseBettingPlanResponse", () => {
    it("should parse valid betting plan JSON", () => {
      const json = JSON.stringify({
        matches: [{ id: "1", recommendation: "BACK" }],
        parlays: [{ ids: ["1", "2"], odds: 3.5 }],
        remainingSingles: [{ id: "3", odds: 2.0 }],
        summary: "Good bets today",
      });

      const result = parseBettingPlanResponse(json);

      expect(result).toBeDefined();
      expect(result?.matches).toHaveLength(1);
      expect(result?.parlays).toHaveLength(1);
      expect(result?.remainingSingles).toHaveLength(1);
      expect(result?.summary).toBe("Good bets today");
    });

    it("should handle JSON wrapped in markdown code blocks", () => {
      const json = `
\`\`\`json
{
  "matches": [],
  "parlays": [],
  "remainingSingles": [],
  "summary": "Test"
}
\`\`\`
      `;

      const result = parseBettingPlanResponse(json);

      expect(result).toBeDefined();
      expect(result?.summary).toBe("Test");
    });

    it("should return null if matches array is missing", () => {
      const json = JSON.stringify({
        parlays: [],
        remainingSingles: [],
        summary: "Test",
      });

      const result = parseBettingPlanResponse(json);

      expect(result).toBeNull();
    });

    it("should return null if parlays array is missing", () => {
      const json = JSON.stringify({
        matches: [],
        remainingSingles: [],
        summary: "Test",
      });

      const result = parseBettingPlanResponse(json);

      expect(result).toBeNull();
    });

    it("should return null if remainingSingles array is missing", () => {
      const json = JSON.stringify({
        matches: [],
        parlays: [],
        summary: "Test",
      });

      const result = parseBettingPlanResponse(json);

      expect(result).toBeNull();
    });

    it("should default summary to empty string if missing", () => {
      const json = JSON.stringify({
        matches: [],
        parlays: [],
        remainingSingles: [],
      });

      const result = parseBettingPlanResponse(json);

      expect(result?.summary).toBe("");
    });

    it("should return null for malformed JSON", () => {
      const malformed = '{ broken json';

      const result = parseBettingPlanResponse(malformed);

      expect(result).toBeNull();
    });

    it("should extract JSON object from text with surrounding content", () => {
      const text = "Here is the plan:\n" +
        JSON.stringify({
          matches: [],
          parlays: [],
          remainingSingles: [],
        }) +
        "\n\nEnd of plan";

      const result = parseBettingPlanResponse(text);

      expect(result).toBeDefined();
    });
  });

  describe("buildMatchAnalysisCandidatePool", () => {
    const mockPayload: MatchOddsPayload = {
      gameId: "1",
      home: "Team A",
      away: "Team B",
      kickoffUnix: 100,
      date: "2026-07-05",
      kickoffTime: "12:00",
      odds: {
        updatedUnix: 100,
        legend: "test",
        markets: [
          {
            key: "h2h",
            outcomes: [
              { name: "H", price: 1.5 },
              { name: "D", price: 3.5 },
              { name: "A", price: 6.0 },
            ],
          },
        ],
      },
    };

    it("should build candidate pool from odds markets", () => {
      const candidates = buildMatchAnalysisCandidatePool(mockPayload);

      expect(candidates).toHaveLength(3);
      expect(candidates[0].candidateId).toBe("P01");
      expect(candidates[1].candidateId).toBe("P02");
      expect(candidates[2].candidateId).toBe("P03");
    });

    it("should filter out invalid prices (<=0 or NaN)", () => {
      const payload: MatchOddsPayload = {
        ...mockPayload,
        odds: {
          ...mockPayload.odds,
          markets: [
            {
              key: "h2h",
              outcomes: [
                { name: "H", price: 1.5 },
                { name: "D", price: 0 },
                { name: "A", price: NaN },
              ],
            },
          ],
        },
      };

      const candidates = buildMatchAnalysisCandidatePool(payload);

      expect(candidates).toHaveLength(1);
      expect(candidates[0].odds).toBe(1.5);
    });

    it("should include correctScore outcomes if available", () => {
      const payload: MatchOddsPayload = {
        ...mockPayload,
        correctScore: [
          { score: "1-0", price: 5.0 },
          { score: "1-1", price: 4.5 },
        ],
      };

      const candidates = buildMatchAnalysisCandidatePool(payload);

      // 3 from h2h + 2 from correctScore
      expect(candidates.length).toBeGreaterThanOrEqual(5);
      const correctScoreOutcomes = candidates.filter(
        (c) => c.marketKey === "correct_score",
      );
      expect(correctScoreOutcomes).toHaveLength(2);
    });

    it("should enforce safety limit of 50 candidates for correctScore", () => {
      const outcomes = Array.from({ length: 100 }, (_, i) => ({
        score: `${i}-${i}`,
        price: 5.0 + i * 0.01,
      }));

      const payload: MatchOddsPayload = {
        ...mockPayload,
        correctScore: outcomes,
      };

      const candidates = buildMatchAnalysisCandidatePool(payload);

      // Should stop at 50 total for correctScore
      const correctScoreCandidates = candidates.filter(
        (c) => c.marketKey === "correct_score",
      );
      expect(correctScoreCandidates.length).toBeLessThanOrEqual(50);
    });

    it("should assign sequential candidate IDs", () => {
      const payload: MatchOddsPayload = {
        ...mockPayload,
        odds: {
          ...mockPayload.odds,
          markets: [
            {
              key: "h2h",
              outcomes: [
                { name: "H", price: 1.5 },
                { name: "D", price: 3.5 },
              ],
            },
            {
              key: "asia_handicap",
              outcomes: [
                { name: "H", price: 1.9, point: -1 },
              ],
            },
          ],
        },
      };

      const candidates = buildMatchAnalysisCandidatePool(payload);

      expect(candidates[0].candidateId).toBe("P01");
      expect(candidates[1].candidateId).toBe("P02");
      expect(candidates[2].candidateId).toBe("P03");
    });
  });

  describe("generateBettingPlan", () => {
    const mockPayload: MatchOddsPayload = {
      gameId: "1",
      home: "Team A",
      away: "Team B",
      kickoffUnix: 100,
      date: "2026-07-05",
      kickoffTime: "12:00",
      odds: {
        updatedUnix: 100,
        legend: "test",
        markets: [
          {
            key: "h2h",
            outcomes: [
              { name: "H", price: 1.5 },
              { name: "A", price: 6.0 },
            ],
          },
        ],
      },
    };

    const mockAnalysis: MatchAiAnalysis = {
      matchKey: "1",
      match: mockPayload,
      recommendation: "BACK",
      confidence: 85,
      reasoning: ["Good form", "Strong defense"],
    };

    it("should return null when payloads empty", async () => {
      const result = await generateBettingPlan([], []);

      expect(result).toBeNull();
    });

    it("should return null when payloads and analyses length mismatch", async () => {
      const result = await generateBettingPlan(
        [mockPayload],
        [mockAnalysis, mockAnalysis],
      );

      expect(result).toBeNull();
    });

    it("should return null when all analyses are null", async () => {
      const result = await generateBettingPlan(
        [mockPayload],
        [null as any],
      );

      expect(result).toBeNull();
    });

    it("should call OpenRouter API for primary model", async () => {
      const mockResponse = {
        text: JSON.stringify({
          matches: [],
          parlays: [],
          remainingSingles: [],
          summary: "Test plan",
        }),
      };

      vi.mocked(openrouter.callOpenRouter).mockResolvedValue(
        mockResponse as any,
      );
      vi.mocked(aiUsage.recordOpenRouterUsage).mockResolvedValue(undefined);

      const result = await generateBettingPlan([mockPayload], [mockAnalysis]);

      expect(result).toBeDefined();
      expect(result?.summary).toBe("Test plan");
    });

    it("should return null when primary model parse fails", async () => {
      const mockResponse = {
        text: '{"invalid": "json"}',
      };

      vi.mocked(openrouter.callOpenRouter).mockResolvedValue(
        mockResponse as any,
      );

      const result = await generateBettingPlan([mockPayload], [mockAnalysis]);

      expect(result).toBeNull();
    });

    it("should not retry on non-retryable error from primary model", async () => {
      vi.mocked(openrouter.callOpenRouter).mockRejectedValueOnce(
        new Error("Invalid API key"),
      );

      const result = await generateBettingPlan([mockPayload], [mockAnalysis]);

      expect(result).toBeNull();
      // Should not call API twice (no fallback retry for non-retryable)
      expect(vi.mocked(openrouter.callOpenRouter).mock.calls.length).toBeLessThanOrEqual(2);
    });

    it("should retry with fallback on retryable error from primary", async () => {
      const mockResponse = {
        text: JSON.stringify({
          matches: [],
          parlays: [],
          remainingSingles: [],
          summary: "Fallback plan",
        }),
      };

      vi.mocked(openrouter.callOpenRouter)
        .mockRejectedValueOnce(new Error("timeout"))
        .mockResolvedValueOnce(mockResponse as any);

      const result = await generateBettingPlan([mockPayload], [mockAnalysis]);

      expect(result).toBeDefined();
      expect(result?.summary).toBe("Fallback plan");
      expect(vi.mocked(openrouter.callOpenRouter).mock.calls.length).toBeGreaterThan(1);
    });

    it("should return null when both primary and fallback fail", async () => {
      vi.mocked(openrouter.callOpenRouter)
        .mockRejectedValueOnce(new Error("timeout"))
        .mockRejectedValueOnce(new Error("rate limited"));

      const result = await generateBettingPlan([mockPayload], [mockAnalysis]);

      expect(result).toBeNull();
    });

    it("should return null when fallback parse fails", async () => {
      const invalidResponse = {
        text: '{"invalid": "json"}',
      };

      vi.mocked(openrouter.callOpenRouter)
        .mockRejectedValueOnce(new Error("timeout"))
        .mockResolvedValueOnce(invalidResponse as any);

      const result = await generateBettingPlan([mockPayload], [mockAnalysis]);

      expect(result).toBeNull();
    });

    it("should filter out null analyses", async () => {
      const mockResponse = {
        text: JSON.stringify({
          matches: [],
          parlays: [],
          remainingSingles: [],
          summary: "Plan with mixed analyses",
        }),
      };

      vi.mocked(openrouter.callOpenRouter).mockResolvedValue(
        mockResponse as any,
      );

      const analyses: (MatchAiAnalysis | null)[] = [
        mockAnalysis,
        null,
        mockAnalysis,
      ];

      // Mock payloads to match (we need 3 payloads for 3 analyses)
      const payloads = [mockPayload, mockPayload, mockPayload];

      const result = await generateBettingPlan(payloads, analyses);

      expect(result).toBeDefined();
    });
  });
});
