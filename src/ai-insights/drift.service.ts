import { Injectable, Logger } from "@nestjs/common";
import {
  InsightFeedbackRating,
  InsightStatus,
  InsightType,
} from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

interface DriftMetrics {
  type: string;
  totalGenerated: number;
  totalActioned: number;
  totalDismissed: number;
  totalUsefulFeedback: number;
  totalFeedback: number;
  actionRate: number;
  dismissRate: number;
  usefulRate: number;
  driftScore: number;
  isCritical: boolean;
}

@Injectable()
export class DriftService {
  private readonly logger = new Logger(DriftService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * For each insight type, compute actionRate, dismissRate, usefulRate,
   * and a composite driftScore. Flag driftScore > 0.7 as critical.
   */
  async getMetrics(): Promise<[DriftMetrics, ...DriftMetrics[]]> {
    const types = Object.values(InsightType) as [InsightType, ...InsightType[]];
    const results: DriftMetrics[] = [];

    for (const type of types) {
      const metrics = await this.computeMetricsForType(type);
      results.push(metrics);
    }

    // Sort by driftScore descending so critical items surface first
    results.sort((a, b) => b.driftScore - a.driftScore);

    const criticalCount = results.filter((r) => r.isCritical).length;
    if (criticalCount > 0) {
      this.logger.warn(
        `${criticalCount} insight type(s) have critical drift (score > 0.7)`,
      );
    }

    return results as [DriftMetrics, ...DriftMetrics[]];
  }

  /**
   * Detailed drift breakdown for a specific insight type.
   */
  async getDriftByType(type: InsightType) {
    const metrics = await this.computeMetricsForType(type);

    // Get recent insights of this type for trend analysis
    const recentInsights = await this.prisma.aIInsight.findMany({
      where: { type },
      orderBy: { generatedAt: "desc" },
      take: 20,
      select: {
        id: true,
        title: true,
        status: true,
        confidenceScore: true,
        generatedAt: true,
        actionedAt: true,
        dismissedAt: true,
        feedback: {
          select: { rating: true },
        },
      },
    });

    const recentTrend = recentInsights.map((insight) => ({
      id: insight.id,
      title: insight.title,
      status: insight.status,
      confidenceScore: insight.confidenceScore,
      generatedAt: insight.generatedAt,
      wasActioned: insight.actionedAt !== null,
      wasDismissed: insight.dismissedAt !== null,
      feedbackRating: insight.feedback[0]?.rating ?? null,
    }));

    // Calculate 7-day rolling metrics
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const recentGenerated = await this.prisma.aIInsight.count({
      where: { type, generatedAt: { gte: sevenDaysAgo } },
    });

    const recentActioned = await this.prisma.aIInsight.count({
      where: {
        type,
        status: InsightStatus.ACTIONED,
        actionedAt: { gte: sevenDaysAgo },
      },
    });

    return {
      ...metrics,
      recentTrend,
      rolling7Day: {
        generated: recentGenerated,
        actioned: recentActioned,
        actionRate: recentGenerated > 0 ? recentActioned / recentGenerated : 0,
      },
    };
  }

  /**
   * Core computation: derive all drift metrics for a single insight type.
   */
  private async computeMetricsForType(
    type: InsightType,
  ): Promise<DriftMetrics> {
    const [totalGenerated, totalActioned, totalDismissed, feedbackStats] =
      await Promise.all([
        this.prisma.aIInsight.count({ where: { type } }),
        this.prisma.aIInsight.count({
          where: { type, status: InsightStatus.ACTIONED },
        }),
        this.prisma.aIInsight.count({
          where: { type, status: InsightStatus.DISMISSED },
        }),
        this.prisma.aIInsightFeedback.aggregate({
          where: {
            insight: { type },
            rating: InsightFeedbackRating.USEFUL,
          },
          _count: { id: true },
        }),
      ]);

    const totalFeedback = await this.prisma.aIInsightFeedback.count({
      where: { insight: { type } },
    });

    const totalUsefulFeedback = feedbackStats._count.id;

    const actionRate = totalGenerated > 0 ? totalActioned / totalGenerated : 0;
    const dismissRate =
      totalGenerated > 0 ? totalDismissed / totalGenerated : 0;
    const usefulRate =
      totalFeedback > 0 ? totalUsefulFeedback / totalFeedback : 0;

    // driftScore: 1.0 means fully drifted (no value), 0.0 means perfectly useful
    const driftScore = 1.0 - (actionRate * 0.4 + usefulRate * 0.6);

    return {
      type,
      totalGenerated,
      totalActioned,
      totalDismissed,
      totalUsefulFeedback,
      totalFeedback,
      actionRate,
      dismissRate,
      usefulRate,
      driftScore: Math.round(driftScore * 1000) / 1000,
      isCritical: driftScore > 0.7,
    };
  }
}
