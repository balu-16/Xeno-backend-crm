import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import type {
  InsightGenerator,
  GeneratedInsight,
  ConfidenceFactor,
} from "./generator.interface";

interface ChannelMetrics {
  channel: string;
  currentFailureRate: number;
  normalFailureRate: number;
  stdDev: number;
  currentDeliveryRate: number;
  normalDeliveryRate: number;
  totalSent: number;
  totalFailed: number;
}

@Injectable()
export class AnomalyGenerator implements InsightGenerator {
  readonly name = "anomaly";

  constructor(private readonly prisma: PrismaService) {}

  async generate(): Promise<GeneratedInsight[]> {
    const insights: GeneratedInsight[] = [];
    const now = new Date();

    // Always produce an anomaly monitoring overview
    const totalCampaignLogs = await this.prisma.campaignLog.count();
    insights.push({
      type: "ANOMALY",
      fingerprint: "anomaly-overview",
      title: "Anomaly detection active",
      summary: `Monitoring ${totalCampaignLogs} delivery events for anomalies including failure spikes and channel degradation.`,
      details: { totalEventsMonitored: totalCampaignLogs },
      recommendation:
        "Anomaly detection runs continuously. Review any flagged issues promptly to prevent widespread delivery problems.",
      estimatedImpact: `${totalCampaignLogs} events under anomaly monitoring`,
      confidenceScore: 0.9,
      confidenceFactors: [
        { factor: "monitoring_active", weight: 0.5, direction: "positive" },
        { factor: "event_coverage", weight: 0.5, direction: "positive" },
      ],
      impactScore: 0.4,
      expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
    });

    const [failureAnomalies, channelAnomalies] = await Promise.all([
      this.detectDeliveryFailureSpikes(now),
      this.detectChannelDegradation(now),
    ]);

    insights.push(...failureAnomalies);
    insights.push(...channelAnomalies);

    return insights;
  }

