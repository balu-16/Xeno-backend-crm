import { Injectable, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import {
  campaignStatusSchema,
  channelSchema,
  insightPrioritySchema,
  insightTypeSchema,
  listInsightsToolSchema,
  paginationQuerySchema,
  segmentRuleGroupSchema,
  type AIToolName,
  type SegmentRuleGroup
} from "../contracts";
import { AnalyticsService } from "../analytics/analytics.service";
import { CampaignsService } from "../campaigns/campaigns.service";
import { CustomersService } from "../customers/customers.service";
import { AIProviderService } from "./ai-provider.service";
import { PrismaService } from "../prisma/prisma.service";
import { SegmentCompilerService } from "../segments/segment-compiler.service";
import { SegmentsService } from "../segments/segments.service";
import { InsightStoreService } from "../ai-insights/insight-store.service";

export type JsonSchema = Record<string, unknown>;

export type ToolResult = {
  tool: AIToolName;
  input: Record<string, unknown>;
  output: unknown;
  sources: string[];
};

export type AIToolDefinition = {
  name: AIToolName;
  description: string;
  inputSchema: JsonSchema;
  requiresConfirmation: boolean;
  validate(input: unknown): Record<string, unknown>;
  execute(input: Record<string, unknown>): Promise<ToolResult>;
};

const emptySchema = z.object({}).strict();
const idSchema = z.object({ id: z.string().uuid() }).strict();
const campaignIdSchema = z.object({ campaignId: z.string().uuid() }).strict();
const customerListSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(120).optional(),
  tag: z.string().trim().max(80).optional()
}).strict();
const createCustomerSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().email(),
  phone: z.string().min(5).max(20),
  tags: z.array(z.string().min(1).max(80)).optional(),
  metadata: z.record(z.unknown()).optional()
}).strict();
const updateCustomerSchema = createCustomerSchema.partial().extend({
  id: z.string().uuid()
}).strict();
const segmentListSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  search: z.string().trim().max(120).optional()
}).strict();
const createSegmentSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).optional(),
  rules: segmentRuleGroupSchema
}).strict();
const updateSegmentSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(2).max(120).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  rules: segmentRuleGroupSchema.optional()
}).strict();
const campaignListSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  search: z.string().trim().max(120).optional(),
  status: campaignStatusSchema.optional(),
  channel: channelSchema.optional()
}).strict();
const createCampaignSchema = z.object({
  name: z.string().trim().min(2).max(120),
  segmentId: z.string().uuid(),
  channel: channelSchema,
  subject: z.string().trim().max(200).optional(),
  message: z.string().trim().min(1).max(5000),
  scheduledAt: z.string().datetime().optional()
}).strict();
const campaignAnalyticsSchema = z.object({
  campaignId: z.string().uuid()
}).strict();
const segmentAnalyticsSchema = z.object({
  segmentId: z.string().uuid().optional()
}).strict();
const promptSchema = z.object({
  prompt: z.string().trim().min(1).max(4000)
}).strict();
const simulateDeliverySchema = z.object({
  campaignId: z.string().uuid(),
  customerId: z.string().uuid(),
  type: z.enum([
    "MessageSent",
    "MessageDelivered",
    "MessageOpened",
    "MessageClicked",
    "MessageConverted",
    "MessageFailed"
  ]),
  payload: z.record(z.unknown()).optional()
}).strict();

function objectSchema(
  properties: Record<string, JsonSchema>,
  required: string[] = []
): JsonSchema {
  return {
    type: "object",
    additionalProperties: false,
    properties,
    required
  };
}

function stringSchema(description: string, extra: JsonSchema = {}): JsonSchema {
  return { type: "string", description, ...extra };
}

function numberSchema(description: string, extra: JsonSchema = {}): JsonSchema {
  return { type: "number", description, ...extra };
}

function arraySchema(description: string, items: JsonSchema): JsonSchema {
  return { type: "array", description, items };
}

const ruleJsonSchema: JsonSchema = {
  type: "object",
  description:
    "Validated segment rules with operator AND/OR and conditions using totalSpent, orderCount, daysSinceLastOrder, city, or emailEngagement."
};

