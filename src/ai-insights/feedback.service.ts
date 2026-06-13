import { Injectable, Logger } from "@nestjs/common";
import { InsightFeedbackRating } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class FeedbackService {
  private readonly logger = new Logger(FeedbackService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Submit feedback for an insight. Handles duplicate (insightId+userId) gracefully
   * by updating the existing record instead of throwing.
   */
  async submit(
    insightId: string,
    userId: string,
    rating: InsightFeedbackRating,
    comment?: string
  ) {
    try {
      const feedback = await this.prisma.aIInsightFeedback.create({
        data: { insightId, userId, rating, comment }
      });
      this.logger.log(`Feedback submitted for insight ${insightId} by user ${userId}`);
      return feedback;
    } catch (error: unknown) {
      // Handle unique constraint violation (duplicate insightId+userId)
      if (
        error instanceof Error &&
        "code" in error &&
        (error as { code: string }).code === "P2002"
      ) {
        this.logger.warn(
          `Duplicate feedback for insight ${insightId} by user ${userId}, updating existing`
        );
        return this.prisma.aIInsightFeedback.update({
          where: {
            insightId_userId: { insightId, userId }
          },
          data: { rating, comment }
        });
      }
      throw error;
    }
  }

  /**
   * List all feedback for a given insight.
   */
  async listByInsight(insightId: string) {
    return this.prisma.aIInsightFeedback.findMany({
      where: { insightId },
      orderBy: { createdAt: "desc" }
    });
  }

  /**
   * Aggregate feedback across all insights to compute usefulRate,
   * notUsefulRate, totalFeedback, and feedback grouped by insight type.
   */
  async analytics() {
    const totalFeedback = await this.prisma.aIInsightFeedback.count();

    if (totalFeedback === 0) {
      return {
        usefulRate: 0,
        notUsefulRate: 0,
        totalFeedback: 0,
        feedbackByType: []
      };
    }

    const [usefulCount, notUsefulCount] = await Promise.all([
      this.prisma.aIInsightFeedback.count({
        where: { rating: InsightFeedbackRating.USEFUL }
      }),
      this.prisma.aIInsightFeedback.count({
        where: { rating: InsightFeedbackRating.NOT_USEFUL }
      })
    ]);

    // Aggregate feedback by insight type
    const feedbackByTypeRaw = await this.prisma.aIInsightFeedback.groupBy({
      by: ["rating"],
      _count: { id: true },
      where: {
        insight: {}
      }
    });

    // Use raw query for grouping by insight type through join
    const feedbackByType = await this.prisma.$queryRaw<
      Array<{
        type: string;
        total: bigint;
        useful: bigint;
        notUseful: bigint;
      }>
    >`
      SELECT
        i.type,
        COUNT(f.id) as total,
        COUNT(CASE WHEN f.rating = 'USEFUL' THEN 1 END) as useful,
        COUNT(CASE WHEN f.rating = 'NOT_USEFUL' THEN 1 END) as "notUseful"
      FROM "AIInsightFeedback" f
      JOIN "AIInsight" i ON i.id = f."insightId"
      GROUP BY i.type
      ORDER BY total DESC
    `;

    return {
      usefulRate: usefulCount / totalFeedback,
      notUsefulRate: notUsefulCount / totalFeedback,
      totalFeedback,
      feedbackByType: feedbackByType.map((row) => ({
        type: row.type,
        total: Number(row.total),
        useful: Number(row.useful),
        notUseful: Number(row.notUseful),
        usefulRate:
          Number(row.total) > 0 ? Number(row.useful) / Number(row.total) : 0
      }))
    };
  }
}
