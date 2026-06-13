import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import type {
  InsightGenerator,
  GeneratedInsight,
  ConfidenceFactor,
} from "./generator.interface";
import type { SegmentRuleGroup } from "../../contracts";

@Injectable()
export class SegmentGenerator implements InsightGenerator {
  readonly name = "segment";

  constructor(private readonly prisma: PrismaService) {}

  async generate(): Promise<GeneratedInsight[]> {
    const insights: GeneratedInsight[] = [];
    const now = new Date();

    // Always produce a segment overview
    const totalSegments = await this.prisma.segment.count();
    const totalCustomers = await this.prisma.customer.count();

    insights.push({
      type: "SEGMENT",
      fingerprint: "segment-overview",
      title: "Segment overview",
      summary: `${totalSegments} segments created covering ${totalCustomers} total customers.`,
      details: { totalSegments, totalCustomers },
      recommendation:
        "Create targeted segments based on purchase behaviour, engagement level, and demographics for more effective campaigns.",
      estimatedImpact: `${totalSegments} segments available for targeting`,
      confidenceScore: 0.95,
      confidenceFactors: [
        { factor: "data_completeness", weight: 0.5, direction: "positive" },
        { factor: "sample_size", weight: 0.5, direction: "positive" },
      ],
      impactScore: 0.4,
      expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
    });

    const [hvrBuyers, atRiskVips, newCohort] = await Promise.all([
      this.discoverHighValueRepeatBuyers(now),
      this.discoverAtRiskVips(now),
      this.discoverNewCustomerCohort(now),
    ]);

    if (hvrBuyers) insights.push(hvrBuyers);
    if (atRiskVips) insights.push(atRiskVips);
    if (newCohort) insights.push(newCohort);

    return insights;
  }

  /**
   * High-value repeat buyers: 2+ orders, >Rs 5000 total spent, last order <60 days.
   */
  private async discoverHighValueRepeatBuyers(
    now: Date,
  ): Promise<GeneratedInsight | null> {
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

    const rows = await this.prisma.$queryRaw<
      Array<{
        customer_count: bigint;
        total_revenue: Prisma.Decimal;
        avg_order_value: Prisma.Decimal;
        avg_order_count: Prisma.Decimal;
      }>
    >`
      WITH customer_stats AS (
        SELECT
          o."customerId",
          COUNT(*)          AS order_count,
          SUM(o.amount)     AS total_spent,
          MAX(o."createdAt") AS last_order_at
        FROM "Order" o
        GROUP BY o."customerId"
        HAVING COUNT(*) >= 2 AND SUM(o.amount) > 5000
      )
      SELECT
        COUNT(*)            AS customer_count,
        SUM(total_spent)    AS total_revenue,
        AVG(total_spent)    AS avg_order_value,
        AVG(order_count)    AS avg_order_count
      FROM customer_stats
      WHERE last_order_at >= ${sixtyDaysAgo}
    `;

    const row = rows[0];
    if (!row) return null;

    const customerCount = Number(row.customer_count);
    if (customerCount === 0) return null;

    const totalRevenue = Number(row.total_revenue);
    const avgOrderValue = Number(row.avg_order_value);
    const avgOrderCount = Number(row.avg_order_count);

    const suggestedRules: SegmentRuleGroup = {
      operator: "AND",
      conditions: [
        { field: "orderCount", operator: ">=", value: 2 },
        { field: "totalSpent", operator: ">", value: 5000 },
        { field: "daysSinceLastOrder", operator: "<", value: 60 },
      ],
    };

    const confidenceFactors: ConfidenceFactor[] = [
      {
        factor: "segment_size",
        weight: 0.35,
        direction: customerCount >= 10 ? "positive" : "negative",
      },
      {
        factor: "revenue_potential",
        weight: 0.35,
        direction: totalRevenue > 10000 ? "positive" : "negative",
      },
      {
        factor: "recency",
        weight: 0.3,
        direction: "positive",
      },
    ];

    return {
      type: "SEGMENT",
      fingerprint: "segment-hvr-buyers",
      title: `${customerCount} high-value repeat buyers identified`,
      summary: `Found ${customerCount} customers with 2+ orders and over Rs 5000 spent in the last 60 days, generating ${totalRevenue.toFixed(2)} in revenue.`,
      details: {
        customerCount,
        totalRevenue,
        avgOrderValue: Number(avgOrderValue.toFixed(2)),
        avgOrderCount: Number(avgOrderCount.toFixed(1)),
        suggestedRules,
        criteria: {
          minOrders: 2,
          minTotalSpent: 5000,
          maxDaysSinceLastOrder: 60,
        },
      },
      recommendation:
        "Create a loyalty segment for these high-value repeat buyers. Offer exclusive early access or VIP perks to increase retention and lifetime value.",
      estimatedImpact: `${totalRevenue.toFixed(2)} revenue from ${customerCount} high-value customers`,
      confidenceScore: this.calculateConfidence(confidenceFactors),
      confidenceFactors,
      impactScore: Math.min(1, totalRevenue / 100000),
      expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
    };
  }

