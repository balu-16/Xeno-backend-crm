import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { CampaignDispatchJob } from "../contracts";
import type { Environment } from "../config/env";

@Injectable()
export class ChannelDispatchService {
  private readonly logger = new Logger(ChannelDispatchService.name);

  constructor(private readonly config: ConfigService<Environment, true>) {}

  async dispatchMany(
    jobs: CampaignDispatchJob[]
  ): Promise<{ accepted: number; failed: number }> {
    const channelServiceUrl = this.config.get("CHANNEL_SERVICE_URL", {
      infer: true,
    });
    const concurrency = 20;
    let accepted = 0;
    let failed = 0;

    for (let i = 0; i < jobs.length; i += concurrency) {
      const chunk = jobs.slice(i, i + concurrency);
      const results = await Promise.allSettled(
        chunk.map(async (job) => {
          const response = await fetch(
            `${channelServiceUrl.replace(/\/$/, "")}/api/dispatch`,
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(job),
              signal: AbortSignal.timeout(10000),
            }
          );
          if (!response.ok) {
            throw new Error(
              `Channel service returned HTTP ${response.status}`
            );
          }
        })
      );
      for (const result of results) {
        if (result.status === "fulfilled") {
          accepted++;
        } else {
          failed++;
          this.logger.error(
            `Channel dispatch failed: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`
          );
        }
      }
    }

    return { accepted, failed };
  }
}
