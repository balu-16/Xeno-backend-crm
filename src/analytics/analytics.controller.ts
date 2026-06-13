import { Controller, Get, Param, Sse, UseGuards } from "@nestjs/common";
import type { MessageEvent } from "@nestjs/common";
import { map, type Observable } from "rxjs";
import { AuthGuard } from "../auth/auth.guard";
import { AppEventsService } from "../events/app-events.service";
import { AnalyticsService } from "./analytics.service";

@Controller()
@UseGuards(AuthGuard)
export class AnalyticsController {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly events: AppEventsService
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

  @Get("analytics/segments")
  segments() {
    return this.analytics.getSegmentAnalytics();
  }

  @Get("analytics/segments/:id")
  segment(@Param("id") id: string) {
    return this.analytics.getSegmentAnalytics(id);
  }

  @Get("analytics/revenue")
  revenue() {
    return this.analytics.getRevenueAnalytics();
  }

  @Get("analytics/delivery")
  delivery() {
    return this.analytics.getDeliveryAnalytics();
  }

  @Sse("analytics/stream")
  stream(): Observable<MessageEvent> {
    return this.events.stream("analytics").pipe(
      map((data) => ({
        data:
          typeof data === "object" && data !== null ? data : String(data)
      }) satisfies MessageEvent)
    );
  }
}
