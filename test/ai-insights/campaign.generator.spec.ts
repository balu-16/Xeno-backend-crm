import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { CampaignGenerator } from "../../src/ai-insights/generators/campaign.generator";

function createMockPrisma() {
  return {
    $queryRaw: vi.fn().mockResolvedValue([]),
    campaign: {
      count: vi.fn().mockResolvedValue(10),
      findMany: vi.fn().mockResolvedValue([]),
    },
  } as any;
}

describe("CampaignGenerator", () => {
  let generator: CampaignGenerator;
  let prisma: ReturnType<typeof createMockPrisma>;

  beforeEach(() => {
    prisma = createMockPrisma();
    generator = new CampaignGenerator(prisma);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-13T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("detects underperforming campaigns below benchmark", async () => {
    prisma.campaign.findMany.mockResolvedValue([
      {
        id: "camp-1",
        name: "Summer Sale",
        channel: "EMAIL",
        status: "COMPLETED",
        analytics: {
          openRate: 0.08,
          clickRate: 0.05,
          conversionRate: 0.02,
          deliveryRate: 0.99,
          totalAudience: 500,
          totalSent: 500,
        },
      },
    ]);
    // fatigue query
    prisma.$queryRaw.mockResolvedValueOnce([]);

    const insights = await generator.generate();

    // openRate 0.08 < benchmark 0.2
    const openRateInsight = insights.find((i) =>
      i.fingerprint.includes("openRate"),
    );
    expect(openRateInsight).toBeDefined();
    expect(openRateInsight!.title).toContain("open rate");
    expect(openRateInsight!.details.actualRate).toBeLessThan(
      openRateInsight!.details.benchmarkRate!,
    );
  });

  it("identifies top-performing campaigns that meet or exceed benchmarks", async () => {
    prisma.campaign.findMany.mockResolvedValue([
      {
        id: "camp-2",
        name: "Black Friday",
        channel: "EMAIL",
        status: "RUNNING",
        analytics: {
          openRate: 0.35,
          clickRate: 0.08,
          conversionRate: 0.03,
          deliveryRate: 0.99,
          totalAudience: 1000,
          totalSent: 1000,
        },
      },
    ]);
    prisma.$queryRaw.mockResolvedValueOnce([]);

    const insights = await generator.generate();

    // All metrics above benchmarks - no underperforming insights
    const underperforming = insights.filter((i) =>
      i.fingerprint.startsWith("campaign-low-"),
    );
    expect(underperforming).toHaveLength(0);
  });

  it("detects underperforming campaigns with low open rates", async () => {
    // Campaign with low open rate (5% vs 20% benchmark)
    prisma.campaign.findMany.mockResolvedValue([
      {
        id: "camp-low-open",
        name: "Low Open Campaign",
        channel: "EMAIL",
        status: "COMPLETED",
        analytics: {
          openRate: 0.05,
          clickRate: 0.03,
          conversionRate: 0.02,
          deliveryRate: 0.98,
          totalAudience: 1000,
          totalSent: 1000,
        },
      },
    ]);

    const insights = await generator.generate();

    const lowOpenInsight = insights.find(
      (i) => i.fingerprint === "campaign-low-openRate-camp-low-open",
    );
    expect(lowOpenInsight).toBeDefined();
    expect(lowOpenInsight!.title).toContain("open rate");
    expect(lowOpenInsight!.details.actualRate).toBeLessThan(0.2);
  });

  it("compares channel effectiveness across EMAIL and SMS benchmarks", async () => {
    prisma.campaign.findMany.mockResolvedValue([
      {
        id: "camp-email",
        name: "Email Promo",
        channel: "EMAIL",
        status: "RUNNING",
        analytics: {
          openRate: 0.1,
          clickRate: 0.01,
          conversionRate: 0.005,
          deliveryRate: 0.98,
          totalAudience: 200,
          totalSent: 200,
        },
      },
      {
        id: "camp-sms",
        name: "SMS Blast",
        channel: "SMS",
        status: "RUNNING",
        analytics: {
          openRate: 0,
          clickRate: 0.02,
          conversionRate: 0,
          deliveryRate: 0.9,
          totalAudience: 100,
          totalSent: 100,
        },
      },
    ]);
    prisma.$queryRaw.mockResolvedValueOnce([]);

    const insights = await generator.generate();

    // EMAIL: openRate(0.1) < 0.2, clickRate(0.01) < 0.03, conversionRate(0.005) < 0.01
    // SMS: clickRate(0.02) < 0.05, deliveryRate(0.9) < 0.95
    const emailInsights = insights.filter((i) => i.details.channel === "EMAIL");
    const smsInsights = insights.filter((i) => i.details.channel === "SMS");
    expect(emailInsights.length).toBeGreaterThanOrEqual(2);
    expect(smsInsights.length).toBeGreaterThanOrEqual(2);
  });

  it("calculates gap from benchmark correctly", async () => {
    prisma.campaign.findMany.mockResolvedValue([
      {
        id: "camp-gap",
        name: "Gap Test",
        channel: "EMAIL",
        status: "COMPLETED",
        analytics: {
          openRate: 0.1,
          clickRate: 0.05,
          conversionRate: 0.02,
          deliveryRate: 0.99,
          totalAudience: 100,
          totalSent: 100,
        },
      },
    ]);
    prisma.$queryRaw.mockResolvedValueOnce([]);

    const insights = await generator.generate();

    // openRate: actual=0.1, benchmark=0.2 => gap = (0.2 - 0.1) / 0.2 = 50%
    const openRateInsight = insights.find(
      (i) => i.details.metric === "openRate",
    );
    expect(openRateInsight).toBeDefined();
    expect(openRateInsight!.details.gapPercent).toBeCloseTo(50, 0);
  });

  it("handles campaigns with no analytics data", async () => {
    prisma.campaign.findMany.mockResolvedValue([
      {
        id: "camp-no-analytics",
        name: "No Analytics Campaign",
        channel: "EMAIL",
        status: "RUNNING",
        analytics: null,
      },
    ]);
    prisma.$queryRaw.mockResolvedValueOnce([]);

    const insights = await generator.generate();

    // No analytics => no underperforming insights generated
    const underperforming = insights.filter((i) =>
      i.fingerprint.startsWith("campaign-low-"),
    );
    expect(underperforming).toHaveLength(0);
  });
});
