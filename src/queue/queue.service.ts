import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  type AnalyticsRefreshJob,
  type CampaignDispatchJob,
  queueNames,
  type ReceiptJob
} from "../contracts";
import { Queue, type JobsOptions } from "bullmq";
import IORedis, { type RedisOptions } from "ioredis";
import { Observable, Subject } from "rxjs";
import type { Environment } from "../config/env";

type StreamEvent = {
  channel: "analytics" | "monitor";
  data: unknown;
};

@Injectable()
export class QueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private publisher?: IORedis;
  private subscriber?: IORedis;
  private campaignDispatch?: Queue<CampaignDispatchJob>;
  private receiptProcessing?: Queue<ReceiptJob>;
  private analyticsRefresh?: Queue<AnalyticsRefreshJob>;
  private readonly events = new Subject<StreamEvent>();

  constructor(private readonly config: ConfigService<Environment, true>) {}

  private connectionOptions(): RedisOptions {
    const useTls = this.config.get("REDIS_TLS", { infer: true });
    return {
      host: this.config.get("REDIS_HOST", { infer: true }),
      port: this.config.get("REDIS_PORT", { infer: true }),
      username: this.config.get("REDIS_USERNAME", { infer: true }),
      password: this.config.get("REDIS_PASSWORD", { infer: true }),
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      retryStrategy: (attempt: number) => Math.min(attempt * 1000, 30000),
      ...(useTls ? { tls: {} } : {})
    };
  }

  bullConnectionOptions() {
    return this.connectionOptions();
  }

  createConnection(): IORedis {
    return new IORedis(this.connectionOptions());
  }

  onModuleInit(): void {
    this.publisher = this.createConnection();
    this.subscriber = this.createConnection();
    this.publisher.on("error", (error) => {
      this.logger.error(`Redis publisher error: ${error.message}`);
    });
    this.subscriber.on("error", (error) => {
      this.logger.error(`Redis subscriber error: ${error.message}`);
    });
    this.campaignDispatch = new Queue(queueNames.campaignDispatch, {
      connection: this.bullConnectionOptions(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 500 },
        removeOnComplete: 1000,
        removeOnFail: 1000
      }
    });
    this.receiptProcessing = new Queue(queueNames.receiptProcessing, {
      connection: this.bullConnectionOptions(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 500 },
        removeOnComplete: 1000,
        removeOnFail: 1000
      }
    });
    this.analyticsRefresh = new Queue(queueNames.analyticsRefresh, {
      connection: this.bullConnectionOptions(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 500 },
        removeOnComplete: 1000,
        removeOnFail: 1000
      }
    });
    for (const queue of [
      this.campaignDispatch,
      this.receiptProcessing,
      this.analyticsRefresh
    ]) {
      queue.on("error", (error) => {
        this.logger.error(`${queue.name} unavailable: ${error.message}`);
      });
    }
    void this.subscriber
      .subscribe("xeno:analytics", "xeno:monitor")
      .catch((error: unknown) => {
        this.logger.error(
          `Redis subscription unavailable: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      });
    this.subscriber.on("message", (channel, raw) => {
      try {
        this.events.next({
          channel: channel === "xeno:analytics" ? "analytics" : "monitor",
          data: JSON.parse(raw) as unknown
        });
      } catch (error) {
        this.logger.warn(`Ignored invalid Redis stream event: ${String(error)}`);
      }
    });
  }

  stream(channel: StreamEvent["channel"]): Observable<unknown> {
    return new Observable((subscriber) => {
      const subscription = this.events.subscribe((event) => {
        if (event.channel === channel) {
          subscriber.next(event.data);
        }
      });
      return () => {
        subscription.unsubscribe();
      };
    });
  }

  async publish(channel: StreamEvent["channel"], data: unknown): Promise<void> {
    if (!this.publisher) {
      throw new Error("Redis publisher is not initialized");
    }
    await this.publisher.publish(`xeno:${channel}`, JSON.stringify(data));
  }

  async addDispatchJobs(jobs: CampaignDispatchJob[]): Promise<void> {
    const channelServiceUrl = this.config.get("CHANNEL_SERVICE_URL", {
      infer: true,
    });

    // Vercel mode: call channel service via HTTP
    if (channelServiceUrl) {
      const concurrency = 10;
      for (let i = 0; i < jobs.length; i += concurrency) {
        const chunk = jobs.slice(i, i + concurrency);
        await Promise.all(
          chunk.map(async (job) => {
            try {
              const response = await fetch(
                `${channelServiceUrl.replace(/\/$/, "")}/api/dispatch`,
                {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify(job),
                  signal: AbortSignal.timeout(30000),
                }
              );
              if (!response.ok) {
                throw new Error(`Channel service returned HTTP ${response.status}`);
              }
            } catch (error) {
              this.logger.error(
                `Channel dispatch failed for ${job.customerId}: ${error instanceof Error ? error.message : String(error)}`
              );
            }
          })
        );
      }
      return;
    }

    // Local mode: use BullMQ queue
    if (!this.campaignDispatch) {
      throw new Error("Campaign dispatch queue is not initialized");
    }
    const chunks: CampaignDispatchJob[][] = [];
    for (let index = 0; index < jobs.length; index += 500) {
      chunks.push(jobs.slice(index, index + 500));
    }
    for (const chunk of chunks) {
      await this.campaignDispatch.addBulk(
        chunk.map((data) => ({
          name: "dispatch-message",
          data,
          opts: {
            jobId: `${data.campaignId}-${data.customerId}`
          } satisfies JobsOptions
        }))
      );
    }
  }

  async addReceiptJob(job: ReceiptJob): Promise<void> {
    if (!this.receiptProcessing) {
      throw new Error("Receipt processing queue is not initialized");
    }
    await this.receiptProcessing.add("process-receipt", job, {
      jobId: job.eventId
    });
  }

  async addAnalyticsJob(job: AnalyticsRefreshJob): Promise<void> {
    if (!this.analyticsRefresh) {
      throw new Error("Analytics refresh queue is not initialized");
    }
    await this.analyticsRefresh.add("refresh-analytics", job, {
      jobId: `${job.campaignId}-${Date.now()}`
    });
  }

  async getQueueCounts(): Promise<
    Array<{
      queue: string;
      waiting: number;
      active: number;
      delayed: number;
      failed: number;
      completed: number;
    }>
  > {
    const queues = [
      this.campaignDispatch,
      this.receiptProcessing,
      this.analyticsRefresh
    ].filter((queue): queue is Queue => queue !== undefined);
    return Promise.all(
      queues.map(async (queue) => {
        const counts = await queue.getJobCounts(
          "waiting",
          "active",
          "delayed",
          "failed",
          "completed"
        );
        return {
          queue: queue.name,
          waiting: counts.waiting ?? 0,
          active: counts.active ?? 0,
          delayed: counts.delayed ?? 0,
          failed: counts.failed ?? 0,
          completed: counts.completed ?? 0
        };
      })
    );
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled([
      this.campaignDispatch?.disconnect(),
      this.receiptProcessing?.disconnect(),
      this.analyticsRefresh?.disconnect()
    ]);
    this.publisher?.disconnect();
    this.subscriber?.disconnect();
    this.events.complete();
  }
}
