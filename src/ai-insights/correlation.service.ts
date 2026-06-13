import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { InsightStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

interface CorrelationGroup {
  entityKey: string;
  entityType: "segment" | "campaign" | "channel";
  insightIds: string[];
}

@Injectable()
export class CorrelationService {
  private readonly logger = new Logger(CorrelationService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Find correlations among ACTIVE insights by grouping on shared entities
   * (same segment, same campaign, same channel). Creates AIInsightCorrelation
   * records for groups of 2+ related insights.
   */
  async findCorrelations() {
    const activeInsights = await this.prisma.aIInsight.findMany({
      where: { status: InsightStatus.ACTIVE },
      select: {
        id: true,
        type: true,
        title: true,
        summary: true,
        recommendation: true,
        details: true,
        sourceData: true,
        generatedAt: true,
        expiresAt: true
      }
    });

    if (activeInsights.length < 2) {
      this.logger.log("Not enough active insights to find correlations");
      return [];
    }

    // Group insights by shared entities
    const groups = this.groupByEntityOverlap(activeInsights);
    const createdCorrelations = [];

    for (const group of groups) {
      if (group.insightIds.length < 2) continue;

      // Check if a correlation already exists for this exact set of insights
      const existing = await this.prisma.aIInsightCorrelation.findFirst({
        where: {
          insightIds: { hasEvery: group.insightIds }
        }
      });
      if (existing) continue;

      const insights = activeInsights.filter((i) =>
        group.insightIds.includes(i.id)
      );

      const correlationScore = this.computeCorrelationScore(insights);
      const rootCause = this.generateRootCause(insights);

      const title = `Correlated ${group.entityType} insights`;
      const summary = `${insights.length} insights share the same ${group.entityType}: ${group.entityKey}`;

      const correlation = await this.prisma.aIInsightCorrelation.create({
        data: {
          title,
          summary,
          insightIds: group.insightIds,
          rootCause: rootCause.narrative,
          recommendation: rootCause.recommendation,
          score: correlationScore,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
        }
      });

      createdCorrelations.push(correlation);
    }

    this.logger.log(
      `Found ${createdCorrelations.length} new correlation(s) among ${activeInsights.length} active insights`
    );
    return createdCorrelations;
  }

  /**
   * List all active (non-expired) correlations.
   */
  async listActive() {
    return this.prisma.aIInsightCorrelation.findMany({
      where: {
        expiresAt: { gt: new Date() }
      },
      orderBy: { score: "desc" }
    });
  }

  /**
   * Get a single correlation by ID.
   */
  async get(id: string) {
    const correlation = await this.prisma.aIInsightCorrelation.findUnique({
      where: { id }
    });
    if (!correlation) {
      throw new NotFoundException(`Correlation ${id} not found`);
    }

    // Fetch the linked insights for context
    const insights = await this.prisma.aIInsight.findMany({
      where: { id: { in: correlation.insightIds } },
      select: {
        id: true,
        type: true,
        title: true,
        summary: true,
        priority: true,
        status: true,
        confidenceScore: true,
        generatedAt: true
      }
    });

    return { ...correlation, insights };
  }

  /**
   * Compute a correlation score (0-1) based on the number of shared entities
   * and temporal proximity of the grouped insights.
   */
  computeCorrelationScore(insights: Array<{ generatedAt: Date; details: unknown }>): number {
    if (insights.length < 2) return 0;

    // Temporal proximity: measure how close in time the insights were generated
    const timestamps = insights.map((i) => i.generatedAt.getTime());
    const minTime = Math.min(...timestamps);
    const maxTime = Math.max(...timestamps);
    const spanHours = (maxTime - minTime) / (1000 * 60 * 60);

    // Score decays as time span increases. Within 1 hour = 1.0, > 72 hours = ~0.1
    const temporalScore = Math.max(0, 1.0 - spanHours / 72);

    // Entity density: more insights in the group = stronger signal
    const densityScore = Math.min(1.0, insights.length / 5);

    // Weighted combination
    const score = temporalScore * 0.6 + densityScore * 0.4;
    return Math.round(score * 1000) / 1000;
  }

  /**
   * Synthesize a root cause narrative and recommendation from a group of
   * related insights.
   */
  generateRootCause(insights: Array<{ type: string; title: string; summary: string; recommendation: string }>): {
    narrative: string;
    recommendation: string;
  } {
    if (insights.length === 0) {
      return { narrative: "No insights to analyze.", recommendation: "N/A" };
    }

    // Collect unique types
    const types = [...new Set(insights.map((i) => i.type))];
    const titles = insights.map((i) => i.title);
    const recommendations = insights.map((i) => i.recommendation);

    let narrative: string;

    if (insights.length === 1) {
      narrative = `Single insight detected: ${titles[0] ?? "Unknown"}. ${insights[0]?.summary ?? ""}`;
    } else {
      narrative = `${insights.length} correlated insights of types [${types.join(", ")}] were generated in close proximity. `;
      narrative += `These insights — ${titles.join("; ")} — likely share a common underlying cause. `;
      narrative += `The pattern suggests a systemic issue affecting multiple dimensions of campaign or customer performance.`;
    }

    // Synthesize recommendation: pick the most actionable one, or combine
    let recommendation: string;
    if (recommendations.length === 1) {
      recommendation = recommendations[0] ?? "No recommendation";
    } else {
      recommendation =
        `Address the correlated issues together for maximum impact. Key actions: ` +
        recommendations.map((r, i) => `${i + 1}. ${r}`).join(" ");
    }

    return { narrative, recommendation };
  }

  /**
   * Group active insights by shared entities extracted from their details/sourceData.
   */
  private groupByEntityOverlap(
    insights: Array<{
      id: string;
      details: unknown;
      sourceData: unknown;
    }>
  ): CorrelationGroup[] {
    const segmentMap = new Map<string, string[]>();
    const campaignMap = new Map<string, string[]>();
    const channelMap = new Map<string, string[]>();

    for (const insight of insights) {
      const details = (insight.details ?? {}) as Record<string, unknown>;
      const sourceData = (insight.sourceData ?? {}) as Record<string, unknown>;
      const merged = { ...sourceData, ...details };

      // Extract segment references
      const segmentId = merged.segmentId ?? merged.segment_id;
      if (typeof segmentId === "string") {
        if (!segmentMap.has(segmentId)) segmentMap.set(segmentId, []);
        segmentMap.get(segmentId)!.push(insight.id);
      }

      // Extract campaign references
      const campaignId = merged.campaignId ?? merged.campaign_id;
      if (typeof campaignId === "string") {
        if (!campaignMap.has(campaignId)) campaignMap.set(campaignId, []);
        campaignMap.get(campaignId)!.push(insight.id);
      }

      // Extract channel references
      const channel = merged.channel;
      if (typeof channel === "string") {
        const normalizedChannel = channel.toUpperCase();
        if (!channelMap.has(normalizedChannel)) channelMap.set(normalizedChannel, []);
        channelMap.get(normalizedChannel)!.push(insight.id);
      }
    }

    const groups: CorrelationGroup[] = [];

    for (const [key, ids] of segmentMap) {
      groups.push({ entityKey: key, entityType: "segment", insightIds: ids });
    }
    for (const [key, ids] of campaignMap) {
      groups.push({ entityKey: key, entityType: "campaign", insightIds: ids });
    }
    for (const [key, ids] of channelMap) {
      groups.push({ entityKey: key, entityType: "channel", insightIds: ids });
    }

    return groups;
  }
}
