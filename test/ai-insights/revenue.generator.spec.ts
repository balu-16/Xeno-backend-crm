import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { RevenueGenerator } from "../../src/ai-insights/generators/revenue.generator";

function createMockPrisma() {
  return {
    $queryRaw: vi.fn().mockResolvedValue([]),
    customer: { count: vi.fn().mockResolvedValue(100) },
    campaign: { findMany: vi.fn().mockResolvedValue([]) },
  } as any;
}

describe("RevenueGenerator", () => {
  let generator: RevenueGenerator;
  let prisma: ReturnType<typeof createMockPrisma>;

  beforeEach(() => {
    prisma = createMockPrisma();
    generator = new RevenueGenerator(prisma);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-13T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("detects 7-day revenue decline greater than 10%", async () => {
    // current period: 4000, previous period: 5000 => -20% decline
    prisma.$queryRaw
      .mockResolvedValueOnce([
        { period: "current", revenue: 4000, order_count: 40n },
        { period: "previous", revenue: 5000, order_count: 50n },
      ])
      // concentration query
      .mockResolvedValueOnce([]);

    const insights = await generator.generate();

    const declineInsight = insights.find((i) => i.fingerprint === "revenue-drop-7d");
    expect(declineInsight).toBeDefined();
    expect(declineInsight!.title).toContain("Revenue decline detected");
    expect(declineInsight!.details.changePercent).toBeLessThan(-10);
    expect(declineInsight!.type).toBe("REVENUE");
  });

  it("detects 7-day revenue growth greater than 10%", async () => {
    // current period: 6000, previous period: 4000 => +50% growth
    prisma.$queryRaw
      .mockResolvedValueOnce([
        { period: "current", revenue: 6000, order_count: 60n },
        { period: "previous", revenue: 4000, order_count: 40n },
      ])
      .mockResolvedValueOnce([]);

    const insights = await generator.generate();

    const growthInsight = insights.find((i) => i.fingerprint === "revenue-growth-7d");
    expect(growthInsight).toBeDefined();
    expect(growthInsight!.title).toContain("Revenue growth detected");
    expect(growthInsight!.details.changePercent).toBeGreaterThan(10);
  });

  it("detects revenue stagnation (flat for 14 days)", async () => {
    // current: 5000, previous: 5050 => ~0% change (stagnation)
    prisma.$queryRaw
      .mockResolvedValueOnce([
        { period: "current", revenue: 5000, order_count: 50n },
        { period: "previous", revenue: 5050, order_count: 50n },
      ])
      .mockResolvedValueOnce([]);

    const insights = await generator.generate();

    // Flat change (< 10% in either direction) should produce no drop/growth insight
    const declineInsight = insights.find((i) => i.fingerprint === "revenue-drop-7d");
    const growthInsight = insights.find((i) => i.fingerprint === "revenue-growth-7d");
    expect(declineInsight).toBeUndefined();
    expect(growthInsight).toBeUndefined();
  });

  it("detects revenue concentration in a single segment", async () => {
    // No 7-day change triggers
    prisma.$queryRaw
      .mockResolvedValueOnce([
        { period: "current", revenue: 5000, order_count: 50n },
        { period: "previous", revenue: 5000, order_count: 50n },
      ])
      // all-time totals
      .mockResolvedValueOnce([{ total: 50000, count: 500n }])
      // concentration: 75% in high_frequency
      .mockResolvedValueOnce([
        { segment: "high_frequency", revenue: 7500, customer_count: 5n },
        { segment: "low_frequency", revenue: 2500, customer_count: 20n },
      ]);

    const insights = await generator.generate();

    const concentrationInsight = insights.find(
      (i) => i.fingerprint === "revenue-concentration-risk",
    );
    expect(concentrationInsight).toBeDefined();
    expect(concentrationInsight!.title).toContain("Revenue concentration risk");
    expect(concentrationInsight!.details.topShare).toBeGreaterThan(0.6);
  });

  it("calculates correct impact score", async () => {
    // 30% decline => impactScore = min(1, 30/50) = 0.6
    prisma.$queryRaw
      .mockResolvedValueOnce([
        { period: "current", revenue: 3500, order_count: 35n },
        { period: "previous", revenue: 5000, order_count: 50n },
      ])
      .mockResolvedValueOnce([]);

    const insights = await generator.generate();

    const declineInsight = insights.find((i) => i.fingerprint === "revenue-drop-7d");
    expect(declineInsight).toBeDefined();
    expect(declineInsight!.impactScore).toBeCloseTo(0.6, 2);
  });

  it("calculates correct confidence score with factors", async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([
        { period: "current", revenue: 4000, order_count: 40n },
        { period: "previous", revenue: 5000, order_count: 50n },
      ])
      .mockResolvedValueOnce([]);

    const insights = await generator.generate();

    const declineInsight = insights.find((i) => i.fingerprint === "revenue-drop-7d");
    expect(declineInsight).toBeDefined();
    expect(declineInsight!.confidenceFactors).toHaveLength(3);
    expect(declineInsight!.confidenceScore).toBeGreaterThanOrEqual(0);
    expect(declineInsight!.confidenceScore).toBeLessThanOrEqual(1);

    // All factors should have a weight and direction
    for (const factor of declineInsight!.confidenceFactors) {
      expect(factor.weight).toBeGreaterThan(0);
      expect(["positive", "negative"]).toContain(factor.direction);
    }
  });

  it("generates proper fingerprint", async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([
        { period: "current", revenue: 3000, order_count: 30n },
        { period: "previous", revenue: 5000, order_count: 50n },
      ])
      .mockResolvedValueOnce([]);

    const insights = await generator.generate();

    const declineInsight = insights.find((i) => i.fingerprint === "revenue-drop-7d");
    expect(declineInsight).toBeDefined();
    expect(declineInsight!.fingerprint).toBe("revenue-drop-7d");
  });

  it("sets appropriate expiry time (6 hours from now)", async () => {
    const now = new Date("2026-06-13T12:00:00Z");
    prisma.$queryRaw
      .mockResolvedValueOnce([
        { period: "current", revenue: 4000, order_count: 40n },
        { period: "previous", revenue: 5000, order_count: 50n },
      ])
      .mockResolvedValueOnce([]);

    const insights = await generator.generate();

    const declineInsight = insights.find((i) => i.fingerprint === "revenue-drop-7d");
    expect(declineInsight).toBeDefined();

    const expectedExpiry = new Date(now.getTime() + 6 * 60 * 60 * 1000);
    expect(declineInsight!.expiresAt.getTime()).toBe(expectedExpiry.getTime());
  });
});
