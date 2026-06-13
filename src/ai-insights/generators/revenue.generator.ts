import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import type {
  InsightGenerator,
  GeneratedInsight,
  ConfidenceFactor,
} from "./generator.interface";

@Injectable()
export class RevenueGenerator implements InsightGenerator {
  readonly name = "revenue";

  constructor(private readonly prisma: PrismaService) {}

  async generate(): Promise<GeneratedInsight[]> {
    const insights: GeneratedInsight[] = [];
    const now = new Date();

    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

    // ── 7-day revenue comparison via raw SQL ──────────────────────
    const rows = await this.prisma.$queryRaw<
      Array<{ period: string; revenue: Prisma.Decimal; order_count: bigint }>
    >`
      SELECT
        CASE
          WHEN "createdAt" >= ${sevenDaysAgo} THEN 'current'
          ELSE 'previous'
        END AS period,
        SUM(amount) AS revenue,
        COUNT(*)    AS order_count
      FROM "Order"
      WHERE "createdAt" >= ${fourteenDaysAgo}
      GROUP BY period
    `;

    const currentRow = rows.find((r) => r.period === "current");
    const previousRow = rows.find((r) => r.period === "previous");

    const currentRevenue = currentRow ? Number(currentRow.revenue) : 0;
    const previousRevenue = previousRow ? Number(previousRow.revenue) : 0;
    const currentOrderCount = currentRow ? Number(currentRow.order_count) : 0;

    // Always produce a revenue overview insight
    const totalRevenueAllTime = await this.prisma.$queryRaw<
      Array<{ total: Prisma.Decimal; count: bigint }>
    >`
      SELECT SUM(amount) AS total, COUNT(*) AS count FROM "Order"
    `;

    const allTimeRevenue = totalRevenueAllTime[0]
      ? Number(totalRevenueAllTime[0].total)
      : 0;
    const allTimeOrders = totalRevenueAllTime[0]
      ? Number(totalRevenueAllTime[0].count)
      : 0;

    if (allTimeOrders > 0) {
      insights.push({
        type: "REVENUE",
        fingerprint: "revenue-overview",
        title: "Revenue overview",
        summary: `Total revenue: ${allTimeRevenue.toFixed(2)} from ${allTimeOrders} orders. Last 7 days: ${currentRevenue.toFixed(2)} from ${currentOrderCount} orders.`,
        details: {
          allTimeRevenue,
          allTimeOrders,
          last7DaysRevenue: currentRevenue,
          last7DaysOrders: currentOrderCount,
          previous7DaysRevenue: previousRevenue,
        },
        recommendation:
          "Monitor revenue trends regularly. Use campaign insights to identify growth opportunities and reduce churn.",
        estimatedImpact: `${allTimeRevenue.toFixed(2)} total revenue tracked`,
        confidenceScore: 0.95,
        confidenceFactors: [
          { factor: "data_completeness", weight: 0.5, direction: "positive" },
          { factor: "sample_size", weight: 0.5, direction: "positive" },
        ],
        impactScore: 0.5,
        expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      });
    }

    if (previousRevenue > 0) {
      const changePercent =
        ((currentRevenue - previousRevenue) / previousRevenue) * 100;

      // ── Revenue drop > 10% ─────────────────────────────────────
      if (changePercent < -10) {
        const confidenceFactors: ConfidenceFactor[] = [
          {
            factor: "order_volume_consistency",
            weight: 0.4,
            direction: currentOrderCount > 0 ? "positive" : "negative",
          },
          {
            factor: "magnitude_of_decline",
            weight: 0.35,
            direction: Math.abs(changePercent) > 25 ? "negative" : "positive",
          },
          {
            factor: "comparison_window_size",
            weight: 0.25,
            direction: "positive",
          },
        ];

        insights.push({
          type: "REVENUE",
          fingerprint: "revenue-drop-7d",
          title: "Revenue decline detected",
          summary: `Revenue dropped ${Math.abs(changePercent).toFixed(1)}% over the last 7 days compared to the previous 7 days.`,
          details: {
            currentRevenue,
            previousRevenue,
            changePercent: Number(changePercent.toFixed(2)),
            currentOrderCount,
            periodStart: sevenDaysAgo.toISOString(),
            periodEnd: now.toISOString(),
          },
          recommendation:
            "Investigate the root cause of the revenue decline. Review recent campaign performance, check for changes in customer behaviour, and consider launching a re-engagement campaign for dormant customers.",
          estimatedImpact: `${Math.abs(changePercent).toFixed(1)}% revenue decline (${(previousRevenue - currentRevenue).toFixed(2)} loss)`,
          confidenceScore: this.calculateConfidence(confidenceFactors),
          confidenceFactors,
          impactScore: Math.min(1, Math.abs(changePercent) / 50),
          expiresAt: new Date(now.getTime() + 6 * 60 * 60 * 1000),
        });
      }

      // ── Revenue growth > 10% ───────────────────────────────────
      if (changePercent > 10) {
        const confidenceFactors: ConfidenceFactor[] = [
          {
            factor: "order_volume_consistency",
            weight: 0.4,
            direction: currentOrderCount > 0 ? "positive" : "negative",
          },
          {
            factor: "magnitude_of_growth",
            weight: 0.35,
            direction: changePercent > 25 ? "positive" : "negative",
          },
          {
            factor: "comparison_window_size",
            weight: 0.25,
            direction: "positive",
          },
        ];

        insights.push({
          type: "REVENUE",
          fingerprint: "revenue-growth-7d",
          title: "Revenue growth detected",
          summary: `Revenue grew ${changePercent.toFixed(1)}% over the last 7 days compared to the previous 7 days.`,
          details: {
            currentRevenue,
            previousRevenue,
            changePercent: Number(changePercent.toFixed(2)),
            currentOrderCount,
            periodStart: sevenDaysAgo.toISOString(),
            periodEnd: now.toISOString(),
          },
          recommendation:
            "Identify what is driving the growth — which campaigns, segments, or channels are contributing most. Double down on high-performing strategies and consider increasing budget for top campaigns.",
          estimatedImpact: `${changePercent.toFixed(1)}% revenue growth (+${(currentRevenue - previousRevenue).toFixed(2)})`,
          confidenceScore: this.calculateConfidence(confidenceFactors),
          confidenceFactors,
          impactScore: Math.min(1, changePercent / 50),
          expiresAt: new Date(now.getTime() + 6 * 60 * 60 * 1000),
        });
      }
    }

    return insights;
  }

  private calculateConfidence(factors: ConfidenceFactor[]): number {
    let score = 0;
    for (const f of factors) {
      score += f.direction === "positive" ? f.weight : -f.weight * 0.3;
    }
    return Math.max(0, Math.min(1, Number(score.toFixed(2))));
  }
}
