import { describe, expect, it, vi, beforeEach } from "vitest";
import { InsightFeedbackRating } from "@prisma/client";
import { FeedbackService } from "../../src/ai-insights/feedback.service";

function createMockPrisma() {
  return {
    aIInsightFeedback: {
      create: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      groupBy: vi.fn(),
    },
    $queryRaw: vi.fn(),
  };
}

describe("FeedbackService", () => {
  let service: FeedbackService;
  let prisma: ReturnType<typeof createMockPrisma>;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new FeedbackService(prisma as any);
  });

  describe("submit", () => {
    it("submits feedback with USEFUL rating", async () => {
      prisma.aIInsightFeedback.create.mockResolvedValue({
        id: "fb-1",
        insightId: "insight-1",
        userId: "user-1",
        rating: InsightFeedbackRating.USEFUL,
        comment: "Very actionable",
        createdAt: new Date(),
      });

      const result = await service.submit(
        "insight-1",
        "user-1",
        InsightFeedbackRating.USEFUL,
        "Very actionable"
      );

      expect(prisma.aIInsightFeedback.create).toHaveBeenCalledWith({
        data: {
          insightId: "insight-1",
          userId: "user-1",
          rating: InsightFeedbackRating.USEFUL,
          comment: "Very actionable",
        },
      });
      expect(result.rating).toBe(InsightFeedbackRating.USEFUL);
    });

    it("submits feedback with NOT_USEFUL rating", async () => {
      prisma.aIInsightFeedback.create.mockResolvedValue({
        id: "fb-2",
        insightId: "insight-2",
        userId: "user-1",
        rating: InsightFeedbackRating.NOT_USEFUL,
        comment: null,
        createdAt: new Date(),
      });

      const result = await service.submit(
        "insight-2",
        "user-1",
        InsightFeedbackRating.NOT_USEFUL
      );

      expect(result.rating).toBe(InsightFeedbackRating.NOT_USEFUL);
    });

    it("prevents duplicate feedback per user per insight by updating existing record", async () => {
      // First submission succeeds
      prisma.aIInsightFeedback.create.mockResolvedValueOnce({
        id: "fb-1",
        insightId: "insight-1",
        userId: "user-1",
        rating: InsightFeedbackRating.USEFUL,
        comment: null,
      });

      await service.submit("insight-1", "user-1", InsightFeedbackRating.USEFUL);

      // Second submission triggers unique constraint error (P2002)
      const duplicateError = new Error("Unique constraint failed");
      (duplicateError as any).code = "P2002";
      prisma.aIInsightFeedback.create.mockRejectedValueOnce(duplicateError);

      prisma.aIInsightFeedback.update.mockResolvedValue({
        id: "fb-1",
        insightId: "insight-1",
        userId: "user-1",
        rating: InsightFeedbackRating.NOT_USEFUL,
        comment: "Changed my mind",
      });

      const result = await service.submit(
        "insight-1",
        "user-1",
        InsightFeedbackRating.NOT_USEFUL,
        "Changed my mind"
      );

      expect(prisma.aIInsightFeedback.update).toHaveBeenCalledWith({
        where: {
          insightId_userId: { insightId: "insight-1", userId: "user-1" },
        },
        data: {
          rating: InsightFeedbackRating.NOT_USEFUL,
          comment: "Changed my mind",
        },
      });
      expect(result.rating).toBe(InsightFeedbackRating.NOT_USEFUL);
    });
  });

  describe("analytics", () => {
    it("aggregates feedback analytics correctly", async () => {
      prisma.aIInsightFeedback.count
        .mockResolvedValueOnce(10)  // totalFeedback
        .mockResolvedValueOnce(7)   // usefulCount
        .mockResolvedValueOnce(3);  // notUsefulCount

      prisma.aIInsightFeedback.groupBy.mockResolvedValue([]);
      prisma.$queryRaw.mockResolvedValue([
        { type: "REVENUE", total: BigInt(5), useful: BigInt(4), notUseful: BigInt(1) },
        { type: "CHURN", total: BigInt(5), useful: BigInt(3), notUseful: BigInt(2) },
      ]);

      const result = await service.analytics();

      expect(result.totalFeedback).toBe(10);
      expect(result.usefulRate).toBe(0.7);
      expect(result.notUsefulRate).toBe(0.3);
      expect(result.feedbackByType).toHaveLength(2);
      expect(result.feedbackByType[0]).toEqual({
        type: "REVENUE",
        total: 5,
        useful: 4,
        notUseful: 1,
        usefulRate: 0.8,
      });
    });

    it("returns zero rates when no feedback exists", async () => {
      prisma.aIInsightFeedback.count.mockResolvedValue(0);

      const result = await service.analytics();

      expect(result.totalFeedback).toBe(0);
      expect(result.usefulRate).toBe(0);
      expect(result.notUsefulRate).toBe(0);
      expect(result.feedbackByType).toEqual([]);
    });
  });
});
