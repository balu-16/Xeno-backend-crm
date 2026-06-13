import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class OutcomeService {
  private readonly logger = new Logger(OutcomeService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(outcome: {
    insightId: string;
    predictedImpact: string;
    predictedValue?: number;
    actionTaken: string;
    measuredAt?: Date;
  }) {
    const insight = await this.prisma.aIInsight.findUnique({
      where: { id: outcome.insightId },
    });
    if (!insight) {
      throw new NotFoundException("Insight not found");
    }

    const created = await this.prisma.aIInsightOutcome.create({
      data: {
        insightId: outcome.insightId,
        predictedImpact: outcome.predictedImpact,
        predictedValue: outcome.predictedValue ?? null,
        actionTaken: outcome.actionTaken,
        measuredAt: outcome.measuredAt ?? new Date(),
      },
    });

    this.logger.log(
      `Created outcome ${created.id} for insight ${outcome.insightId}`
    );
    return created;
  }

  async listByInsight(insightId: string) {
    return this.prisma.aIInsightOutcome.findMany({
      where: { insightId },
      orderBy: { measuredAt: "desc" },
    });
  }

  calculateAccuracy(predicted: number, actual: number): number {
    if (predicted === 0 && actual === 0) {
      return 1;
    }
    if (predicted === 0 || actual === 0) {
      return 0;
    }
    const diff = Math.abs(predicted - actual);
    const maxVal = Math.max(Math.abs(predicted), Math.abs(actual));
    const accuracy = Math.max(0, 1 - diff / maxVal);
    return Math.round(accuracy * 100) / 100;
  }

  async getAccuracyStats(insightId: string) {
    const outcomes = await this.prisma.aIInsightOutcome.findMany({
      where: {
        insightId,
        accuracy: { not: null },
      },
    });

    if (outcomes.length === 0) {
      return {
        insightId,
        totalOutcomes: 0,
        measuredOutcomes: 0,
        averageAccuracy: null,
        minAccuracy: null,
        maxAccuracy: null,
      };
    }

    const accuracies = outcomes.map((o) => o.accuracy!);
    const sum = accuracies.reduce((s, a) => s + a, 0);

    return {
      insightId,
      totalOutcomes: outcomes.length,
      measuredOutcomes: outcomes.length,
      averageAccuracy: Math.round((sum / accuracies.length) * 100) / 100,
      minAccuracy: Math.min(...accuracies),
      maxAccuracy: Math.max(...accuracies),
    };
  }

  async measureOutcome(
    outcomeId: string,
    actualImpact: string,
    actualValue: number
  ) {
    const outcome = await this.prisma.aIInsightOutcome.findUnique({
      where: { id: outcomeId },
    });
    if (!outcome) {
      throw new NotFoundException("Outcome not found");
    }

    const accuracy =
      outcome.predictedValue !== null
        ? this.calculateAccuracy(outcome.predictedValue, actualValue)
        : null;

    const updated = await this.prisma.aIInsightOutcome.update({
      where: { id: outcomeId },
      data: {
        actualImpact,
        actualValue,
        accuracy,
      },
    });

    this.logger.log(
      `Measured outcome ${outcomeId}: actualValue=${actualValue}, accuracy=${accuracy}`
    );
    return updated;
  }
}
