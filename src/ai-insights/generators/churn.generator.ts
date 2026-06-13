import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import type {
  InsightGenerator,
  GeneratedInsight,
  ConfidenceFactor,
} from "./generator.interface";

interface ChurnRiskCustomer {
  customerId: string;
  customerName: string;
  customerEmail: string;
  churnScore: number;
  riskLevel: "HIGH" | "MEDIUM" | "LOW";
  factors: {
    daysSinceLastPurchase: { value: number; weight: number; score: number };
    daysSinceLastEngagement: { value: number; weight: number; score: number };
    campaignInteraction: { value: number; weight: number; score: number };
    orderFrequencyDecline: { value: number; weight: number; score: number };
    purchaseValueDecline: { value: number; weight: number; score: number };
  };
}

@Injectable()
export class ChurnGenerator implements InsightGenerator {
  readonly name = "churn";

  constructor(private readonly prisma: PrismaService) {}

  async generate(): Promise<GeneratedInsight[]> {
    const insights: GeneratedInsight[] = [];
    const now = new Date();

    // Always produce a churn overview
    const totalCustomers = await this.prisma.customer.count();
    insights.push({
      type: "CHURN",
      fingerprint: "churn-overview",
      title: "Churn risk monitoring active",
      summary: `Monitoring ${totalCustomers} customers for churn risk signals based on purchase recency, engagement, and campaign interaction.`,
      details: { totalCustomersMonitored: totalCustomers },
      recommendation:
        "Review high-risk customers regularly and launch targeted retention campaigns before they churn.",
      estimatedImpact: `${totalCustomers} customers under churn monitoring`,
      confidenceScore: 0.9,
      confidenceFactors: [
        { factor: "monitoring_coverage", weight: 0.5, direction: "positive" },
        { factor: "model_active", weight: 0.5, direction: "positive" },
      ],
      impactScore: 0.5,
      expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
    });

    const highRiskCustomers = await this.scoreChurnRisk(now);

    if (highRiskCustomers.length === 0) return insights;

    const totalRevenueAtRisk = highRiskCustomers.reduce(
      (sum, c) => sum + c.factors.daysSinceLastPurchase.value * 0,
      0,
    );

    const avgChurnScore =
      highRiskCustomers.reduce((sum, c) => sum + c.churnScore, 0) /
      highRiskCustomers.length;

    // Build risk factor breakdown
    const factorBreakdown = this.aggregateFactorBreakdown(highRiskCustomers);

    const confidenceFactors: ConfidenceFactor[] = [
      {
        factor: "scoring_model_coverage",
        weight: 0.3,
        direction: highRiskCustomers.length >= 5 ? "positive" : "negative",
      },
      {
        factor: "multi_factor_signals",
        weight: 0.35,
        direction: "positive",
      },
      {
        factor: "data_recency",
        weight: 0.35,
        direction: "positive",
      },
    ];

    insights.push({
      type: "CHURN",
      fingerprint: "churn-high-risk-batch",
      title: `${highRiskCustomers.length} customers at high risk of churn`,
      summary: `Identified ${highRiskCustomers.length} customers with a churn risk score above 0.7. Average churn score: ${avgChurnScore.toFixed(2)}.`,
      details: {
        highRiskCount: highRiskCustomers.length,
        avgChurnScore: Number(avgChurnScore.toFixed(3)),
        factorBreakdown,
        topRiskCustomers: highRiskCustomers.slice(0, 20).map((c) => ({
          customerId: c.customerId,
          customerName: c.customerName,
          churnScore: Number(c.churnScore.toFixed(3)),
          riskLevel: c.riskLevel,
          primaryFactor: this.getPrimaryFactor(c.factors),
        })),
        riskDistribution: {
          high: highRiskCustomers.filter((c) => c.riskLevel === "HIGH").length,
          medium: 0,
          low: 0,
        },
        scoringWeights: {
          daysSinceLastPurchase: 0.3,
          daysSinceLastEngagement: 0.2,
          campaignInteraction: 0.2,
          orderFrequencyDecline: 0.15,
          purchaseValueDecline: 0.15,
        },
      },
      recommendation:
        "Prioritise retention campaigns for these high-risk customers. Segment by primary risk factor: customers with declining purchase frequency respond well to personalised product recommendations, while those with no recent engagement may need a re-activation incentive.",
      estimatedImpact: `${highRiskCustomers.length} customers at high churn risk`,
      confidenceScore: this.calculateConfidence(confidenceFactors),
      confidenceFactors,
      impactScore: Math.min(1, highRiskCustomers.length / 50),
      expiresAt: new Date(now.getTime() + 12 * 60 * 60 * 1000),
    });

    return insights;
  }

