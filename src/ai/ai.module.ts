import { Module } from "@nestjs/common";
import { AIInsightsModule } from "../ai-insights/ai-insights.module";
import { AnalyticsModule } from "../analytics/analytics.module";
import { CampaignsModule } from "../campaigns/campaigns.module";
import { CustomersModule } from "../customers/customers.module";
import { SegmentsModule } from "../segments/segments.module";
import { AIController } from "./ai.controller";
import { AIProviderService } from "./ai-provider.service";
import { AIService } from "./ai.service";
import { AIToolsService } from "./ai-tools.service";
import { ToolRegistryService } from "./tool-registry.service";
import { AnalyticsToolsProvider } from "./tools/analytics-tools.provider";
import { CampaignToolsProvider } from "./tools/campaign-tools.provider";
import { ChannelToolsProvider } from "./tools/channel-tools.provider";
import { CustomerToolsProvider } from "./tools/customer-tools.provider";
import { OptionalToolsProvider } from "./tools/optional-tools.provider";
import { SegmentToolsProvider } from "./tools/segment-tools.provider";

@Module({
  imports: [AIInsightsModule, AnalyticsModule, CampaignsModule, CustomersModule, SegmentsModule],
  controllers: [AIController],
  providers: [
    AIService,
    AIToolsService,
    AIProviderService,
    ToolRegistryService,
    CustomerToolsProvider,
    SegmentToolsProvider,
    CampaignToolsProvider,
    AnalyticsToolsProvider,
    ChannelToolsProvider,
    OptionalToolsProvider,
  ]
})
export class AIModule {}
