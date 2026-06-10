import {
  ConflictException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import {
  campaignStatusSchema,
  channelSchema,
  type CampaignDispatchJob,
  type PaginationQuery
} from "../contracts";
import {
  CampaignEventType,
  CampaignStatus,
  ChannelType,
  DeliveryStatus
} from "@prisma/client";
import { randomUUID } from "node:crypto";
import { toInputJson } from "../common/json";
import { PrismaService } from "../prisma/prisma.service";
import { QueueService } from "../queue/queue.service";
import { SegmentCompilerService } from "../segments/segment-compiler.service";

@Injectable()
export class CampaignsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly segments: SegmentCompilerService,
    private readonly queues: QueueService
  ) {}

  async list(
    query: PaginationQuery,
    filters: { status?: string; channel?: string }
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
      ...(channel ? { channel } : {})
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.campaign.findMany({
        where,
        include: { segment: true, analytics: true },
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize
      }),
      this.prisma.campaign.count({ where })
    ]);
    return {
      data: items,
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize)
      }
    };
  }

  async create(input: {
    name: string;
    segmentId: string;
    channel: string;
    subject?: string;
    message: string;
  }) {
    const channel = channelSchema.parse(input.channel);
    const segment = await this.prisma.segment.findUnique({
      where: { id: input.segmentId }
    });
    if (!segment) {
      throw new NotFoundException("Segment not found");
    }
    const correlationId = randomUUID();
    return this.prisma.$transaction(async (transaction) => {
      const campaign = await transaction.campaign.create({
        data: {
          name: input.name,
          segmentId: input.segmentId,
          channel,
          subject: input.subject,
          message: input.message
        }
      });
      await transaction.campaignEvent.create({
        data: {
          eventId: randomUUID(),
          type: CampaignEventType.CampaignCreated,
          campaignId: campaign.id,
          correlationId,
          payload: toInputJson({ name: campaign.name, channel }),
          occurredAt: new Date()
        }
      });
      await transaction.campaignAnalytics.create({
        data: { campaignId: campaign.id }
      });
      return campaign;
    });
  }

  async previewAudience(id: string) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id },
      include: { segment: true }
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
      include: { segment: true }
    });
    if (!campaign) {
      throw new NotFoundException("Campaign not found");
    }
    if (campaign.status !== CampaignStatus.DRAFT) {
      throw new ConflictException("Only draft campaigns can be launched");
    }
    const audience = await this.segments.match(campaign.segment.rules, {
      limit: 10000
    });
    if (audience.length === 0) {
      throw new ConflictException("The selected segment has no customers");
    }
    const correlationId = randomUUID();
    const occurredAt = new Date();
    await this.prisma.$transaction(async (transaction) => {
      await transaction.campaign.update({
        where: { id },
        data: {
          status: CampaignStatus.QUEUED,
          audienceSizeSnapshot: audience.length,
          launchedAt: occurredAt
        }
      });
      await transaction.campaignEvent.create({
        data: {
          eventId: randomUUID(),
          type: CampaignEventType.CampaignLaunched,
          campaignId: id,
          correlationId,
          payload: toInputJson({ audienceSize: audience.length }),
          occurredAt
        }
      });
      await transaction.campaignEvent.createMany({
        data: audience.map((customer) => ({
          eventId: randomUUID(),
          type: CampaignEventType.MessageQueued,
          campaignId: id,
          customerId: customer.id,
          correlationId,
          payload: toInputJson({ channel: campaign.channel }),
          occurredAt
        }))
      });
      await transaction.campaignLog.createMany({
        data: audience.map((customer) => ({
          campaignId: id,
          customerId: customer.id,
          status: DeliveryStatus.QUEUED,
          lastEventAt: occurredAt
        }))
      });
      await transaction.campaignAnalytics.update({
        where: { campaignId: id },
        data: { totalAudience: audience.length, totalQueued: audience.length }
      });
    });

    const jobs: CampaignDispatchJob[] = audience.map((customer) => ({
      campaignId: id,
      customerId: customer.id,
      channel: campaign.channel,
      destination:
        campaign.channel === ChannelType.EMAIL ? customer.email : customer.phone,
      subject: campaign.subject,
      message: campaign.message,
      correlationId
    }));
    try {
      await this.queues.addDispatchJobs(jobs);
      await this.prisma.campaign.update({
        where: { id },
        data: { status: CampaignStatus.RUNNING }
      });
    } catch (error) {
      await this.prisma.$transaction([
        this.prisma.campaign.update({
          where: { id },
          data: { status: CampaignStatus.FAILED }
        }),
        this.prisma.processingFailure.create({
          data: {
            queue: "campaign-dispatch",
            correlationId,
            reason: error instanceof Error ? error.message : String(error),
            diagnostics: toInputJson({ campaignId: id })
          }
        })
      ]);
      throw error;
    }
    return {
      campaignId: id,
      status: CampaignStatus.RUNNING,
      audienceSize: audience.length,
      correlationId
    };
  }

  async get(id: string) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id },
      include: {
        segment: true,
        analytics: true,
        events: { orderBy: { occurredAt: "desc" }, take: 100 }
      }
    });
    if (!campaign) {
      throw new NotFoundException("Campaign not found");
    }
    const failures = await this.prisma.campaignLog.groupBy({
      by: ["failureReason"],
      where: { campaignId: id, status: DeliveryStatus.FAILED },
      _count: true
    });
    return {
      ...campaign,
      failures: failures.map((failure) => ({
        reason: failure.failureReason ?? "Unknown delivery failure",
        count: failure._count
      }))
    };
  }
}
