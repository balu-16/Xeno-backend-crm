import { Injectable, Logger, NotFoundException, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import type {
  ListInsightsQuery,
  AIInsightView,
  ExecutiveSummaryView,
  InsightActionView,
} from "../contracts";
import {
  InsightType as InsightTypeEnum,
  InsightPriority as InsightPriorityEnum,
  InsightStatus as InsightStatusEnum,
  Prisma,
} from "@prisma/client";
import type { GeneratedInsight } from "./generators/generator.interface";

type InsightWithRelations = Prisma.AIInsightGetPayload<{
  include: { actions: true; outcomes: true; feedback: true };
}>;

@Injectable()
export class InsightStoreService {
  private readonly logger = new Logger(InsightStoreService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() _unusedQueues?: unknown,
  ) {}

  /**
   * Upsert an insight by fingerprint. If an ACTIVE insight with the same
   * fingerprint already exists, update it in-place. Otherwise create a new row.
   */
  async upsert(insight: GeneratedInsight): Promise<AIInsightView> {
    const data: Prisma.AIInsightCreateInput = {
      type: insight.type,
      priority: this.priorityFromScore(
        insight.impactScore * insight.confidenceScore,
      ),
      fingerprint: insight.fingerprint,
      title: insight.title,
      summary: insight.summary,
      details: insight.details as Prisma.InputJsonValue,
      recommendation: insight.recommendation,
      estimatedImpact: insight.estimatedImpact ?? null,
      confidenceScore: insight.confidenceScore,
      confidenceFactors:
        insight.confidenceFactors as unknown as Prisma.InputJsonValue,
      impactScore: insight.impactScore,
      priorityScore: insight.impactScore * insight.confidenceScore,
      expiresAt: insight.expiresAt,
      correlationId: insight.correlationId ?? null,
    };

    const existing = await this.prisma.aIInsight.findFirst({
      where: {
        fingerprint: insight.fingerprint,
        status: InsightStatusEnum.ACTIVE,
      },
    });

    let record: InsightWithRelations;

    if (existing) {
      this.logger.debug(
        `Updating existing insight ${existing.id} for fingerprint ${insight.fingerprint}`,
      );
      record = await this.prisma.aIInsight.update({
        where: { id: existing.id },
        data: {
          ...data,
          updatedAt: new Date(),
        },
        include: { actions: true, outcomes: true, feedback: true },
      });
    } else {
      this.logger.debug(
        `Creating new insight for fingerprint ${insight.fingerprint}`,
      );
      record = await this.prisma.aIInsight.create({
        data,
        include: { actions: true, outcomes: true, feedback: true },
      });
    }

    return this.toView(record);
  }

  /**
   * List insights with optional filtering by type, priority, and status.
   * Results are paginated and sorted by priorityScore descending.
   */
  async list(query: ListInsightsQuery): Promise<{
    data: AIInsightView[];
    meta: { total: number; page: number; pageSize: number; totalPages: number };
  }> {
    const where: Prisma.AIInsightWhereInput = {};

    if (query.type) {
      where.type = query.type as InsightTypeEnum;
    }
    if (query.priority) {
      where.priority = query.priority as InsightPriorityEnum;
    }
    if (query.status) {
      where.status = query.status as InsightStatusEnum;
    }

    const skip = (query.page - 1) * query.pageSize;

    const [records, total] = await Promise.all([
      this.prisma.aIInsight.findMany({
        where,
        orderBy: { priorityScore: "desc" },
        skip,
        take: query.pageSize,
        include: { actions: true, outcomes: true, feedback: true },
      }),
      this.prisma.aIInsight.count({ where }),
    ]);

    return {
      data: records.map((r) => this.toView(r)),
      meta: {
        total,
        page: query.page,
        pageSize: query.pageSize,
        totalPages: Math.ceil(total / query.pageSize),
      },
    };
  }

  /**
   * Get a single insight by id. Throws NotFoundException if not found.
   */
  async get(id: string): Promise<AIInsightView> {
    const record = await this.prisma.aIInsight.findUnique({
      where: { id },
      include: { actions: true, outcomes: true, feedback: true },
    });

    if (!record) {
      throw new NotFoundException(`Insight ${id} not found`);
    }

    return this.toView(record);
  }

  /**
   * Dismiss an insight — sets status to DISMISSED and records dismissedAt.
   */
  async dismiss(id: string): Promise<AIInsightView> {
    await this.ensureExists(id);

    const record = await this.prisma.aIInsight.update({
      where: { id },
      data: {
        status: InsightStatusEnum.DISMISSED,
        dismissedAt: new Date(),
      },
      include: { actions: true, outcomes: true, feedback: true },
    });

    this.logger.log(`Insight ${id} dismissed`);
    return this.toView(record);
  }

  /**
   * Complete an insight — sets status to COMPLETED and records completedAt.
   */
  async complete(id: string): Promise<AIInsightView> {
    await this.ensureExists(id);

    const record = await this.prisma.aIInsight.update({
      where: { id },
      data: {
        status: InsightStatusEnum.COMPLETED,
        completedAt: new Date(),
      },
      include: { actions: true, outcomes: true, feedback: true },
    });

    this.logger.log(`Insight ${id} completed`);
    return this.toView(record);
  }

  /**
   * Expire stale insights and purge old expired ones.
   * 1. Mark all ACTIVE/PENDING insights whose expiresAt < now() as EXPIRED.
   * 2. Delete EXPIRED insights older than 7 days.
   */
  async expire(): Promise<{ expired: number; deleted: number }> {
    const now = new Date();

    // Mark expired
    const expiredResult = await this.prisma.aIInsight.updateMany({
      where: {
        status: { in: [InsightStatusEnum.ACTIVE, InsightStatusEnum.DISMISSED] },
        expiresAt: { lt: now },
      },
      data: { status: InsightStatusEnum.EXPIRED },
    });

    // Delete EXPIRED older than 7 days
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const deletedResult = await this.prisma.aIInsight.deleteMany({
      where: {
        status: InsightStatusEnum.EXPIRED,
        createdAt: { lt: sevenDaysAgo },
      },
    });

    if (expiredResult.count > 0 || deletedResult.count > 0) {
      this.logger.log(
        `Expire cycle: ${expiredResult.count} marked expired, ${deletedResult.count} purged`,
      );
    }

    return { expired: expiredResult.count, deleted: deletedResult.count };
  }

  /**
   * Aggregate current ACTIVE insights into an executive summary.
   */
  async executiveSummary(): Promise<ExecutiveSummaryView> {
    const activeInsights = await this.prisma.aIInsight.findMany({
      where: { status: InsightStatusEnum.ACTIVE },
      orderBy: { priorityScore: "desc" },
    });

    // Aggregate by type
    const byType = new Map<string, typeof activeInsights>();
    for (const insight of activeInsights) {
      const list = byType.get(insight.type) ?? [];
      list.push(insight);
      byType.set(insight.type, list);
    }

    const avgScore = (items: typeof activeInsights) =>
      items.length > 0
        ? items.reduce((sum, i) => sum + i.priorityScore, 0) / items.length
        : 0;

    const revenueInsights = byType.get("REVENUE") ?? [];
    const customerInsights = byType.get("CUSTOMER") ?? [];
    const campaignInsights = byType.get("CAMPAIGN") ?? [];
    const churnInsights = byType.get("CHURN") ?? [];
    const deliveryInsights = byType.get("DELIVERY") ?? [];

    const overallScore =
      activeInsights.length > 0
        ? activeInsights.reduce((sum, i) => sum + i.priorityScore, 0) /
          activeInsights.length
        : 0;

    // Determine trend based on score distribution
    const criticalCount = activeInsights.filter(
      (i) => i.priority === "CRITICAL",
    ).length;
    const trend: "improving" | "stable" | "declining" =
      criticalCount > 3
        ? "declining"
        : criticalCount === 0
          ? "improving"
          : "stable";

    // Risks are CRITICAL or HIGH insights
    const risks = activeInsights
      .filter((i) => i.priority === "CRITICAL" || i.priority === "HIGH")
      .slice(0, 5)
      .map((i) => ({
        title: i.title,
        severity: i.priority,
      }));

    // Recommended actions from top insights
    const recommendedActions = activeInsights.slice(0, 5).map((i) => ({
      title: i.recommendation,
      insightId: i.id,
    }));

    // Determine revenue/customer/campaign trends from insight details
    const revenueChange = this.detailChange(revenueInsights[0]);
    const customerChange = this.detailChange(customerInsights[0]);
    const campaignChange = this.detailChange(campaignInsights[0]);

    const toTrend = (change: number): "up" | "down" | "flat" =>
      change > 0 ? "up" : change < 0 ? "down" : "flat";

    return {
      revenue: { change: revenueChange, trend: toTrend(revenueChange) },
      customerGrowth: {
        change: customerChange,
        trend: toTrend(customerChange),
      },
      campaignPerformance: {
        change: campaignChange,
        trend: toTrend(campaignChange),
      },
      executiveScore: {
        overallScore: Math.round(overallScore * 100) / 100,
        revenueScore: Math.round(avgScore(revenueInsights) * 100) / 100,
        engagementScore:
          Math.round(
            avgScore([...campaignInsights, ...deliveryInsights]) * 100,
          ) / 100,
        churnScore: Math.round(avgScore(churnInsights) * 100) / 100,
        deliveryScore: Math.round(avgScore(deliveryInsights) * 100) / 100,
        campaignScore: Math.round(avgScore(campaignInsights) * 100) / 100,
        trend,
        factors: {
          totalActive: activeInsights.length,
          critical: criticalCount,
          byType: Object.fromEntries(
            [...byType.entries()].map(([type, items]) => [type, items.length]),
          ),
        },
        generatedAt: new Date().toISOString(),
      },
      risks,
      recommendedActions,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Trigger a refresh of all insight generators.
   * Delegates to AIInsightsService.runGenerator via the onModuleInit schedule.
   * This method is kept for API compatibility.
   */
  triggerRefresh(): void {
    this.logger.log(
      "Insight refresh triggered (handled by AIInsightsService schedule)",
    );
  }

  // ── Private helpers ──────────────────────────────────────────────────

  private async ensureExists(id: string): Promise<void> {
    const exists = await this.prisma.aIInsight.findUnique({ where: { id } });
    if (!exists) {
      throw new NotFoundException(`Insight ${id} not found`);
    }
  }

  private priorityFromScore(
    score: number,
  ): "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" {
    if (score >= 0.8) return "CRITICAL";
    if (score >= 0.6) return "HIGH";
    if (score >= 0.4) return "MEDIUM";
    return "LOW";
  }

  private detailChange(insight: { details: unknown } | undefined): number {
    if (
      !insight ||
      typeof insight.details !== "object" ||
      insight.details === null
    ) {
      return 0;
    }
    const change = (insight.details as Record<string, unknown>).change;
    return typeof change === "number" && Number.isFinite(change) ? change : 0;
  }

  private toView(record: InsightWithRelations): AIInsightView {
    return {
      id: record.id,
      type: record.type as AIInsightView["type"],
      priority: record.priority as AIInsightView["priority"],
      fingerprint: record.fingerprint,
      title: record.title,
      summary: record.summary,
      details: record.details as Record<string, unknown>,
      recommendation: record.recommendation,
      estimatedImpact: record.estimatedImpact,
      confidenceScore: record.confidenceScore,
      confidenceFactors:
        record.confidenceFactors as unknown as AIInsightView["confidenceFactors"],
      impactScore: record.impactScore,
      priorityScore: record.priorityScore,
      status: record.status as AIInsightView["status"],
      correlationId: record.correlationId,
      generatedAt: record.generatedAt.toISOString(),
      expiresAt: record.expiresAt.toISOString(),
      createdAt: record.createdAt.toISOString(),
      actions: record.actions.map((a) => ({
        id: a.id,
        insightId: a.insightId,
        type: a.type as InsightActionView["type"],
        label: a.label,
        description: a.description,
        status: a.status as InsightActionView["status"],
        metadata: a.metadata as Record<string, unknown> | null,
        executedResult: a.executedResult as Record<string, unknown> | null,
        clickedAt: a.clickedAt?.toISOString() ?? null,
        executedAt: a.executedAt?.toISOString() ?? null,
        createdAt: a.createdAt.toISOString(),
      })),
      outcomes: record.outcomes.map((o) => ({
        id: o.id,
        insightId: o.insightId,
        predictedImpact: o.predictedImpact,
        actualImpact: o.actualImpact,
        predictedValue: o.predictedValue,
        actualValue: o.actualValue,
        accuracy: o.accuracy,
        actionTaken: o.actionTaken,
        measuredAt: o.measuredAt.toISOString(),
        createdAt: o.createdAt.toISOString(),
      })),
      feedback: record.feedback.map((f) => ({
        rating: f.rating,
        comment: f.comment,
      })),
    };
  }
}
