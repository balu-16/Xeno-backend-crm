import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { CampaignStatus, ChannelType } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { SegmentCompilerService } from "../segments/segment-compiler.service";

interface SimulationResult {
  expectedReach: number;
  expectedOpenRate: number;
  expectedClickRate: number;
  expectedConversionRate: number;
  expectedRevenue: number;
  expectedCost: number;
  expectedROI: number;
  confidence: number;
  basedOnCampaigns: number;
}

// Approximate cost per message by channel (in currency units)
const COST_PER_MESSAGE: Record<string, number> = {
  EMAIL: 0.005,
  SMS: 0.04,
  WHATSAPP: 0.03,
  RCS: 0.05
};

@Injectable()
export class SimulationService {
  private readonly logger = new Logger(SimulationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly segments: SegmentCompilerService
  ) {}

  /**
   * Predict campaign outcomes for a given insight, segment, and channel.
   * Uses historical campaign data for similar segments and channels to
   * estimate rates, revenue, cost, and ROI.
   */
  async simulateCampaign(
    insightId: string,
    segmentId: string,
    channel: ChannelType
  ): Promise<SimulationResult> {
    // Validate insight exists
    const insight = await this.prisma.aIInsight.findUnique({
      where: { id: insightId }
    });
    if (!insight) {
      throw new NotFoundException(`Insight ${insightId} not found`);
    }

    // Validate segment exists
    const segment = await this.prisma.segment.findUnique({
      where: { id: segmentId }
    });
    if (!segment) {
      throw new NotFoundException(`Segment ${segmentId} not found`);
    }

    // Calculate expected reach from segment audience
    const audienceSize = await this.segments.count(segment.rules);

    // Query historical campaign analytics for this segment and channel
    const historicalCampaigns = await this.prisma.campaign.findMany({
      where: {
        segmentId,
        channel,
        status: CampaignStatus.COMPLETED
      },
      include: {
        analytics: true
      },
      orderBy: { completedAt: "desc" },
      take: 20
    });

    // Also query broader channel-level data for better estimates
    const channelCampaigns = await this.prisma.campaign.findMany({
      where: {
        channel,
        status: CampaignStatus.COMPLETED,
        analytics: { isNot: null }
      },
      include: {
        analytics: true
      },
      orderBy: { completedAt: "desc" },
      take: 50
    });

    // Compute rates from historical data, prioritizing segment-specific data
    const dataSource = historicalCampaigns.length >= 3
      ? historicalCampaigns
      : channelCampaigns;

    const hasSegmentData = historicalCampaigns.length >= 3;

    const {
      avgOpenRate,
      avgClickRate,
      avgConversionRate,
      avgOrderValue
    } = this.computeHistoricalRates(dataSource);

    // Calculate expected metrics
    const expectedReach = audienceSize;
    const expectedOpenRate = avgOpenRate;
    const expectedClickRate = avgClickRate;
    const expectedConversionRate = avgConversionRate;

    const expectedConversions = expectedReach * expectedConversionRate;
    const expectedRevenue = expectedConversions * avgOrderValue;

    const costPerMessage = COST_PER_MESSAGE[channel] ?? 0.02;
    const expectedCost = expectedReach * costPerMessage;

    const expectedROI = expectedCost > 0 ? expectedRevenue / expectedCost : 0;

    // Confidence based on volume and recency of historical data
    const confidence = this.computeConfidence(
      dataSource.length,
      hasSegmentData,
      expectedReach
    );

    this.logger.log(
      `Simulation for insight ${insightId}: reach=${expectedReach}, ` +
      `roi=${expectedROI.toFixed(2)}, confidence=${confidence.toFixed(2)}`
    );

    return {
      expectedReach,
      expectedOpenRate: Math.round(expectedOpenRate * 10000) / 10000,
      expectedClickRate: Math.round(expectedClickRate * 10000) / 10000,
      expectedConversionRate: Math.round(expectedConversionRate * 10000) / 10000,
      expectedRevenue: Math.round(expectedRevenue * 100) / 100,
      expectedCost: Math.round(expectedCost * 100) / 100,
      expectedROI: Math.round(expectedROI * 100) / 100,
      confidence: Math.round(confidence * 100) / 100,
      basedOnCampaigns: dataSource.length
    };
  }

  /**
   * Extract average rates from historical campaign analytics.
   */
  private computeHistoricalRates(
    campaigns: Array<{
      analytics: {
        openRate: number;
        clickRate: number;
        conversionRate: number;
        revenueAccrued: unknown;
        totalConverted: number;
      } | null;
    }>
  ): {
    avgOpenRate: number;
    avgClickRate: number;
    avgConversionRate: number;
    avgOrderValue: number;
  } {
    const withAnalytics = campaigns.filter((c) => c.analytics !== null);

    if (withAnalytics.length === 0) {
      // Return conservative defaults when no historical data exists
      return {
        avgOpenRate: 0.2,
        avgClickRate: 0.03,
        avgConversionRate: 0.01,
        avgOrderValue: 50
      };
    }

    let totalOpen = 0;
    let totalClick = 0;
    let totalConversion = 0;
    let totalRevenue = 0;
    let totalConversions = 0;

    for (const campaign of withAnalytics) {
      const a = campaign.analytics!;
      totalOpen += a.openRate;
      totalClick += a.clickRate;
      totalConversion += a.conversionRate;
      totalRevenue += Number(a.revenueAccrued ?? 0);
      totalConversions += a.totalConverted;
    }

    const count = withAnalytics.length;
    const avgOrderValue =
      totalConversions > 0 ? totalRevenue / totalConversions : 50;

    return {
      avgOpenRate: totalOpen / count,
      avgClickRate: totalClick / count,
      avgConversionRate: totalConversion / count,
      avgOrderValue
    };
  }

  /**
   * Compute confidence (0-1) based on data availability and quality.
   */
  private computeConfidence(
    dataPointCount: number,
    hasSegmentSpecificData: boolean,
    audienceSize: number
  ): number {
    // Data volume factor: more campaigns = higher confidence, saturates at 15
    const volumeFactor = Math.min(1.0, dataPointCount / 15);

    // Segment specificity bonus
    const segmentFactor = hasSegmentSpecificData ? 0.15 : 0;

    // Audience size factor: very small or very large audiences reduce confidence
    let audienceFactor = 0;
    if (audienceSize >= 100 && audienceSize <= 10000) {
      audienceFactor = 0.1;
    } else if (audienceSize >= 50) {
      audienceFactor = 0.05;
    }

    // Base confidence floor so we always return something meaningful
    const base = 0.2;

    return Math.min(1.0, base + volumeFactor * 0.55 + segmentFactor + audienceFactor);
  }
}
