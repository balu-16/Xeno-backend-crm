import { Injectable, Logger } from "@nestjs/common";
import {
  campaignEventTypeSchema,
  receiptJobSchema,
  type CampaignEventType,
  type DeliveryStatus,
  type ReceiptJob
} from "../contracts";
import {
  CampaignEventType as PrismaEventType,
  DeliveryStatus as PrismaDeliveryStatus,
  Prisma
} from "@prisma/client";
import { toInputJson } from "../common/json";
import { PrismaService } from "../prisma/prisma.service";
import { AnalyticsService } from "../analytics/analytics.service";
import { AppEventsService } from "../events/app-events.service";

const statusByEvent: Partial<Record<CampaignEventType, DeliveryStatus>> = {
  MessageQueued: "QUEUED",
  MessageSent: "SENT",
  MessageDelivered: "DELIVERED",
  MessageOpened: "OPENED",
  MessageClicked: "CLICKED",
  MessageConverted: "CONVERTED",
  MessageFailed: "FAILED"
};

const statusRank: Record<DeliveryStatus, number> = {
  QUEUED: 0,
  SENT: 1,
  FAILED: 2,
  DELIVERED: 3,
  OPENED: 4,
  CLICKED: 5,
  CONVERTED: 6
};

@Injectable()
export class ReceiptProcessingService {
  private readonly logger = new Logger(ReceiptProcessingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly analytics: AnalyticsService,
    private readonly events: AppEventsService
  ) {}

  async processReceipt(input: ReceiptJob): Promise<void> {
    const eventType = campaignEventTypeSchema.parse(
      input.type
    ) as PrismaEventType;
    const nextStatus = statusByEvent[input.type];
    const occurredAt = new Date(input.occurredAt);
    const rawFailureReason = input.payload.reason;
    const failureReason =
      typeof rawFailureReason === "string"
        ? rawFailureReason
        : "Channel delivery failed";
    try {
      await this.prisma.$transaction(async (transaction) => {
        let attributedOrderId: string | undefined;
        if (input.type === "MessageConverted") {
          const amountValue = input.payload.orderAmount;
          const amount =
            typeof amountValue === "number" && Number.isFinite(amountValue)
              ? Math.max(1, amountValue)
              : 75;
          const order = await transaction.order.create({
            data: {
              customerId: input.customerId,
              amount,
              items: toInputJson([
                { sku: "CAMPAIGN-CONVERSION", quantity: 1 }
              ]),
              createdAt: occurredAt
            }
          });
          attributedOrderId = order.id;
        }
        await transaction.campaignEvent.create({
          data: {
            eventId: input.eventId,
            type: eventType,
            campaignId: input.campaignId,
            customerId: input.customerId,
            attributedOrderId,
            correlationId: input.correlationId,
            payload: toInputJson(input.payload),
            occurredAt
          }
        });
        if (nextStatus) {
          const current = await transaction.campaignLog.findUnique({
            where: {
              campaignId_customerId: {
                campaignId: input.campaignId,
                customerId: input.customerId
              }
            }
          });
          const shouldAdvance =
            !current ||
            (occurredAt >= current.lastEventAt &&
              statusRank[nextStatus] >= statusRank[current.status]);
          if (shouldAdvance) {
            await transaction.campaignLog.upsert({
              where: {
                campaignId_customerId: {
                  campaignId: input.campaignId,
                  customerId: input.customerId
                }
              },
              create: {
                campaignId: input.campaignId,
                customerId: input.customerId,
                status: nextStatus as PrismaDeliveryStatus,
                lastEventAt: occurredAt,
                failureReason:
                  input.type === "MessageFailed" ? failureReason : null,
                attributedOrderId
              },
              update: {
                status: nextStatus as PrismaDeliveryStatus,
                lastEventAt: occurredAt,
                failureReason:
                  input.type === "MessageFailed" ? failureReason : null,
                ...(attributedOrderId ? { attributedOrderId } : {})
              }
            });
          }
        }
        await transaction.webhookReceipt.update({
          where: { id: input.receiptId },
          data: {
            processedAt: new Date(),
            attempts: { increment: 1 },
            error: null
          }
        });
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        await this.prisma.webhookReceipt.update({
          where: { id: input.receiptId },
          data: { processedAt: new Date(), attempts: { increment: 1 } }
        });
        return;
      }
      await this.prisma.webhookReceipt.update({
        where: { id: input.receiptId },
        data: {
          attempts: { increment: 1 },
          error: error instanceof Error ? error.message : String(error)
        }
      });
      throw error;
    }

    // Refresh analytics directly (no queue)
    await this.analytics.refreshCampaign(input.campaignId);

    // Publish monitor event (in-memory)
    this.events.publish("monitor", {
      type: "receipt.processed",
      eventId: input.eventId,
      campaignId: input.campaignId,
      eventType: input.type
    });
  }
}
