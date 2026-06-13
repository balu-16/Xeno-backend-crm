import { Injectable, Logger } from "@nestjs/common";
import type { InsightPriority } from "../contracts";

@Injectable()
export class ScoringService {
  private readonly logger = new Logger(ScoringService.name);

  /**
   * Calculate the combined priority score from impact and confidence.
   * Formula: impactScore * confidenceScore (both in 0..1 range).
   */
  calculatePriorityScore(
    impactScore: number,
    confidenceScore: number,
  ): number {
    const score = impactScore * confidenceScore;
    this.logger.debug(
      `Priority score: ${score.toFixed(3)} (impact=${impactScore.toFixed(3)}, confidence=${confidenceScore.toFixed(3)})`,
    );
    return Math.round(score * 1000) / 1000;
  }

  /**
   * Map a numeric priority score to an InsightPriority label.
   * Thresholds:
   *   >= 0.8  => CRITICAL
   *   >= 0.6  => HIGH
   *   >= 0.4  => MEDIUM
   *   <  0.4  => LOW
   */
  priorityFromScore(score: number): InsightPriority {
    if (score >= 0.8) return "CRITICAL";
    if (score >= 0.6) return "HIGH";
    if (score >= 0.4) return "MEDIUM";
    return "LOW";
  }

  /**
   * Calculate impact score as a ratio of revenue impact to max observed revenue.
   * Capped at 1.0.
   */
  calculateImpactScore(
    revenueImpact: number,
    maxRevenue: number,
  ): number {
    if (maxRevenue <= 0) {
      this.logger.warn("maxRevenue is zero or negative, returning 0 impact");
      return 0;
    }
    const score = Math.min(1.0, revenueImpact / maxRevenue);
    this.logger.debug(
      `Impact score: ${score.toFixed(3)} (revenueImpact=${revenueImpact}, maxRevenue=${maxRevenue})`,
    );
    return Math.round(score * 1000) / 1000;
  }

  /**
   * Calculate confidence score as a weighted average of three factors:
   *   - dataFreshness (weight 0.4): How recent the underlying data is (0..1)
   *   - sampleSize    (weight 0.3): Sufficiency of data points (0..1)
   *   - trendConsistency (weight 0.3): How consistent trends are (0..1)
   *
   * All inputs should be normalised to 0..1 before calling.
   */
  calculateConfidenceScore(
    dataFreshness: number,
    sampleSize: number,
    trendConsistency: number,
  ): number {
    const weights = {
      dataFreshness: 0.4,
      sampleSize: 0.3,
      trendConsistency: 0.3,
    };

    const score =
      dataFreshness * weights.dataFreshness +
      sampleSize * weights.sampleSize +
      trendConsistency * weights.trendConsistency;

    this.logger.debug(
      `Confidence score: ${score.toFixed(3)} (freshness=${dataFreshness.toFixed(3)}, sample=${sampleSize.toFixed(3)}, consistency=${trendConsistency.toFixed(3)})`,
    );

    return Math.round(score * 1000) / 1000;
  }
}
