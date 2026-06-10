import { Injectable, NotFoundException } from "@nestjs/common";
import type {
  CampaignPerformance,
  Channel,
  DashboardMetrics
} from "../contracts";
import {
  CampaignEventType,
  CampaignStatus,
  Prisma
} from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { QueueService } from "../queue/queue.service";

type CampaignAggregateRow = {
  sent: bigint;
  delivered: bigint;
  opened: bigint;
  clicked: bigint;
  converted: bigint;
  failed: bigint;
  revenue: Prisma.Decimal | null;
};

function rate(numerator: number, denominator: number): number {
  return denominator === 0
    ? 0
    : Math.round((numerator / denominator) * 10000) / 100;
}

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queues: QueueService
  ) {}

  async refreshCampaign(
    campaignId: string,
    publish = true
  ): Promise<CampaignPerformance> {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      include: { analytics: true }
    });
    if (!campaign) {
      throw new NotFoundException("Campaign not found");
    }
    const rows = await this.prisma.$queryRaw<CampaignAggregateRow[]>(Prisma.sql`
      SELECT
        COUNT(DISTINCT "customerId") FILTER (
          WHERE type = 'MessageSent'::"CampaignEventType"
        )::bigint AS sent,
        COUNT(DISTINCT "customerId") FILTER (
          WHERE type = 'MessageDelivered'::"CampaignEventType"
        )::bigint AS delivered,
        COUNT(DISTINCT "customerId") FILTER (
          WHERE type = 'MessageOpened'::"CampaignEventType"
        )::bigint AS opened,
        COUNT(DISTINCT "customerId") FILTER (
          WHERE type = 'MessageClicked'::"CampaignEventType"
        )::bigint AS clicked,
        COUNT(DISTINCT "customerId") FILTER (
          WHERE type = 'MessageConverted'::"CampaignEventType"
        )::bigint AS converted,
        COUNT(DISTINCT "customerId") FILTER (
          WHERE type = 'MessageFailed'::"CampaignEventType"
        )::bigint AS failed,
        COALESCE(SUM(o.amount), 0) AS revenue
      FROM "CampaignEvent" e
      LEFT JOIN "Order" o ON o.id = e."attributedOrderId"
      WHERE e."campaignId" = ${campaignId}
    `);
    const aggregate = rows[0];
    const sent = Number(aggregate?.sent ?? 0);
    const delivered = Number(aggregate?.delivered ?? 0);
    const opened = Number(aggregate?.opened ?? 0);
    const clicked = Number(aggregate?.clicked ?? 0);
    const converted = Number(aggregate?.converted ?? 0);
    const failed = Number(aggregate?.failed ?? 0);
    const revenue = Number(aggregate?.revenue ?? 0);
    const pending = await this.prisma.campaignLog.count({
      where: {
        campaignId,
        status: { in: ["QUEUED", "SENT"] }
      }
    });
    const status =
      campaign.status === CampaignStatus.FAILED
        ? CampaignStatus.FAILED
        : pending === 0 && campaign.launchedAt
          ? CampaignStatus.COMPLETED
          : campaign.status;
    const analytics = await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.campaignAnalytics.upsert({
        where: { campaignId },
        create: {
          campaignId,
          totalAudience: campaign.audienceSizeSnapshot,
          totalQueued: campaign.audienceSizeSnapshot,
          totalSent: sent,
          totalDelivered: delivered,
          totalOpened: opened,
          totalClicked: clicked,
          totalConverted: converted,
          totalFailed: failed,
          deliveryRate: rate(delivered, sent),
          openRate: rate(opened, delivered),
          clickRate: rate(clicked, opened),
          conversionRate: rate(converted, clicked),
          revenueAccrued: revenue
        },
        update: {
          totalAudience: campaign.audienceSizeSnapshot,
          totalQueued: campaign.audienceSizeSnapshot,
          totalSent: sent,
          totalDelivered: delivered,
          totalOpened: opened,
          totalClicked: clicked,
          totalConverted: converted,
          totalFailed: failed,
          deliveryRate: rate(delivered, sent),
          openRate: rate(opened, delivered),
          clickRate: rate(clicked, opened),
          conversionRate: rate(converted, clicked),
          revenueAccrued: revenue
        }
      });
      if (status !== campaign.status) {
        await transaction.campaign.update({
          where: { id: campaignId },
          data: {
            status,
            ...(status === CampaignStatus.COMPLETED
              ? { completedAt: new Date() }
              : {})
          }
        });
      }
      return updated;
    });
    const failures = await this.prisma.campaignLog.groupBy({
      by: ["failureReason"],
      where: { campaignId, status: "FAILED" },
      _count: true
    });
    const performance: CampaignPerformance = {
      campaignId,
      name: campaign.name,
      status,
      totalAudience: campaign.audienceSizeSnapshot,
      funnel: {
        sent,
        delivered,
        opened,
        clicked,
        converted,
        failed
      },
      rates: {
        delivery: analytics.deliveryRate,
        open: analytics.openRate,
        click: analytics.clickRate,
        conversion: analytics.conversionRate
      },
      revenue,
      failures: failures.map((failure) => ({
        reason: failure.failureReason ?? "Unknown delivery failure",
        count: failure._count
      })),
      updatedAt: analytics.updatedAt.toISOString()
    };
    if (publish) {
      await this.queues.publish("analytics", {
        type: "campaign.analytics.updated",
        campaignId,
        performance
      });
    }
    return performance;
  }

  async getCampaignPerformance(
    campaignId: string
  ): Promise<CampaignPerformance> {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      include: { analytics: true }
    });
    if (!campaign) {
      throw new NotFoundException("Campaign not found");
    }
    if (!campaign.analytics) {
      return this.refreshCampaign(campaignId, false);
    }
    const failures = await this.prisma.campaignLog.groupBy({
      by: ["failureReason"],
      where: { campaignId, status: "FAILED" },
      _count: true
    });
    return {
      campaignId,
      name: campaign.name,
      status: campaign.status,
      totalAudience: campaign.analytics.totalAudience,
      funnel: {
        sent: campaign.analytics.totalSent,
        delivered: campaign.analytics.totalDelivered,
        opened: campaign.analytics.totalOpened,
        clicked: campaign.analytics.totalClicked,
        converted: campaign.analytics.totalConverted,
        failed: campaign.analytics.totalFailed
      },
      rates: {
        delivery: campaign.analytics.deliveryRate,
        open: campaign.analytics.openRate,
        click: campaign.analytics.clickRate,
        conversion: campaign.analytics.conversionRate
      },
      revenue: Number(campaign.analytics.revenueAccrued),
      failures: failures.map((failure) => ({
        reason: failure.failureReason ?? "Unknown delivery failure",
        count: failure._count
      })),
      updatedAt: campaign.analytics.updatedAt.toISOString()
    };
  }

  async dashboard(): Promise<DashboardMetrics> {
    const [
      totalCustomers,
      totalOrders,
      orderRevenue,
      activeCampaigns,
      analytics,
      campaignTrend,
      revenueTrend,
      channelRows,
      segmentRows,
      recentCampaigns,
      recentConversions,
      recentTools,
      recentSegments
    ] = await Promise.all([
      this.prisma.customer.count(),
      this.prisma.order.count(),
      this.prisma.order.aggregate({ _sum: { amount: true } }),
      this.prisma.campaign.count({
        where: { status: { in: ["QUEUED", "RUNNING"] } }
      }),
      this.prisma.campaignAnalytics.aggregate({
        _sum: {
          totalSent: true,
          totalDelivered: true,
          totalOpened: true,
          totalClicked: true,
          totalConverted: true
        }
      }),
      this.prisma.$queryRaw<
        Array<{ date: Date; sent: bigint; converted: bigint }>
      >(Prisma.sql`
        SELECT
          DATE_TRUNC('day', "occurredAt") AS date,
          COUNT(*) FILTER (
            WHERE type = 'MessageSent'::"CampaignEventType"
          )::bigint AS sent,
          COUNT(*) FILTER (
            WHERE type = 'MessageConverted'::"CampaignEventType"
          )::bigint AS converted
        FROM "CampaignEvent"
        WHERE "occurredAt" >= NOW() - INTERVAL '14 days'
        GROUP BY 1
        ORDER BY 1
      `),
      this.prisma.$queryRaw<Array<{ date: Date; revenue: Prisma.Decimal }>>(
        Prisma.sql`
          SELECT
            DATE_TRUNC('day', e."occurredAt") AS date,
            COALESCE(SUM(o.amount), 0) AS revenue
          FROM "CampaignEvent" e
          JOIN "Order" o ON o.id = e."attributedOrderId"
          WHERE e.type = 'MessageConverted'::"CampaignEventType"
            AND e."occurredAt" >= NOW() - INTERVAL '14 days'
          GROUP BY 1
          ORDER BY 1
        `
      ),
      this.prisma.$queryRaw<
        Array<{ channel: Channel; converted: bigint; sent: bigint }>
      >(Prisma.sql`
        SELECT
          c.channel,
          COUNT(DISTINCT e."customerId") FILTER (
            WHERE e.type = 'MessageConverted'::"CampaignEventType"
          )::bigint AS converted,
          COUNT(DISTINCT e."customerId") FILTER (
            WHERE e.type = 'MessageSent'::"CampaignEventType"
          )::bigint AS sent
        FROM "Campaign" c
        LEFT JOIN "CampaignEvent" e ON e."campaignId" = c.id
        GROUP BY c.channel
        ORDER BY c.channel
      `),
      this.prisma.$queryRaw<Array<{ segment: string; conversions: bigint }>>(
        Prisma.sql`
          SELECT
            s.name AS segment,
            COUNT(e.id)::bigint AS conversions
          FROM "Segment" s
          JOIN "Campaign" c ON c."segmentId" = s.id
          JOIN "CampaignEvent" e ON e."campaignId" = c.id
          WHERE e.type = 'MessageConverted'::"CampaignEventType"
          GROUP BY s.id
          ORDER BY conversions DESC
          LIMIT 8
        `
      ),
      this.prisma.campaign.findMany({
        orderBy: { launchedAt: "desc" },
        where: { launchedAt: { not: null } },
        take: 5
      }),
      this.prisma.campaignEvent.findMany({
        where: { type: CampaignEventType.MessageConverted },
        include: { campaign: { select: { name: true } } },
        orderBy: { occurredAt: "desc" },
        take: 5
      }),
      this.prisma.aIToolExecution.findMany({
        orderBy: { createdAt: "desc" },
        take: 5
      }),
      this.prisma.segment.findMany({
        orderBy: { createdAt: "desc" },
        take: 5
      })
    ]);
    const sent = analytics._sum.totalSent ?? 0;
    const delivered = analytics._sum.totalDelivered ?? 0;
    const opened = analytics._sum.totalOpened ?? 0;
    const clicked = analytics._sum.totalClicked ?? 0;
    const converted = analytics._sum.totalConverted ?? 0;
    const activity: DashboardMetrics["activity"] = [
      ...recentCampaigns.map((campaign) => ({
        id: campaign.id,
        kind: "campaign" as const,
        title: `Campaign launched: ${campaign.name}`,
        occurredAt: (campaign.launchedAt ?? campaign.createdAt).toISOString()
      })),
      ...recentConversions.map((event) => ({
        id: event.id,
        kind: "conversion" as const,
        title: `Conversion attributed to ${event.campaign.name}`,
        occurredAt: event.occurredAt.toISOString()
      })),
      ...recentTools.map((tool) => ({
        id: tool.id,
        kind: "ai" as const,
        title: `AI executed ${tool.toolName}`,
        occurredAt: tool.createdAt.toISOString()
      })),
      ...recentSegments.map((segment) => ({
        id: segment.id,
        kind: "segment" as const,
        title: `Segment created: ${segment.name}`,
        occurredAt: segment.createdAt.toISOString()
      }))
    ]
      .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
      .slice(0, 12);
    return {
      totalCustomers,
      totalOrders,
      totalRevenue: Number(orderRevenue._sum.amount ?? 0),
      activeCampaigns,
      deliveryRate: rate(delivered, sent),
      openRate: rate(opened, delivered),
      clickRate: rate(clicked, opened),
      conversionRate: rate(converted, clicked),
      campaignPerformance: campaignTrend.map((row) => ({
        date: row.date.toISOString(),
        sent: Number(row.sent),
        converted: Number(row.converted)
      })),
      revenueTrends: revenueTrend.map((row) => ({
        date: row.date.toISOString(),
        revenue: Number(row.revenue)
      })),
      channelPerformance: channelRows.map((row) => ({
        channel: row.channel,
        rate: rate(Number(row.converted), Number(row.sent))
      })),
      segmentPerformance: segmentRows.map((row) => ({
        segment: row.segment,
        conversions: Number(row.conversions)
      })),
      activity,
      generatedAt: new Date().toISOString()
    };
  }

  async globalAnalytics() {
    const [dashboard, campaigns] = await Promise.all([
      this.dashboard(),
      this.prisma.campaign.findMany({
        include: { analytics: true, segment: { select: { name: true } } },
        where: { analytics: { isNot: null } },
        orderBy: { createdAt: "desc" },
        take: 50
      })
    ]);
    return { dashboard, campaigns };
  }
}
