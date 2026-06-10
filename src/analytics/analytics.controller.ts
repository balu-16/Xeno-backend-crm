import { Controller, Get, Param, Sse } from "@nestjs/common";
import type { MessageEvent } from "@nestjs/common";
import { map, type Observable } from "rxjs";
import { QueueService } from "../queue/queue.service";
import { AnalyticsService } from "./analytics.service";

@Controller()
export class AnalyticsController {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly queues: QueueService
  ) {}

  @Get("dashboard")
  dashboard() {
    return this.analytics.dashboard();
  }

  @Get("analytics")
  global() {
    return this.analytics.globalAnalytics();
  }

  @Get("analytics/campaigns/:id")
  campaign(@Param("id") id: string) {
    return this.analytics.getCampaignPerformance(id);
  }

  @Sse("analytics/stream")
  stream(): Observable<MessageEvent> {
    return this.queues.stream("analytics").pipe(
      map((data) => ({
        data:
          typeof data === "object" && data !== null ? data : String(data)
      }) satisfies MessageEvent)
    );
  }
}
