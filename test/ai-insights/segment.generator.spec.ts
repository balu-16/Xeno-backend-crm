import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { SegmentGenerator } from "../../src/ai-insights/generators/segment.generator";

function createMockPrisma() {
  return {
    $queryRaw: vi.fn().mockResolvedValue([]),
    segment: { count: vi.fn().mockResolvedValue(5) },
    customer: { count: vi.fn().mockResolvedValue(100) },
  } as any;
}

describe("SegmentGenerator", () => {
  let generator: SegmentGenerator;
  let prisma: ReturnType<typeof createMockPrisma>;

  beforeEach(() => {
    prisma = createMockPrisma();
    generator = new SegmentGenerator(prisma);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-13T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("discovers high-value repeat buyers with 2+ orders and >5000 spent", async () => {
    // High-value repeat buyers query
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        customer_count: 25n,
        total_revenue: 187500,
        avg_order_value: 7500,
        avg_order_count: 4.2,
      },
    ]);
    // At-risk VIPs query
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        customer_count: 0n,
        total_revenue: 0,
        avg_lifetime_value: 0,
        avg_days_inactive: 0,
      },
    ]);
    // New cohort queries (2 queries via Promise.all)
    prisma.$queryRaw
      .mockResolvedValueOnce([
        { customer_count: 0n, with_orders: 0n, total_revenue: 0 },
      ])
      .mockResolvedValueOnce([{ customer_count: 0n }]);

    const insights = await generator.generate();

    const hvrInsight = insights.find(
      (i) => i.fingerprint === "segment-hvr-buyers",
    );
    expect(hvrInsight).toBeDefined();
    expect(hvrInsight!.details.customerCount).toBe(25);
    expect(hvrInsight!.details.totalRevenue).toBe(187500);
    expect(hvrInsight!.details.criteria!.minOrders).toBe(2);
    expect(hvrInsight!.details.criteria!.minTotalSpent).toBe(5000);
  });

  it("identifies at-risk VIPs with high lifetime value but no recent orders", async () => {
    // High-value repeat buyers: none
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        customer_count: 0n,
        total_revenue: 0,
        avg_order_value: 0,
        avg_order_count: 0,
      },
    ]);
    // At-risk VIPs
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        customer_count: 8n,
        total_revenue: 120000,
        avg_lifetime_value: 15000,
        avg_days_inactive: 52.5,
      },
    ]);
    // New cohort (empty)
    prisma.$queryRaw
      .mockResolvedValueOnce([
        { customer_count: 0n, with_orders: 0n, total_revenue: 0 },
      ])
      .mockResolvedValueOnce([{ customer_count: 0n }]);

    const insights = await generator.generate();

    const vipInsight = insights.find(
      (i) => i.fingerprint === "segment-at-risk-vips",
    );
    expect(vipInsight).toBeDefined();
    expect(vipInsight!.details.customerCount).toBe(8);
    expect(vipInsight!.details.avgLifetimeValue).toBe(15000);
    expect(vipInsight!.details.criteria!.minTotalSpent).toBe(10000);
    expect(vipInsight!.title).toContain("VIP customers at risk");
  });

  it("generates valid segment rules", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        customer_count: 15n,
        total_revenue: 90000,
        avg_order_value: 6000,
        avg_order_count: 3.5,
      },
    ]);
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        customer_count: 0n,
        total_revenue: 0,
        avg_lifetime_value: 0,
        avg_days_inactive: 0,
      },
    ]);
    prisma.$queryRaw
      .mockResolvedValueOnce([
        { customer_count: 0n, with_orders: 0n, total_revenue: 0 },
      ])
      .mockResolvedValueOnce([{ customer_count: 0n }]);

    const insights = await generator.generate();

    const hvrInsight = insights.find(
      (i) => i.fingerprint === "segment-hvr-buyers",
    );
    expect(hvrInsight).toBeDefined();

    const rules = hvrInsight!.details.suggestedRules!;
    expect(rules).toBeDefined();
    expect(rules.operator).toBe("AND");
    expect(rules.conditions).toHaveLength(3);
    expect(rules.conditions[0]).toEqual({
      field: "orderCount",
      operator: ">=",
      value: 2,
    });
    expect(rules.conditions[1]).toEqual({
      field: "totalSpent",
      operator: ">",
      value: 5000,
    });
  });

  it("calculates segment size accurately", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        customer_count: 42n,
        total_revenue: 315000,
        avg_order_value: 7500,
        avg_order_count: 5.0,
      },
    ]);
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        customer_count: 0n,
        total_revenue: 0,
        avg_lifetime_value: 0,
        avg_days_inactive: 0,
      },
    ]);
    prisma.$queryRaw
      .mockResolvedValueOnce([
        { customer_count: 0n, with_orders: 0n, total_revenue: 0 },
      ])
      .mockResolvedValueOnce([{ customer_count: 0n }]);

    const insights = await generator.generate();

    const hvrInsight = insights.find(
      (i) => i.fingerprint === "segment-hvr-buyers",
    );
    expect(hvrInsight).toBeDefined();
    expect(hvrInsight!.details.customerCount).toBe(42);
    expect(hvrInsight!.details.avgOrderCount).toBe(5);
  });

  it("estimates segment revenue potential", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        customer_count: 30n,
        total_revenue: 250000,
        avg_order_value: 8333.33,
        avg_order_count: 4.0,
      },
    ]);
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        customer_count: 0n,
        total_revenue: 0,
        avg_lifetime_value: 0,
        avg_days_inactive: 0,
      },
    ]);
    prisma.$queryRaw
      .mockResolvedValueOnce([
        { customer_count: 0n, with_orders: 0n, total_revenue: 0 },
      ])
      .mockResolvedValueOnce([{ customer_count: 0n }]);

    const insights = await generator.generate();

    const hvrInsight = insights.find(
      (i) => i.fingerprint === "segment-hvr-buyers",
    );
    expect(hvrInsight).toBeDefined();
    expect(hvrInsight!.details.totalRevenue).toBe(250000);
    // impactScore = min(1, 250000 / 100000) = 1
    expect(hvrInsight!.impactScore).toBe(1);
    expect(hvrInsight!.estimatedImpact).toContain("250000");
    expect(hvrInsight!.estimatedImpact).toContain("30");
  });
});
