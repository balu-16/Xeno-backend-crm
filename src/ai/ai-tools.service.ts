import { Injectable, NotFoundException } from "@nestjs/common";
import {
  segmentRuleGroupSchema,
  type AIToolName,
  type SegmentRuleGroup
} from "../contracts";
import { AnalyticsService } from "../analytics/analytics.service";
import { AIProviderService } from "./ai-provider.service";
import { PrismaService } from "../prisma/prisma.service";
import { SegmentCompilerService } from "../segments/segment-compiler.service";

export type ToolResult = {
  tool: AIToolName;
  input: Record<string, unknown>;
  output: unknown;
  sources: string[];
};

@Injectable()
export class AIToolsService {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly prisma: PrismaService,
    private readonly segments: SegmentCompilerService,
    private readonly provider: AIProviderService
  ) {}

  async getDashboardMetrics(): Promise<ToolResult> {
    return {
      tool: "getDashboardMetrics",
      input: {},
      output: await this.analytics.dashboard(),
      sources: ["Customer", "Order", "CampaignAnalytics", "CampaignEvent"]
    };
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

  async getCampaignPerformance(reference: string): Promise<ToolResult> {
    const campaign = await this.resolveCampaign(reference);
    return {
      tool: "getCampaignPerformance",
      input: { campaignId: campaign.id },
      output: await this.analytics.getCampaignPerformance(campaign.id),
      sources: [
        `Campaign:${campaign.id}`,
        "CampaignAnalytics",
        "CampaignEvent"
      ]
    };
  }

  private heuristicRules(prompt: string): SegmentRuleGroup {
    const normalized = prompt.toLowerCase();
    const conditions: SegmentRuleGroup["conditions"] = [];
    if (/vip|high[- ]?value|high roller|spent/.test(normalized)) {
      const amount = Number(normalized.match(/\$?(\d{2,6})/)?.[1] ?? 500);
      conditions.push({
        field: "totalSpent",
        operator: ">",
        value: amount
      });
    }
    if (/inactive|haven't|not bought|win.?back|month/.test(normalized)) {
      const days = Number(normalized.match(/(\d+)\s*days?/)?.[1] ?? 30);
      conditions.push({
        field: "daysSinceLastOrder",
        operator: ">",
        value: days
      });
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

  async generateSegmentRules(prompt: string): Promise<ToolResult> {
    let rules: SegmentRuleGroup | null = null;
    const generated = await this.provider.complete(
      "Return only JSON matching {operator:'AND'|'OR',conditions:[{field,operator,value}]}. Allowed fields: totalSpent, orderCount, daysSinceLastOrder, city, emailEngagement. Never return SQL.",
      prompt
    );
    if (generated) {
      try {
        const json = generated
          .replace(/^```(?:json)?/i, "")
          .replace(/```$/, "")
          .trim();
        rules = segmentRuleGroupSchema.parse(JSON.parse(json) as unknown);
      } catch {
        rules = null;
      }
    }
    rules ??= this.heuristicRules(prompt);
    const validated = this.segments.validate(rules);
    const audienceSize = await this.segments.count(validated);
    return {
      tool: "generateSegmentRules",
      input: { prompt },
      output: { rules: validated, audienceSize },
      sources: ["ValidatedSegmentRuleSchema", "Customer", "Order"]
    };
  }

  async generateCampaignMessage(prompt: string): Promise<ToolResult> {
    const modelOutput = await this.provider.complete(
      "Create concise B2C marketing copy. Return a subject line and body. Do not claim facts, discounts, or metrics not supplied by the user.",
      prompt
    );
    const output = modelOutput
      ? { message: modelOutput }
      : {
          subject: "Something special, just for you",
          message:
            "Hi {{first_name}}, we picked something we think you'll love. Take a look while it is still available."
        };
    return {
      tool: "generateCampaignMessage",
      input: { prompt },
      output,
      sources: ["UserCampaignBrief"]
    };
  }

  async recommendAudience(prompt: string): Promise<ToolResult> {
    const candidates = await this.prisma.segment.findMany({
      orderBy: { createdAt: "desc" },
      take: 20
    });
    const scored = await Promise.all(
      candidates.map(async (segment) => {
        const audienceSize = await this.segments.count(segment.rules);
        const normalized = prompt.toLowerCase();
        const nameScore = segment.name
          .toLowerCase()
          .split(/\s+/)
          .filter((word) => normalized.includes(word)).length;
        return {
          id: segment.id,
          name: segment.name,
          audienceSize,
          score: nameScore * 10 + Math.min(audienceSize / 1000, 9)
        };
      })
    );
    return {
      tool: "recommendAudience",
      input: { campaignGoal: prompt },
      output: scored.sort((left, right) => right.score - left.score).slice(0, 5),
      sources: candidates.map((segment) => `Segment:${segment.id}`)
    };
  }

  async listSegments(): Promise<ToolResult> {
    const segments = await this.prisma.segment.findMany({
      orderBy: { createdAt: "desc" },
      take: 50
    });
    const withSizes = await Promise.all(
      segments.map(async (segment) => {
        const audienceSize = await this.segments.count(segment.rules);
        return {
          id: segment.id,
          name: segment.name,
          description: segment.description,
          audienceSize,
          createdAt: segment.createdAt.toISOString()
        };
      })
    );
    return {
      tool: "listSegments",
      input: {},
      output: { total: withSizes.length, segments: withSizes },
      sources: ["Segment", "Customer", "Order"]
    };
  }

  async listCampaigns(): Promise<ToolResult> {
    const campaigns = await this.prisma.campaign.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        segment: { select: { name: true } },
        analytics: true
      },
      take: 50
    });
    const formatted = campaigns.map((c) => ({
      id: c.id,
      name: c.name,
      status: c.status,
      channel: c.channel,
      segment: c.segment.name,
      audienceSize: c.audienceSizeSnapshot,
      launchedAt: c.launchedAt?.toISOString() ?? null,
      deliveryRate: c.analytics?.deliveryRate ?? null,
      openRate: c.analytics?.openRate ?? null,
      revenue: c.analytics ? Number(c.analytics.revenueAccrued) : null
    }));
    return {
      tool: "listCampaigns",
      input: {},
      output: { total: formatted.length, campaigns: formatted },
      sources: ["Campaign", "CampaignAnalytics", "Segment"]
    };
  }

  async getCustomerStats(): Promise<ToolResult> {
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
      tool: "getCustomerStats",
      input: {},
      output: {
        totalCustomers,
        totalOrders,
        totalRevenue: Number(revenue._sum.amount ?? 0),
        topSpenders,
        cityBreakdown
      },
      sources: ["Customer", "Order"]
    };
  }

  async diagnoseCampaignFailure(reference: string): Promise<ToolResult> {
    const campaign = await this.resolveCampaign(reference);
    const performance = await this.analytics.getCampaignPerformance(campaign.id);
    const diagnostics: string[] = [];
    if (performance.rates.delivery < 90) {
      diagnostics.push(
        `Delivery rate is ${performance.rates.delivery}%, indicating channel or destination failures.`
      );
    }
    if (performance.rates.open < 40) {
      diagnostics.push(
        `Open rate is ${performance.rates.open}%, indicating weak subject or audience fit.`
      );
    }
    if (performance.rates.click < 15) {
      diagnostics.push(
        `Click rate is ${performance.rates.click}%, indicating message or offer friction.`
      );
    }
    if (performance.rates.conversion < 10) {
      diagnostics.push(
        `Post-click conversion is ${performance.rates.conversion}%, indicating landing or offer friction.`
      );
    }
    if (performance.failures.length > 0) {
      diagnostics.push(
        `${performance.funnel.failed} recipients failed delivery; inspect the recorded failure reasons.`
      );
    }
    if (diagnostics.length === 0) {
      diagnostics.push(
        "No severe funnel failure is visible in the recorded campaign metrics."
      );
    }
    return {
      tool: "diagnoseCampaignFailure",
      input: { campaignId: campaign.id },
      output: { performance, diagnostics },
      sources: [
        `Campaign:${campaign.id}`,
        "CampaignAnalytics",
        "CampaignEvent",
        "CampaignLog"
      ]
    };
  }
}