  /**
   * Score all customers with orders for churn risk using a rule-based model.
   * Returns only customers with a churn score > 0.7 (high risk).
   */
  private async scoreChurnRisk(now: Date): Promise<ChurnRiskCustomer[]> {
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sixtyDaysAgoDate = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

    // Get customer-level aggregated data for churn scoring
    const rows = await this.prisma.$queryRaw<
      Array<{
        customer_id: string;
        customer_name: string;
        customer_email: string;
        days_since_last_purchase: number;
        current_period_orders: bigint;
        previous_period_orders: bigint;
        current_period_value: Prisma.Decimal;
        previous_period_value: Prisma.Decimal;
        last_campaign_event_days: number | null;
        recent_campaigns_total: bigint;
        recent_campaigns_opened: bigint;
      }>
    >`
      WITH last_purchase AS (
        SELECT
          "customerId",
          MAX("createdAt") AS last_order_at
        FROM "Order"
        GROUP BY "customerId"
      ),
      current_period AS (
        SELECT
          "customerId",
          COUNT(*)      AS order_count,
          COALESCE(SUM(amount), 0) AS total_value
        FROM "Order"
        WHERE "createdAt" >= ${thirtyDaysAgo}
        GROUP BY "customerId"
      ),
      previous_period AS (
        SELECT
          "customerId",
          COUNT(*)      AS order_count,
          COALESCE(SUM(amount), 0) AS total_value
        FROM "Order"
        WHERE "createdAt" >= ${sixtyDaysAgoDate}
          AND "createdAt" < ${thirtyDaysAgo}
        GROUP BY "customerId"
      ),
      last_engagement AS (
        SELECT
          "customerId",
          MAX("occurredAt") AS last_event_at
        FROM "CampaignEvent"
        WHERE "customerId" IS NOT NULL
        GROUP BY "customerId"
      ),
      campaign_interactions AS (
        SELECT
          ce."customerId",
          COUNT(DISTINCT ce."campaignId") AS total_campaigns,
          COUNT(DISTINCT CASE
            WHEN ce.type IN ('MessageOpened', 'MessageClicked', 'MessageConverted')
            THEN ce."campaignId"
          END) AS opened_campaigns
        FROM "CampaignEvent" ce
        WHERE ce."customerId" IS NOT NULL
          AND ce."occurredAt" >= ${sixtyDaysAgo}
        GROUP BY ce."customerId"
      )
      SELECT
        c.id              AS customer_id,
        c.name            AS customer_name,
        c.email           AS customer_email,
        EXTRACT(EPOCH FROM (${now}::timestamp - lp.last_order_at)) / 86400
                          AS days_since_last_purchase,
        COALESCE(cp.order_count, 0)   AS current_period_orders,
        COALESCE(pp.order_count, 0)   AS previous_period_orders,
        COALESCE(cp.total_value, 0)   AS current_period_value,
        COALESCE(pp.total_value, 0)   AS previous_period_value,
        CASE WHEN le.last_event_at IS NOT NULL
          THEN EXTRACT(EPOCH FROM (${now}::timestamp - le.last_event_at)) / 86400
          ELSE NULL
        END                           AS last_campaign_event_days,
        COALESCE(ci.total_campaigns, 0)    AS recent_campaigns_total,
        COALESCE(ci.opened_campaigns, 0)   AS recent_campaigns_opened
      FROM "Customer" c
      INNER JOIN last_purchase lp ON lp."customerId" = c.id
      LEFT JOIN current_period cp ON cp."customerId" = c.id
      LEFT JOIN previous_period pp ON pp."customerId" = c.id
      LEFT JOIN last_engagement le ON le."customerId" = c.id
      LEFT JOIN campaign_interactions ci ON ci."customerId" = c.id
      WHERE lp.last_order_at < ${ninetyDaysAgo}
    `;

    const results: ChurnRiskCustomer[] = [];

    for (const row of rows) {
      const daysSinceLastPurchase = Number(row.days_since_last_purchase);
      const currentPeriodOrders = Number(row.current_period_orders);
      const previousPeriodOrders = Number(row.previous_period_orders);
      const currentPeriodValue = Number(row.current_period_value);
      const previousPeriodValue = Number(row.previous_period_value);
      const lastCampaignEventDays = row.last_campaign_event_days
        ? Number(row.last_campaign_event_days)
        : null;
      const recentCampaignsTotal = Number(row.recent_campaigns_total);
      const recentCampaignsOpened = Number(row.recent_campaigns_opened);

      // Factor 1: Days since last purchase (30%)
      let purchaseRecencyScore: number;
      if (daysSinceLastPurchase > 90) {
        purchaseRecencyScore = 1.0;
      } else if (daysSinceLastPurchase > 60) {
        purchaseRecencyScore = 0.6;
      } else if (daysSinceLastPurchase > 30) {
        purchaseRecencyScore = 0.3;
      } else {
        purchaseRecencyScore = 0;
      }

      // Factor 2: Days since last engagement (20%)
      let engagementScore: number;
      if (lastCampaignEventDays === null) {
        engagementScore = 1.0;
      } else if (lastCampaignEventDays > 60) {
        engagementScore = 1.0;
      } else if (lastCampaignEventDays > 30) {
        engagementScore = 0.5;
      } else {
        engagementScore = 0;
      }

      // Factor 3: Campaign interaction (20%) — no opens in last 5 campaigns
      let campaignInteractionScore: number;
      if (recentCampaignsTotal === 0) {
        campaignInteractionScore = 0.5;
      } else if (recentCampaignsOpened === 0) {
        campaignInteractionScore = 1.0;
      } else {
        campaignInteractionScore = Math.max(
          0,
          1 - recentCampaignsOpened / Math.min(recentCampaignsTotal, 5),
        );
      }

      // Factor 4: Order frequency decline (15%) — current < 50% of previous
      let frequencyDeclineScore: number;
      if (previousPeriodOrders === 0) {
        frequencyDeclineScore = currentPeriodOrders === 0 ? 0.8 : 0;
      } else {
        const ratio = currentPeriodOrders / previousPeriodOrders;
        frequencyDeclineScore = ratio < 0.5 ? 1.0 : ratio < 0.8 ? 0.5 : 0;
      }

      // Factor 5: Purchase value decline (15%) — current < 50% of previous
      let valueDeclineScore: number;
      if (previousPeriodValue === 0) {
        valueDeclineScore = currentPeriodValue === 0 ? 0.8 : 0;
      } else {
        const ratio = currentPeriodValue / previousPeriodValue;
        valueDeclineScore = ratio < 0.5 ? 1.0 : ratio < 0.8 ? 0.5 : 0;
      }

      // Weighted churn score
      const churnScore =
        purchaseRecencyScore * 0.3 +
        engagementScore * 0.2 +
        campaignInteractionScore * 0.2 +
        frequencyDeclineScore * 0.15 +
        valueDeclineScore * 0.15;

      let riskLevel: "HIGH" | "MEDIUM" | "LOW";
      if (churnScore > 0.7) {
        riskLevel = "HIGH";
      } else if (churnScore >= 0.4) {
        riskLevel = "MEDIUM";
      } else {
        riskLevel = "LOW";
      }

      results.push({
        customerId: row.customer_id,
        customerName: row.customer_name,
        customerEmail: row.customer_email,
        churnScore: Number(churnScore.toFixed(4)),
        riskLevel,
        factors: {
          daysSinceLastPurchase: {
            value: daysSinceLastPurchase,
            weight: 0.3,
            score: Number(purchaseRecencyScore.toFixed(3)),
          },
          daysSinceLastEngagement: {
            value: lastCampaignEventDays ?? -1,
            weight: 0.2,
            score: Number(engagementScore.toFixed(3)),
          },
          campaignInteraction: {
            value: recentCampaignsOpened,
            weight: 0.2,
            score: Number(campaignInteractionScore.toFixed(3)),
          },
          orderFrequencyDecline: {
            value: currentPeriodOrders,
            weight: 0.15,
            score: Number(frequencyDeclineScore.toFixed(3)),
          },
          purchaseValueDecline: {
            value: currentPeriodValue,
            weight: 0.15,
            score: Number(valueDeclineScore.toFixed(3)),
          },
        },
      });
    }

    // Return only high-risk customers, sorted by score descending
    return results
      .filter((c) => c.riskLevel === "HIGH")
      .sort((a, b) => b.churnScore - a.churnScore);
  }

