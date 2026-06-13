import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard, type AuthenticatedRequest } from "../auth/auth.guard";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { listInsightsQuerySchema, insightFeedbackRatingSchema } from "../contracts";
import { AIInsightsService } from "./ai-insights.service";
import { ActionService } from "./action.service";
import { FeedbackService } from "./feedback.service";
import { SimulationService } from "./simulation.service";
import { ExecutiveScoreService } from "./executive-score.service";
import { CorrelationService } from "./correlation.service";
import { DriftService } from "./drift.service";

@Controller("insights")
@UseGuards(AuthGuard, RolesGuard)
export class AIInsightsController {
  constructor(
    private readonly insights: AIInsightsService,
    private readonly actions: ActionService,
    private readonly feedback: FeedbackService,
    private readonly simulation: SimulationService,
    private readonly executiveScore: ExecutiveScoreService,
    private readonly correlation: CorrelationService,
    private readonly drift: DriftService,
  ) {}

  @Get("status")
  status() {
    return this.insights.getStatus();
  }

  @Get()
  list(@Query() raw: Record<string, unknown>) {
    const query = listInsightsQuerySchema.parse(raw);
    return this.insights.list(query);
  }

  @Get("summary")
  executiveSummary() {
    return this.insights.executiveSummary();
  }

  @Get("executive-score")
  getExecutiveScore() {
    return this.executiveScore.getCurrent();
  }

  @Get("executive-score/history")
  getHistory(@Query("days") rawDays?: string) {
    const days = rawDays ? Number(rawDays) : 30;
    return this.executiveScore.getHistory(days);
  }

  @Get("correlations")
  listCorrelations() {
    return this.correlation.listActive();
  }

  @Get("correlations/:id")
  getCorrelation(@Param("id") id: string) {
    return this.correlation.get(id);
  }

  @Get("feedback/analytics")
  @Roles("ADMIN")
  feedbackAnalytics() {
    return this.feedback.analytics();
  }

  @Get("drift")
  @Roles("ADMIN")
  getDriftMetrics() {
    return this.drift.getMetrics();
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.insights.get(id);
  }

  @Patch(":id/dismiss")
  dismiss(@Param("id") id: string) {
    return this.insights.dismiss(id);
  }

  @Patch(":id/complete")
  complete(@Param("id") id: string) {
    return this.insights.complete(id);
  }

  @Post("refresh")
  triggerRefresh() {
    return this.insights.triggerRefresh();
  }

  @Get(":id/actions")
  listActions(@Param("id") id: string) {
    return this.actions.listByInsight(id);
  }

  @Post("actions/:actionId/execute")
  executeAction(
    @Param("actionId") actionId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.actions.executeAction(actionId, req.user.id);
  }

  @Post(":id/feedback")
  submitFeedback(
    @Param("id") id: string,
    @Req() req: AuthenticatedRequest,
    @Body() body: { rating: string; comment?: string },
  ) {
    const rating = insightFeedbackRatingSchema.parse(body.rating);
    return this.feedback.submit(id, req.user.id, rating, body.comment);
  }

  @Post(":id/simulate")
  simulate(
    @Param("id") id: string,
    @Body() body: { segmentId: string; channel: string },
  ) {
    return this.simulation.simulateCampaign(
      id,
      body.segmentId,
      body.channel as any,
    );
  }
}
