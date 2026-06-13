import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

interface DimensionScores {
  revenueScore: number;
  engagementScore: number;
  churnScore: number;
  deliveryScore: number;
  campaignScore: number;
}

interface ExecutiveScoreResult extends DimensionScores {
  id: string;
  overallScore: number;
  trend: string;
  factors: Record<string, unknown>;
  generatedAt: Date;
}

// Dimension weights for overall score (must sum to 1.0)
const WEIGHTS = {
  revenue: 0.25,
  engagement: 0.2,
  churn: 0.25,
  delivery: 0.15,
  campaign: 0.15
};

@Injectable()
export class ExecutiveScoreService {
  private readonly logger = new Logger(ExecutiveScoreService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Compute overall executive score (0-100) from dimension scores.
   * Persists the result and determines trend vs previous score.
   */
  async calculate(): Promise<ExecutiveScoreResult> {
    const dimensions = await this.calculateDimensionScores();

    const overallScore = Math.round(
      dimensions.revenueScore * WEIGHTS.revenue +
      dimensions.engagementScore * WEIGHTS.engagement +
      dimensions.churnScore * WEIGHTS.churn +
      dimensions.deliveryScore * WEIGHTS.delivery +
      dimensions.campaignScore * WEIGHTS.campaign
    );

    // Determine trend by comparing with the most recent previous score
    const previous = await this.prisma.aIExecutiveScore.findFirst({
      orderBy: { generatedAt: "desc" }
    });

    let trend: string;
    if (!previous) {
      trend = "NEW";
    } else {
      const diff = overallScore - previous.overallScore;
      if (diff > 3) trend = "IMPROVING";
      else if (diff < -3) trend = "DECLINING";
      else trend = "STABLE";
    }

    const factors = {
      weights: WEIGHTS,
      rawDimensions: { ...dimensions },
      previousScore: previous?.overallScore ?? null,
      scoreDelta: previous ? overallScore - previous.overallScore : null
    } as unknown as Record<string, unknown>;

    const saved = await this.prisma.aIExecutiveScore.create({
      data: {
        overallScore,
        revenueScore: dimensions.revenueScore,
        engagementScore: dimensions.engagementScore,
        churnScore: dimensions.churnScore,
        deliveryScore: dimensions.deliveryScore,
        campaignScore: dimensions.campaignScore,
        factors: factors as never,
        trend
      }
    });

    this.logger.log(
      `Executive score calculated: ${overallScore} (${trend})`
    );

    return {
      id: saved.id,
      overallScore,
      ...dimensions,
      trend,
      factors,
      generatedAt: saved.generatedAt
    };
  }

  /**
   * Return the latest score, or calculate a new one if none exists.
   */
  async getCurrent(): Promise<ExecutiveScoreResult> {
    const existing = await this.prisma.aIExecutiveScore.findFirst({
      orderBy: { generatedAt: "desc" }
    });

    if (existing) {
      return {
        id: existing.id,
        overallScore: existing.overallScore,
        revenueScore: existing.revenueScore,
        engagementScore: existing.engagementScore,
        churnScore: existing.churnScore,
        deliveryScore: existing.deliveryScore,
        campaignScore: existing.campaignScore,
        trend: existing.trend,
        factors: existing.factors as Record<string, unknown>,
        generatedAt: existing.generatedAt
      };
    }

    return this.calculate();
  }

  /**
   * Return scores over the past N days.
   */
  async getHistory(days: number) {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const scores = await this.prisma.aIExecutiveScore.findMany({
      where: { generatedAt: { gte: since } },
      orderBy: { generatedAt: "asc" }
    });

    return scores.map((s) => ({
      id: s.id,
      overallScore: s.overallScore,
      revenueScore: s.revenueScore,
      engagementScore: s.engagementScore,
      churnScore: s.churnScore,
      deliveryScore: s.deliveryScore,
      campaignScore: s.campaignScore,
      trend: s.trend,
      factors: s.factors,
      generatedAt: s.generatedAt
    }));
  }

  /**
   * Calculate each dimension score (0-100) from live data.
   */
  private async calculateDimensionScores(): Promise<DimensionScores> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [
      revenueScore,
      engagementScore,
      churnScore,
      deliveryScore,
      campaignScore
    ] = await Promise.all([
      this.calculateRevenueScore(thirtyDaysAgo),
      this.calculateEngagementScore(thirtyDaysAgo),
      this.calculateChurnScore(thirtyDaysAgo),
      this.calculateDeliveryScore(thirtyDaysAgo),
      this.calculateCampaignScore(thirtyDaysAgo)
    ]);

    return {
      revenueScore,
      engagementScore,
      churnScore,
      deliveryScore,
      campaignScore
    };
  }

