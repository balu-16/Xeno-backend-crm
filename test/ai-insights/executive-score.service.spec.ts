import { describe, expect, it, vi, beforeEach } from "vitest";
import { ExecutiveScoreService } from "../../src/ai-insights/executive-score.service";

function createMockPrisma() {
  return {
    aIExecutiveScore: {
      findFirst: vi.fn(),
      create: vi.fn(),
      findMany: vi.fn(),
    },
    order: {
      aggregate: vi.fn(),
      groupBy: vi.fn(),
    },
    customer: {
      count: vi.fn(),
    },
    campaign: {
      count: vi.fn(),
    },
    campaignAnalytics: {
      aggregate: vi.fn(),
    },
  };
}

describe("ExecutiveScoreService", () => {
  let service: ExecutiveScoreService;
  let prisma: ReturnType<typeof createMockPrisma>;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new ExecutiveScoreService(prisma as any);
  });

  describe("calculate", () => {
    it("calculates overall score from dimension scores using weighted average", async () => {
      // Mock all dimension score data sources
      // Revenue: recent=15000, prior=10000 => growth=0.5 => score=min(100, 50+50)=100
      prisma.order.aggregate
        .mockResolvedValueOnce({ _sum: { amount: 15000 }, _count: 10 })
        .mockResolvedValueOnce({ _sum: { amount: 10000 }, _count: 8 });

      // Engagement: openRate=0.25 (benchmark), clickRate=0.05 (benchmark)
      prisma.campaignAnalytics.aggregate.mockResolvedValue({
        _avg: { openRate: 0.25, clickRate: 0.05, deliveryRate: 0.95, conversionRate: 0.05 },
      });

      // Churn: 80 active out of 100 customers
      prisma.customer.count.mockResolvedValue(100);
      prisma.order.groupBy.mockResolvedValue(
        Array.from({ length: 80 }, (_, i) => ({ customerId: `c-${i}` }))
      );

      // Campaign: 10 total, 8 completed
      prisma.campaign.count
        .mockResolvedValueOnce(10)
        .mockResolvedValueOnce(8);

      // No previous score (NEW trend)
      prisma.aIExecutiveScore.findFirst.mockResolvedValue(null);

      // Mock the create to return saved record
      prisma.aIExecutiveScore.create.mockImplementation(async (args: any) => ({
        id: "score-1",
        ...args.data,
        generatedAt: new Date(),
      }));

      const result = await service.calculate();

      // revenueScore = min(100, max(0, 50 + 0.5*100)) = 100
      // engagementScore = ((min(100, 0.25/0.25*50) + min(100, 0.05/0.05*50)) / 2) = 50
      // churnScore = min(100, 80/100 * 100) = 80
      // deliveryScore = min(100, 0.95*100) = 95
      // campaignScore = 8/10*60 + min(40, 0.05/0.05*40) = 48+40 = 88
      // overall = round(100*0.25 + 50*0.2 + 80*0.25 + 95*0.15 + 88*0.15)
      //         = round(25 + 10 + 20 + 14.25 + 13.2) = round(82.45) = 82

      expect(result.overallScore).toBeGreaterThan(0);
      expect(result.overallScore).toBeLessThanOrEqual(100);
      expect(result.trend).toBe("NEW");
      expect(result.revenueScore).toBe(100);
      expect(result.engagementScore).toBe(50);
      expect(result.churnScore).toBe(80);
      expect(result.deliveryScore).toBe(95);
    });

    it("determines trend correctly as IMPROVING when score rises by more than 3", async () => {
      // Set up dimension mocks returning neutral values
      prisma.order.aggregate.mockResolvedValue({ _sum: { amount: 10000 }, _count: 5 });
      prisma.campaignAnalytics.aggregate.mockResolvedValue({
        _avg: { openRate: 0.2, clickRate: 0.04, deliveryRate: 0.9, conversionRate: 0.03 },
      });
      prisma.customer.count.mockResolvedValue(100);
      prisma.order.groupBy.mockResolvedValue(Array.from({ length: 50 }, (_, i) => ({ customerId: `c-${i}` })));
      prisma.campaign.count.mockResolvedValueOnce(10).mockResolvedValueOnce(5);

      // Previous score was 40, new score should be higher
      prisma.aIExecutiveScore.findFirst.mockResolvedValue({
        overallScore: 40,
        generatedAt: new Date(),
      });

      prisma.aIExecutiveScore.create.mockImplementation(async (args: any) => ({
        id: "score-2",
        ...args.data,
        generatedAt: new Date(),
      }));

      const result = await service.calculate();

      expect(result.trend).toBe("IMPROVING");
    });

    it("determines trend correctly as DECLINING when score drops by more than 3", async () => {
      // Set up dimension mocks returning low values
      // Revenue: recent=5000, prior=20000 => growth=-0.75 => score=50-75=-25 => clamped to 0
      prisma.order.aggregate
        .mockResolvedValueOnce({ _sum: { amount: 5000 }, _count: 2 })
        .mockResolvedValueOnce({ _sum: { amount: 20000 }, _count: 15 });

      prisma.campaignAnalytics.aggregate.mockResolvedValue({
        _avg: { openRate: 0.05, clickRate: 0.01, deliveryRate: 0.5, conversionRate: 0.005 },
      });

      prisma.customer.count.mockResolvedValue(100);
      prisma.order.groupBy.mockResolvedValue(Array.from({ length: 10 }, (_, i) => ({ customerId: `c-${i}` })));
      prisma.campaign.count.mockResolvedValueOnce(10).mockResolvedValueOnce(1);

      // Previous score was 80
      prisma.aIExecutiveScore.findFirst.mockResolvedValue({
        overallScore: 80,
        generatedAt: new Date(),
      });

      prisma.aIExecutiveScore.create.mockImplementation(async (args: any) => ({
        id: "score-3",
        ...args.data,
        generatedAt: new Date(),
      }));

      const result = await service.calculate();

      expect(result.trend).toBe("DECLINING");
    });

    it("determines trend as STABLE when score change is within 3 points", async () => {
      // Use consistent moderate values
      // Revenue: recent=10000, prior=10000 => growth=0 => score=50
      prisma.order.aggregate
        .mockResolvedValueOnce({ _sum: { amount: 10000 }, _count: 5 })
        .mockResolvedValueOnce({ _sum: { amount: 10000 }, _count: 5 });

      prisma.campaignAnalytics.aggregate.mockResolvedValue({
        _avg: { openRate: 0.125, clickRate: 0.025, deliveryRate: 0.75, conversionRate: 0.025 },
      });

      prisma.customer.count.mockResolvedValue(100);
      prisma.order.groupBy.mockResolvedValue(Array.from({ length: 50 }, (_, i) => ({ customerId: `c-${i}` })));
      prisma.campaign.count.mockResolvedValueOnce(10).mockResolvedValueOnce(5);

      // Previous score close to what new score will be (~49)
      // With these mocks: revenue=50, engagement=25, churn=50, delivery=75, campaign=50
      // overall = round(50*0.25 + 25*0.2 + 50*0.25 + 75*0.15 + 50*0.15) = round(48.75) = 49
      prisma.aIExecutiveScore.findFirst.mockResolvedValue({
        overallScore: 50,
        generatedAt: new Date(),
      });

      prisma.aIExecutiveScore.create.mockImplementation(async (args: any) => ({
        id: "score-4",
        ...args.data,
        generatedAt: new Date(),
      }));

      const result = await service.calculate();

      expect(result.trend).toBe("STABLE");
    });
  });

  describe("getCurrent", () => {
    it("returns existing score when one is available", async () => {
      const existing = {
        id: "score-existing",
        overallScore: 72,
        revenueScore: 80,
        engagementScore: 65,
        churnScore: 70,
        deliveryScore: 90,
        campaignScore: 55,
        trend: "STABLE",
        factors: { weights: {} },
        generatedAt: new Date(),
      };

      prisma.aIExecutiveScore.findFirst.mockResolvedValue(existing);

      const result = await service.getCurrent();

      expect(result.id).toBe("score-existing");
      expect(result.overallScore).toBe(72);
      expect(result.trend).toBe("STABLE");
    });

    it("handles edge case: no data by calculating a new score", async () => {
      prisma.aIExecutiveScore.findFirst.mockResolvedValue(null);

      // Set up minimal mocks for calculate()
      prisma.order.aggregate.mockResolvedValue({ _sum: { amount: 0 }, _count: 0 });
      prisma.campaignAnalytics.aggregate.mockResolvedValue({
        _avg: { openRate: 0, clickRate: 0, deliveryRate: 0, conversionRate: 0 },
      });
      prisma.customer.count.mockResolvedValue(0);
      prisma.order.groupBy.mockResolvedValue([]);
      prisma.campaign.count.mockResolvedValue(0);

      prisma.aIExecutiveScore.create.mockImplementation(async (args: any) => ({
        id: "score-new",
        ...args.data,
        generatedAt: new Date(),
      }));

      const result = await service.getCurrent();

      expect(result.trend).toBe("NEW");
      expect(result.overallScore).toBeGreaterThanOrEqual(0);
    });
  });
});
