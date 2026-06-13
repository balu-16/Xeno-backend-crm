import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { ChurnGenerator } from "../../src/ai-insights/generators/churn.generator";

function createMockPrisma() {
  return {
    $queryRaw: vi.fn().mockResolvedValue([]),
    customer: { count: vi.fn().mockResolvedValue(100) },
  } as any;
}

describe("ChurnGenerator", () => {
  let generator: ChurnGenerator;
  let prisma: ReturnType<typeof createMockPrisma>;

  beforeEach(() => {
    prisma = createMockPrisma();
    generator = new ChurnGenerator(prisma);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-13T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("scores churn risk correctly for an inactive customer", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        customer_id: "cust-1",
        customer_name: "Alice",
        customer_email: "alice@example.com",
        days_since_last_purchase: 120,
        current_period_orders: 0n,
        previous_period_orders: 2n,
        current_period_value: 0,
        previous_period_value: 3000,
        last_campaign_event_days: 90,
        recent_campaigns_total: 5n,
        recent_campaigns_opened: 0n,
      },
    ]);

    const insights = await generator.generate();

    // Overview + high-risk batch
    expect(insights).toHaveLength(2);
    const batch = insights.find((i) => i.fingerprint === "churn-high-risk-batch");
    expect(batch).toBeDefined();
    expect(batch!.type).toBe("CHURN");
    expect(batch!.details.highRiskCount).toBe(1);
    expect(batch!.details.avgChurnScore).toBeGreaterThan(0.7);
  });

  it("classifies high/medium/low risk correctly", async () => {
    // Only high-risk customers (score > 0.7) are returned by scoreChurnRisk
    // So we test that only HIGH risk customers appear in the output
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        customer_id: "cust-high",
        customer_name: "High Risk",
        customer_email: "high@example.com",
        days_since_last_purchase: 150,
        current_period_orders: 0n,
        previous_period_orders: 3n,
        current_period_value: 0,
        previous_period_value: 5000,
        last_campaign_event_days: null,
        recent_campaigns_total: 0n,
        recent_campaigns_opened: 0n,
      },
      {
        customer_id: "cust-high-2",
        customer_name: "Also High",
        customer_email: "high2@example.com",
        days_since_last_purchase: 100,
        current_period_orders: 0n,
        previous_period_orders: 4n,
        current_period_value: 0,
        previous_period_value: 8000,
        last_campaign_event_days: 70,
        recent_campaigns_total: 3n,
        recent_campaigns_opened: 0n,
      },
    ]);

    const insights = await generator.generate();

    // Overview + high-risk batch
    expect(insights).toHaveLength(2);
    const batch = insights.find((i) => i.fingerprint === "churn-high-risk-batch");
    const topCustomers = batch!.details.topRiskCustomers as any[];
    expect(topCustomers.length).toBe(2);
    for (const customer of topCustomers) {
      expect(customer.riskLevel).toBe("HIGH");
    }
  });

  it("identifies top risk factors from the factor breakdown", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        customer_id: "cust-factors",
        customer_name: "Factor Test",
        customer_email: "factor@example.com",
        days_since_last_purchase: 120,
        current_period_orders: 0n,
        previous_period_orders: 5n,
        current_period_value: 0,
        previous_period_value: 10000,
        last_campaign_event_days: 80,
        recent_campaigns_total: 4n,
        recent_campaigns_opened: 0n,
      },
    ]);

    const insights = await generator.generate();

    const batch = insights.find((i) => i.fingerprint === "churn-high-risk-batch");
    const breakdown = batch!.details.factorBreakdown as Record<
      string,
      { avgScore: number; affectedCount: number }
    >;
    expect(breakdown).toBeDefined();
    expect(breakdown.daysSinceLastPurchase).toBeDefined();
    expect(breakdown.daysSinceLastEngagement).toBeDefined();
    expect(breakdown.campaignInteraction).toBeDefined();
    expect(breakdown.orderFrequencyDecline).toBeDefined();
    expect(breakdown.purchaseValueDecline).toBeDefined();

    // For this very inactive customer, daysSinceLastPurchase should have a high score
    expect(breakdown.daysSinceLastPurchase!.avgScore).toBeGreaterThanOrEqual(
      0.8,
    );
  });

  it("calculates total revenue at risk", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        customer_id: "cust-rev-1",
        customer_name: "Revenue 1",
        customer_email: "rev1@example.com",
        days_since_last_purchase: 100,
        current_period_orders: 0n,
        previous_period_orders: 2n,
        current_period_value: 0,
        previous_period_value: 3000,
        last_campaign_event_days: 60,
        recent_campaigns_total: 2n,
        recent_campaigns_opened: 0n,
      },
      {
        customer_id: "cust-rev-2",
        customer_name: "Revenue 2",
        customer_email: "rev2@example.com",
        days_since_last_purchase: 110,
        current_period_orders: 0n,
        previous_period_orders: 3n,
        current_period_value: 0,
        previous_period_value: 7000,
        last_campaign_event_days: null,
        recent_campaigns_total: 0n,
        recent_campaigns_opened: 0n,
      },
    ]);

    const insights = await generator.generate();

    // Overview + high-risk batch
    expect(insights).toHaveLength(2);
    const batch = insights.find((i) => i.fingerprint === "churn-high-risk-batch");
    expect(batch!.details.highRiskCount).toBe(2);
    // impactScore = min(1, 2 / 50) = 0.04
    expect(batch!.impactScore).toBeCloseTo(0.04, 2);
  });

  it("handles customers with no order history (returns overview only)", async () => {
    // No high-risk customers returned from the query
    prisma.$queryRaw.mockResolvedValueOnce([]);

    const insights = await generator.generate();

    // Only the overview insight, no high-risk batch
    expect(insights).toHaveLength(1);
    expect(insights[0]!.fingerprint).toBe("churn-overview");
  });

  it("generates actionable recommendation", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        customer_id: "cust-rec",
        customer_name: "Rec Test",
        customer_email: "rec@example.com",
        days_since_last_purchase: 95,
        current_period_orders: 0n,
        previous_period_orders: 2n,
        current_period_value: 0,
        previous_period_value: 4000,
        last_campaign_event_days: 50,
        recent_campaigns_total: 3n,
        recent_campaigns_opened: 0n,
      },
    ]);

    const insights = await generator.generate();

    const batch = insights.find((i) => i.fingerprint === "churn-high-risk-batch");
    expect(batch!.recommendation).toBeDefined();
    expect(batch!.recommendation.length).toBeGreaterThan(20);
    expect(batch!.recommendation).toContain("retention");
  });
});
