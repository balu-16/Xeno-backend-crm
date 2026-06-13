import { Module } from "@nestjs/common";
import { AnalyticsModule } from "../analytics/analytics.module";
import { ChannelDispatchModule } from "../channel-dispatch/channel-dispatch.module";
import { SegmentsModule } from "../segments/segments.module";
import { CampaignsController } from "./campaigns.controller";
import { CampaignsService } from "./campaigns.service";

@Module({
  imports: [SegmentsModule, ChannelDispatchModule, AnalyticsModule],
  controllers: [CampaignsController],
  providers: [CampaignsService],
  exports: [CampaignsService]
})
export class CampaignsModule {}
