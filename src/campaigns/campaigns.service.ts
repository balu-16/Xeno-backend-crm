import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  campaignStatusSchema,
  channelSchema,
  type CampaignDispatchJob,
  type PaginationQuery,
} from "../contracts";
import {
  CampaignEventType,
  CampaignStatus,
  ChannelType,
  DeliveryStatus,
} from "@prisma/client";
import { randomUUID } from "node:crypto";
import { toInputJson } from "../common/json";
import { PrismaService } from "../prisma/prisma.service";
import { ChannelDispatchService } from "../channel-dispatch/channel-dispatch.service";
import { AnalyticsService } from "../analytics/analytics.service";
import { SegmentCompilerService } from "../segments/segment-compiler.service";

@Injectable()
export class CampaignsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly segments: SegmentCompilerService,
    private readonly channelDispatch: ChannelDispatchService,
    private readonly analytics: AnalyticsService,
  ) {}

  async list(
    query: PaginationQuery,
    filters: { status?: string; channel?: string },
  ) {
    const status = filters.status
      ? campaignStatusSchema.parse(filters.status)
      : undefined;
    const channel = filters.channel
      ? channelSchema.parse(filters.channel)
      : undefined;
    const where = {
      ...(query.search
        ? { name: { contains: query.search, mode: "insensitive" as const } }
        : {}),
      ...(status ? { status } : {}),
      ...(channel ? { channel } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.campaign.findMany({
        where,
        include: { segment: true, analytics: true },
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.campaign.count({ where }),
    ]);
    return {
      data: items,
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
      },
    };
  }

  async create(input: {
    name: string;
    segmentId: string;
    channel: string;
    subject?: string;
    message: string;
    scheduledAt?: string;
  }) {
    const channel = channelSchema.parse(input.channel);
    const segment = await this.prisma.segment.findUnique({
      where: { id: input.segmentId },
    });
    if (!segment) {
      throw new NotFoundException("Segment not found");
    }
    const scheduledAt = input.scheduledAt ? new Date(input.scheduledAt) : null;
    if (scheduledAt && scheduledAt <= new Date()) {
      throw new ConflictException("Scheduled time must be in the future");
    }
    const correlationId = randomUUID();
    return this.prisma.$transaction(async (transaction) => {
      const campaign = await transaction.campaign.create({
        data: {
          name: input.name,
          segmentId: input.segmentId,
          channel,
          subject: input.subject,
          message: input.message,
          scheduledAt,
        },
      });
      await transaction.campaignEvent.create({
        data: {
          eventId: randomUUID(),
          type: CampaignEventType.CampaignCreated,
          campaignId: campaign.id,
          correlationId,
          payload: toInputJson({ name: campaign.name, channel }),
          occurredAt: new Date(),
        },
      });
      await transaction.campaignAnalytics.create({
        data: { campaignId: campaign.id },
      });
      return campaign;
    });
  }

  async previewAudience(id: string) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id },
      include: { segment: true },
    });
    if (!campaign) {
      throw new NotFoundException("Campaign not found");
    }
    const audienceSize = await this.segments.count(campaign.segment.rules);
    return { campaignId: id, audienceSize };
  }

  async launch(id: string) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id },
      include: { segment: true },
    });
    if (!campaign) {
      throw new NotFoundException("Campaign not found");
    }
    // Atomic status check + update inside transaction to prevent TOCTOU race
    if (campaign.status !== CampaignStatus.DRAFT) {
      throw new ConflictException("Only draft campaigns can be launched");
    }
    const audience = await this.segments.match(campaign.segment.rules, {
      limit: 10000,
    });
    if (audience.length === 0) {
      throw new ConflictException("The selected segment has no customers");
    }
    const correlationId = randomUUID();
    const occurredAt = new Date();
    await this.prisma.$transaction(async (transaction) => {
      // Atomic conditional update — only succeeds if still DRAFT
      const updated = await transaction.campaign.updateMany({
        where: { id, status: CampaignStatus.DRAFT },
        data: {
          status: CampaignStatus.QUEUED,
          audienceSizeSnapshot: audience.length,
          launchedAt: occurredAt,
        },
      });
      if (updated.count === 0) {
        throw new ConflictException(
          "Campaign was already launched by another request",
        );
      }
      await transaction.campaignEvent.create({
        data: {
          eventId: randomUUID(),
          type: CampaignEventType.CampaignLaunched,
          campaignId: id,
          correlationId,
          payload: toInputJson({ audienceSize: audience.length }),
          occurredAt,
        },
      });
      await transaction.campaignEvent.createMany({
        data: audience.map((customer) => ({
          eventId: randomUUID(),
          type: CampaignEventType.MessageQueued,
          campaignId: id,
          customerId: customer.id,
          correlationId,
          payload: toInputJson({ channel: campaign.channel }),
          occurredAt,
        })),
      });
      await transaction.campaignLog.createMany({
        data: audience.map((customer) => ({
          campaignId: id,
          customerId: customer.id,
          status: DeliveryStatus.QUEUED,
          lastEventAt: occurredAt,
        })),
      });
      await transaction.campaignAnalytics.update({
        where: { campaignId: id },
        data: { totalAudience: audience.length, totalQueued: audience.length },
      });
    });

    const jobs: CampaignDispatchJob[] = audience.map((customer) => ({
      campaignId: id,
      customerId: customer.id,
      channel: campaign.channel,
      destination:
        campaign.channel === ChannelType.EMAIL
          ? customer.email
          : customer.phone,
      subject: campaign.subject,
      message: campaign.message,
      correlationId,
    }));
    try {
      const dispatchResult = await this.channelDispatch.dispatchMany(jobs);
      if (dispatchResult.failed > 0 && dispatchResult.accepted === 0) {
        throw new Error(
          `All ${dispatchResult.failed} dispatch requests failed`,
        );
      }
      await this.prisma.campaign.update({
        where: { id },
        data: { status: CampaignStatus.RUNNING },
      });
    } catch (error) {
      await this.prisma.$transaction([
        this.prisma.campaign.update({
          where: { id },
          data: { status: CampaignStatus.FAILED },
        }),
        // Mark all QUEUED log entries as FAILED so analytics don't show ghost pending
        this.prisma.campaignLog.updateMany({
          where: { campaignId: id, status: DeliveryStatus.QUEUED },
          data: { status: DeliveryStatus.FAILED, lastEventAt: new Date() },
        }),
        this.prisma.processingFailure.create({
          data: {
            queue: "campaign-dispatch",
            correlationId,
            reason: error instanceof Error ? error.message : String(error),
            diagnostics: toInputJson({ campaignId: id }),
          },
        }),
      ]);
      throw error;
    }
    return {
      campaignId: id,
      status: CampaignStatus.RUNNING,
      audienceSize: audience.length,
      correlationId,
    };
  }

  async get(id: string) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id },
      include: {
        segment: true,
        analytics: true,
        events: { orderBy: { occurredAt: "desc" }, take: 100 },
      },
    });
    if (!campaign) {
      throw new NotFoundException("Campaign not found");
    }
    const failures = await this.prisma.campaignLog.groupBy({
      by: ["failureReason"],
      where: { campaignId: id, status: DeliveryStatus.FAILED },
      _count: true,
    });
    return {
      ...campaign,
      failures: failures.map((failure) => ({
        reason: failure.failureReason ?? "Unknown delivery failure",
        count: failure._count,
      })),
    };
  }

  async remove(id: string) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id },
    });
    if (!campaign) {
      throw new NotFoundException("Campaign not found");
    }
    if (
      campaign.status === CampaignStatus.RUNNING ||
      campaign.status === CampaignStatus.QUEUED
    ) {
      throw new ConflictException("Cannot delete a running or queued campaign");
    }
    await this.prisma.campaign.delete({ where: { id } });
    return { deleted: true, id };
  }

  async pause(id: string) {
    const campaign = await this.prisma.campaign.findUnique({ where: { id } });
    if (!campaign) {
      throw new NotFoundException("Campaign not found");
    }
    if (
      campaign.status !== CampaignStatus.RUNNING &&
      campaign.status !== CampaignStatus.QUEUED
    ) {
      throw new ConflictException(
        "Only running or queued campaigns can be paused",
      );
    }
    return this.prisma.campaign.update({
      where: { id },
      data: { status: CampaignStatus.PAUSED },
    });
  }

  async retryFailed(id: string) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id },
      include: { segment: true },
    });
    if (!campaign) {
      throw new NotFoundException("Campaign not found");
    }
    const failedLogs = await this.prisma.campaignLog.findMany({
      where: { campaignId: id, status: DeliveryStatus.FAILED },
      include: { customer: true },
      take: 10000,
    });
    if (failedLogs.length === 0) {
      return { campaignId: id, retried: 0, correlationId: null };
    }
    const correlationId = randomUUID();
    await this.prisma.$transaction([
      this.prisma.campaign.update({
        where: { id },
        data: { status: CampaignStatus.RUNNING },
      }),
      this.prisma.campaignEvent.createMany({
        data: failedLogs.map((log) => ({
          eventId: randomUUID(),
          type: CampaignEventType.MessageQueued,
          campaignId: id,
          customerId: log.customerId,
          correlationId,
          payload: toInputJson({ retry: true, channel: campaign.channel }),
          occurredAt: new Date(),
        })),
      }),
      this.prisma.campaignLog.updateMany({
        where: { campaignId: id, status: DeliveryStatus.FAILED },
        data: {
          status: DeliveryStatus.QUEUED,
          failureReason: null,
          lastEventAt: new Date(),
        },
      }),
    ]);
    const jobs: CampaignDispatchJob[] = failedLogs.map((log) => ({
      campaignId: id,
      customerId: log.customerId,
      channel: campaign.channel,
      destination:
        campaign.channel === ChannelType.EMAIL
          ? log.customer.email
          : log.customer.phone,
      subject: campaign.subject,
      message: campaign.message,
      correlationId,
    }));
    await this.channelDispatch.dispatchMany(jobs);
    return { campaignId: id, retried: failedLogs.length, correlationId };
  }

  async simulateDelivery(
    campaignId: string,
    customerId: string,
    type: Exclude<
      keyof typeof CampaignEventType,
      "CampaignCreated" | "CampaignLaunched" | "MessageQueued"
    >,
    payload: Record<string, unknown> = {},
  ) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
    });
    if (!campaign) {
      throw new NotFoundException("Campaign not found");
    }
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
    });
    if (!customer) {
      throw new NotFoundException("Customer not found");
    }
    const eventType = CampaignEventType[type];
    if (!eventType) {
      throw new ConflictException("Unsupported simulated delivery event");
    }
    const statusByEvent: Partial<Record<CampaignEventType, DeliveryStatus>> = {
      [CampaignEventType.MessageSent]: DeliveryStatus.SENT,
      [CampaignEventType.MessageDelivered]: DeliveryStatus.DELIVERED,
      [CampaignEventType.MessageOpened]: DeliveryStatus.OPENED,
      [CampaignEventType.MessageClicked]: DeliveryStatus.CLICKED,
      [CampaignEventType.MessageConverted]: DeliveryStatus.CONVERTED,
      [CampaignEventType.MessageFailed]: DeliveryStatus.FAILED,
    };
    const occurredAt = new Date();
    const correlationId = randomUUID();
    const result = await this.prisma.$transaction(async (transaction) => {
      let attributedOrderId: string | undefined;
      if (eventType === CampaignEventType.MessageConverted) {
        const amountValue = payload.orderAmount;
        const amount =
          typeof amountValue === "number" && Number.isFinite(amountValue)
            ? Math.max(1, amountValue)
            : 75;
        const order = await transaction.order.create({
          data: {
            customerId,
            amount,
            items: toInputJson([
              { sku: "AI-SIMULATED-CONVERSION", quantity: 1 },
            ]),
            createdAt: occurredAt,
          },
        });
        attributedOrderId = order.id;
      }
      const event = await transaction.campaignEvent.create({
        data: {
          eventId: randomUUID(),
          type: eventType,
          campaignId,
          customerId,
          attributedOrderId,
          correlationId,
          payload: toInputJson({ ...payload, simulatedBy: "ai-tool" }),
          occurredAt,
        },
      });
      const status = statusByEvent[eventType];
      if (status) {
        await transaction.campaignLog.upsert({
          where: { campaignId_customerId: { campaignId, customerId } },
          create: {
            campaignId,
            customerId,
            status,
            failureReason:
              status === DeliveryStatus.FAILED
                ? this.formatFailureReason(payload.reason)
                : null,
            attributedOrderId,
            lastEventAt: occurredAt,
          },
          update: {
            status,
            failureReason:
              status === DeliveryStatus.FAILED
                ? this.formatFailureReason(payload.reason)
                : null,
            ...(attributedOrderId ? { attributedOrderId } : {}),
            lastEventAt: occurredAt,
          },
        });
      }
      return event;
    });
    await this.analytics.refreshCampaign(campaignId);
    return {
      campaignId,
      customerId,
      event: result.type,
      eventId: result.id,
      correlationId,
    };
  }

  /** Launch all campaigns whose scheduledAt has passed */
  async launchScheduled(): Promise<
    Array<{ campaignId: string; audienceSize: number }>
  > {
    const now = new Date();
    const scheduled = await this.prisma.campaign.findMany({
      where: {
        status: CampaignStatus.DRAFT,
        scheduledAt: { lte: now },
      },
      take: 10,
    });
    const results: Array<{ campaignId: string; audienceSize: number }> = [];
    for (const campaign of scheduled) {
      try {
        const result = await this.launch(campaign.id);
        results.push(result);
      } catch (error) {
        await this.prisma.processingFailure
          .create({
            data: {
              queue: "scheduled-launch",
              reason: error instanceof Error ? error.message : String(error),
              diagnostics: toInputJson({ campaignId: campaign.id }),
            },
          })
          .catch(() => {});
      }
    }
    return results;
  }

  private formatFailureReason(reason: unknown): string {
    return typeof reason === "string" && reason.trim().length > 0
      ? reason
      : "Simulated failure";
  }
}
