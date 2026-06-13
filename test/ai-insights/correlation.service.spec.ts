import { describe, expect, it, vi, beforeEach } from "vitest";
import { CorrelationService } from "../../src/ai-insights/correlation.service";

function createMockPrisma() {
  return {
    aIInsight: {
      findMany: vi.fn(),
    },
    aIInsightCorrelation: {
      findFirst: vi.fn(),
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
  };
}

describe("CorrelationService", () => {
  let service: CorrelationService;
  let prisma: ReturnType<typeof createMockPrisma>;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new CorrelationService(prisma as any);
  });

  describe("findCorrelations", () => {
    it("groups related insights by entity overlap (same segmentId)", async () => {
      const now = new Date();
      const insights = [
        {
          id: "insight-1",
          type: "CHURN",
          title: "Churn spike in segment A",
          summary: "Churn increased",
          recommendation: "Send retention offer",
          details: { segmentId: "seg-100" },
          sourceData: {},
          generatedAt: now,
          expiresAt: new Date(now.getTime() + 86400000),
        },
        {
          id: "insight-2",
          type: "REVENUE",
          title: "Revenue drop in segment A",
          summary: "Revenue down 20%",
          recommendation: "Launch promo",
          details: { segmentId: "seg-100" },
          sourceData: {},
          generatedAt: new Date(now.getTime() + 3600000),
          expiresAt: new Date(now.getTime() + 86400000),
        },
        {
          id: "insight-3",
          type: "CAMPAIGN",
          title: "Unrelated campaign insight",
          summary: "Campaign data",
          recommendation: "Review campaign",
          details: { segmentId: "seg-999" },
          sourceData: {},
          generatedAt: now,
          expiresAt: new Date(now.getTime() + 86400000),
        },
      ];

      prisma.aIInsight.findMany.mockResolvedValue(insights);
      prisma.aIInsightCorrelation.findFirst.mockResolvedValue(null);
      prisma.aIInsightCorrelation.create.mockResolvedValue({
        id: "corr-1",
        title: "Correlated segment insights",
        insightIds: ["insight-1", "insight-2"],
        score: 0.9,
      });

      const results = await service.findCorrelations();

      // Only seg-100 group has 2+ insights
      expect(results).toHaveLength(1);
      expect(prisma.aIInsightCorrelation.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          insightIds: expect.arrayContaining(["insight-1", "insight-2"]),
          title: "Correlated segment insights",
        }),
      });
    });

    it("returns empty array when fewer than 2 active insights exist", async () => {
      prisma.aIInsight.findMany.mockResolvedValue([
        {
          id: "insight-1",
          type: "REVENUE",
          title: "Only one",
          summary: "Alone",
          recommendation: "Nothing",
          details: {},
          sourceData: {},
          generatedAt: new Date(),
          expiresAt: new Date(),
        },
      ]);

      const results = await service.findCorrelations();
      expect(results).toEqual([]);
    });
  });

  describe("computeCorrelationScore", () => {
    it("computes correlation score correctly based on temporal proximity and density", () => {
      const now = new Date();
      // 2 insights generated 1 hour apart
      // temporalScore = 1.0 - 1/72 = 0.986
      // densityScore = 2/5 = 0.4
      // score = 0.986 * 0.6 + 0.4 * 0.4 = 0.5916 + 0.16 = 0.7516
      const insights = [
        { generatedAt: now, details: {} },
        { generatedAt: new Date(now.getTime() + 1 * 60 * 60 * 1000), details: {} },
      ];

      const score = service.computeCorrelationScore(insights);

      expect(score).toBeGreaterThan(0.7);
      expect(score).toBeLessThan(0.8);
    });

    it("returns 0 for a single insight", () => {
      const score = service.computeCorrelationScore([
        { generatedAt: new Date(), details: {} },
      ]);
      expect(score).toBe(0);
    });

    it("returns lower score for insights far apart in time", () => {
      const now = new Date();
      // 2 insights 48 hours apart
      // temporalScore = 1.0 - 48/72 = 0.333
      // densityScore = 2/5 = 0.4
      // score = 0.333 * 0.6 + 0.4 * 0.4 = 0.2 + 0.16 = 0.36
      const insights = [
        { generatedAt: now, details: {} },
        { generatedAt: new Date(now.getTime() + 48 * 60 * 60 * 1000), details: {} },
      ];

      const score = service.computeCorrelationScore(insights);

      expect(score).toBeLessThan(0.4);
    });
  });

  describe("generateRootCause", () => {
    it("generates root cause narrative with multiple correlated insights", () => {
      const insights = [
        {
          type: "CHURN",
          title: "Churn spike",
          summary: "Churn increased 15%",
          recommendation: "Send retention offers",
        },
        {
          type: "REVENUE",
          title: "Revenue drop",
          summary: "Revenue down 20%",
          recommendation: "Launch win-back campaign",
        },
      ];

      const result = service.generateRootCause(insights);

      expect(result.narrative).toContain("2 correlated insights");
      expect(result.narrative).toContain("CHURN");
      expect(result.narrative).toContain("REVENUE");
      expect(result.narrative).toContain("Churn spike");
      expect(result.narrative).toContain("Revenue drop");
      expect(result.recommendation).toContain("1. Send retention offers");
      expect(result.recommendation).toContain("2. Launch win-back campaign");
    });

    it("generates single insight narrative when only one insight exists", () => {
      const insights = [
        {
          type: "REVENUE",
          title: "Revenue spike detected",
          summary: "Revenue up 30%",
          recommendation: "Investigate source",
        },
      ];

      const result = service.generateRootCause(insights);

      expect(result.narrative).toContain("Single insight detected");
      expect(result.narrative).toContain("Revenue spike detected");
      expect(result.recommendation).toBe("Investigate source");
    });

    it("returns fallback for empty insights array", () => {
      const result = service.generateRootCause([]);

      expect(result.narrative).toBe("No insights to analyze.");
      expect(result.recommendation).toBe("N/A");
    });
  });
});
