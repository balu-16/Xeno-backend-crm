import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { AnomalyGenerator } from "../../src/ai-insights/generators/anomaly.generator";

function createMockPrisma() {
  return {
    $queryRaw: vi.fn().mockResolvedValue([]),
    campaignLog: { count: vi.fn().mockResolvedValue(500) },
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
    // Promise.all interleaving: spike-q1, degradation-q1, spike-q2, degradation-q2
    // Spike current: EMAIL 150/1000 = 15% failure
    prisma.$queryRaw.mockResolvedValueOnce([
      { channel: "EMAIL", total_sent: 1000n, total_failed: 150n },
    ]);
    // Degradation current: none
    prisma.$queryRaw.mockResolvedValueOnce([]);
    // Spike baseline: 5% normal rate
    prisma.$queryRaw.mockResolvedValueOnce([
      { channel: "EMAIL", avg_failure_rate: 0.05, std_dev: 0.02 },
    ]);
    // Degradation baseline: none
    prisma.$queryRaw.mockResolvedValueOnce([]);

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
    // Promise.all interleaving: spike-q1, degradation-q1, spike-q2, degradation-q2
    // Spike current: none
    prisma.$queryRaw.mockResolvedValueOnce([]);
    // Degradation current: SMS 350/500 = 70% delivery
    prisma.$queryRaw.mockResolvedValueOnce([
      { channel: "SMS", total: 500n, delivered: 350n },
    ]);
    // Spike baseline: none
    prisma.$queryRaw.mockResolvedValueOnce([]);
    // Degradation baseline: SMS normal 95%
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
    // Promise.all interleaving: spike-q1, degradation-q1, spike-q2, degradation-q2
    // Spike current: none
    prisma.$queryRaw.mockResolvedValueOnce([]);
    // Degradation current: EMAIL 140/200 = 70%
    prisma.$queryRaw.mockResolvedValueOnce([
      { channel: "EMAIL", total: 200n, delivered: 140n },
    ]);
    // Spike baseline: none
    prisma.$queryRaw.mockResolvedValueOnce([]);
    // Degradation baseline: EMAIL normal 92%, stdDev 5%
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

  it("handles insufficient data gracefully by not generating anomaly insights", async () => {
    // Promise.all interleaving: spike-q1, degradation-q1, spike-q2, degradation-q2
    // Spike current: too few messages (< 10)
    prisma.$queryRaw.mockResolvedValueOnce([
      { channel: "EMAIL", total_sent: 5n, total_failed: 2n },
    ]);
    // Degradation current: too few messages (< 20)
    prisma.$queryRaw.mockResolvedValueOnce([
      { channel: "EMAIL", total: 10n, delivered: 8n },
    ]);
    // Spike baseline
    prisma.$queryRaw.mockResolvedValueOnce([
      { channel: "EMAIL", avg_failure_rate: 0.05, std_dev: 0.02 },
    ]);
    // Degradation baseline
    prisma.$queryRaw.mockResolvedValueOnce([
      { channel: "EMAIL", avg_delivery_rate: 0.95, std_dev: 0.03 },
    ]);

    const insights = await generator.generate();

    // Only the overview insight, no anomaly insights
    expect(insights).toHaveLength(1);
    expect(insights[0]!.fingerprint).toBe("anomaly-overview");
  });

  it("generates appropriate urgency via confidence and impact scores", async () => {
    // Promise.all interleaving: spike-q1, degradation-q1, spike-q2, degradation-q2
    // Spike current: EMAIL 500/2000 = 25% failure
    prisma.$queryRaw.mockResolvedValueOnce([
      { channel: "EMAIL", total_sent: 2000n, total_failed: 500n },
    ]);
    // Degradation current: none
    prisma.$queryRaw.mockResolvedValueOnce([]);
    // Spike baseline: 3% normal
    prisma.$queryRaw.mockResolvedValueOnce([
      { channel: "EMAIL", avg_failure_rate: 0.03, std_dev: 0.01 },
    ]);
    // Degradation baseline: none
    prisma.$queryRaw.mockResolvedValueOnce([]);

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
