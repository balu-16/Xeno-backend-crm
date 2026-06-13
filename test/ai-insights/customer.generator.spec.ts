import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { CustomerGenerator } from "../../src/ai-insights/generators/customer.generator";

function createMockPrisma() {
  return {
    $queryRaw: vi.fn(),
    customer: { count: vi.fn() },
  } as any;
}

describe("CustomerGenerator", () => {
  let generator: CustomerGenerator;
  let prisma: ReturnType<typeof createMockPrisma>;

  beforeEach(() => {
    prisma = createMockPrisma();
    generator = new CustomerGenerator(prisma);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-13T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("detects inactive customers at 30/60/90 day thresholds", async () => {
    prisma.customer.count.mockResolvedValue(100);

    // 30-day inactive
    prisma.$queryRaw.mockResolvedValueOnce([
      { inactive_count: 25n, revenue_at_risk: 12500, avg_order_value: 500 },
    ]);
    // 60-day inactive
    prisma.$queryRaw.mockResolvedValueOnce([
      { inactive_count: 15n, revenue_at_risk: 9000, avg_order_value: 600 },
    ]);
    // 90-day inactive
    prisma.$queryRaw.mockResolvedValueOnce([
      { inactive_count: 8n, revenue_at_risk: 6400, avg_order_value: 800 },
    ]);

    const insights = await generator.generate();

    expect(insights).toHaveLength(3);

    const fingerprints = insights.map((i) => i.fingerprint);
    expect(fingerprints).toContain("inactive-customers-30d");
    expect(fingerprints).toContain("inactive-customers-60d");
    expect(fingerprints).toContain("inactive-customers-90d");

    expect(insights[0]!.details.severity).toBe("moderate");
    expect(insights[1]!.details.severity).toBe("high");
    expect(insights[2]!.details.severity).toBe("critical");
  });

  it("identifies returning customers by having no inactive insight when all are active", async () => {
    prisma.customer.count.mockResolvedValue(50);

    // All thresholds return zero inactive
    prisma.$queryRaw
      .mockResolvedValueOnce([{ inactive_count: 0n, revenue_at_risk: 0, avg_order_value: 0 }])
      .mockResolvedValueOnce([{ inactive_count: 0n, revenue_at_risk: 0, avg_order_value: 0 }])
      .mockResolvedValueOnce([{ inactive_count: 0n, revenue_at_risk: 0, avg_order_value: 0 }]);

    const insights = await generator.generate();

    expect(insights).toHaveLength(0);
  });

  it("identifies high-value customers (top 10%) via revenue at risk ratio", async () => {
    prisma.customer.count.mockResolvedValue(100);

    // 30-day: 10 inactive customers with high revenue at risk
    prisma.$queryRaw.mockResolvedValueOnce([
      { inactive_count: 10n, revenue_at_risk: 50000, avg_order_value: 5000 },
    ]);
    prisma.$queryRaw.mockResolvedValueOnce([
      { inactive_count: 5n, revenue_at_risk: 30000, avg_order_value: 6000 },
    ]);
    prisma.$queryRaw.mockResolvedValueOnce([
      { inactive_count: 2n, revenue_at_risk: 15000, avg_order_value: 7500 },
    ]);

    const insights = await generator.generate();

    // 30-day insight: 10/100 = 10% inactive ratio
    const thirtyDayInsight = insights.find((i) => i.fingerprint === "inactive-customers-30d");
    expect(thirtyDayInsight).toBeDefined();
    expect(thirtyDayInsight!.details.inactiveRatio).toBeCloseTo(0.1, 2);
    expect(thirtyDayInsight!.details.revenueAtRisk).toBe(50000);
  });

  it("calculates customer count accurately", async () => {
    prisma.customer.count.mockResolvedValue(200);

    prisma.$queryRaw.mockResolvedValueOnce([
      { inactive_count: 42n, revenue_at_risk: 21000, avg_order_value: 500 },
    ]);
    prisma.$queryRaw.mockResolvedValueOnce([
      { inactive_count: 18n, revenue_at_risk: 10800, avg_order_value: 600 },
    ]);
    prisma.$queryRaw.mockResolvedValueOnce([
      { inactive_count: 5n, revenue_at_risk: 4000, avg_order_value: 800 },
    ]);

    const insights = await generator.generate();

    expect(insights[0]!.details.inactiveCount).toBe(42);
    expect(insights[0]!.details.totalCustomers).toBe(200);
    expect(insights[0]!.details.inactiveRatio).toBeCloseTo(0.21, 2);
  });

  it("generates proper recommendation text based on threshold severity", async () => {
    prisma.customer.count.mockResolvedValue(100);

    // 30-day
    prisma.$queryRaw.mockResolvedValueOnce([
      { inactive_count: 20n, revenue_at_risk: 10000, avg_order_value: 500 },
    ]);
    // 60-day
    prisma.$queryRaw.mockResolvedValueOnce([
      { inactive_count: 10n, revenue_at_risk: 7000, avg_order_value: 700 },
    ]);
    // 90-day
    prisma.$queryRaw.mockResolvedValueOnce([
      { inactive_count: 5n, revenue_at_risk: 4000, avg_order_value: 800 },
    ]);

    const insights = await generator.generate();

    const thirty = insights.find((i) => i.fingerprint === "inactive-customers-30d");
    const sixty = insights.find((i) => i.fingerprint === "inactive-customers-60d");
    const ninety = insights.find((i) => i.fingerprint === "inactive-customers-90d");

    expect(thirty!.recommendation).toContain("Monitor");
    expect(sixty!.recommendation).toContain("re-activation");
    expect(ninety!.recommendation).toContain("win-back");
  });

  it("handles zero-customer edge case", async () => {
    prisma.customer.count.mockResolvedValue(0);

    const insights = await generator.generate();

    expect(insights).toHaveLength(0);
    // $queryRaw should never have been called
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
});
