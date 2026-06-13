import { Injectable, Logger } from "@nestjs/common";
import type { ConfidenceFactor } from "../contracts";

@Injectable()
export class ConfidenceService {
  private readonly logger = new Logger(ConfidenceService.name);

  explainConfidence(insight: {
    confidenceScore: number;
    confidenceFactors: ConfidenceFactor[] | null;
    type: string;
    details: Record<string, unknown>;
  }): {
    score: number;
    level: string;
    factors: ConfidenceFactor[];
    explanation: string;
  } {
    const factors = insight.confidenceFactors ?? [];
    const score = insight.confidenceScore;

    const level =
      score >= 0.8
        ? "HIGH"
        : score >= 0.6
          ? "MEDIUM"
          : score >= 0.4
            ? "LOW"
            : "VERY_LOW";

    const factorSummaries = factors.map((f) => {
      const impact = f.direction === "positive" ? "increases" : "decreases";
      const pct = Math.round(f.weight * 100);
      return `${f.factor} (${impact} confidence by ${pct}%)`;
    });

    const explanation =
      factors.length > 0
        ? `This ${insight.type} insight has ${level.toLowerCase()} confidence (${Math.round(score * 100)}%). Key factors: ${factorSummaries.join("; ")}.`
        : `This ${insight.type} insight has ${level.toLowerCase()} confidence (${Math.round(score * 100)}%). No detailed factors available.`;

    this.logger.debug(
      `Explained confidence for insight: score=${score}, level=${level}, factors=${factors.length}`
    );

    return { score, level, factors, explanation };
  }

  buildFactors(
    dataFreshness: number,
    sampleSize: number,
    trendConsistency: number,
    historicalAccuracy: number
  ): ConfidenceFactor[] {
    const raw = [
      { factor: "data_freshness", weight: dataFreshness },
      { factor: "sample_size", weight: sampleSize },
      { factor: "trend_consistency", weight: trendConsistency },
      { factor: "historical_accuracy", weight: historicalAccuracy },
    ];

    const total = raw.reduce((sum, f) => sum + f.weight, 0);
    if (total === 0) {
      this.logger.warn(
        "All factor weights are zero, returning equal distribution"
      );
      const equal = 1 / raw.length;
      return raw.map((f) => ({
        factor: f.factor,
        weight: Math.round(equal * 100) / 100,
        direction: "positive" as const,
      }));
    }

    const factors: ConfidenceFactor[] = raw.map((f) => {
      const normalized = Math.round((f.weight / total) * 100) / 100;
      return {
        factor: f.factor,
        weight: normalized,
        direction: normalized >= 0.5 ? ("positive" as const) : ("negative" as const),
      };
    });

    // Adjust rounding so weights sum to exactly 1.0
    const sum = factors.reduce((s, f) => s + f.weight, 0);
    const diff = Math.round((1 - sum) * 100) / 100;
    if (diff !== 0 && factors.length > 0) {
      const last = factors[factors.length - 1]!;
      last.weight = Math.round((last.weight + diff) * 100) / 100;
    }

    this.logger.debug(
      `Built confidence factors: ${factors
        .map((f) => `${f.factor}=${f.weight}`)
        .join(", ")}`
    );

    return factors;
  }
}