  /**
   * Revenue score: based on recent revenue trends.
   * Compares last 30 days to prior 30 days.
   */
  private async calculateRevenueScore(since: Date): Promise<number> {
    const priorSince = new Date(since);
    priorSince.setDate(priorSince.getDate() - 30);

    const [recentRevenue, priorRevenue] = await Promise.all([
      this.prisma.order.aggregate({
        where: { createdAt: { gte: since } },
        _sum: { amount: true },
        _count: true
      }),
      this.prisma.order.aggregate({
        where: { createdAt: { gte: priorSince, lt: since } },
        _sum: { amount: true },
        _count: true
      })
    ]);

    const recent = Number(recentRevenue._sum.amount ?? 0);
    const prior = Number(priorRevenue._sum.amount ?? 0);

    if (prior === 0 && recent === 0) return 50; // neutral
    if (prior === 0) return 80; // new revenue is good

    const growthRate = (recent - prior) / prior;
    // Map growth rate to 0-100: -50% loss = 10, 0% = 50, +50% growth = 90
    return Math.min(100, Math.max(0, Math.round(50 + growthRate * 100)));
  }

  /**
   * Engagement score: based on open and click rates from recent campaigns.
   */
  private async calculateEngagementScore(since: Date): Promise<number> {
    const analytics = await this.prisma.campaignAnalytics.aggregate({
      where: { updatedAt: { gte: since } },
      _avg: { openRate: true, clickRate: true }
    });

    const avgOpenRate = analytics._avg.openRate ?? 0;
    const avgClickRate = analytics._avg.clickRate ?? 0;

    // Benchmarks: 25% open rate = 50pts, 5% click rate = 50pts
    const openScore = Math.min(100, (avgOpenRate / 0.25) * 50);
    const clickScore = Math.min(100, (avgClickRate / 0.05) * 50);

    return Math.round((openScore + clickScore) / 2);
  }

  /**
   * Churn score (inverted): lower churn risk = higher score.
   * Based on customers who have not ordered recently.
   */
  private async calculateChurnScore(since: Date): Promise<number> {
    const totalCustomers = await this.prisma.customer.count();

    if (totalCustomers === 0) return 50;

    // Customers with orders in the last 30 days
    const activeCustomers = await this.prisma.order.groupBy({
      by: ["customerId"],
      where: { createdAt: { gte: since } }
    });

    const activeRate = activeCustomers.length / totalCustomers;
    // activeRate of 1.0 = no churn = 100, 0.0 = all churned = 0
    return Math.round(Math.min(100, activeRate * 100));
  }

  /**
   * Delivery score: based on average delivery rate from recent campaigns.
   */
  private async calculateDeliveryScore(since: Date): Promise<number> {
    const analytics = await this.prisma.campaignAnalytics.aggregate({
      where: { updatedAt: { gte: since } },
      _avg: { deliveryRate: true }
    });

    const avgDeliveryRate = analytics._avg.deliveryRate ?? 0;
    // deliveryRate is 0-1, map to 0-100
    return Math.round(Math.min(100, avgDeliveryRate * 100));
  }

  /**
   * Campaign score: based on conversion rate and campaign success rate.
   */
  private async calculateCampaignScore(since: Date): Promise<number> {
    const [totalCampaigns, completedCampaigns, analytics] = await Promise.all([
      this.prisma.campaign.count({
        where: { createdAt: { gte: since } }
      }),
      this.prisma.campaign.count({
        where: { createdAt: { gte: since }, status: "COMPLETED" }
      }),
      this.prisma.campaignAnalytics.aggregate({
        where: { updatedAt: { gte: since } },
        _avg: { conversionRate: true }
      })
    ]);

    if (totalCampaigns === 0) return 50;

    const completionRate = completedCampaigns / totalCampaigns;
    const avgConversion = analytics._avg.conversionRate ?? 0;

    // Completion contributes 60%, conversion rate contributes 40%
    const completionScore = completionRate * 60;
    // 5% conversion = full 40pts
    const conversionScore = Math.min(40, (avgConversion / 0.05) * 40);

    return Math.round(completionScore + conversionScore);
  }
}