  private getPrimaryFactor(
    factors: ChurnRiskCustomer["factors"],
  ): string {
    const scored = [
      { name: "daysSinceLastPurchase", score: factors.daysSinceLastPurchase.score * factors.daysSinceLastPurchase.weight },
      { name: "daysSinceLastEngagement", score: factors.daysSinceLastEngagement.score * factors.daysSinceLastEngagement.weight },
      { name: "campaignInteraction", score: factors.campaignInteraction.score * factors.campaignInteraction.weight },
      { name: "orderFrequencyDecline", score: factors.orderFrequencyDecline.score * factors.orderFrequencyDecline.weight },
      { name: "purchaseValueDecline", score: factors.purchaseValueDecline.score * factors.purchaseValueDecline.weight },
    ];
    scored.sort((a, b) => b.score - a.score);
    return scored[0]?.name ?? "unknown";
  }

  private aggregateFactorBreakdown(
    customers: ChurnRiskCustomer[],
  ): Record<string, { avgScore: number; affectedCount: number }> {
    const factorNames = [
      "daysSinceLastPurchase",
      "daysSinceLastEngagement",
      "campaignInteraction",
      "orderFrequencyDecline",
      "purchaseValueDecline",
    ] as const;

    const breakdown: Record<string, { avgScore: number; affectedCount: number }> = {};

    for (const factor of factorNames) {
      const scores = customers.map((c) => c.factors[factor].score);
      const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
      const affectedCount = scores.filter((s) => s > 0.5).length;
      breakdown[factor] = {
        avgScore: Number(avgScore.toFixed(3)),
        affectedCount,
      };
    }

    return breakdown;
  }

  private calculateConfidence(factors: ConfidenceFactor[]): number {
    let score = 0;
    for (const f of factors) {
      score += f.direction === "positive" ? f.weight : -f.weight * 0.3;
    }
    return Math.max(0, Math.min(1, Number(score.toFixed(2))));
  }
}
