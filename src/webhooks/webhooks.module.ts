import { Module } from "@nestjs/common";
import { AnalyticsModule } from "../analytics/analytics.module";
import { EventsModule } from "../events/events.module";
import { ReceiptProcessingService } from "./receipt-processing.service";
import { WebhooksController } from "./webhooks.controller";

@Module({
  imports: [AnalyticsModule, EventsModule],
  controllers: [WebhooksController],
  providers: [ReceiptProcessingService],
  exports: [ReceiptProcessingService]
})
export class WebhooksModule {}
