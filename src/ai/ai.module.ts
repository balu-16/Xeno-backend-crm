import { Module } from "@nestjs/common";
import { AnalyticsModule } from "../analytics/analytics.module";
import { SegmentsModule } from "../segments/segments.module";
import { AIController } from "./ai.controller";
import { AIProviderService } from "./ai-provider.service";
import { AIService } from "./ai.service";
import { AIToolsService } from "./ai-tools.service";

@Module({
  imports: [AnalyticsModule, SegmentsModule],
  controllers: [AIController],
  providers: [AIService, AIToolsService, AIProviderService]
})
export class AIModule {}
