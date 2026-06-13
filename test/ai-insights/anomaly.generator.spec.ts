import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { AnomalyGenerator } from "../../src/ai-insights/generators/anomaly.generator";

function createMockPrisma() {
  return {
    $queryRaw: vi.fn(),
  } as any;
}

describe("AnomalyGenerator", () => {
  let generator: AnomalyGenerator;
  let prisma: ReturnType<typeof createMockPrisma>;

  beforeEach(() => {
    prisma = createMockPrisma();
    generator = new AnomalyGenerator(prisma);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-13T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("detects delivery failure spikes when current rate exceeds 2x baseline", async () => {
    // Current failure rates
    prisma.$queryRaw.mockResolvedValueOnce([
      { channel: "EMAIL", total_sent: 1000n, total_failed: 150n },
    ]);
    // Baseline stats
    prisma.$queryRaw.mockResolvedValueOnce([
      { channel: "EMAIL", avg_failure_rate: 0.05, std_dev: 0.02 },
    ]);
    // Channel degradation queries (current 7-day, baseline 30-day)
    prisma.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    const insights = await generator.generate();

    const spikeInsight = insights.find(
      (i) => i.fingerprint === "anomaly-failure-spike-email",
    );
    expect(spikeInsight).toBeDefined();
    expect(spikeInsight!.title).toContain("Delivery failure spike");
    expect(spikeInsight!.details.currentRate).toBeGreaterThan(
      spikeInsight!.details.normalRate! * 2,
    );
  });

  it("detects channel degradation when delivery rate drops below baseline", async () => {
    // Failure spike queries (no spikes)
    prisma.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    // Channel degradation: current 7-day
    prisma.$queryRaw.mockResolvedValueOnce([
      { channel: "SMS", total: 500n, delivered: 350n },
    ]);
    // Channel degradation: baseline 30-day
    prisma.$queryRaw.mockResolvedValueOnce([
      { channel: "SMS", avg_delivery_rate: 0.95, std_dev: 0.03 },
    ]);

    const insights = await generator.generate();

    const degradationInsight = insights.find(
      (i) => i.fingerprint === "anomaly-delivery-degradation-sms",
    );
    expect(degradationInsight).toBeDefined();
    expect(degradationInsight!.title).toContain("delivery rate degradation");
    // Current rate 350/500 = 0.70, normal = 0.95, drop = 26.3%
    expect(degradationInsight!.details.dropPercentage).toBeGreaterThan(20);
  });

  it("calculates standard deviation correctly for baseline comparison", async () => {
    // No failure spikes
    prisma.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    // Channel degradation: current well below baseline - 2*sigma
    prisma.$queryRaw.mockResolvedValueOnce([
      { channel: "EMAIL", total: 200n, delivered: 140n },
    ]);
    prisma.$queryRaw.mockResolvedValueOnce([
      { channel: "EMAIL", avg_delivery_rate: 0.92, std_dev: 0.05 },
    ]);

    const insights = await generator.generate();

    const degradationInsight = insights.find(
      (i) => i.fingerprint === "anomaly-delivery-degradation-email",
    );
    expect(degradationInsight).toBeDefined();
    expect(degradationInsight!.details.stdDev).toBe(0.05);
    // Current rate = 0.70, normal - 2*sigma = 0.92 - 0.10 = 0.82
    // 0.70 < 0.82, so it should be flagged
    expect(degradationInsight!.details.currentRate).toBeLessThan(
      degradationInsight!.details.normalRate! -
        2 * degradationInsight!.details.stdDev!,
    );
  });

  it("handles insufficient data gracefully by not generating insights", async () => {
    // Failure spike: too few messages (< 10)
    prisma.$queryRaw.mockResolvedValueOnce([
      { channel: "EMAIL", total_sent: 5n, total_failed: 2n },
    ]);
    prisma.$queryRaw.mockResolvedValueOnce([
      { channel: "EMAIL", avg_failure_rate: 0.05, std_dev: 0.02 },
    ]);
    // Channel degradation: too few messages (< 20)
    prisma.$queryRaw.mockResolvedValueOnce([
      { channel: "EMAIL", total: 10n, delivered: 8n },
    ]);
    prisma.$queryRaw.mockResolvedValueOnce([
      { channel: "EMAIL", avg_delivery_rate: 0.95, std_dev: 0.03 },
    ]);

    const insights = await generator.generate();

    expect(insights).toHaveLength(0);
  });

  it("generates appropriate urgency via confidence and impact scores", async () => {
    // Severe failure spike
    prisma.$queryRaw.mockResolvedValueOnce([
      { channel: "EMAIL", total_sent: 2000n, total_failed: 500n },
    ]);
    prisma.$queryRaw.mockResolvedValueOnce([
      { channel: "EMAIL", avg_failure_rate: 0.03, std_dev: 0.01 },
    ]);
    prisma.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    const insights = await generator.generate();

    const spikeInsight = insights.find(
      (i) => i.fingerprint === "anomaly-failure-spike-email",
    );
    expect(spikeInsight).toBeDefined();
    // Failure spike confidence is hardcoded to 0.92
    expect(spikeInsight!.confidenceScore).toBe(0.92);
    // impactScore = min(1, currentFailureRate) = min(1, 0.25) = 0.25
    expect(spikeInsight!.impactScore).toBeCloseTo(0.25, 2);
    // Expiry should be 4 hours for spikes
    const expectedExpiry =
      new Date("2026-06-13T12:00:00Z").getTime() + 4 * 60 * 60 * 1000;
    expect(spikeInsight!.expiresAt.getTime()).toBe(expectedExpiry);
  });
});
