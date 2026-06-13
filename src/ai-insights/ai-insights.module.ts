import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { AnalyticsModule } from "../analytics/analytics.module";
import { SegmentsModule } from "../segments/segments.module";
import { AIInsightsController } from "./ai-insights.controller";
import { AIInsightsService } from "./ai-insights.service";
import { InsightStoreService } from "./insight-store.service";
import { ScoringService } from "./scoring.service";
import { ConfidenceService } from "./confidence.service";
import { RecommendationService } from "./recommendation.service";
import { ActionService } from "./action.service";
import { OutcomeService } from "./outcome.service";
import { FeedbackService } from "./feedback.service";
import { DriftService } from "./drift.service";
import { CorrelationService } from "./correlation.service";
import { ExecutiveScoreService } from "./executive-score.service";
import { SimulationService } from "./simulation.service";
import { RevenueGenerator } from "./generators/revenue.generator";
import { CustomerGenerator } from "./generators/customer.generator";
import { CampaignGenerator } from "./generators/campaign.generator";
import { SegmentGenerator } from "./generators/segment.generator";
import { ChurnGenerator } from "./generators/churn.generator";
import { AnomalyGenerator } from "./generators/anomaly.generator";

@Module({
  imports: [PrismaModule, AnalyticsModule, SegmentsModule],
  controllers: [AIInsightsController],
  providers: [
    AIInsightsService,
    InsightStoreService,
    ScoringService,
    ConfidenceService,
    RecommendationService,
    ActionService,
    OutcomeService,
    FeedbackService,
    DriftService,
    CorrelationService,
    ExecutiveScoreService,
    SimulationService,
    RevenueGenerator,
    CustomerGenerator,
    CampaignGenerator,
    SegmentGenerator,
    ChurnGenerator,
    AnomalyGenerator,
  ],
  exports: [AIInsightsService, InsightStoreService, ActionService, SimulationService],
})
export class AIInsightsModule {}
