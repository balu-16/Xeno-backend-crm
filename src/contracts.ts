import { z } from "zod";

export const channelSchema = z.enum(["WHATSAPP", "SMS", "EMAIL", "RCS"]);
export type Channel = z.infer<typeof channelSchema>;

export const campaignStatusSchema = z.enum([
  "DRAFT",
  "QUEUED",
  "RUNNING",
  "PAUSED",
  "COMPLETED",
  "FAILED"
]);
export type CampaignStatus = z.infer<typeof campaignStatusSchema>;

export const campaignEventTypeSchema = z.enum([
  "CampaignCreated",
  "CampaignLaunched",
  "MessageQueued",
  "MessageSent",
  "MessageDelivered",
  "MessageOpened",
  "MessageClicked",
  "MessageConverted",
  "MessageFailed"
]);
export type CampaignEventType = z.infer<typeof campaignEventTypeSchema>;

export const deliveryStatusSchema = z.enum([
  "QUEUED",
  "SENT",
  "DELIVERED",
  "OPENED",
  "CLICKED",
  "CONVERTED",
  "FAILED"
]);
export type DeliveryStatus = z.infer<typeof deliveryStatusSchema>;

export const segmentFieldSchema = z.enum([
  "totalSpent",
  "orderCount",
  "daysSinceLastOrder",
  "city",
  "emailEngagement"
]);
export type SegmentField = z.infer<typeof segmentFieldSchema>;

export const segmentOperatorSchema = z.enum([
  ">",
  ">=",
  "<",
  "<=",
  "=",
  "!=",
  "contains"
]);
export type SegmentOperator = z.infer<typeof segmentOperatorSchema>;

