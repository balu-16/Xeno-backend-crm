import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit
} from "@nestjs/common";
import {
  analyticsRefreshJobSchema,
  queueNames
} from "../contracts";
import { Job, Worker } from "bullmq";
import { AnalyticsService } from "../analytics/analytics.service";
import { toInputJson } from "../common/json";
import { PrismaService } from "../prisma/prisma.service";
import { QueueService } from "../queue/queue.service";

@Injectable()
export class AnalyticsWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AnalyticsWorker.name);
  private worker?: Worker;

  constructor(
    private readonly analytics: AnalyticsService,
    private readonly prisma: PrismaService,
    private readonly queues: QueueService
  ) {}

  onModuleInit(): void {
    this.worker = new Worker(
      queueNames.analyticsRefresh,
      async (job: Job) => {
        const input = analyticsRefreshJobSchema.parse(job.data);
        await this.analytics.refreshCampaign(input.campaignId);
      },
      {
        connection: this.queues.bullConnectionOptions(),
        concurrency: 5
      }
    );
    this.worker.on("failed", (job, error) => {
      this.logger.error(
        `Analytics job ${job?.id ?? "unknown"} failed`,
        error.stack
      );
      if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
        const parsed = analyticsRefreshJobSchema.safeParse(job.data);
        void this.prisma.processingFailure.create({
          data: {
            queue: queueNames.analyticsRefresh,
            jobId: job.id,
            correlationId: parsed.success ? parsed.data.correlationId : null,
            reason: error.message,
            diagnostics: toInputJson({ stack: error.stack })
          }
        });
      }
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close(true);
  }
}
