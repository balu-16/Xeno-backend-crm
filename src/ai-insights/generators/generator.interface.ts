import type { InsightType, SegmentRuleGroup } from "../../contracts";

export type ConfidenceFactor = {
  factor: string;
  weight: number;
  direction: "positive" | "negative";
};

export type GeneratedInsightDetails = Record<string, unknown> & {
  actualRate?: number;
  avgLifetimeValue?: number;
  benchmarkRate?: number;
  criteria?: Record<string, number | string>;
  currentRate?: number;
  customerCount?: number;
  dropPercentage?: number;
  factorBreakdown?: Record<string, { avgScore: number; affectedCount: number }>;
  normalRate?: number;
  stdDev?: number;
  suggestedRules?: SegmentRuleGroup;
  totalRevenue?: number;
};

export type GeneratedInsight = {
  type: InsightType;
  fingerprint: string;
  title: string;
  summary: string;
  details: GeneratedInsightDetails;
  recommendation: string;
  estimatedImpact?: string;
  confidenceScore: number;
  confidenceFactors: ConfidenceFactor[];
  impactScore: number;
  expiresAt: Date;
  correlationId?: string;
};

export interface InsightGenerator {
  readonly name: string;
  generate(): Promise<GeneratedInsight[]>;
}
