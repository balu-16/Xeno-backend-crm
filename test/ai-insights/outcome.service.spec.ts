import { describe, expect, it, vi, beforeEach } from "vitest";
import { NotFoundException } from "@nestjs/common";
import { OutcomeService } from "../../src/ai-insights/outcome.service";

function createMockPrisma() {
  return {
    aIInsight: {
      findUnique: vi.fn(),
    },
    aIInsightOutcome: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  };
}

describe("OutcomeService", () => {
  let service: OutcomeService;
  let prisma: ReturnType<typeof createMockPrisma>;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new OutcomeService(prisma as any);
  });

  describe("create", () => {
    it("creates an outcome record when an action is executed", async () => {
      prisma.aIInsight.findUnique.mockResolvedValue({ id: "insight-1" });
      prisma.aIInsightOutcome.create.mockResolvedValue({
        id: "outcome-1",
        insightId: "insight-1",
        predictedImpact: "15% revenue increase",
        predictedValue: 15000,
        actionTaken: "Created win-back segment",
        measuredAt: new Date("2026-01-15"),
        createdAt: new Date(),
      });

      const result = await service.create({
        insightId: "insight-1",
        predictedImpact: "15% revenue increase",
        predictedValue: 15000,
        actionTaken: "Created win-back segment",
        measuredAt: new Date("2026-01-15"),
      });

      expect(prisma.aIInsightOutcome.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          insightId: "insight-1",
          predictedImpact: "15% revenue increase",
          predictedValue: 15000,
          actionTaken: "Created win-back segment",
        }),
      });
      expect(result.id).toBe("outcome-1");
    });

    it("throws NotFoundException when insight does not exist", async () => {
      prisma.aIInsight.findUnique.mockResolvedValue(null);

      await expect(
        service.create({
          insightId: "nonexistent",
          predictedImpact: "test",
          actionTaken: "test action",
        })
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("calculateAccuracy", () => {
    it("calculates prediction accuracy correctly", () => {
      // Predicted 100, actual 80: diff=20, max=100, accuracy=1-0.2=0.8
      expect(service.calculateAccuracy(100, 80)).toBe(0.8);

      // Predicted 50, actual 50: perfect match
      expect(service.calculateAccuracy(50, 50)).toBe(1);

      // Predicted 200, actual 100: diff=100, max=200, accuracy=1-0.5=0.5
      expect(service.calculateAccuracy(200, 100)).toBe(0.5);

      // Predicted 1000, actual 950: diff=50, max=1000, accuracy=1-0.05=0.95
      expect(service.calculateAccuracy(1000, 950)).toBe(0.95);
    });

    it("handles zero predicted value edge case", () => {
      // Both zero: perfect accuracy
      expect(service.calculateAccuracy(0, 0)).toBe(1);

      // Predicted zero, actual non-zero: accuracy is 0
      expect(service.calculateAccuracy(0, 100)).toBe(0);

      // Actual zero, predicted non-zero: accuracy is 0
      expect(service.calculateAccuracy(100, 0)).toBe(0);
    });
  });

  describe("getAccuracyStats", () => {
    it("aggregates accuracy across multiple outcomes", async () => {
      prisma.aIInsightOutcome.findMany.mockResolvedValue([
        { accuracy: 0.8 },
        { accuracy: 0.6 },
        { accuracy: 0.9 },
        { accuracy: 0.7 },
      ]);

      const stats = await service.getAccuracyStats("insight-1");

      expect(stats.totalOutcomes).toBe(4);
      expect(stats.measuredOutcomes).toBe(4);
      expect(stats.minAccuracy).toBe(0.6);
      expect(stats.maxAccuracy).toBe(0.9);
      expect(stats.averageAccuracy).toBe(0.75);
    });

    it("returns null averages when no measured outcomes exist", async () => {
      prisma.aIInsightOutcome.findMany.mockResolvedValue([]);

      const stats = await service.getAccuracyStats("insight-1");

      expect(stats.totalOutcomes).toBe(0);
      expect(stats.measuredOutcomes).toBe(0);
      expect(stats.averageAccuracy).toBeNull();
      expect(stats.minAccuracy).toBeNull();
      expect(stats.maxAccuracy).toBeNull();
    });
  });

  describe("measureOutcome", () => {
    it("updates outcome with actual values and computes accuracy", async () => {
      prisma.aIInsightOutcome.findUnique.mockResolvedValue({
        id: "outcome-1",
        predictedValue: 100,
      });

      prisma.aIInsightOutcome.update.mockResolvedValue({
        id: "outcome-1",
        predictedValue: 100,
        actualValue: 80,
        accuracy: 0.8,
        actualImpact: "Moderate increase observed",
      });

      const result = await service.measureOutcome("outcome-1", "Moderate increase observed", 80);

      expect(prisma.aIInsightOutcome.update).toHaveBeenCalledWith({
        where: { id: "outcome-1" },
        data: expect.objectContaining({
          actualImpact: "Moderate increase observed",
          actualValue: 80,
          accuracy: 0.8,
        }),
      });
      expect(result.accuracy).toBe(0.8);
    });

    it("sets accuracy to null when predictedValue is null", async () => {
      prisma.aIInsightOutcome.findUnique.mockResolvedValue({
        id: "outcome-1",
        predictedValue: null,
      });

      prisma.aIInsightOutcome.update.mockResolvedValue({
        id: "outcome-1",
        actualValue: 50,
        accuracy: null,
      });

      await service.measureOutcome("outcome-1", "Some impact", 50);

      expect(prisma.aIInsightOutcome.update).toHaveBeenCalledWith({
        where: { id: "outcome-1" },
        data: expect.objectContaining({
          accuracy: null,
        }),
      });
    });
  });
});
