import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import type {
  InsightGenerator,
  GeneratedInsight,
  ConfidenceFactor,
} from "./generator.interface";

@Injectable()
export class CampaignGenerator implements InsightGenerator {
  readonly name = "campaign";

  constructor(private readonly prisma: PrismaService) {}

  async generate(): Promise<GeneratedInsight[]> {
    const insights: GeneratedInsight[] = [];
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 6 * 60 * 60 * 1000);

    // Always produce a campaign overview
    const totalCampaigns = await this.prisma.campaign.count();
    const runningCampaigns = await this.prisma.campaign.count({
      where: { status: "RUNNING" },
    });
    const completedCampaigns = await this.prisma.campaign.count({
      where: { status: "COMPLETED" },
    });

    insights.push({
      type: "CAMPAIGN",
      fingerprint: "campaign-overview",
      title: "Campaign overview",
      summary: `${totalCampaigns} campaigns total — ${runningCampaigns} running, ${completedCampaigns} completed.`,
      details: {
        totalCampaigns,
        runningCampaigns,
        completedCampaigns,
      },
      recommendation:
        "Review campaign performance regularly. A/B test subject lines and content to improve engagement rates.",
      estimatedImpact: `${totalCampaigns} campaigns tracked`,
      confidenceScore: 0.95,
      confidenceFactors: [
        { factor: "data_completeness", weight: 0.5, direction: "positive" },
        { factor: "sample_size", weight: 0.5, direction: "positive" },
      ],
      impactScore: 0.4,
      expiresAt,
    });

    // ── Underperforming campaigns ─────────────────────────────────
    const campaigns = await this.prisma.campaign.findMany({
      where: {
        status: { in: ["RUNNING", "COMPLETED"] },
        analytics: { isNot: null },
      },
      include: { analytics: true },
    });

    const benchmarks: Record<
      string,
      { metric: string; threshold: number; label: string }[]
    > = {
      EMAIL: [
        { metric: "openRate", threshold: 0.2, label: "Open rate" },
        { metric: "clickRate", threshold: 0.03, label: "Click rate" },
        { metric: "conversionRate", threshold: 0.01, label: "Conversion rate" },
      ],
      SMS: [
        { metric: "deliveryRate", threshold: 0.95, label: "Delivery rate" },
        { metric: "clickRate", threshold: 0.05, label: "Click rate" },
      ],
    };

    for (const campaign of campaigns) {
      const analytics = campaign.analytics;
      if (!analytics) continue;

      const channel = campaign.channel;
      const channelBenchmarks = benchmarks[channel];
      if (!channelBenchmarks) continue;

      const rates: Record<string, number> = {
        openRate: analytics.openRate,
        clickRate: analytics.clickRate,
        conversionRate: analytics.conversionRate,
        deliveryRate: analytics.deliveryRate,
      };

      for (const bench of channelBenchmarks) {
        const actualRate = rates[bench.metric] ?? 0;

        if (actualRate < bench.threshold && analytics.totalSent > 0) {
          const gapPercent =
            ((bench.threshold - actualRate) / bench.threshold) * 100;

          const confidenceFactors: ConfidenceFactor[] = [
            {
              factor: "audience_size",
              weight: 0.3,
              direction:
                analytics.totalAudience >= 50 ? "positive" : "negative",
            },
            {
              factor: "gap_from_benchmark",
              weight: 0.4,
              direction: gapPercent > 50 ? "negative" : "positive",
            },
            {
              factor: "campaign_completion",
              weight: 0.3,
              direction:
                campaign.status === "COMPLETED" ? "positive" : "negative",
            },
          ];

          insights.push({
            type: "CAMPAIGN",
            fingerprint: `campaign-low-${bench.metric}-${campaign.id}`,
            title: `Low ${bench.label.toLowerCase()} for "${campaign.name}"`,
            summary: `Campaign "${campaign.name}" has a ${bench.label.toLowerCase()} of ${(actualRate * 100).toFixed(1)}%, below the ${(bench.threshold * 100).toFixed(0)}% benchmark for ${channel}.`,
            details: {
              campaignId: campaign.id,
              campaignName: campaign.name,
              channel,
              metric: bench.metric,
              actualRate: Number(actualRate.toFixed(4)),
              benchmarkRate: bench.threshold,
              gapPercent: Number(gapPercent.toFixed(2)),
              totalAudience: analytics.totalAudience,
              totalSent: analytics.totalSent,
              status: campaign.status,
            },
            recommendation:
              bench.metric === "openRate"
                ? "Test different subject lines, send times, and sender names. Consider A/B testing to improve open rates."
                : bench.metric === "clickRate"
                  ? "Improve your call-to-action placement, use more compelling offers, and ensure mobile-friendly email design."
                  : bench.metric === "conversionRate"
                    ? "Review your landing page experience, simplify the conversion flow, and ensure the offer matches the campaign message."
                    : "Check your contact list hygiene. Remove invalid numbers and ensure opt-in compliance to improve delivery rates.",
            estimatedImpact: `${gapPercent.toFixed(0)}% gap from ${bench.label.toLowerCase()} benchmark`,
            confidenceScore: this.calculateConfidence(confidenceFactors),
            confidenceFactors,
            impactScore: Math.min(1, gapPercent / 100),
            expiresAt,
          });
        }
      }
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
