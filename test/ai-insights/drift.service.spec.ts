import { describe, expect, it, vi, beforeEach } from "vitest";
import { InsightFeedbackRating, InsightStatus, InsightType } from "@prisma/client";
import { DriftService } from "../../src/ai-insights/drift.service";

function createMockPrisma() {
  return {
    aIInsight: {
      count: vi.fn(),
      findMany: vi.fn(),
    },
    aIInsightFeedback: {
      count: vi.fn(),
      aggregate: vi.fn(),
    },
  };
}

describe("DriftService", () => {
  let service: DriftService;
  let prisma: ReturnType<typeof createMockPrisma>;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new DriftService(prisma as any);
  });

  describe("getMetrics", () => {
    it("calculates drift score correctly for high-dismiss pattern", async () => {
      // For each insight type, computeMetricsForType is called.
      // We set up the mock to return the same values for each type call.
      // High dismiss, low action: drift should be high.
      // Pattern: 100 generated, 5 actioned, 80 dismissed, 10 useful out of 30 feedback
      // actionRate = 5/100 = 0.05, usefulRate = 10/30 = 0.333
      // driftScore = 1.0 - (0.05 * 0.4 + 0.333 * 0.6) = 1.0 - (0.02 + 0.2) = 0.78

      const types = Object.values(InsightType);

      // Set up mocks for each type call - all return high-dismiss pattern
      for (let i = 0; i < types.length; i++) {
        prisma.aIInsight.count
          .mockResolvedValueOnce(100)   // totalGenerated
          .mockResolvedValueOnce(5)     // totalActioned
          .mockResolvedValueOnce(80);   // totalDismissed

        prisma.aIInsightFeedback.aggregate.mockResolvedValueOnce({
          _count: { id: 10 },
        });
        prisma.aIInsightFeedback.count.mockResolvedValueOnce(30);
      }

      const results = await service.getMetrics();

      expect(results.length).toBe(types.length);

      // All should have the same pattern
      const firstResult = results[0];
      expect(firstResult.totalGenerated).toBe(100);
      expect(firstResult.totalDismissed).toBe(80);
      expect(firstResult.dismissRate).toBe(0.8);
      expect(firstResult.actionRate).toBe(0.05);
      expect(firstResult.driftScore).toBeGreaterThan(0.7);
      expect(firstResult.isCritical).toBe(true);
    });

    it("calculates drift score correctly for low-action pattern", async () => {
      // Pattern: 50 generated, 2 actioned, 5 dismissed, 8 useful out of 20 feedback
      // actionRate = 2/50 = 0.04, usefulRate = 8/20 = 0.4
      // driftScore = 1.0 - (0.04 * 0.4 + 0.4 * 0.6) = 1.0 - (0.016 + 0.24) = 0.744

      const types = Object.values(InsightType);
      for (let i = 0; i < types.length; i++) {
        prisma.aIInsight.count
          .mockResolvedValueOnce(50)
          .mockResolvedValueOnce(2)
          .mockResolvedValueOnce(5);

        prisma.aIInsightFeedback.aggregate.mockResolvedValueOnce({
          _count: { id: 8 },
        });
        prisma.aIInsightFeedback.count.mockResolvedValueOnce(20);
      }

      const results = await service.getMetrics();
      const firstResult = results[0];

      expect(firstResult.actionRate).toBeCloseTo(0.04, 2);
      expect(firstResult.usefulRate).toBeCloseTo(0.4, 2);
      expect(firstResult.driftScore).toBeCloseTo(0.744, 2);
      expect(firstResult.isCritical).toBe(true);
    });

    it("identifies healthy insight patterns with low drift", async () => {
      // Pattern: 100 generated, 60 actioned, 10 dismissed, 45 useful out of 50 feedback
      // actionRate = 60/100 = 0.6, usefulRate = 45/50 = 0.9
      // driftScore = 1.0 - (0.6 * 0.4 + 0.9 * 0.6) = 1.0 - (0.24 + 0.54) = 0.22

      const types = Object.values(InsightType);
      for (let i = 0; i < types.length; i++) {
        prisma.aIInsight.count
          .mockResolvedValueOnce(100)
          .mockResolvedValueOnce(60)
          .mockResolvedValueOnce(10);

        prisma.aIInsightFeedback.aggregate.mockResolvedValueOnce({
          _count: { id: 45 },
        });
        prisma.aIInsightFeedback.count.mockResolvedValueOnce(50);
      }

      const results = await service.getMetrics();
      const firstResult = results[0];

      expect(firstResult.actionRate).toBe(0.6);
      expect(firstResult.usefulRate).toBe(0.9);
      expect(firstResult.driftScore).toBeCloseTo(0.22, 2);
      expect(firstResult.isCritical).toBe(false);
    });

    it("flags critical drift for auto-adjustment when drift score exceeds 0.7", async () => {
      // Pattern: 200 generated, 0 actioned, 150 dismissed, 2 useful out of 100 feedback
      // actionRate = 0, usefulRate = 2/100 = 0.02
      // driftScore = 1.0 - (0 * 0.4 + 0.02 * 0.6) = 1.0 - 0.012 = 0.988

      const types = Object.values(InsightType);
      for (let i = 0; i < types.length; i++) {
        prisma.aIInsight.count
          .mockResolvedValueOnce(200)
          .mockResolvedValueOnce(0)
          .mockResolvedValueOnce(150);

        prisma.aIInsightFeedback.aggregate.mockResolvedValueOnce({
          _count: { id: 2 },
        });
        prisma.aIInsightFeedback.count.mockResolvedValueOnce(100);
      }

      const results = await service.getMetrics();

      // Results are sorted by driftScore descending
      const criticalResults = results.filter((r) => r.isCritical);
      expect(criticalResults.length).toBe(types.length);

      const firstResult = results[0];
      expect(firstResult.driftScore).toBeCloseTo(0.988, 2);
      expect(firstResult.isCritical).toBe(true);
      expect(firstResult.totalActioned).toBe(0);
      expect(firstResult.dismissRate).toBe(0.75);
    });

    it("handles zero generated insights gracefully", async () => {
      const types = Object.values(InsightType);
      for (let i = 0; i < types.length; i++) {
        prisma.aIInsight.count
          .mockResolvedValueOnce(0)
          .mockResolvedValueOnce(0)
          .mockResolvedValueOnce(0);

        prisma.aIInsightFeedback.aggregate.mockResolvedValueOnce({
          _count: { id: 0 },
        });
        prisma.aIInsightFeedback.count.mockResolvedValueOnce(0);
      }

      const results = await service.getMetrics();
      const firstResult = results[0];

      expect(firstResult.actionRate).toBe(0);
      expect(firstResult.dismissRate).toBe(0);
      expect(firstResult.usefulRate).toBe(0);
      // driftScore = 1.0 - (0 + 0) = 1.0
      expect(firstResult.driftScore).toBe(1.0);
      expect(firstResult.isCritical).toBe(true);
    });
  });
});