  /**
   * At-risk VIPs: high lifetime value but declining engagement (no recent orders).
   */
  private async discoverAtRiskVips(
    now: Date,
  ): Promise<GeneratedInsight | null> {
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

    const rows = await this.prisma.$queryRaw<
      Array<{
        customer_count: bigint;
        total_revenue: Prisma.Decimal;
        avg_lifetime_value: Prisma.Decimal;
        avg_days_inactive: Prisma.Decimal;
      }>
    >`
      WITH customer_stats AS (
        SELECT
          o."customerId",
          COUNT(*)             AS order_count,
          SUM(o.amount)        AS total_spent,
          MAX(o."createdAt")   AS last_order_at
        FROM "Order" o
        GROUP BY o."customerId"
        HAVING SUM(o.amount) > 10000
      )
      SELECT
        COUNT(*)                    AS customer_count,
        SUM(total_spent)            AS total_revenue,
        AVG(total_spent)            AS avg_lifetime_value,
        AVG(
          EXTRACT(EPOCH FROM (${now}::timestamp - last_order_at)) / 86400
        )                           AS avg_days_inactive
      FROM customer_stats
      WHERE last_order_at < ${thirtyDaysAgo}
        AND last_order_at >= ${ninetyDaysAgo}
    `;

    const row = rows[0];
    if (!row) return null;

    const customerCount = Number(row.customer_count);
    if (customerCount === 0) return null;

    const totalRevenue = Number(row.total_revenue);
    const avgLifetimeValue = Number(row.avg_lifetime_value);
    const avgDaysInactive = Number(row.avg_days_inactive);

    const suggestedRules: SegmentRuleGroup = {
      operator: "AND",
      conditions: [
        { field: "totalSpent", operator: ">", value: 10000 },
        { field: "daysSinceLastOrder", operator: ">", value: 30 },
        { field: "daysSinceLastOrder", operator: "<=", value: 90 },
      ],
    };

    const confidenceFactors: ConfidenceFactor[] = [
      {
        factor: "vip_value_size",
        weight: 0.4,
        direction: avgLifetimeValue > 15000 ? "positive" : "negative",
      },
      {
        factor: "inactivity_duration",
        weight: 0.35,
        direction: avgDaysInactive > 45 ? "negative" : "positive",
      },
      {
        factor: "segment_size",
        weight: 0.25,
        direction: customerCount >= 5 ? "positive" : "negative",
      },
    ];

    return {
      type: "SEGMENT",
      fingerprint: "segment-at-risk-vips",
      title: `${customerCount} VIP customers at risk of churn`,
      summary: `${customerCount} high-value customers (avg lifetime value Rs ${avgLifetimeValue.toFixed(0)}) have not ordered in 30-90 days, with Rs ${totalRevenue.toFixed(2)} in historical revenue at risk.`,
      details: {
        customerCount,
        totalRevenue,
        avgLifetimeValue: Number(avgLifetimeValue.toFixed(2)),
        avgDaysInactive: Number(avgDaysInactive.toFixed(1)),
        suggestedRules,
        criteria: {
          minTotalSpent: 10000,
          inactiveDaysMin: 30,
          inactiveDaysMax: 90,
        },
      },
      recommendation:
        "Urgently target these at-risk VIPs with a personalised win-back campaign. Consider exclusive offers, early access to new products, or a direct outreach from a dedicated account manager.",
      estimatedImpact: `${totalRevenue.toFixed(2)} in historical revenue at risk from ${customerCount} VIPs`,
      confidenceScore: this.calculateConfidence(confidenceFactors),
      confidenceFactors,
      impactScore: Math.min(1, totalRevenue / 50000),
      expiresAt: new Date(now.getTime() + 12 * 60 * 60 * 1000),
    };
  }

