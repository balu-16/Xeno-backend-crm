import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import type {
  InsightGenerator,
  GeneratedInsight,
  ConfidenceFactor,
} from "./generator.interface";

const INACTIVITY_THRESHOLDS = [30, 60, 90] as const;

@Injectable()
export class CustomerGenerator implements InsightGenerator {
  readonly name = "customer";

  constructor(private readonly prisma: PrismaService) {}

  async generate(): Promise<GeneratedInsight[]> {
    const insights: GeneratedInsight[] = [];
    const now = new Date();

    const totalCustomers = await this.prisma.customer.count();

    // Always produce a customer overview
    const customersWithOrders = await this.prisma.$queryRaw<
      Array<{ count: bigint }>
    >`
      SELECT COUNT(DISTINCT "customerId") AS count FROM "Order"
    `;
    const activeCustomers = customersWithOrders[0]
      ? Number(customersWithOrders[0].count)
      : 0;

    insights.push({
      type: "CUSTOMER",
      fingerprint: "customer-overview",
      title: "Customer overview",
      summary: `${totalCustomers} total customers, ${activeCustomers} with at least one order.`,
      details: {
        totalCustomers,
        activeCustomers,
        dormantCustomers: totalCustomers - activeCustomers,
      },
      recommendation:
        "Focus on converting dormant customers with targeted campaigns. Monitor churn risk indicators regularly.",
      estimatedImpact: `${totalCustomers} customers in database`,
      confidenceScore: 0.95,
      confidenceFactors: [
        { factor: "data_completeness", weight: 0.5, direction: "positive" },
        { factor: "sample_size", weight: 0.5, direction: "positive" },
      ],
      impactScore: 0.4,
      expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
    });

    if (totalCustomers === 0) return insights;

    for (const days of INACTIVITY_THRESHOLDS) {
      const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

      const rows = await this.prisma.$queryRaw<
        Array<{
          inactive_count: bigint;
          revenue_at_risk: Prisma.Decimal;
          avg_order_value: Prisma.Decimal;
        }>
      >`
        WITH active_customers AS (
          SELECT DISTINCT o."customerId"
          FROM "Order" o
          WHERE o."createdAt" >= ${cutoff}
        ),
        inactive AS (
          SELECT
            c.id,
            COALESCE(SUM(o.amount), 0) AS lifetime_revenue,
            COUNT(o.id) AS lifetime_orders
          FROM "Customer" c
          INNER JOIN "Order" o ON o."customerId" = c.id
          WHERE c.id NOT IN (SELECT "customerId" FROM active_customers)
          GROUP BY c.id
        )
        SELECT
          COUNT(*)                  AS inactive_count,
          SUM(lifetime_revenue)     AS revenue_at_risk,
          AVG(lifetime_revenue)     AS avg_order_value
        FROM inactive
      `;

      const row = rows[0];
      if (!row) continue;

      const inactiveCount = Number(row.inactive_count);
      if (inactiveCount === 0) continue;

      const revenueAtRisk = Number(row.revenue_at_risk);
      const avgLifetimeValue = Number(row.avg_order_value);
      const inactiveRatio = inactiveCount / totalCustomers;

      const severityLabel =
        days >= 90 ? "critical" : days >= 60 ? "high" : "moderate";

      const confidenceFactors: ConfidenceFactor[] = [
        {
          factor: "inactive_customer_volume",
          weight: 0.35,
          direction: inactiveCount > 10 ? "positive" : "negative",
        },
        {
          factor: "threshold_duration",
          weight: 0.3,
          direction: days >= 60 ? "positive" : "negative",
        },
        {
          factor: "revenue_at_risk_size",
          weight: 0.35,
          direction: revenueAtRisk > 0 ? "positive" : "negative",
        },
      ];

      insights.push({
        type: "CUSTOMER",
        fingerprint: `inactive-customers-${days}d`,
        title: `${inactiveCount} customers inactive for ${days}+ days`,
        summary: `${inactiveCount} customers (${(inactiveRatio * 100).toFixed(1)}% of total) have not placed an order in the last ${days} days, representing ${revenueAtRisk.toFixed(2)} in lifetime revenue at risk.`,
        details: {
          inactiveCount,
          thresholdDays: days,
          revenueAtRisk,
          avgLifetimeValue: Number(avgLifetimeValue.toFixed(2)),
          inactiveRatio: Number(inactiveRatio.toFixed(4)),
          totalCustomers,
          severity: severityLabel,
        },
        recommendation:
          days >= 90
            ? "These customers are at high risk of permanent churn. Launch a targeted win-back campaign with a compelling incentive (discount or free shipping) and consider removing them from regular sends to protect sender reputation."
            : days >= 60
              ? "Engage these customers before they churn. Send a personalised re-activation campaign highlighting new products or exclusive offers."
              : "Monitor these customers closely. Consider a gentle re-engagement email or SMS with a curated product selection.",
        estimatedImpact: `${revenueAtRisk.toFixed(2)} lifetime revenue at risk from ${inactiveCount} inactive customers`,
        confidenceScore: this.calculateConfidence(confidenceFactors),
        confidenceFactors,
        impactScore: Math.min(1, inactiveRatio),
        expiresAt: new Date(now.getTime() + 6 * 60 * 60 * 1000),
      });
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
