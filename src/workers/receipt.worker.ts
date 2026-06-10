import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit
} from "@nestjs/common";
import {
  campaignEventTypeSchema,
  queueNames,
  receiptJobSchema,
  type CampaignEventType,
  type DeliveryStatus
} from "../contracts";
import {
  CampaignEventType as PrismaEventType,
  DeliveryStatus as PrismaDeliveryStatus,
  Prisma
} from "@prisma/client";
import { Job, Worker } from "bullmq";
import { toInputJson } from "../common/json";
import { PrismaService } from "../prisma/prisma.service";
import { QueueService } from "../queue/queue.service";

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
export class ReceiptWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReceiptWorker.name);
  private worker?: Worker;

  constructor(
    private readonly prisma: PrismaService,
    private readonly queues: QueueService
  ) {}

  onModuleInit(): void {
    this.worker = new Worker(
      queueNames.receiptProcessing,
      async (job: Job) => this.process(job),
      {
        connection: this.queues.bullConnectionOptions(),
        concurrency: 20
      }
    );
    this.worker.on("failed", (job, error) => {
      this.logger.error(`Receipt job ${job?.id ?? "unknown"} failed`, error.stack);
      if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
        const parsed = receiptJobSchema.safeParse(job.data);
        void this.prisma.processingFailure.create({
          data: {
            queue: queueNames.receiptProcessing,
            jobId: job.id,
            correlationId: parsed.success ? parsed.data.correlationId : null,
            reason: error.message,
            diagnostics: toInputJson({ stack: error.stack })
          }
        });
      }
    });
  }

  private async process(job: Job): Promise<void> {
    const input = receiptJobSchema.parse(job.data);
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
                  input.type === "MessageFailed"
                    ? failureReason
                    : null,
                attributedOrderId
              },
              update: {
                status: nextStatus as PrismaDeliveryStatus,
                lastEventAt: occurredAt,
                failureReason:
                  input.type === "MessageFailed"
                    ? failureReason
                    : null,
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
    await this.queues.addAnalyticsJob({
      campaignId: input.campaignId,
      correlationId: input.correlationId
    });
    await this.queues.publish("monitor", {
      type: "receipt.processed",
      eventId: input.eventId,
      campaignId: input.campaignId,
      eventType: input.type
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close(true);
  }
}