  /**
   * New customer cohort: acquired in the last 30 days.
   */
  private async discoverNewCustomerCohort(
    now: Date,
  ): Promise<GeneratedInsight | null> {
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

    const [currentCohortRows, previousCohortRows] = await Promise.all([
      this.prisma.$queryRaw<
        Array<{
          customer_count: bigint;
          with_orders: bigint;
          total_revenue: Prisma.Decimal;
        }>
      >`
        SELECT
          COUNT(DISTINCT c.id)  AS customer_count,
          COUNT(DISTINCT CASE WHEN o.id IS NOT NULL THEN c.id END) AS with_orders,
          COALESCE(SUM(o.amount), 0) AS total_revenue
        FROM "Customer" c
        LEFT JOIN "Order" o ON o."customerId" = c.id
        WHERE c."createdAt" >= ${thirtyDaysAgo}
      `,
      this.prisma.$queryRaw<
        Array<{
          customer_count: bigint;
        }>
      >`
        SELECT COUNT(*) AS customer_count
        FROM "Customer"
        WHERE "createdAt" >= ${sixtyDaysAgo}
          AND "createdAt" < ${thirtyDaysAgo}
      `,
    ]);

    const currentRow = currentCohortRows[0];
    if (!currentRow) return null;

    const customerCount = Number(currentRow.customer_count);
    if (customerCount === 0) return null;

    const withOrders = Number(currentRow.with_orders);
    const totalRevenue = Number(currentRow.total_revenue);
    const previousCount = previousCohortRows[0]
      ? Number(previousCohortRows[0].customer_count)
      : 0;

    const conversionRate = customerCount > 0 ? withOrders / customerCount : 0;
    const growthRate =
      previousCount > 0
        ? ((customerCount - previousCount) / previousCount) * 100
        : 0;

    const suggestedRules: SegmentRuleGroup = {
      operator: "AND",
      conditions: [
        { field: "daysSinceLastOrder", operator: "<=", value: 30 },
      ],
    };

    const confidenceFactors: ConfidenceFactor[] = [
      {
        factor: "cohort_size",
        weight: 0.35,
        direction: customerCount >= 10 ? "positive" : "negative",
      },
      {
        factor: "conversion_rate",
        weight: 0.35,
        direction: conversionRate > 0.2 ? "positive" : "negative",
      },
      {
        factor: "growth_trend",
        weight: 0.3,
        direction: growthRate > 0 ? "positive" : "negative",
      },
    ];

    return {
      type: "SEGMENT",
      fingerprint: "segment-new-cohort",
      title: `${customerCount} new customers acquired in the last 30 days`,
      summary: `${customerCount} new customers joined in the last 30 days (${growthRate > 0 ? "+" : ""}${growthRate.toFixed(1)}% vs prior period). ${withOrders} have already made a purchase (${(conversionRate * 100).toFixed(1)}% conversion).`,
      details: {
        customerCount,
        withOrders,
        totalRevenue,
        conversionRate: Number(conversionRate.toFixed(4)),
        previousPeriodCount: previousCount,
        growthRate: Number(growthRate.toFixed(2)),
        suggestedRules,
        criteria: {
          acquiredInLastDays: 30,
        },
      },
      recommendation:
        "Nurture this new cohort with an onboarding campaign. Send a welcome series with product recommendations and a first-purchase incentive to maximise early conversion and retention.",
      estimatedImpact: `${customerCount} new customers with ${(conversionRate * 100).toFixed(1)}% early conversion rate`,
      confidenceScore: this.calculateConfidence(confidenceFactors),
      confidenceFactors,
      impactScore: Math.min(1, customerCount / 100),
      expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
    };
  }

  private calculateConfidence(factors: ConfidenceFactor[]): number {
    let score = 0;
    for (const f of factors) {
      score += f.direction === "positive" ? f.weight : -f.weight * 0.3;
    }
    return Math.max(0, Math.min(1, Number(score.toFixed(2))));
  }
}
