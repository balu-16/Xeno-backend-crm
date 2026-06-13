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
import { AppEventsService } from "../events/app-events.service";

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

function safeBigintToNumber(value: bigint | number | Prisma.Decimal | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return value;
  // Prisma Decimal has a .toNumber() method
  if (typeof value === "object" && "toNumber" in value && typeof value.toNumber === "function") {
    return value.toNumber();
  }
  return Number(value);
}

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: AppEventsService
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
        COUNT(DISTINCT e."customerId") FILTER (
          WHERE e.type = 'MessageSent'::"CampaignEventType"
        )::bigint AS sent,
        COUNT(DISTINCT e."customerId") FILTER (
          WHERE e.type = 'MessageDelivered'::"CampaignEventType"
        )::bigint AS delivered,
        COUNT(DISTINCT e."customerId") FILTER (
          WHERE e.type = 'MessageOpened'::"CampaignEventType"
        )::bigint AS opened,
        COUNT(DISTINCT e."customerId") FILTER (
          WHERE e.type = 'MessageClicked'::"CampaignEventType"
        )::bigint AS clicked,
        COUNT(DISTINCT e."customerId") FILTER (
          WHERE e.type = 'MessageConverted'::"CampaignEventType"
        )::bigint AS converted,
        COUNT(DISTINCT e."customerId") FILTER (
          WHERE e.type = 'MessageFailed'::"CampaignEventType"
        )::bigint AS failed,
        COALESCE(SUM(o.amount), 0) AS revenue
      FROM "CampaignEvent" e
      LEFT JOIN "Order" o ON o.id = e."attributedOrderId"
      WHERE e."campaignId" = ${campaignId}
    `);
    const aggregate = rows[0];
    const sent = safeBigintToNumber(aggregate?.sent);
    const delivered = safeBigintToNumber(aggregate?.delivered);
    const opened = safeBigintToNumber(aggregate?.opened);
    const clicked = safeBigintToNumber(aggregate?.clicked);
    const converted = safeBigintToNumber(aggregate?.converted);
    const failed = safeBigintToNumber(aggregate?.failed);
    const revenue = safeBigintToNumber(aggregate?.revenue);
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
          openRate: rate(opened, sent),
          clickRate: rate(clicked, sent),
          conversionRate: rate(converted, sent),
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
          openRate: rate(opened, sent),
          clickRate: rate(clicked, sent),
          conversionRate: rate(converted, sent),
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
      this.events.publish("analytics", {
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
      openRate: rate(opened, sent),
      clickRate: rate(clicked, sent),
      conversionRate: rate(converted, sent),
      campaignPerformance: campaignTrend.map((row) => ({
        date: row.date.toISOString(),
        sent: safeBigintToNumber(row.sent),
        converted: safeBigintToNumber(row.converted)
      })),
      revenueTrends: revenueTrend.map((row) => ({
        date: row.date.toISOString(),
        revenue: safeBigintToNumber(row.revenue)
      })),
      channelPerformance: channelRows.map((row) => ({
        channel: row.channel,
        rate: rate(safeBigintToNumber(row.converted), safeBigintToNumber(row.sent))
      })),
      segmentPerformance: segmentRows.map((row) => ({
        segment: row.segment,
        conversions: safeBigintToNumber(row.conversions)
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

  async getSegmentAnalytics(segmentId?: string) {
    const rows = await this.prisma.$queryRaw<Array<{
      segmentId: string;
      segment: string;
      campaigns: bigint;
      audience: bigint;
      sent: bigint;
      delivered: bigint;
      opened: bigint;
      clicked: bigint;
      converted: bigint;
      revenue: Prisma.Decimal;
    }>>(Prisma.sql`
      SELECT
        s.id AS "segmentId",
        s.name AS segment,
        COUNT(DISTINCT c.id)::bigint AS campaigns,
        COALESCE(SUM(a."totalAudience"), 0)::bigint AS audience,
        COALESCE(SUM(a."totalSent"), 0)::bigint AS sent,
        COALESCE(SUM(a."totalDelivered"), 0)::bigint AS delivered,
        COALESCE(SUM(a."totalOpened"), 0)::bigint AS opened,
        COALESCE(SUM(a."totalClicked"), 0)::bigint AS clicked,
        COALESCE(SUM(a."totalConverted"), 0)::bigint AS converted,
        COALESCE(SUM(a."revenueAccrued"), 0) AS revenue
      FROM "Segment" s
      LEFT JOIN "Campaign" c ON c."segmentId" = s.id
      LEFT JOIN "CampaignAnalytics" a ON a."campaignId" = c.id
      ${segmentId ? Prisma.sql`WHERE s.id = ${segmentId}` : Prisma.empty}
      GROUP BY s.id, s.name
      ORDER BY revenue DESC, converted DESC, segment ASC
    `);
    return rows.map((row) => ({
      segmentId: row.segmentId,
      segment: row.segment,
      campaigns: safeBigintToNumber(row.campaigns),
      audience: safeBigintToNumber(row.audience),
      sent: safeBigintToNumber(row.sent),
      delivered: safeBigintToNumber(row.delivered),
      opened: safeBigintToNumber(row.opened),
      clicked: safeBigintToNumber(row.clicked),
      converted: safeBigintToNumber(row.converted),
      revenue: safeBigintToNumber(row.revenue),
      deliveryRate: rate(safeBigintToNumber(row.delivered), safeBigintToNumber(row.sent)),
      openRate: rate(safeBigintToNumber(row.opened), safeBigintToNumber(row.sent)),
      clickRate: rate(safeBigintToNumber(row.clicked), safeBigintToNumber(row.sent)),
      conversionRate: rate(safeBigintToNumber(row.converted), safeBigintToNumber(row.sent))
    }));
  }

  async getRevenueAnalytics() {
    const [summary, byCampaign, bySegment, trend] = await Promise.all([
      this.prisma.order.aggregate({ _sum: { amount: true }, _count: true }),
      this.prisma.campaign.findMany({
        include: { analytics: true, segment: { select: { name: true } } },
        orderBy: { analytics: { revenueAccrued: "desc" } },
        take: 10
      }),
      this.getSegmentAnalytics(),
      this.prisma.$queryRaw<Array<{ date: Date; revenue: Prisma.Decimal }>>(
        Prisma.sql`
          SELECT DATE_TRUNC('day', "createdAt") AS date, SUM(amount) AS revenue
          FROM "Order"
          WHERE "createdAt" >= NOW() - INTERVAL '30 days'
          GROUP BY 1
          ORDER BY 1
        `
      )
    ]);
    return {
      totalRevenue: Number(summary._sum.amount ?? 0),
      totalOrders: summary._count,
      topCampaigns: byCampaign.map((campaign) => ({
        id: campaign.id,
        name: campaign.name,
        segment: campaign.segment.name,
        revenue: campaign.analytics ? Number(campaign.analytics.revenueAccrued) : 0
      })),
      topSegments: bySegment.slice(0, 10).map((segment) => ({
        segmentId: segment.segmentId,
        segment: segment.segment,
        revenue: segment.revenue,
        converted: segment.converted
      })),
      trend: trend.map((row) => ({
        date: row.date.toISOString(),
        revenue: Number(row.revenue)
      }))
    };
  }

  async getDeliveryAnalytics() {
    const [analytics, failures, channelRows] = await Promise.all([
      this.prisma.campaignAnalytics.aggregate({
        _sum: {
          totalSent: true,
          totalDelivered: true,
          totalOpened: true,
          totalClicked: true,
          totalConverted: true,
          totalFailed: true
        }
      }),
      this.prisma.campaignLog.groupBy({
        by: ["failureReason"],
        where: { status: "FAILED" },
        _count: true,
        orderBy: { _count: { failureReason: "desc" } },
        take: 10
      }),
      this.prisma.$queryRaw<Array<{
        channel: Channel;
        sent: bigint;
        delivered: bigint;
        failed: bigint;
      }>>(Prisma.sql`
        SELECT
          c.channel,
          COALESCE(SUM(a."totalSent"), 0)::bigint AS sent,
          COALESCE(SUM(a."totalDelivered"), 0)::bigint AS delivered,
          COALESCE(SUM(a."totalFailed"), 0)::bigint AS failed
        FROM "Campaign" c
        LEFT JOIN "CampaignAnalytics" a ON a."campaignId" = c.id
        GROUP BY c.channel
        ORDER BY c.channel
      `)
    ]);
    const sent = analytics._sum.totalSent ?? 0;
    const delivered = analytics._sum.totalDelivered ?? 0;
    const opened = analytics._sum.totalOpened ?? 0;
    const clicked = analytics._sum.totalClicked ?? 0;
    const converted = analytics._sum.totalConverted ?? 0;
    const failed = analytics._sum.totalFailed ?? 0;
    return {
      sent,
      delivered,
      opened,
      clicked,
      converted,
      failed,
      deliveryRate: rate(delivered, sent),
      openRate: rate(opened, sent),
      clickRate: rate(clicked, sent),
      conversionRate: rate(converted, sent),
      failureReasons: failures.map((failure) => ({
        reason: failure.failureReason ?? "Unknown delivery failure",
        count: failure._count
      })),
      channels: channelRows.map((row) => ({
        channel: row.channel,
        sent: safeBigintToNumber(row.sent),
        delivered: safeBigintToNumber(row.delivered),
        failed: safeBigintToNumber(row.failed),
        deliveryRate: rate(safeBigintToNumber(row.delivered), safeBigintToNumber(row.sent))
      }))
    };
  }
}
