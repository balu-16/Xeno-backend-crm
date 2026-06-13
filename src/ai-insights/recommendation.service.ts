import { Injectable, Logger } from "@nestjs/common";
import type { InsightType } from "../contracts";

@Injectable()
export class RecommendationService {
  private readonly logger = new Logger(RecommendationService.name);

  /**
   * Generate a human-readable recommendation string based on insight type
   * and the associated details object. Uses a template-based approach.
   */
  generate(type: InsightType, details: Record<string, unknown>): string {
    let recommendation: string;

    switch (type) {
      case "REVENUE":
        recommendation = this.buildRevenueRecommendation(details);
        break;
      case "CUSTOMER":
        recommendation = this.buildCustomerRecommendation(details);
        break;
      case "CAMPAIGN":
        recommendation = this.buildCampaignRecommendation(details);
        break;
      case "SEGMENT":
        recommendation = this.buildSegmentRecommendation(details);
        break;
      case "CHURN":
        recommendation = this.buildChurnRecommendation(details);
        break;
      case "DELIVERY":
        recommendation = this.buildDeliveryRecommendation(details);
        break;
      case "CONVERSION":
        recommendation = this.buildConversionRecommendation(details);
        break;
      case "OPPORTUNITY":
        recommendation = this.buildOpportunityRecommendation(details);
        break;
      case "ANOMALY":
        recommendation = this.buildAnomalyRecommendation(details);
        break;
      case "PREDICTION":
        recommendation = this.buildPredictionRecommendation(details);
        break;
      default:
        recommendation = this.buildGenericRecommendation(details);
        break;
    }

    this.logger.debug(
      `Generated ${type} recommendation: ${recommendation.slice(0, 80)}...`,
    );
    return recommendation;
  }

  // ── Type-specific builders ────────────────────────────────────────────

  private buildRevenueRecommendation(
    details: Record<string, unknown>,
  ): string {
    const change = this.num(details.change);
    const metric = this.str(details.metric, "revenue");
    const period = this.str(details.period, "the recent period");

    if (change > 10) {
      return `${metric} grew by ${change}% during ${period}. Consider doubling down on the campaigns and segments driving this growth to sustain momentum.`;
    }
    if (change > 0) {
      return `${metric} increased modestly by ${change}% during ${period}. Review top-performing segments and reallocate budget towards high-ROI channels.`;
    }
    if (change < -10) {
      return `${metric} declined by ${Math.abs(change)}% during ${period}. Investigate root causes such as reduced engagement, increased churn, or market shifts, and consider launching a re-engagement campaign.`;
    }
    if (change < 0) {
      return `${metric} dipped slightly by ${Math.abs(change)}% during ${period}. Monitor closely and test targeted offers to arrest the downward trend.`;
    }
    return `${metric} remained flat during ${period}. Explore new segments or channels to unlock incremental growth.`;
  }

  private buildCustomerRecommendation(
    details: Record<string, unknown>,
  ): string {
    const trend = this.str(details.trend, "stable");
    const segment = this.str(details.segment, "your customer base");
    const churnRate = this.num(details.churnRate);

    if (trend === "growing") {
      return `Your ${segment} is expanding. Focus on onboarding quality by setting up welcome sequences and early-engagement campaigns to convert new customers into repeat buyers.`;
    }
    if (trend === "declining" || churnRate > 5) {
      return `Your ${segment} is shrinking (${churnRate}% churn detected). Launch a targeted retention campaign with personalised offers for at-risk customers identified in the CHURN insights.`;
    }
    return `Your ${segment} is stable. Analyse purchase patterns to identify upsell and cross-sell opportunities within existing cohorts.`;
  }

  private buildCampaignRecommendation(
    details: Record<string, unknown>,
  ): string {
    const openRate = this.num(details.openRate);
    const clickRate = this.num(details.clickRate);
    const conversionRate = this.num(details.conversionRate);
    const campaignName = this.str(details.campaignName, "The campaign");

    if (openRate < 15) {
      return `${campaignName} has a low open rate (${openRate}%). Test alternative subject lines, send times, or audience segmentation to improve visibility.`;
    }
    if (clickRate < 2) {
      return `${campaignName} opens well (${openRate}%) but click-through is low (${clickRate}%). Revamp the call-to-action, improve message personalisation, or test shorter content.`;
    }
    if (conversionRate < 1) {
      return `${campaignName} drives clicks (${clickRate}%) but conversions lag (${conversionRate}%). Review the landing experience, offer relevance, and checkout flow for friction.`;
    }
    return `${campaignName} is performing well (open ${openRate}%, click ${clickRate}%, conversion ${conversionRate}%). Consider scaling this approach to similar segments.`;
  }

  private buildSegmentRecommendation(
    details: Record<string, unknown>,
  ): string {
    const segmentName = this.str(details.segmentName, "The segment");
    const size = this.num(details.size);
    const avgOrderValue = this.num(details.avgOrderValue);

    if (size > 1000 && avgOrderValue > 500) {
      return `${segmentName} (${size} customers, avg order ${avgOrderValue}) is a high-value audience. Prioritise exclusive campaigns, loyalty rewards, and early access offers for this group.`;
    }
    if (size > 500) {
      return `${segmentName} has ${size} customers. Test tailored messaging and promotional strategies to increase engagement and average order value.`;
    }
    return `${segmentName} is a niche group (${size} customers). Use personalised, high-touch communication to maximise per-customer value.`;
  }

