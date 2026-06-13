import { describe, expect, it, vi, beforeEach } from "vitest";
import { NotFoundException } from "@nestjs/common";
import { SimulationService } from "../../src/ai-insights/simulation.service";

function createMockPrisma() {
  return {
    aIInsight: {
      findUnique: vi.fn(),
    },
    segment: {
      findUnique: vi.fn(),
    },
    campaign: {
      findMany: vi.fn(),
    },
  };
}

function createMockSegments() {
  return {
    count: vi.fn(),
  };
}

describe("SimulationService", () => {
  let service: SimulationService;
  let prisma: ReturnType<typeof createMockPrisma>;
  let segments: ReturnType<typeof createMockSegments>;

  beforeEach(() => {
    prisma = createMockPrisma();
    segments = createMockSegments();
    service = new SimulationService(prisma as any, segments as any);
  });

  describe("simulateCampaign", () => {
    it("predicts campaign reach correctly from segment audience size", async () => {
      prisma.aIInsight.findUnique.mockResolvedValue({ id: "insight-1" });
      prisma.segment.findUnique.mockResolvedValue({ id: "seg-1", rules: {} });
      segments.count.mockResolvedValue(5000);

      // Segment-specific campaigns (>=3, so used as data source)
      prisma.campaign.findMany
        .mockResolvedValueOnce([
          {
            analytics: {
              openRate: 0.25,
              clickRate: 0.05,
              conversionRate: 0.02,
              revenueAccrued: 5000,
              totalConverted: 100,
            },
          },
          {
            analytics: {
              openRate: 0.3,
              clickRate: 0.06,
              conversionRate: 0.025,
              revenueAccrued: 6000,
              totalConverted: 120,
            },
          },
          {
            analytics: {
              openRate: 0.2,
              clickRate: 0.04,
              conversionRate: 0.015,
              revenueAccrued: 4000,
              totalConverted: 80,
            },
          },
        ])
        // Channel-level campaigns (not used since segment has >=3)
        .mockResolvedValueOnce([]);

      const result = await service.simulateCampaign("insight-1", "seg-1", "EMAIL");

      expect(result.expectedReach).toBe(5000);
      expect(result.basedOnCampaigns).toBe(3);
      // Avg open rate: (0.25+0.3+0.2)/3 = 0.25
      expect(result.expectedOpenRate).toBeCloseTo(0.25, 2);
    });

    it("calculates ROI from historical data correctly", async () => {
      prisma.aIInsight.findUnique.mockResolvedValue({ id: "insight-1" });
      prisma.segment.findUnique.mockResolvedValue({ id: "seg-1", rules: {} });
      segments.count.mockResolvedValue(1000);

      prisma.campaign.findMany
        .mockResolvedValueOnce([
          {
            analytics: {
              openRate: 0.3,
              clickRate: 0.06,
              conversionRate: 0.03,
              revenueAccrued: 9000,
              totalConverted: 30,
            },
          },
          {
            analytics: {
              openRate: 0.25,
              clickRate: 0.05,
              conversionRate: 0.02,
              revenueAccrued: 4000,
              totalConverted: 20,
            },
          },
          {
            analytics: {
              openRate: 0.28,
              clickRate: 0.055,
              conversionRate: 0.025,
              revenueAccrued: 6250,
              totalConverted: 25,
            },
          },
        ])
        .mockResolvedValueOnce([]);

      const result = await service.simulateCampaign("insight-1", "seg-1", "EMAIL");

      // Avg conversion rate: (0.03+0.02+0.025)/3 = 0.025
      // Expected conversions: 1000 * 0.025 = 25
      // Total revenue from historical: 9000+4000+6250 = 19250
      // Total conversions from historical: 30+20+25 = 75
      // Avg order value: 19250/75 = 256.67
      // Expected revenue: 25 * 256.67 = 6416.67
      // Expected cost: 1000 * 0.005 (EMAIL) = 5
      // Expected ROI: 6416.67 / 5 = 1283.33

      expect(result.expectedROI).toBeGreaterThan(100);
      expect(result.expectedRevenue).toBeGreaterThan(0);
      expect(result.expectedCost).toBe(5); // EMAIL cost = 0.005 * 1000
      expect(result.expectedConversionRate).toBeCloseTo(0.025, 3);
    });

    it("handles no historical campaigns gracefully with conservative defaults", async () => {
      prisma.aIInsight.findUnique.mockResolvedValue({ id: "insight-1" });
      prisma.segment.findUnique.mockResolvedValue({ id: "seg-1", rules: {} });
      segments.count.mockResolvedValue(500);

      // No segment-specific, no channel-level campaigns
      prisma.campaign.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const result = await service.simulateCampaign("insight-1", "seg-1", "SMS");

      // Conservative defaults: openRate=0.2, clickRate=0.03, conversionRate=0.01, avgOrderValue=50
      expect(result.expectedOpenRate).toBeCloseTo(0.2, 2);
      expect(result.expectedClickRate).toBeCloseTo(0.03, 2);
      expect(result.expectedConversionRate).toBeCloseTo(0.01, 3);
      expect(result.basedOnCampaigns).toBe(0);

      // Expected conversions: 500 * 0.01 = 5
      // Expected revenue: 5 * 50 = 250
      // Expected cost: 500 * 0.04 (SMS) = 20
      // ROI: 250 / 20 = 12.5
      expect(result.expectedRevenue).toBe(250);
      expect(result.expectedCost).toBe(20);
      expect(result.expectedROI).toBe(12.5);
    });

    it("throws NotFoundException when insight does not exist", async () => {
      prisma.aIInsight.findUnique.mockResolvedValue(null);

      await expect(
        service.simulateCampaign("nonexistent", "seg-1", "EMAIL")
      ).rejects.toThrow(NotFoundException);
    });

    it("throws NotFoundException when segment does not exist", async () => {
      prisma.aIInsight.findUnique.mockResolvedValue({ id: "insight-1" });
      prisma.segment.findUnique.mockResolvedValue(null);

      await expect(
        service.simulateCampaign("insight-1", "nonexistent", "EMAIL")
      ).rejects.toThrow(NotFoundException);
    });
  });
});