export const segmentConditionSchema = z
  .object({
    field: segmentFieldSchema,
    operator: segmentOperatorSchema,
    value: z.union([z.string().max(200), z.number().finite()])
  })
  .strict()
  .superRefine((condition, context) => {
    const numericFields: SegmentField[] = [
      "totalSpent",
      "orderCount",
      "daysSinceLastOrder",
      "emailEngagement"
    ];
    if (numericFields.includes(condition.field) && typeof condition.value !== "number") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${condition.field} requires a numeric value`,
        path: ["value"]
      });
    }
    if (condition.field === "city" && typeof condition.value !== "string") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "city requires a string value",
        path: ["value"]
      });
    }
    if (condition.operator === "contains" && condition.field !== "city") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "contains is only supported for city",
        path: ["operator"]
      });
    }
  });
export type SegmentCondition = z.infer<typeof segmentConditionSchema>;

export type SegmentRuleGroup = {
  operator: "AND" | "OR";
  conditions: Array<SegmentCondition | SegmentRuleGroup>;
};

const segmentRuleGroupBaseSchema: z.ZodType<SegmentRuleGroup> = z.lazy(() =>
  z
    .object({
      operator: z.enum(["AND", "OR"]),
      conditions: z
        .array(z.union([segmentConditionSchema, segmentRuleGroupBaseSchema]))
        .min(1)
        .max(12)
    })
    .strict()
);

function ruleDepth(group: SegmentRuleGroup): number {
  return (
    1 +
    Math.max(
      0,
      ...group.conditions.map((condition) =>
        "conditions" in condition ? ruleDepth(condition) : 0
      )
    )
  );
}

export const segmentRuleGroupSchema = segmentRuleGroupBaseSchema.superRefine(
  (group, context) => {
    if (ruleDepth(group) > 3) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Segment rules may be nested at most three levels"
      });
    }
  }
);

export const paginationQuerySchema = z.object({
  cursor: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(120).optional()
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export const campaignDispatchJobSchema = z.object({
  campaignId: z.string().uuid(),
  customerId: z.string().uuid(),
  channel: channelSchema,
  destination: z.string().min(1),
  subject: z.string().max(200).nullable(),
  message: z.string().min(1).max(5000),
  correlationId: z.string().uuid()
});
export type CampaignDispatchJob = z.infer<typeof campaignDispatchJobSchema>;

export const receiptJobSchema = z.object({
  receiptId: z.string().uuid(),
  eventId: z.string().uuid(),
  type: campaignEventTypeSchema,
  occurredAt: z.string().datetime(),
  campaignId: z.string().uuid(),
  customerId: z.string().uuid(),
  correlationId: z.string().uuid(),
  payload: z.record(z.unknown()).default({})
});
export type ReceiptJob = z.infer<typeof receiptJobSchema>;

export const channelWebhookSchema = receiptJobSchema.omit({ receiptId: true });
export type ChannelWebhook = z.infer<typeof channelWebhookSchema>;

export type ApiSuccess<T> = {
  success: true;
  data: T;
  meta?: Record<string, unknown>;
  requestId: string;
};

export type ApiFailure = {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  requestId: string;
};

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export type DashboardMetrics = {
  totalCustomers: number;
  totalOrders: number;
  totalRevenue: number;
  activeCampaigns: number;
  deliveryRate: number;
  openRate: number;
  clickRate: number;
  conversionRate: number;
  campaignPerformance: Array<{ date: string; sent: number; converted: number }>;
  revenueTrends: Array<{ date: string; revenue: number }>;
  channelPerformance: Array<{ channel: Channel; rate: number }>;
  segmentPerformance: Array<{ segment: string; conversions: number }>;
  activity: Array<{
    id: string;
    kind: "campaign" | "conversion" | "ai" | "segment";
    title: string;
    occurredAt: string;
  }>;
  generatedAt: string;
};

export type CampaignPerformance = {
  campaignId: string;
  name: string;
  status: CampaignStatus;
  totalAudience: number;
  funnel: {
    sent: number;
    delivered: number;
    opened: number;
    clicked: number;
    converted: number;
    failed: number;
  };
  rates: {
    delivery: number;
    open: number;
    click: number;
    conversion: number;
  };
  revenue: number;
  failures: Array<{ reason: string; count: number }>;
  updatedAt: string;
};

export const aiToolNameSchema = z.enum([
  "getCustomers",
  "getCustomerById",
  "getCustomerByEmail",
  "createCustomer",
  "updateCustomer",
  "deleteCustomer",
  "getSegments",
  "getSegment",
  "createSegment",
  "updateSegment",
  "deleteSegment",
  "getSegmentCustomerCount",
  "getCampaigns",
  "getCampaign",
  "createCampaign",
  "launchCampaign",
  "pauseCampaign",
  "deleteCampaign",
  "getCampaignAnalytics",
  "getSegmentAnalytics",
  "getRevenueAnalytics",
  "getDeliveryAnalytics",
  "retryCampaign",
  "simulateDelivery",
  "getDashboardMetrics",
  "getCampaignPerformance",
  "generateSegmentRules",
  "generateCampaignMessage",
  "recommendAudience",
  "diagnoseCampaignFailure",
  "listSegments",
  "listCampaigns",
  "getCustomerStats",
  "getBestSendTime",
  "suggestABTest",
  "getInsights"
]);
export type AIToolName = z.infer<typeof aiToolNameSchema>;

// ─── AI Insights ─────────────────────────────────────────

export const insightTypeSchema = z.enum([
  "REVENUE", "CUSTOMER", "CAMPAIGN", "SEGMENT", "CHURN",
  "DELIVERY", "CONVERSION", "OPPORTUNITY", "ANOMALY", "PREDICTION",
]);
export type InsightType = z.infer<typeof insightTypeSchema>;

export const insightPrioritySchema = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
export type InsightPriority = z.infer<typeof insightPrioritySchema>;

export const insightStatusSchema = z.enum(["ACTIVE", "DISMISSED", "COMPLETED", "EXPIRED", "ACTIONED"]);
export type InsightStatus = z.infer<typeof insightStatusSchema>;

export const insightActionTypeSchema = z.enum([
  "GENERATE_SEGMENT", "CREATE_CAMPAIGN", "LAUNCH_CAMPAIGN",
  "SEND_RETENTION_OFFER", "EXPORT_CSV", "VIEW_DETAILS",
]);
export type InsightActionType = z.infer<typeof insightActionTypeSchema>;

export const insightActionStatusSchema = z.enum(["GENERATED", "CLICKED", "EXECUTED", "FAILED"]);
export type InsightActionStatus = z.infer<typeof insightActionStatusSchema>;

export const insightFeedbackRatingSchema = z.enum(["USEFUL", "NOT_USEFUL"]);
export type InsightFeedbackRating = z.infer<typeof insightFeedbackRatingSchema>;

export const listInsightsQuerySchema = z.object({
  type: insightTypeSchema.optional(),
  priority: insightPrioritySchema.optional(),
  status: insightStatusSchema.default("ACTIVE"),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
}).strict();
export type ListInsightsQuery = z.infer<typeof listInsightsQuerySchema>;

export const listInsightsToolSchema = z.object({
  type: insightTypeSchema.optional(),
  priority: insightPrioritySchema.optional(),
  limit: z.number().int().min(1).max(50).default(10),
});

export type ConfidenceFactor = {
  factor: string;
  weight: number;
  direction: "positive" | "negative";
};

export type InsightActionView = {
  id: string;
  insightId: string;
  type: InsightActionType;
  label: string;
  description: string | null;
  status: InsightActionStatus;
  metadata: Record<string, unknown> | null;
  executedResult: Record<string, unknown> | null;
  clickedAt: string | null;
  executedAt: string | null;
  createdAt: string;
};

export type InsightOutcomeView = {
  id: string;
  insightId: string;
  predictedImpact: string;
  actualImpact: string | null;
  predictedValue: number | null;
  actualValue: number | null;
  accuracy: number | null;
  actionTaken: string;
  measuredAt: string;
  createdAt: string;
};

export type AIInsightView = {
  id: string;
  type: InsightType;
  priority: InsightPriority;
  fingerprint: string;
  title: string;
  summary: string;
  details: Record<string, unknown>;
  recommendation: string;
  estimatedImpact: string | null;
  confidenceScore: number;
  confidenceFactors: ConfidenceFactor[] | null;
  impactScore: number;
  priorityScore: number;
  status: InsightStatus;
  correlationId: string | null;
  generatedAt: string;
  expiresAt: string;
  createdAt: string;
  actions?: InsightActionView[];
  outcomes?: InsightOutcomeView[];
  feedback?: Array<{ rating: string; comment: string | null }>;
};

export type ExecutiveScoreView = {
  overallScore: number;
  revenueScore: number;
  engagementScore: number;
  churnScore: number;
  deliveryScore: number;
  campaignScore: number;
  trend: "improving" | "stable" | "declining";
  factors: Record<string, unknown>;
  generatedAt: string;
};

export type InsightCorrelationView = {
  id: string;
  title: string;
  summary: string;
  insightIds: string[];
  rootCause: string;
  recommendation: string;
  score: number;
  generatedAt: string;
  expiresAt: string;
};

export type DriftMetricsView = {
  type: InsightType;
  fingerprintPattern: string;
  totalGenerated: number;
  totalActioned: number;
  totalDismissed: number;
  actionRate: number;
  dismissRate: number;
  usefulRate: number;
  driftScore: number;
};

export type CampaignSimulationView = {
  expectedReach: number;
  expectedOpenRate: number;
  expectedClickRate: number;
  expectedConversionRate: number;
  expectedRevenue: number;
  expectedCost: number;
  expectedROI: number;
  confidence: number;
  basedOn: string;
};

export type ExecutiveSummaryView = {
  revenue: { change: number; trend: "up" | "down" | "flat" };
  customerGrowth: { change: number; trend: "up" | "down" | "flat" };
  campaignPerformance: { change: number; trend: "up" | "down" | "flat" };
  executiveScore: ExecutiveScoreView;
  risks: Array<{ title: string; severity: string }>;
  recommendedActions: Array<{ title: string; insightId: string }>;
  generatedAt: string;
};