  private buildChurnRecommendation(details: Record<string, unknown>): string {
    const riskLevel = this.str(details.riskLevel, "medium");
    const atRiskCount = this.num(details.atRiskCount);
    const daysSinceLastOrder = this.num(details.daysSinceLastOrder);

    if (riskLevel === "high" || atRiskCount > 500) {
      return `${atRiskCount} customers are at high churn risk (${daysSinceLastOrder}+ days inactive). Immediately launch a win-back campaign with compelling incentives — time-limited discounts, loyalty bonuses, or personalised product recommendations.`;
    }
    if (riskLevel === "medium" || atRiskCount > 100) {
      return `${atRiskCount} customers show moderate churn signals. Schedule a re-engagement sequence with relevant content and a gentle nudge offer before they lapse completely.`;
    }
    return `Churn risk is low among ${atRiskCount} flagged customers. Maintain engagement through regular value-add communications and monitor for early warning signals.`;
  }

  private buildDeliveryRecommendation(
    details: Record<string, unknown>,
  ): string {
    const deliveryRate = this.num(details.deliveryRate);
    const channel = this.str(details.channel, "your primary channel");
    const failureReason = this.str(details.failureReason);

    if (deliveryRate < 80) {
      return `${channel} delivery rate is critically low (${deliveryRate}%). ${failureReason ? `Primary failure: ${failureReason}. ` : ""}Audit your contact list hygiene, check sender reputation, and verify integration health before the next campaign.`;
    }
    if (deliveryRate < 95) {
      return `${channel} delivery rate is ${deliveryRate}%, below the 95% target. Review bounced addresses, clean invalid contacts, and investigate provider-level throttling.`;
    }
    return `${channel} delivery is healthy at ${deliveryRate}%. Continue monitoring and maintain list hygiene to sustain this performance.`;
  }

  private buildConversionRecommendation(
    details: Record<string, unknown>,
  ): string {
    const conversionRate = this.num(details.conversionRate);
    const funnel = this.str(details.funnelStage, "unknown");
    const revenue = this.num(details.revenue);

    if (conversionRate < 1) {
      return `Conversion rate is ${conversionRate}% (drop-off at ${funnel} stage). Review the user journey for friction points — simplify forms, improve page load speed, and ensure offer clarity. Potential revenue recovery: ${revenue}.`;
    }
    if (conversionRate < 3) {
      return `Conversion rate is ${conversionRate}%. A/B test landing pages, call-to-action placement, and offer structures to move the needle. Current funnel bottleneck: ${funnel}.`;
    }
    return `Conversion rate is strong at ${conversionRate}% (funnel stage: ${funnel}). Document what is working and replicate this approach across similar campaigns.`;
  }

  private buildOpportunityRecommendation(
    details: Record<string, unknown>,
  ): string {
    const opportunityType = this.str(details.opportunityType, "growth");
    const estimatedValue = this.num(details.estimatedValue);
    const segment = this.str(details.segment, "target customers");

    if (opportunityType === "upsell") {
      return `Upsell opportunity worth ~${estimatedValue} identified with ${segment}. Create a targeted campaign showcasing premium products or bundles based on their purchase history.`;
    }
    if (opportunityType === "cross-sell") {
      return `Cross-sell opportunity worth ~${estimatedValue} detected for ${segment}. Recommend complementary products through personalised messaging at the right moment in the customer journey.`;
    }
    return `A ${opportunityType} opportunity worth ~${estimatedValue} exists for ${segment}. Prioritise this segment in your next campaign cycle to capture the value before the window closes.`;
  }

  private buildAnomalyRecommendation(
    details: Record<string, unknown>,
  ): string {
    const metric = this.str(details.metric, "a key metric");
    const deviation = this.num(details.deviation);
    const direction = this.str(details.direction, "unexpected");

    if (direction === "spike") {
      return `${metric} spiked by ${deviation}% unexpectedly. Investigate whether this is driven by a successful campaign, viral event, or data error — then capitalise if genuine.`;
    }
    if (direction === "drop") {
      return `${metric} dropped by ${Math.abs(deviation)}% unexpectedly. Urgently check for technical issues, campaign failures, or external factors, and take corrective action.`;
    }
    return `An anomaly of ${deviation}% was detected in ${metric}. Review the underlying data and contributing factors to determine if action is required.`;
  }

  private buildPredictionRecommendation(
    details: Record<string, unknown>,
  ): string {
    const metric = this.str(details.metric, "the predicted metric");
    const predictedValue = this.num(details.predictedValue);
    const confidence = this.num(details.confidence);
    const timeframe = this.str(details.timeframe, "the forecast period");

    if (confidence > 0.8) {
      return `${metric} is predicted to reach ${predictedValue} during ${timeframe} (${Math.round(confidence * 100)}% confidence). Proactively plan capacity, inventory, or campaigns to match the expected demand.`;
    }
    if (confidence > 0.5) {
      return `${metric} may reach ${predictedValue} during ${timeframe} (${Math.round(confidence * 100)}% confidence). Monitor leading indicators closely and prepare contingency plans.`;
    }
    return `${metric} forecast for ${timeframe} is uncertain (${Math.round(confidence * 100)}% confidence, predicted ${predictedValue}). Gather more data points and revisit the forecast as signals become clearer.`;
  }

  private buildGenericRecommendation(
    details: Record<string, unknown>,
  ): string {
    const summary = this.str(details.summary, "Review the insight details");
    return `${summary}. Analyse the underlying data and take appropriate action based on your current business priorities.`;
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  private num(value: unknown): number {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = parseFloat(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    return 0;
  }

  private str(value: unknown, fallback = ""): string {
    if (typeof value === "string" && value.length > 0) return value;
    return fallback;
  }
}
