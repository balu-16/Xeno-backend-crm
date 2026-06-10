import { z } from "zod";

export const channelSchema = z.enum(["WHATSAPP", "SMS", "EMAIL", "RCS"]);
export type Channel = z.infer<typeof channelSchema>;

export const campaignStatusSchema = z.enum([
  "DRAFT",
  "QUEUED",
  "RUNNING",
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

export const analyticsRefreshJobSchema = z.object({
  campaignId: z.string().uuid(),
  correlationId: z.string().uuid()
});
export type AnalyticsRefreshJob = z.infer<typeof analyticsRefreshJobSchema>;

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
  "getDashboardMetrics",
  "getCampaignPerformance",
  "generateSegmentRules",
  "generateCampaignMessage",
  "recommendAudience",
  "diagnoseCampaignFailure",
  "listSegments",
  "listCampaigns",
  "getCustomerStats"
]);
export type AIToolName = z.infer<typeof aiToolNameSchema>;

export const queueNames = {
  campaignDispatch: "campaign-dispatch",
  receiptProcessing: "receipt-processing",
  analyticsRefresh: "analytics-refresh"
} as const;