  /**
   * Detect delivery failure spikes: current failure rate > 2x normal failure rate.
   * Normal is computed as a rolling 30-day average per channel.
   */
  private async detectDeliveryFailureSpikes(
    now: Date,
  ): Promise<GeneratedInsight[]> {
    const insights: GeneratedInsight[] = [];
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Current day failure rates per channel
    const currentRows = await this.prisma.$queryRaw<
      Array<{
        channel: string;
        total_sent: bigint;
        total_failed: bigint;
      }>
    >`
      SELECT
        c.channel,
        COUNT(*)                                          AS total_sent,
        COUNT(CASE WHEN cl.status = 'FAILED' THEN 1 END) AS total_failed
      FROM "CampaignLog" cl
      INNER JOIN "Campaign" c ON c.id = cl."campaignId"
      WHERE cl."createdAt" >= ${oneDayAgo}
      GROUP BY c.channel
    `;

    // Rolling 30-day baseline per channel (excluding today)
    const baselineRows = await this.prisma.$queryRaw<
      Array<{
        channel: string;
        daily_rates: number[];
        avg_failure_rate: Prisma.Decimal;
        std_dev: Prisma.Decimal;
      }>
    >`
      WITH daily_stats AS (
        SELECT
          c.channel,
          DATE(cl."createdAt") AS day,
          COUNT(*)             AS total,
          COUNT(CASE WHEN cl.status = 'FAILED' THEN 1 END) AS failed
        FROM "CampaignLog" cl
        INNER JOIN "Campaign" c ON c.id = cl."campaignId"
        WHERE cl."createdAt" >= ${thirtyDaysAgo}
          AND cl."createdAt" < ${oneDayAgo}
        GROUP BY c.channel, DATE(cl."createdAt")
      ),
      daily_rates AS (
        SELECT
          channel,
          day,
          CASE WHEN total > 0 THEN failed::float / total ELSE 0 END AS failure_rate
        FROM daily_stats
        WHERE total > 0
      )
      SELECT
        channel,
        AVG(failure_rate)                                          AS avg_failure_rate,
        COALESCE(STDDEV(failure_rate), 0)                          AS std_dev
      FROM daily_rates
      GROUP BY channel
    `;

    const baselineMap = new Map(
      baselineRows.map((r) => [
        r.channel,
        {
          avgFailureRate: Number(r.avg_failure_rate),
          stdDev: Number(r.std_dev),
        },
      ]),
    );

    for (const row of currentRows) {
      const totalSent = Number(row.total_sent);
      if (totalSent < 10) continue; // Skip channels with too few messages

      const totalFailed = Number(row.total_failed);
      const currentFailureRate = totalFailed / totalSent;

      const baseline = baselineMap.get(row.channel);
      if (!baseline) continue;

      const normalFailureRate = baseline.avgFailureRate;
      const stdDev = baseline.stdDev;

      // Flag if current > 2x normal OR current > mean + 2*sigma
      const isSpike =
        (normalFailureRate > 0 && currentFailureRate > 2 * normalFailureRate) ||
        (stdDev > 0 && currentFailureRate > normalFailureRate + 2 * stdDev);

      if (isSpike) {
        const confidenceFactors: ConfidenceFactor[] = [
          {
            factor: "spike_magnitude",
            weight: 0.4,
            direction:
              currentFailureRate > 3 * normalFailureRate
                ? "negative"
                : "positive",
          },
          {
            factor: "baseline_data_points",
            weight: 0.3,
            direction: "positive",
          },
          {
            factor: "sample_size",
            weight: 0.3,
            direction: totalSent >= 50 ? "positive" : "negative",
          },
        ];

        insights.push({
          type: "ANOMALY",
          fingerprint: `anomaly-failure-spike-${row.channel.toLowerCase()}`,
          title: `Delivery failure spike detected on ${row.channel}`,
          summary: `The ${row.channel} channel failure rate is ${(currentFailureRate * 100).toFixed(1)}% today, compared to a normal rate of ${(normalFailureRate * 100).toFixed(1)}%. This is ${normalFailureRate > 0 ? (currentFailureRate / normalFailureRate).toFixed(1) : "N/A"}x the baseline.`,
          details: {
            channel: row.channel,
            metric: "failure_rate",
            currentRate: Number(currentFailureRate.toFixed(4)),
            normalRate: Number(normalFailureRate.toFixed(4)),
            stdDev: Number(stdDev.toFixed(4)),
            deviationMultiple:
              stdDev > 0
                ? Number(
                    (
                      (currentFailureRate - normalFailureRate) /
                      stdDev
                    ).toFixed(2),
                  )
                : null,
            totalSent,
            totalFailed,
            isSpike: true,
          },
          recommendation:
            "Investigate the root cause of the delivery failure spike. Check provider status, rate limits, and message content. Consider pausing affected campaigns until the issue is resolved.",
          estimatedImpact: `${totalFailed} failed deliveries on ${row.channel} in the last 24 hours`,
          confidenceScore: 0.92,
          confidenceFactors,
          impactScore: Math.min(1, currentFailureRate),
          expiresAt: new Date(now.getTime() + 4 * 60 * 60 * 1000),
        });
      }
    }

    return insights;
  }

