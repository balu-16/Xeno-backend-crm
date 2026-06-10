import { Module } from "@nestjs/common";
import { SegmentsModule } from "../segments/segments.module";
import { CampaignsController } from "./campaigns.controller";
import { CampaignsService } from "./campaigns.service";

@Module({
  imports: [SegmentsModule],
  controllers: [CampaignsController],
  providers: [CampaignsService],
  exports: [CampaignsService]
})
export class CampaignsModule {}