@Injectable()
export class AIToolsService {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly campaigns: CampaignsService,
    private readonly customers: CustomersService,
    private readonly prisma: PrismaService,
    private readonly segmentCompiler: SegmentCompilerService,
    private readonly segments: SegmentsService,
    private readonly provider: AIProviderService,
    private readonly insightStore: InsightStoreService
  ) {}

  get definitions(): AIToolDefinition[] {
    return [
      this.define("getCustomers", "List customers with optional search/tag filters. Use the 'tag' parameter to filter customers by a specific tag value (e.g. 'vip', 'new', 'inactive'). Returns paginated results with order counts and lifetime value.", objectSchema({
        page: numberSchema("Page number", { minimum: 1 }),
        pageSize: numberSchema("Customers per page", { minimum: 1, maximum: 100 }),
        search: stringSchema("Search by customer name or email"),
        tag: stringSchema("Filter by customer tag")
      }), false, customerListSchema, async (input) => ({
        tool: "getCustomers",
        input,
        output: await this.customers.list(paginationQuerySchema.parse(input), {
          tag: typeof input.tag === "string" ? input.tag : undefined
        }),
        sources: ["Customer", "Order"]
      })),
      this.define("getCustomerById", "Retrieve one customer by UUID.", objectSchema({
        id: stringSchema("Customer UUID", { format: "uuid" })
      }, ["id"]), false, idSchema, async (input) => ({
        tool: "getCustomerById",
        input,
        output: await this.customers.get(String(input.id)),
        sources: [`Customer:${String(input.id)}`, "Order", "CampaignEvent"]
      })),
      this.define("getCustomerByEmail", "Retrieve one customer by email address.", objectSchema({
        email: stringSchema("Customer email", { format: "email" })
      }, ["email"]), false, z.object({ email: z.string().email() }).strict(), async (input) => ({
        tool: "getCustomerByEmail",
        input,
        output: await this.customers.getByEmail(String(input.email)),
        sources: [`CustomerEmail:${String(input.email).toLowerCase()}`, "Order", "CampaignEvent"]
      })),
      this.define("createCustomer", "Create a CRM customer.", objectSchema({
        name: stringSchema("Customer name"),
        email: stringSchema("Customer email", { format: "email" }),
        phone: stringSchema("Customer phone"),
        tags: arraySchema("Customer tags", { type: "string" }),
        metadata: { type: "object", description: "Free-form customer metadata" }
      }, ["name", "email", "phone"]), false, createCustomerSchema, async (input) => ({
        tool: "createCustomer",
        input,
        output: await this.customers.create(input as z.infer<typeof createCustomerSchema>),
        sources: ["Customer"]
      })),
      this.define("updateCustomer", "Update a CRM customer.", objectSchema({
        id: stringSchema("Customer UUID", { format: "uuid" }),
        name: stringSchema("New customer name"),
        email: stringSchema("New email", { format: "email" }),
        phone: stringSchema("New phone"),
        tags: arraySchema("Replacement customer tags", { type: "string" }),
        metadata: { type: "object", description: "Replacement metadata" }
      }, ["id"]), false, updateCustomerSchema, async (input) => ({
        tool: "updateCustomer",
        input,
        output: await this.customers.update(String(input.id), input),
        sources: [`Customer:${String(input.id)}`]
      })),
      this.define("deleteCustomer", "Delete a CRM customer.", objectSchema({
        id: stringSchema("Customer UUID", { format: "uuid" })
      }, ["id"]), false, idSchema, async (input) => ({
        tool: "deleteCustomer",
        input,
        output: await this.customers.remove(String(input.id)),
        sources: [`Customer:${String(input.id)}`]
      })),

      this.define("getSegments", "List segments with audience sizes.", objectSchema({
        page: numberSchema("Page number", { minimum: 1 }),
        pageSize: numberSchema("Segments per page", { minimum: 1, maximum: 100 }),
        search: stringSchema("Search by segment name")
      }), false, segmentListSchema, async (input) => ({
        tool: "getSegments",
        input,
        output: await this.segments.list(paginationQuerySchema.parse(input)),
        sources: ["Segment", "Customer", "Order"]
      })),
      this.define("getSegment", "Retrieve one segment by UUID.", objectSchema({
        id: stringSchema("Segment UUID", { format: "uuid" })
      }, ["id"]), false, idSchema, async (input) => ({
        tool: "getSegment",
        input,
        output: await this.segments.get(String(input.id)),
        sources: [`Segment:${String(input.id)}`, "Customer", "Order"]
      })),
      this.define("createSegment", "Create a customer segment. Requires a name and rules object with {operator:'AND'|'OR', conditions:[{field, operator, value}]}. Available fields: totalSpent (number), orderCount (number), daysSinceLastOrder (number), city (string), emailEngagement (string). If the user hasn't provided all required info, ask them for it first rather than guessing. Use generateSegmentRules to convert natural language descriptions into valid rule JSON. Description is auto-generated from rules if not provided.", objectSchema({
        name: stringSchema("Segment name"),
        description: stringSchema("Segment description"),
        rules: ruleJsonSchema
      }, ["name", "rules"]), false, createSegmentSchema, async (input) => ({
        tool: "createSegment",
        input,
        output: await this.segments.create(input as z.infer<typeof createSegmentSchema>),
        sources: ["Segment", "Customer", "Order"]
      })),
      this.define("updateSegment", "Update segment name, description, or rules.", objectSchema({
        id: stringSchema("Segment UUID", { format: "uuid" }),
        name: stringSchema("Segment name"),
        description: stringSchema("Segment description"),
        rules: ruleJsonSchema
      }, ["id"]), false, updateSegmentSchema, async (input) => ({
        tool: "updateSegment",
        input,
        output: await this.segments.update(String(input.id), input),
        sources: [`Segment:${String(input.id)}`, "Customer", "Order"]
      })),
      this.define("deleteSegment", "Delete a segment.", objectSchema({
        id: stringSchema("Segment UUID", { format: "uuid" })
      }, ["id"]), false, idSchema, async (input) => ({
        tool: "deleteSegment",
        input,
        output: await this.segments.remove(String(input.id)),
        sources: [`Segment:${String(input.id)}`]
      })),
      this.define("getSegmentCustomerCount", "Count the exact number of customers in a SPECIFIC segment by its UUID. Use this when the user asks 'how many customers are in [segment name]'. First get the segment ID via getSegments if needed.", objectSchema({
        id: stringSchema("Segment UUID", { format: "uuid" })
      }, ["id"]), false, idSchema, async (input) => ({
        tool: "getSegmentCustomerCount",
        input,
        output: await this.segments.countCustomers(String(input.id)),
        sources: [`Segment:${String(input.id)}`, "Customer", "Order"]
      })),

      this.define("getCampaigns", "List campaigns with optional status/channel filters.", objectSchema({
        page: numberSchema("Page number", { minimum: 1 }),
        pageSize: numberSchema("Campaigns per page", { minimum: 1, maximum: 100 }),
        search: stringSchema("Search by campaign name"),
        status: { type: "string", enum: campaignStatusSchema.options },
        channel: { type: "string", enum: channelSchema.options }
      }), false, campaignListSchema, async (input) => ({
        tool: "getCampaigns",
        input,
        output: await this.campaigns.list(paginationQuerySchema.parse(input), {
          status: typeof input.status === "string" ? input.status : undefined,
          channel: typeof input.channel === "string" ? input.channel : undefined
        }),
        sources: ["Campaign", "Segment", "CampaignAnalytics"]
      })),
      this.define("getCampaign", "Retrieve one campaign by UUID.", objectSchema({
        id: stringSchema("Campaign UUID", { format: "uuid" })
      }, ["id"]), false, idSchema, async (input) => ({
        tool: "getCampaign",
        input,
        output: await this.campaigns.get(String(input.id)),
        sources: [`Campaign:${String(input.id)}`, "Segment", "CampaignAnalytics", "CampaignEvent"]
      })),
      this.define("createCampaign", "Create a draft or scheduled campaign.", objectSchema({
        name: stringSchema("Campaign name"),
        segmentId: stringSchema("Target segment UUID", { format: "uuid" }),
        channel: { type: "string", enum: channelSchema.options },
        subject: stringSchema("Email subject or message title"),
        message: stringSchema("Campaign message"),
        scheduledAt: stringSchema("Future ISO datetime", { format: "date-time" })
      }, ["name", "segmentId", "channel", "message"]), false, createCampaignSchema, async (input) => ({
        tool: "createCampaign",
        input,
        output: await this.campaigns.create(input as z.infer<typeof createCampaignSchema>),
        sources: ["Campaign", "Segment"]
      })),
      this.define("launchCampaign", "Launch a draft campaign.", objectSchema({
        id: stringSchema("Campaign UUID", { format: "uuid" })
      }, ["id"]), false, idSchema, async (input) => ({
        tool: "launchCampaign",
        input,
        output: await this.campaigns.launch(String(input.id)),
        sources: [`Campaign:${String(input.id)}`, "Segment", "Customer", "Queue"]
      })),
      this.define("pauseCampaign", "Pause a running or queued campaign.", objectSchema({
        id: stringSchema("Campaign UUID", { format: "uuid" })
      }, ["id"]), false, idSchema, async (input) => ({
        tool: "pauseCampaign",
        input,
        output: await this.campaigns.pause(String(input.id)),
        sources: [`Campaign:${String(input.id)}`]
      })),
      this.define("deleteCampaign", "Delete a campaign.", objectSchema({
        id: stringSchema("Campaign UUID", { format: "uuid" })
      }, ["id"]), false, idSchema, async (input) => ({
        tool: "deleteCampaign",
        input,
        output: await this.campaigns.remove(String(input.id)),
        sources: [`Campaign:${String(input.id)}`]
      })),

      this.define("getCampaignAnalytics", "Retrieve detailed analytics (delivery rate, open rate, click rate, conversions, funnel) for a SPECIFIC campaign by its UUID. Use this when the user asks about a specific campaign's performance, delivery rate, or metrics. First get the campaign ID via getCampaigns if needed.", objectSchema({
        campaignId: stringSchema("Campaign UUID", { format: "uuid" })
      }, ["campaignId"]), false, campaignAnalyticsSchema, async (input) => ({
        tool: "getCampaignAnalytics",
        input,
        output: await this.analytics.getCampaignPerformance(String(input.campaignId)),
        sources: [`Campaign:${String(input.campaignId)}`, "CampaignAnalytics", "CampaignEvent"]
      })),
      this.define("getSegmentAnalytics", "Retrieve segment performance analytics.", objectSchema({
        segmentId: stringSchema("Optional segment UUID", { format: "uuid" })
      }), false, segmentAnalyticsSchema, async (input) => ({
        tool: "getSegmentAnalytics",
        input,
        output: await this.analytics.getSegmentAnalytics(
          typeof input.segmentId === "string" ? input.segmentId : undefined
        ),
        sources: ["Segment", "Campaign", "CampaignAnalytics"]
      })),
      this.define("getRevenueAnalytics", "Retrieve revenue analytics.", objectSchema({}), false, emptySchema, async (input) => ({
        tool: "getRevenueAnalytics",
        input,
        output: await this.analytics.getRevenueAnalytics(),
        sources: ["Order", "CampaignAnalytics", "Segment"]
      })),
      this.define("getDeliveryAnalytics", "Retrieve delivery funnel and failure analytics.", objectSchema({}), false, emptySchema, async (input) => ({
        tool: "getDeliveryAnalytics",
        input,
        output: await this.analytics.getDeliveryAnalytics(),
        sources: ["CampaignAnalytics", "CampaignLog", "CampaignEvent"]
      })),

      this.define("retryCampaign", "Retry failed deliveries for a campaign.", objectSchema({
        campaignId: stringSchema("Campaign UUID", { format: "uuid" })
      }, ["campaignId"]), false, campaignIdSchema, async (input) => ({
        tool: "retryCampaign",
        input,
        output: await this.campaigns.retryFailed(String(input.campaignId)),
        sources: [`Campaign:${String(input.campaignId)}`, "CampaignLog", "Queue"]
      })),
      this.define("simulateDelivery", "Record a simulated delivery event.", objectSchema({
        campaignId: stringSchema("Campaign UUID", { format: "uuid" }),
        customerId: stringSchema("Customer UUID", { format: "uuid" }),
        type: {
          type: "string",
          enum: [
            "MessageSent",
            "MessageDelivered",
            "MessageOpened",
            "MessageClicked",
            "MessageConverted",
            "MessageFailed"
          ]
        },
        payload: { type: "object", description: "Optional event payload" }
      }, ["campaignId", "customerId", "type"]), false, simulateDeliverySchema, async (input) => ({
        tool: "simulateDelivery",
        input,
        output: await this.campaigns.simulateDelivery(
          String(input.campaignId),
          String(input.customerId),
          input.type as "MessageSent" | "MessageDelivered" | "MessageOpened" | "MessageClicked" | "MessageConverted" | "MessageFailed",
          (input.payload as Record<string, unknown> | undefined) ?? {}
        ),
        sources: [`Campaign:${String(input.campaignId)}`, `Customer:${String(input.customerId)}`, "CampaignEvent", "CampaignLog"]
      })),

      this.define("getInsights", "Get proactive AI-generated business insights. Use when user asks about opportunities, risks, recommendations, or business health.", objectSchema({
        type: { type: "string", enum: insightTypeSchema.options, description: "Filter by insight type" },
        priority: { type: "string", enum: insightPrioritySchema.options, description: "Filter by priority level" },
        limit: numberSchema("Maximum number of insights to return", { minimum: 1, maximum: 50 })
      }), false, listInsightsToolSchema, async (input) => ({
        tool: "getInsights",
        input,
        output: await this.insightStore.list({
          type: typeof input.type === "string" ? input.type : undefined,
          priority: typeof input.priority === "string" ? input.priority : undefined,
          status: "ACTIVE",
          page: 1,
          pageSize: typeof input.limit === "number" ? input.limit : 10
        }),
        sources: ["AIInsight"]
      })),

      this.defineLegacyTools()
    ].flat();
  }

  getDefinition(name: string): AIToolDefinition | undefined {
    return this.definitions.find((tool) => tool.name === name);
  }

  async execute(name: string, input: unknown): Promise<ToolResult> {
    const definition = this.getDefinition(name);
    if (!definition) {
      throw new NotFoundException(`AI tool not found: ${name}`);
    }
    return definition.execute(definition.validate(input));
  }

  private define<T extends z.ZodType<Record<string, unknown>>>(
    name: AIToolName,
    description: string,
    inputSchema: JsonSchema,
    requiresConfirmation: boolean,
    schema: T,
    execute: (input: z.infer<T>) => Promise<ToolResult>
  ): AIToolDefinition {
    return {
      name,
      description,
      inputSchema,
      requiresConfirmation,
      validate(input: unknown) {
        return schema.parse(input);
      },
      execute: execute as (input: Record<string, unknown>) => Promise<ToolResult>
    };
  }

  private defineLegacyTools(): AIToolDefinition[] {
    return [
      this.define("getDashboardMetrics", "Retrieve dashboard metrics.", objectSchema({}), false, emptySchema, async (input) => ({
        tool: "getDashboardMetrics",
        input,
        output: await this.analytics.dashboard(),
        sources: ["Customer", "Order", "CampaignAnalytics", "CampaignEvent"]
      })),
      this.define("getCampaignPerformance", "Retrieve campaign performance by campaign reference text.", objectSchema({
        prompt: stringSchema("User text containing a campaign name or request")
      }, ["prompt"]), false, promptSchema, async (input) => {
        const campaign = await this.resolveCampaign(String(input.prompt));
        return {
          tool: "getCampaignPerformance",
          input: { campaignId: campaign.id },
          output: await this.analytics.getCampaignPerformance(campaign.id),
          sources: [`Campaign:${campaign.id}`, "CampaignAnalytics", "CampaignEvent"]
        };
      }),
      this.define("generateSegmentRules", "Convert a natural-language audience description into validated segment rules JSON. Use this BEFORE calling createSegment when the user describes their audience in plain English (e.g. 'customers who spent over $500 and live in Mumbai'). Returns rules and estimated audience size.", objectSchema({
        prompt: stringSchema("Natural-language audience description")
      }, ["prompt"]), false, promptSchema, async (input) => this.generateSegmentRules(String(input.prompt))),
      this.define("generateCampaignMessage", "Draft campaign copy from a brief.", objectSchema({
        prompt: stringSchema("Campaign copy brief")
      }, ["prompt"]), false, promptSchema, async (input) => this.generateCampaignMessage(String(input.prompt))),
      this.define("recommendAudience", "Recommend target audiences for a goal.", objectSchema({
        prompt: stringSchema("Campaign goal or targeting brief")
      }, ["prompt"]), false, promptSchema, async (input) => this.recommendAudience(String(input.prompt))),
      this.define("diagnoseCampaignFailure", "Diagnose campaign performance problems.", objectSchema({
        prompt: stringSchema("Campaign name or failure question")
      }, ["prompt"]), false, promptSchema, async (input) => this.diagnoseCampaignFailure(String(input.prompt))),
      this.define("listSegments", "Legacy alias for getSegments.", objectSchema({}), false, emptySchema, async (input) => {
        const result = await this.execute("getSegments", {});
        return { ...result, tool: "listSegments", input };
      }),
      this.define("listCampaigns", "Legacy alias for getCampaigns.", objectSchema({}), false, emptySchema, async (input) => {
        const result = await this.execute("getCampaigns", {});
        return { ...result, tool: "listCampaigns", input };
      }),
      this.define("getCustomerStats", "Retrieve customer count, orders, revenue, and top spenders.", objectSchema({}), false, emptySchema, async (input) => ({
        tool: "getCustomerStats",
        input,
        output: await this.getCustomerStatsOutput(),
        sources: ["Customer", "Order"]
      })),
      this.define("getBestSendTime", "Analyze historical delivery events for send-time recommendations.", objectSchema({
        prompt: stringSchema("User question")
      }, ["prompt"]), false, promptSchema, async (input) => this.getBestSendTime(String(input.prompt))),
      this.define("suggestABTest", "Suggest A/B test variants based on campaign performance.", objectSchema({
        prompt: stringSchema("Campaign or testing brief")
      }, ["prompt"]), false, promptSchema, async (input) => this.suggestABTest(String(input.prompt)))
    ];
  }

  private async resolveCampaign(reference: string) {
    const campaigns = await this.prisma.campaign.findMany({
      orderBy: { createdAt: "desc" },
      take: 100
    });
    const normalized = reference.toLowerCase();
    const campaign =
      campaigns.find((candidate) =>
        normalized.includes(candidate.name.toLowerCase())
      ) ?? campaigns[0];
    if (!campaign) {
      throw new NotFoundException("No campaigns are available to analyze");
    }
    return campaign;
  }

  private heuristicRules(prompt: string): SegmentRuleGroup {
    const normalized = prompt.toLowerCase();
    const conditions: SegmentRuleGroup["conditions"] = [];
    if (/vip|high[- ]?value|high roller|spent/.test(normalized)) {
      const amount = Number(normalized.match(/\$?(\d{2,6})/)?.[1] ?? 500);
      conditions.push({ field: "totalSpent", operator: ">", value: amount });
    }
    if (/inactive|haven't|not bought|win.?back|month/.test(normalized)) {
      const days = Number(normalized.match(/(\d+)\s*days?/)?.[1] ?? 30);
      conditions.push({ field: "daysSinceLastOrder", operator: ">", value: days });
    }
    if (/loyal|repeat|orders?/.test(normalized)) {
      conditions.push({ field: "orderCount", operator: ">", value: 3 });
    }
    const city = normalized.match(/(?:in|from)\s+([a-z][a-z ]{2,24})$/)?.[1];
    if (city) {
      conditions.push({ field: "city", operator: "contains", value: city });
    }
    if (conditions.length === 0) {
      conditions.push({ field: "orderCount", operator: ">", value: 0 });
    }
    return { operator: "AND", conditions };
  }

  private async generateSegmentRules(prompt: string): Promise<ToolResult> {
    let rules: SegmentRuleGroup | null = null;
    const generated = await this.provider.complete(
      "Return only JSON matching {operator:'AND'|'OR',conditions:[{field,operator,value}]}. Allowed fields: totalSpent, orderCount, daysSinceLastOrder, city, emailEngagement. Never return SQL.",
      `<user_input>\n${prompt}\n</user_input>`
    );
    if (generated) {
      try {
        // Strip markdown code fences (handles fences anywhere in the string)
        const json = generated
          .replace(/```(?:json)?\s*/gi, "")
          .replace(/```/g, "")
          .trim();
        rules = segmentRuleGroupSchema.parse(JSON.parse(json) as unknown);
      } catch {
        rules = null;
      }
    }
    rules ??= this.heuristicRules(prompt);
    const validated = this.segmentCompiler.validate(rules);
    const audienceSize = await this.segmentCompiler.count(validated);
    return {
      tool: "generateSegmentRules",
      input: { prompt },
      output: { rules: validated, audienceSize },
      sources: ["ValidatedSegmentRuleSchema", "Customer", "Order"]
    };
  }

  private async generateCampaignMessage(prompt: string): Promise<ToolResult> {
    const modelOutput = await this.provider.complete(
      "Create concise B2C marketing copy. Return a subject line and body. Do not claim facts, discounts, or metrics not supplied by the user.",
      `<user_input>\n${prompt}\n</user_input>`
    );
    return {
      tool: "generateCampaignMessage",
      input: { prompt },
      output: modelOutput?.trim()
        ? { message: modelOutput.trim() }
        : {
            subject: "Something special, just for you",
            message:
              "Hi {{first_name}}, we picked something we think you'll love. Take a look while it is still available."
          },
      sources: ["UserCampaignBrief"]
    };
  }

  private async recommendAudience(prompt: string): Promise<ToolResult> {
    const candidates = await this.prisma.segment.findMany({
      orderBy: { createdAt: "desc" },
      take: 20
    });
    const normalized = prompt.toLowerCase();
    const goalKeywords = normalized.split(/\s+/).filter((word) => word.length > 3);
    const scored = await Promise.all(candidates.map(async (segment) => {
      const audienceSize = await this.segmentCompiler.count(segment.rules);
      const rawRules = segment.rules;
      const conditions =
        rawRules &&
        typeof rawRules === "object" &&
        "conditions" in rawRules &&
        Array.isArray((rawRules as Record<string, unknown>).conditions)
          ? ((rawRules as Record<string, unknown>).conditions as Array<{ field: string; value: unknown }>)
          : [];
      const nameWords = segment.name.toLowerCase().split(/\s+/);
      const nameScore = nameWords.filter((word) => goalKeywords.includes(word)).length;
      let ruleScore = 0;
      if (/vip|high.?value|spender|loyal|repeat/i.test(normalized) &&
        conditions.some((condition) => condition.field === "totalSpent" || condition.field === "orderCount")) {
        ruleScore += 15;
      }
      if (/inactive|win.?back|dormant|churn|haven't/i.test(normalized) &&
        conditions.some((condition) => condition.field === "daysSinceLastOrder")) {
        ruleScore += 15;
      }
      const sizeScore = Math.min(Math.log10(Math.max(audienceSize, 1)) * 3, 12);
      const totalScore = nameScore * 8 + ruleScore + sizeScore;
      return {
        id: segment.id,
        name: segment.name,
        description: segment.description,
        audienceSize,
        score: Math.round(totalScore * 10) / 10
      };
    }));
    const topSegments = scored.sort((left, right) => right.score - left.score).slice(0, 5);
    return {
      tool: "recommendAudience",
      input: { campaignGoal: prompt },
      output: { topSegments, reasoning: `Scored ${candidates.length} segments using CRM segment rules and audience size.` },
      sources: candidates.map((segment) => `Segment:${segment.id}`)
    };
  }

  private async getCustomerStatsOutput() {
    const [totalCustomers, totalOrders, revenue, topSpenders, cityBreakdown] =
      await Promise.all([
        this.prisma.customer.count(),
        this.prisma.order.count(),
        this.prisma.order.aggregate({ _sum: { amount: true } }),
        this.prisma.$queryRaw<Array<{ name: string; totalSpent: number; orderCount: number }>>`
          SELECT c.name, SUM(o.amount)::float AS "totalSpent", COUNT(o.id)::int AS "orderCount"
          FROM "Customer" c
          JOIN "Order" o ON o."customerId" = c.id
          GROUP BY c.id, c.name
          ORDER BY "totalSpent" DESC
          LIMIT 5
        `,
        this.prisma.$queryRaw<Array<{ city: string; count: number }>>`
          SELECT metadata->>'city' AS city, COUNT(*)::int AS count
          FROM "Customer"
          WHERE metadata->>'city' IS NOT NULL
          GROUP BY city
          ORDER BY count DESC
          LIMIT 10
        `
      ]);
    return {
      totalCustomers,
      totalOrders,
      totalRevenue: Number(revenue._sum.amount ?? 0),
      topSpenders,
      cityBreakdown
    };
  }

  private async getBestSendTime(prompt: string): Promise<ToolResult> {
    const rows = await this.prisma.$queryRaw<
      Array<{ dow: number; hour: number; opened: bigint; delivered: bigint }>
    >`
      SELECT
        EXTRACT(DOW FROM e."occurredAt")::int AS dow,
        EXTRACT(HOUR FROM e."occurredAt")::int AS hour,
        COUNT(DISTINCT e."customerId") FILTER (
          WHERE e.type = 'MessageOpened'::"CampaignEventType"
        )::bigint AS opened,
        COUNT(DISTINCT e2."customerId")::bigint AS delivered
      FROM "CampaignEvent" e
      LEFT JOIN "CampaignEvent" e2
        ON e2."campaignId" = e."campaignId"
        AND e2."customerId" = e."customerId"
        AND e2.type = 'MessageDelivered'::"CampaignEventType"
      WHERE e.type IN ('MessageOpened'::"CampaignEventType", 'MessageDelivered'::"CampaignEventType")
      GROUP BY 1, 2
      HAVING COUNT(DISTINCT e2."customerId") > 0
      ORDER BY dow, hour
    `;
    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const slots = rows.map((row) => ({
      day: dayNames[row.dow] ?? `Day ${row.dow}`,
      hour: row.hour,
      opened: Number(row.opened),
      delivered: Number(row.delivered),
      openRate: Number(row.delivered) > 0
        ? Math.round((Number(row.opened) / Number(row.delivered)) * 10000) / 100
        : 0
    }));
    const best = [...slots].sort((left, right) => right.openRate - left.openRate).slice(0, 5);
    return {
      tool: "getBestSendTime",
      input: { prompt },
      output: {
        bestTimeSlots: best,
        recommendation: best[0]
          ? `Best time: ${best[0].day} at ${String(best[0].hour).padStart(2, "0")}:00 (${best[0].openRate}% open rate)`
          : "Not enough delivery data to determine optimal send time"
      },
      sources: ["CampaignEvent"]
    };
  }

  private async suggestABTest(prompt: string): Promise<ToolResult> {
    let campaign: { id: string; name: string; channel: string; message: string; subject: string | null } | null = null;
    try {
      campaign = await this.resolveCampaign(prompt);
    } catch {
      campaign = null;
    }
    if (!campaign) {
      return {
        tool: "suggestABTest",
        input: { prompt },
        output: {
          variants: [
            { name: "Variant A - Direct offer", audiencePercent: 50, messageAngle: "Direct product offer with clear CTA", optimizeFor: "Click rate" },
            { name: "Variant B - Storytelling", audiencePercent: 50, messageAngle: "Narrative approach with customer proof", optimizeFor: "Engagement" }
          ]
        },
        sources: ["UserCampaignBrief"]
      };
    }
    const performance = await this.analytics.getCampaignPerformance(campaign.id);
    return {
      tool: "suggestABTest",
      input: { campaignId: campaign.id },
      output: {
        campaign: campaign.name,
        currentPerformance: performance.rates,
        variants: [
          { name: "Variant A - Control", audiencePercent: 50, subject: campaign.subject ?? undefined, messageAngle: "Current message", optimizeFor: "Open rate" },
          { name: "Variant B - Personalized", audiencePercent: 50, messageAngle: "More personalized copy and clearer CTA", optimizeFor: "Click rate" }
        ]
      },
      sources: [`Campaign:${campaign.id}`, "CampaignAnalytics"]
    };
  }

  private async diagnoseCampaignFailure(reference: string): Promise<ToolResult> {
    const campaign = await this.resolveCampaign(reference);
    const performance = await this.analytics.getCampaignPerformance(campaign.id);
    const diagnostics: string[] = [];
    if (performance.rates.delivery < 90) {
      diagnostics.push(`Delivery rate is ${performance.rates.delivery}%, indicating channel or destination failures.`);
    }
    if (performance.rates.open < 40) {
      diagnostics.push(`Open rate is ${performance.rates.open}%, indicating weak subject or audience fit.`);
    }
    if (performance.rates.click < 15) {
      diagnostics.push(`Click rate is ${performance.rates.click}%, indicating message or offer friction.`);
    }
    if (performance.rates.conversion < 10) {
      diagnostics.push(`Post-click conversion is ${performance.rates.conversion}%, indicating landing or offer friction.`);
    }
    if (performance.failures.length > 0) {
      diagnostics.push(`${performance.funnel.failed} recipients failed delivery; inspect recorded failure reasons.`);
    }
    if (diagnostics.length === 0) {
      diagnostics.push("No severe funnel failure is visible in the recorded campaign metrics.");
    }
    return {
      tool: "diagnoseCampaignFailure",
      input: { campaignId: campaign.id },
      output: { performance, diagnostics },
      sources: [`Campaign:${campaign.id}`, "CampaignAnalytics", "CampaignEvent", "CampaignLog"]
    };
  }
}