  /**
   * Detect channel degradation: delivery rate drop for a specific channel.
   * Compares current 7-day delivery rate against 30-day rolling average.
   */
  private async detectChannelDegradation(
    now: Date,
  ): Promise<GeneratedInsight[]> {
    const insights: GeneratedInsight[] = [];
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Current 7-day delivery rates per channel
    const currentRows = await this.prisma.$queryRaw<
      Array<{
        channel: string;
        total: bigint;
        delivered: bigint;
      }>
    >`
      SELECT
        c.channel,
        COUNT(*)                                           AS total,
        COUNT(CASE WHEN cl.status IN ('DELIVERED','OPENED','CLICKED','CONVERTED') THEN 1 END) AS delivered
      FROM "CampaignLog" cl
      INNER JOIN "Campaign" c ON c.id = cl."campaignId"
      WHERE cl."createdAt" >= ${sevenDaysAgo}
      GROUP BY c.channel
    `;

    // 30-day rolling average delivery rates per channel (excluding recent 7 days)
    const baselineRows = await this.prisma.$queryRaw<
      Array<{
        channel: string;
        avg_delivery_rate: Prisma.Decimal;
        std_dev: Prisma.Decimal;
      }>
    >`
      WITH daily_stats AS (
        SELECT
          c.channel,
          DATE(cl."createdAt") AS day,
          COUNT(*)             AS total,
          COUNT(CASE WHEN cl.status IN ('DELIVERED','OPENED','CLICKED','CONVERTED') THEN 1 END) AS delivered
        FROM "CampaignLog" cl
        INNER JOIN "Campaign" c ON c.id = cl."campaignId"
        WHERE cl."createdAt" >= ${thirtyDaysAgo}
          AND cl."createdAt" < ${sevenDaysAgo}
        GROUP BY c.channel, DATE(cl."createdAt")
      ),
      daily_rates AS (
        SELECT
          channel,
          day,
          CASE WHEN total > 0 THEN delivered::float / total ELSE 0 END AS delivery_rate
        FROM daily_stats
        WHERE total > 0
      )
      SELECT
        channel,
        AVG(delivery_rate)                                  AS avg_delivery_rate,
        COALESCE(STDDEV(delivery_rate), 0)                  AS std_dev
      FROM daily_rates
      GROUP BY channel
    `;

    const baselineMap = new Map(
      baselineRows.map((r) => [
        r.channel,
        {
          avgDeliveryRate: Number(r.avg_delivery_rate),
          stdDev: Number(r.std_dev),
        },
      ]),
    );

    for (const row of currentRows) {
      const total = Number(row.total);
      if (total < 20) continue;

      const delivered = Number(row.delivered);
      const currentDeliveryRate = delivered / total;

      const baseline = baselineMap.get(row.channel);
      if (!baseline) continue;

      const normalDeliveryRate = baseline.avgDeliveryRate;
      const stdDev = baseline.stdDev;

      // Flag if delivery rate dropped below normal - 2*sigma
      const isDegraded =
        stdDev > 0
          ? currentDeliveryRate < normalDeliveryRate - 2 * stdDev
          : normalDeliveryRate > 0 &&
            currentDeliveryRate < normalDeliveryRate * 0.7;

      if (isDegraded) {
        const dropPercentage =
          normalDeliveryRate > 0
            ? ((normalDeliveryRate - currentDeliveryRate) /
                normalDeliveryRate) *
              100
            : 0;

        const confidenceFactors: ConfidenceFactor[] = [
          {
            factor: "degradation_magnitude",
            weight: 0.4,
            direction: dropPercentage > 20 ? "negative" : "positive",
          },
          {
            factor: "baseline_stability",
            weight: 0.3,
            direction: stdDev < 0.1 ? "positive" : "negative",
          },
          {
            factor: "sample_size",
            weight: 0.3,
            direction: total >= 100 ? "positive" : "negative",
          },
        ];

        insights.push({
          type: "ANOMALY",
          fingerprint: `anomaly-delivery-degradation-${row.channel.toLowerCase()}`,
          title: `${row.channel} delivery rate degradation detected`,
          summary: `The ${row.channel} channel delivery rate dropped to ${(currentDeliveryRate * 100).toFixed(1)}% over the last 7 days, down from a normal rate of ${(normalDeliveryRate * 100).toFixed(1)}% (-${dropPercentage.toFixed(1)}%).`,
          details: {
            channel: row.channel,
            metric: "delivery_rate",
            currentRate: Number(currentDeliveryRate.toFixed(4)),
            normalRate: Number(normalDeliveryRate.toFixed(4)),
            stdDev: Number(stdDev.toFixed(4)),
            dropPercentage: Number(dropPercentage.toFixed(2)),
            currentPeriodDays: 7,
            baselinePeriodDays: 30,
            totalMessages: total,
            deliveredMessages: delivered,
            isDegraded: true,
          },
          recommendation:
            "Review the delivery pipeline for this channel. Check for provider issues, content filtering, or rate limiting. Test with a small batch to verify delivery before resuming full campaigns.",
          estimatedImpact: `${dropPercentage.toFixed(1)}% drop in ${row.channel} delivery rate affecting ${total} messages`,
          confidenceScore: 0.91,
          confidenceFactors,
          impactScore: Math.min(1, dropPercentage / 50),
          expiresAt: new Date(now.getTime() + 6 * 60 * 60 * 1000),
        });
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
