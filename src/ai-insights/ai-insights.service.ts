import { Injectable, Logger } from "@nestjs/common";
import { InsightStoreService } from "./insight-store.service";
import type {
  ListInsightsQuery,
  AIInsightView,
  ExecutiveSummaryView,
} from "../contracts";
import { RevenueGenerator } from "./generators/revenue.generator";
import { CustomerGenerator } from "./generators/customer.generator";
import { CampaignGenerator } from "./generators/campaign.generator";
import { SegmentGenerator } from "./generators/segment.generator";
import { ChurnGenerator } from "./generators/churn.generator";
import { AnomalyGenerator } from "./generators/anomaly.generator";

const GENERATOR_INTERVAL_MINUTES = 60; // Run every 1 hour

const SCHEDULE_INTERVALS: Array<{
  generator: string;
  minutes: number;
}> = [
  { generator: "revenue", minutes: GENERATOR_INTERVAL_MINUTES },
  { generator: "customer", minutes: GENERATOR_INTERVAL_MINUTES },
  { generator: "campaign", minutes: GENERATOR_INTERVAL_MINUTES },
  { generator: "segment", minutes: GENERATOR_INTERVAL_MINUTES },
  { generator: "churn", minutes: GENERATOR_INTERVAL_MINUTES },
  { generator: "anomaly", minutes: GENERATOR_INTERVAL_MINUTES },
];

export interface InsightGenerationStatus {
  isGenerating: boolean;
  lastRunAt: string | null;
  lastRunGenerated: number;
  nextRunAt: string | null;
}

@Injectable()
export class AIInsightsService {
  private readonly logger = new Logger(AIInsightsService.name);

  private isGenerating = false;
  private lastRunAt: Date | null = null;
  private lastRunGenerated = 0;
  private nextRunAt: Date | null = null;

  constructor(
    private readonly store: InsightStoreService,
    private readonly revenueGenerator: RevenueGenerator,
    private readonly customerGenerator: CustomerGenerator,
    private readonly campaignGenerator: CampaignGenerator,
    private readonly segmentGenerator: SegmentGenerator,
    private readonly churnGenerator: ChurnGenerator,
    private readonly anomalyGenerator: AnomalyGenerator,
  ) {}

  onModuleInit(): void {
    // Run all generators immediately on startup (non-blocking)
    this.logger.log("Running initial insight generation on startup...");
    void this.runAllGenerators("startup");

    // Schedule recurring runs
    const intervalMs = GENERATOR_INTERVAL_MINUTES * 60 * 1000;
    this.nextRunAt = new Date(Date.now() + intervalMs);

    setInterval(() => {
      this.nextRunAt = new Date(Date.now() + intervalMs);
      void this.runAllGenerators("scheduled");
    }, intervalMs);

    this.logger.log(
      `Scheduled insight generators every ${GENERATOR_INTERVAL_MINUTES}m`,
    );
  }

  getStatus(): InsightGenerationStatus {
    return {
      isGenerating: this.isGenerating,
      lastRunAt: this.lastRunAt?.toISOString() ?? null,
      lastRunGenerated: this.lastRunGenerated,
      nextRunAt: this.nextRunAt?.toISOString() ?? null,
    };
  }

  private async runAllGenerators(trigger: string): Promise<void> {
    if (this.isGenerating) {
      this.logger.warn(`Skipping ${trigger} run — already generating`);
      return;
    }

    this.isGenerating = true;
    const startTime = Date.now();
    this.logger.log(`Starting ${trigger} insight generation`);

    let totalGenerated = 0;

    for (const { generator } of SCHEDULE_INTERVALS) {
      try {
        const generators = this.getGenerators(generator);
        for (const gen of generators) {
          const insights = await gen.generate();
          for (const insight of insights) {
            await this.store.upsert(insight);
          }
          totalGenerated += insights.length;
          this.logger.log(
            `${trigger}: ${gen.name} produced ${insights.length} insights`,
          );
        }
      } catch (error) {
        this.logger.error(
          `${trigger}: Generator "${generator}" failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    this.lastRunAt = new Date();
    this.lastRunGenerated = totalGenerated;
    this.isGenerating = false;

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    this.logger.log(
      `${trigger} generation complete — ${totalGenerated} insights in ${elapsed}s`,
    );
  }

  private getGenerators(generator: string) {
    switch (generator) {
      case "revenue":
        return [this.revenueGenerator];
      case "customer":
        return [this.customerGenerator];
      case "campaign":
        return [this.campaignGenerator];
      case "segment":
        return [this.segmentGenerator];
      case "churn":
        return [this.churnGenerator];
      case "anomaly":
        return [this.anomalyGenerator];
      default:
        return [];
    }
  }

  async list(query: ListInsightsQuery) {
    return this.store.list(query);
  }

  async get(id: string): Promise<AIInsightView> {
    return this.store.get(id);
  }

  async dismiss(id: string): Promise<AIInsightView> {
    return this.store.dismiss(id);
  }

  async complete(id: string): Promise<AIInsightView> {
    return this.store.complete(id);
  }

  async executiveSummary(): Promise<ExecutiveSummaryView> {
    return this.store.executiveSummary();
  }

  async triggerRefresh(): Promise<{ generated: number }> {
    if (this.isGenerating) {
      return { generated: 0 };
    }

    // Run in background, don't await
    void this.runAllGenerators("manual").then(() => {
      // Update next run time after manual refresh
      const intervalMs = GENERATOR_INTERVAL_MINUTES * 60 * 1000;
      this.nextRunAt = new Date(Date.now() + intervalMs);
    });

    return { generated: -1 }; // -1 means "running in background"
  }
}
