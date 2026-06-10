import { Injectable, NotFoundException } from "@nestjs/common";
import { type AIToolName } from "../contracts";
import { ToolExecutionStatus } from "@prisma/client";
import { toInputJson } from "../common/json";
import { PrismaService } from "../prisma/prisma.service";
import { AIProviderService } from "./ai-provider.service";
import { AIToolsService, type ToolResult } from "./ai-tools.service";

// ─── Intent taxonomy ────────────────────────────────────────────────
export type Intent =
  | "greeting"
  | "thanks"
  | "farewell"
  | "help"
  | "listSegments"
  | "segmentQuery"
  | "listCampaigns"
  | "campaignPerformance"
  | "campaignDiagnosis"
  | "customerStats"
  | "dashboard"
  | "generateSegment"
  | "generateMessage"
  | "recommendAudience"
  | "unknown";

// ─── Observability log entry ─────────────────────────────────────────
export type RequestLog = {
  query: string;
  intent: Intent;
  toolCalled: AIToolName | "none" | null;
  toolResultSummary: string;
  responseLength: number;
  timestamp: string;
};

@Injectable()
export class AIService {
  // In-memory request log (last 200 entries)
  private readonly requestLog: RequestLog[] = [];
  private readonly MAX_LOG = 200;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tools: AIToolsService,
    private readonly provider: AIProviderService
  ) {}

  // ─── Public API ──────────────────────────────────────────────────

  async createConversation(title?: string) {
    return this.prisma.aIConversation.create({
      data: { title: title?.trim() || "New conversation" }
    });
  }

  async listConversations() {
    return this.prisma.aIConversation.findMany({
      orderBy: { updatedAt: "desc" },
      include: {
        messages: { orderBy: { createdAt: "desc" }, take: 1 }
      },
      take: 100
    });
  }

  async getConversation(id: string) {
    const conversation = await this.prisma.aIConversation.findUnique({
      where: { id },
      include: {
        messages: { orderBy: { createdAt: "asc" } },
        tools: { orderBy: { createdAt: "asc" } }
      }
    });
    if (!conversation) {
      throw new NotFoundException("Conversation not found");
    }
    return conversation;
  }

  /** Expose recent request logs for debugging */
  getRequestLog(): RequestLog[] {
    return [...this.requestLog];
  }

  // ─── Intent classification ───────────────────────────────────────

  private classifyIntent(prompt: string): Intent {
    const n = prompt.toLowerCase().trim();

    // ── Greetings ──────────────────────────────────────────────────
    if (/^(hi|hello|hey|yo|sup|what'?s\s*up|howdy|hola|greetings)\b/i.test(n)) {
      return "greeting";
    }
    if (/^good\s*(morning|afternoon|evening|night)\b/i.test(n)) {
      return "greeting";
    }
    if (/^how\s*are\s*you|^how'?s\s*it\s*going|^what'?s\s*new/i.test(n)) {
      return "greeting";
    }

    // ── Thanks / farewell ──────────────────────────────────────────
    if (/^(thanks?|thank\s*you|thx|ty|appreciate)\b/i.test(n)) {
      return "thanks";
    }
    if (/^(bye|goodbye|see\s*you|cheers|later|take\s*care|good\s*night|gn)\b/i.test(n)) {
      return "farewell";
    }

    // ── Help ───────────────────────────────────────────────────────
    if (/^(help|what\s*can\s*you\s*do|what\s*do\s*you\s*do|capabilities|features|commands)\b/i.test(n)) {
      return "help";
    }

    // ── Campaign performance (must come BEFORE listCampaigns) ─────
    if (/(?:show|display|get|view)\s*(?:me\s*)?(?:the\s*)?campaign\s*(?:performance|funnel|metric|stat|result|outcome)/i.test(n)) {
      return "campaignPerformance";
    }
    if (/campaign.*(?:performance|funnel|metrics|results|outcome|how\s*did)/i.test(n)) {
      return "campaignPerformance";
    }
    if (/(?:performance|funnel|metric|result|how\s*did).*campaign/i.test(n)) {
      return "campaignPerformance";
    }

    // ── List segments (must come BEFORE generateSegment) ───────────
    if (/(?:list|show|display|get|view|see|all|how\s*many|total|count|number|exist).*segment/i.test(n)) {
      return "listSegments";
    }
    if (/segment.*(?:list|show|all|total|count|how\s*many|exist|number)/i.test(n)) {
      return "listSegments";
    }
    if (/^(?:segments?|my\s*segments?)\s*[?.!]*$/i.test(n)) {
      return "listSegments";
    }
    if (/(?:largest|biggest|smallest|top|best)\s*segment/i.test(n)) {
      return "listSegments";
    }
    if (/segment\s*(?:name|info|detail|overview)/i.test(n)) {
      return "listSegments";
    }

    // ── Generate segment rules (explicit creation request) ─────────
    if (/(?:create|build|make|generate|define)\s*(?:a\s*)?(?:new\s*)?(?:segment|audience)/i.test(n)) {
      return "generateSegment";
    }
    if (/(?:find|identify|target|get)\s*(?:me\s*)?(?:the\s*)?(?:customers?|shoppers?|audience|users?)\s*(?:who|that|in|from)/i.test(n)) {
      return "generateSegment";
    }
    if (/who\s+(?:are|is)\s*(?:the\s*)?(?:my\s*)?(?:customers?|shoppers?|users?)/i.test(n)) {
      return "generateSegment";
    }
    if (/(?:customers?|shoppers?|users?)\s*(?:who|that)\s*(?:haven|have|spent|bought|ordered|are|live)/i.test(n)) {
      return "generateSegment";
    }
    if (/(?:vip|inactive|high\s*value|win\s*back|loyal|repeat|churn|dormant|active)\s*(?:customers?|shoppers?|segment|audience)/i.test(n)) {
      return "generateSegment";
    }

    // ── List campaigns (must come BEFORE campaignPerformance) ──────
    if (/(?:list|show|display|get|view|see|all|how\s*many|total|count|number|exist|active|running|failed|completed|draft).*campaign/i.test(n)) {
      return "listCampaigns";
    }
    if (/campaign.*(?:list|show|all|total|count|how\s*many|exist|number|status)/i.test(n)) {
      return "listCampaigns";
    }
    if (/^(?:campaigns?|my\s*campaigns?)\s*[?.!]*$/i.test(n)) {
      return "listCampaigns";
    }

    // ── Campaign diagnosis (why did X fail) ────────────────────────
    if (/(?:why|diagnos|what\s*went\s*wrong|underperform|drop.?off|issue|problem).*(?:campaign|sale|performance)/i.test(n)) {
      return "campaignDiagnosis";
    }
    if (/(?:campaign|sale).*\s*(?:fail|underperform|wrong|issue|problem|low|bad)/i.test(n)) {
      return "campaignDiagnosis";
    }

    // ── Campaign performance ───────────────────────────────────────
    if (/campaign.*(?:performance|funnel|metric|stat|result|outcome|how\s*did)/i.test(n)) {
      return "campaignPerformance";
    }
    if (/(?:performance|funnel|metric|stat|result|how\s*did).*campaign/i.test(n)) {
      return "campaignPerformance";
    }

    // ── Customer stats ─────────────────────────────────────────────
    if (/(?:list|show|display|get|view|how\s*many|total|count|top|best|recent|inactive|active|vip)\s*(?:the\s*)?(?:my\s*)?customer/i.test(n)) {
      return "customerStats";
    }
    if (/customer.*(?:list|all|total|count|how\s*many|stat|number|info|detail|breakdown|overview)/i.test(n)) {
      return "customerStats";
    }
    if (/^(?:customers?|my\s*customers?)\s*[?.!]*$/i.test(n)) {
      return "customerStats";
    }
    if (/(?:top|best|highest)\s*(?:spender|customer|buyer)/i.test(n)) {
      return "customerStats";
    }
    if (/revenue|conversion\s*rate|lifetime\s*value|ltv|aov|order\s*value/i.test(n)) {
      return "customerStats";
    }
    if (/(?:how\s*many|total|count)\s*(?:customers?|users?|shoppers?|buyers?)/i.test(n)) {
      return "customerStats";
    }

    // ── Dashboard / summary ────────────────────────────────────────
    if (/dashboard|metric|overview|summar(?:y|ize)|how\s*(?:is|are)\s*(?:our|we|things|business)|what'?s\s*(?:going|happening|up)|kpi|report|crm/i.test(n)) {
      return "dashboard";
    }

    // ── Generate campaign message ──────────────────────────────────
    if (/(?:write|draft|compose|create|generate).*(?:message|copy|subject|email|sms|content)/i.test(n)) {
      return "generateMessage";
    }

    // ── Recommend audience ─────────────────────────────────────────
    if (/recommend|best\s*audience|who\s*should|which\s*segment.*(?:for|target)/i.test(n)) {
      return "recommendAudience";
    }

    return "unknown";
  }

  // ─── Intent → tool mapping ───────────────────────────────────────

  private intentToTool(intent: Intent): AIToolName | null {
    switch (intent) {
      case "listSegments":
        return "listSegments";
      case "generateSegment":
        return "generateSegmentRules";
      case "listCampaigns":
        return "listCampaigns";
      case "campaignPerformance":
        return "getCampaignPerformance";
      case "campaignDiagnosis":
        return "diagnoseCampaignFailure";
      case "customerStats":
        return "getCustomerStats";
      case "dashboard":
        return "getDashboardMetrics";
      case "generateMessage":
        return "generateCampaignMessage";
      case "recommendAudience":
        return "recommendAudience";
      default:
        return null; // no tool needed for greeting/thanks/help/unknown
    }
  }

  // ─── Tool execution dispatcher ───────────────────────────────────

  private async executeTool(
    toolName: AIToolName,
    prompt: string
  ): Promise<ToolResult> {
    switch (toolName) {
      case "getDashboardMetrics":
        return this.tools.getDashboardMetrics();
      case "getCampaignPerformance":
        return this.tools.getCampaignPerformance(prompt);
      case "generateSegmentRules":
        return this.tools.generateSegmentRules(prompt);
      case "generateCampaignMessage":
        return this.tools.generateCampaignMessage(prompt);
      case "recommendAudience":
        return this.tools.recommendAudience(prompt);
      case "diagnoseCampaignFailure":
        return this.tools.diagnoseCampaignFailure(prompt);
      case "listSegments":
        return this.tools.listSegments();
      case "listCampaigns":
        return this.tools.listCampaigns();
      case "getCustomerStats":
        return this.tools.getCustomerStats();
    }
  }

  // ─── Response generation ─────────────────────────────────────────

  private async generateConversationalResponse(
    intent: Intent,
    prompt: string
  ): Promise<string> {
    const systemPrompts: Record<string, string> = {
      greeting:
        "You are Xeno, a friendly B2C marketing copilot. The user said a greeting. Respond warmly and briefly. Mention that you can help with segments, campaigns, analytics, and customer insights. Do NOT include any data or metrics. Keep it to 2-3 sentences max.",
      thanks:
        "You are Xeno, a friendly B2C marketing copilot. The user said thanks. Respond warmly and briefly. Do NOT include any data or metrics. Keep it to 1-2 sentences.",
      farewell:
        "You are Xeno, a friendly B2C marketing copilot. The user is saying goodbye. Respond warmly and briefly. Do NOT include any data or metrics. Keep it to 1-2 sentences.",
      help:
        "You are Xeno, a B2C marketing copilot. List your capabilities concisely: 1) List and analyze customer segments, 2) List and analyze campaigns, 3) Show customer statistics, 4) Generate segment rules from natural language, 5) Draft campaign messages, 6) Diagnose campaign failures, 7) Recommend target audiences. Format as a bulleted list. Do NOT include any data or metrics.",
      unknown:
        "You are Xeno, a B2C marketing copilot. The user asked something you cannot help with. Politely explain what you can do: segments, campaigns, analytics, customer insights. Do NOT include any data or metrics. Keep it to 2-3 sentences."
    };

    const system = systemPrompts[intent as keyof typeof systemPrompts] ?? systemPrompts["unknown"];
    const generated = await this.provider.complete(system!, `User said: ${prompt}`);
    if (generated?.trim()) {
      return generated.trim();
    }

    // Hardcoded fallbacks only for conversational responses (no data)
    const fallbacks: Record<string, string> = {
      greeting:
        "Hi there! 👋 I'm Xeno, your marketing copilot. I can help you with segments, campaigns, analytics, and customer insights. What would you like to know?",
      thanks: "You're welcome! Let me know if there's anything else I can help with. 😊",
      farewell: "Goodbye! Feel free to come back anytime. 👋",
      help:
        "I can help you with:\n• **Segments** — list, create, and analyze customer segments\n• **Campaigns** — list, analyze performance, and diagnose failures\n• **Customers** — view stats, top spenders, and breakdowns\n• **Analytics** — dashboard metrics and KPIs\n• **Content** — draft campaign messages\n• **Recommendations** — find the best audience for a goal",
      unknown:
        "I'm not sure I understood that. I can help with segments, campaigns, analytics, and customer insights. Try asking something like \"list all segments\" or \"show campaign performance\"."
    };
    return fallbacks[intent as keyof typeof fallbacks] ?? fallbacks["unknown"] ?? "I'm here to help with your marketing data. What would you like to know?";
  }

  private async generateToolResponse(
    prompt: string,
    result: ToolResult
  ): Promise<string> {
    const generated = await this.provider.complete(
      "You are Xeno's B2C marketing copilot. Answer the user's question using ONLY the supplied tool result data. Never invent metrics. Format the response in clear markdown with bullet points and bold key numbers. Be concise and conversational — do not dump raw JSON.",
      `User request:\n${prompt}\n\nTool: ${result.tool}\nSources: ${result.sources.join(", ")}\nTool result:\n${JSON.stringify(result.output, null, 2)}`
    );
    if (!generated?.trim()) {
      return this.fallbackResponse(result);
    }
    // Numeric grounding check
    const numericTokens = (value: string): Set<string> =>
      new Set(value.match(/-?\d+(?:\.\d+)?/g) ?? []);
    const allowedNumbers = numericTokens(JSON.stringify(result.output));
    const generatedNumbers = numericTokens(generated);
    const grounded = [...generatedNumbers].every((value) =>
      allowedNumbers.has(value)
    );
    return grounded ? generated.trim() : this.fallbackResponse(result);
  }

  // ─── Fallback response formatters ────────────────────────────────

  private fallbackResponse(result: ToolResult): string {
    const output = result.output as Record<string, unknown>;
    switch (result.tool) {
      case "getDashboardMetrics":
        return this.formatDashboardSummary(output);
      case "getCampaignPerformance":
        return this.formatCampaignPerformance(output);
      case "generateSegmentRules":
        return this.formatSegmentRules(output);
      case "generateCampaignMessage":
        return this.formatCampaignMessage(output);
      case "recommendAudience":
        return this.formatRecommendedAudience(output);
      case "diagnoseCampaignFailure":
        return this.formatCampaignDiagnosis(output);
      case "listSegments":
        return this.formatSegmentList(output);
      case "listCampaigns":
        return this.formatCampaignList(output);
      case "getCustomerStats":
        return this.formatCustomerStats(output);
    }
  }

  private formatDashboardSummary(output: Record<string, unknown>): string {
    const totalCustomers = output.totalCustomers as number ?? 0;
    const totalOrders = output.totalOrders as number ?? 0;
    const totalRevenue = output.totalRevenue as number ?? 0;
    const activeCampaigns = output.activeCampaigns as number ?? 0;
    const deliveryRate = output.deliveryRate as number ?? 0;
    const openRate = output.openRate as number ?? 0;
    const clickRate = output.clickRate as number ?? 0;
    const conversionRate = output.conversionRate as number ?? 0;
    const revenueFormatted = totalRevenue >= 1_000_000
      ? `₹${(totalRevenue / 1_000_000).toFixed(2)}M`
      : totalRevenue >= 1_000
        ? `₹${(totalRevenue / 1_000).toFixed(1)}K`
        : `₹${totalRevenue.toFixed(2)}`;
    return [
      `📊 **Dashboard Overview**`,
      ``,
      `• **${totalCustomers.toLocaleString()}** customers across **${totalOrders.toLocaleString()}** orders`,
      `• **${revenueFormatted}** total revenue`,
      `• **${activeCampaigns}** active campaign${activeCampaigns !== 1 ? "s" : ""}`,
      ``,
      `**Campaign Performance:**`,
      `• Delivery rate: **${deliveryRate.toFixed(1)}%**`,
      `• Open rate: **${openRate.toFixed(1)}%**`,
      `• Click rate: **${clickRate.toFixed(1)}%**`,
      `• Conversion rate: **${conversionRate.toFixed(1)}%**`,
    ].join("\n");
  }

  private formatCampaignPerformance(output: Record<string, unknown>): string {
    const name = (output.name as string) ?? "Campaign";
    const status = (output.status as string) ?? "unknown";
    const funnel = (output.funnel ?? {}) as Record<string, number>;
    const rates = (output.rates ?? {}) as Record<string, number>;
    const failures = (output.failures ?? []) as Array<{ reason: string; count: number }>;
    const revenue = output.revenue as number ?? 0;
    const lines = [
      `📈 **${name}** — ${status}`,
      ``,
      `**Funnel:**`,
      `• Sent: ${funnel.sent?.toLocaleString() ?? 0}`,
      `• Delivered: ${funnel.delivered?.toLocaleString() ?? 0} (${(rates.delivery ?? 0).toFixed(1)}%)`,
      `• Opened: ${funnel.opened?.toLocaleString() ?? 0} (${(rates.open ?? 0).toFixed(1)}%)`,
      `• Clicked: ${funnel.clicked?.toLocaleString() ?? 0} (${(rates.click ?? 0).toFixed(1)}%)`,
      `• Converted: ${funnel.converted?.toLocaleString() ?? 0} (${(rates.conversion ?? 0).toFixed(1)}%)`,
      `• Failed: ${funnel.failed?.toLocaleString() ?? 0}`,
      `• Revenue: ₹${revenue.toLocaleString()}`,
    ];
    if (failures.length > 0) {
      lines.push("", "**Top failures:**");
      for (const f of failures.slice(0, 5)) {
        lines.push(`• ${f.reason}: ${f.count}`);
      }
    }
    return lines.join("\n");
  }

  private formatSegmentRules(output: Record<string, unknown>): string {
    const rules = output.rules;
    const audienceSize = (output.audienceSize as number) ?? 0;
    return [
      `🎯 **Generated Segment Rules**`,
      ``,
      `Audience size: **${audienceSize.toLocaleString()}** customers`,
      ``,
      `\`\`\`json\n${JSON.stringify(rules, null, 2)}\n\`\`\``,
    ].join("\n");
  }

  private formatCampaignMessage(output: Record<string, unknown>): string {
    const subject = (output.subject as string) ?? "";
    const message = (output.message as string) ?? "";
    return [
      `✉️ **Campaign Message Draft**`,
      subject ? `\n**Subject:** ${subject}` : "",
      `\n${message}`,
    ].join("\n");
  }

  private formatRecommendedAudience(output: Record<string, unknown>): string {
    const candidates = (output as { candidates?: unknown[] }).candidates ?? (Array.isArray(output) ? output : []);
    const items = candidates as Array<{ name: string; audienceSize: number; score: number }>;
    if (items.length === 0) {
      return "No matching audiences found for this goal.";
    }
    const lines = [`👥 **Recommended Audiences**`, ``];
    for (const item of items.slice(0, 5)) {
      lines.push(`• **${item.name}** — ${item.audienceSize?.toLocaleString() ?? 0} customers`);
    }
    return lines.join("\n");
  }

  private formatCampaignDiagnosis(output: Record<string, unknown>): string {
    const performance = (output.performance ?? {}) as Record<string, unknown>;
    const diagnostics = (output.diagnostics ?? []) as string[];
    const perfName = (performance.name as string) ?? "Campaign";
    const funnel = (performance.funnel ?? {}) as Record<string, number>;
    const rates = (performance.rates ?? {}) as Record<string, number>;
    const failures = (performance.failures ?? []) as Array<{ reason: string; count: number }>;
    const lines = [
      `🔍 **Campaign Diagnosis: ${perfName}**`,
      ``,
      `**Funnel rates:**`,
      `• Delivery: ${(rates.delivery ?? 0).toFixed(1)}%`,
      `• Open: ${(rates.open ?? 0).toFixed(1)}%`,
      `• Click: ${(rates.click ?? 0).toFixed(1)}%`,
      `• Conversion: ${(rates.conversion ?? 0).toFixed(1)}%`,
      `• Failed: ${funnel.failed?.toLocaleString() ?? 0}`,
      ``,
      `**Findings:**`,
    ];
    for (const d of diagnostics) {
      lines.push(`• ${d}`);
    }
    if (failures.length > 0) {
      lines.push("", "**Failure reasons:**");
      for (const f of failures.slice(0, 5)) {
        lines.push(`• ${f.reason}: ${f.count} recipients`);
      }
    }
    return lines.join("\n");
  }

  private formatSegmentList(output: Record<string, unknown>): string {
    const total = (output.total as number) ?? 0;
    const segments = (output.segments ?? []) as Array<{
      name: string;
      description: string | null;
      audienceSize: number;
    }>;
    if (total === 0) {
      return "No segments found. Create one by describing your target audience.";
    }
    const lines = [
      `🎯 **${total} Segment${total !== 1 ? "s" : ""}**`,
      ``,
    ];
    for (const seg of segments) {
      lines.push(
        `• **${seg.name}** — ${seg.audienceSize.toLocaleString()} customers${seg.description ? ` (${seg.description})` : ""}`
      );
    }
    return lines.join("\n");
  }

  private formatCampaignList(output: Record<string, unknown>): string {
    const total = (output.total as number) ?? 0;
    const campaigns = (output.campaigns ?? []) as Array<{
      name: string;
      status: string;
      channel: string;
      segment: string;
      audienceSize: number;
      openRate: number | null;
      deliveryRate: number | null;
      revenue: number | null;
    }>;
    if (total === 0) {
      return "No campaigns found. Create one from the Campaigns page.";
    }
    const lines = [
      `📢 **${total} Campaign${total !== 1 ? "s" : ""}**`,
      ``,
    ];
    for (const c of campaigns) {
      const rate = c.openRate !== null ? ` · Open: ${c.openRate.toFixed(1)}%` : "";
      const delivery = c.deliveryRate !== null ? ` · Delivery: ${c.deliveryRate.toFixed(1)}%` : "";
      const rev = c.revenue !== null ? ` · Revenue: ₹${c.revenue.toLocaleString()}` : "";
      lines.push(
        `• **${c.name}** [${c.status}] — ${c.channel} · ${c.audienceSize.toLocaleString()} recipients${rate}${delivery}${rev}`
      );
    }
    return lines.join("\n");
  }

  private formatCustomerStats(output: Record<string, unknown>): string {
    const totalCustomers = (output.totalCustomers as number) ?? 0;
    const totalOrders = (output.totalOrders as number) ?? 0;
    const totalRevenue = (output.totalRevenue as number) ?? 0;
    const topSpenders = (output.topSpenders ?? []) as Array<{ name: string; totalSpent: number; orderCount: number }>;
    const cityBreakdown = (output.cityBreakdown ?? []) as Array<{ city: string; count: number }>;
    const revenueFormatted = totalRevenue >= 1_000_000
      ? `₹${(totalRevenue / 1_000_000).toFixed(2)}M`
      : totalRevenue >= 1_000
        ? `₹${(totalRevenue / 1_000).toFixed(1)}K`
        : `₹${totalRevenue.toFixed(2)}`;
    const lines = [
      `👥 **Customer Overview**`,
      ``,
      `• **${totalCustomers.toLocaleString()}** total customers`,
      `• **${totalOrders.toLocaleString()}** total orders`,
      `• **${revenueFormatted}** total revenue`,
    ];
    if (topSpenders.length > 0) {
      lines.push("", "**Top spenders:**");
      for (const s of topSpenders.slice(0, 5)) {
        lines.push(`• **${s.name}** — ₹${s.totalSpent.toLocaleString()} (${s.orderCount} orders)`);
      }
    }
    if (cityBreakdown.length > 0) {
      lines.push("", "**Top cities:**");
      for (const c of cityBreakdown.slice(0, 5)) {
        lines.push(`• ${c.city}: ${c.count.toLocaleString()} customers`);
      }
    }
    return lines.join("\n");
  }

  // ─── Main message handler ────────────────────────────────────────

  async sendMessage(conversationId: string, prompt: string) {
    const conversation = await this.prisma.aIConversation.findUnique({
      where: { id: conversationId }
    });
    if (!conversation) {
      throw new NotFoundException("Conversation not found");
    }
    await this.prisma.aIMessage.create({
      data: { conversationId, role: "USER", content: prompt }
    });
    if (conversation.title === "New conversation") {
      await this.prisma.aIConversation.update({
        where: { id: conversationId },
        data: { title: prompt.slice(0, 70) }
      });
    }

    // ── Step 1: Classify intent ────────────────────────────────────
    const intent = this.classifyIntent(prompt);
    const toolName = this.intentToTool(intent);

    // ── Observability log ──────────────────────────────────────────
    const logEntry: RequestLog = {
      query: prompt,
      intent,
      toolCalled: toolName ?? "none",
      toolResultSummary: "",
      responseLength: 0,
      timestamp: new Date().toISOString()
    };

    // ── Step 2: Create tool execution record ───────────────────────
    const execution = await this.prisma.aIToolExecution.create({
      data: {
        conversationId,
        toolName: toolName ?? "none",
        status: ToolExecutionStatus.STARTED,
        input: toInputJson({ prompt, intent, toolName })
      }
    });

    try {
      let response: string;
      let result: ToolResult | null = null;

      // ── Step 3: Execute tool or generate conversational response ─
      if (toolName) {
        // Data-backed path: execute the appropriate tool
        result = await this.executeTool(toolName, prompt);
        logEntry.toolResultSummary = `tool=${result.tool}, sources=${result.sources.length}`;
        response = await this.generateToolResponse(prompt, result);
      } else {
        // Conversational path: no tool needed
        logEntry.toolResultSummary = "no tool (conversational)";
        response = await this.generateConversationalResponse(intent, prompt);
      }

      logEntry.responseLength = response.length;
      this.pushLog(logEntry);

      // ── Step 4: Persist results ──────────────────────────────────
      const groundingData = result
        ? { tool: result.tool, sources: result.sources, executionId: execution.id }
        : { tool: null, sources: [], executionId: execution.id, intent };

      await this.prisma.$transaction([
        this.prisma.aIToolExecution.update({
          where: { id: execution.id },
          data: {
            status: ToolExecutionStatus.COMPLETED,
            toolName: result ? result.tool : `conversational:${intent}`,
            output: toInputJson(result ? result.output : { intent, conversational: true }),
            completedAt: new Date()
          }
        }),
        this.prisma.aIMessage.create({
          data: {
            conversationId,
            role: "ASSISTANT",
            content: response,
            grounding: toInputJson(groundingData)
          }
        }),
        this.prisma.aIConversation.update({
          where: { id: conversationId },
          data: { updatedAt: new Date() }
        })
      ]);

      return {
        conversationId,
        response,
        toolResult: result?.output ?? null,
        grounding: {
          tool: result?.tool ?? null,
          sources: result?.sources ?? [],
          executionId: execution.id
        }
      };
    } catch (error) {
      await this.prisma.aIToolExecution.update({
        where: { id: execution.id },
        data: {
          status: ToolExecutionStatus.FAILED,
          error: error instanceof Error ? error.message : String(error),
          completedAt: new Date()
        }
      });
      throw error;
    }
  }

  private pushLog(entry: RequestLog): void {
    this.requestLog.push(entry);
    if (this.requestLog.length > this.MAX_LOG) {
      this.requestLog.shift();
    }
  }
}
