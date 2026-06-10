import { describe, expect, it } from "vitest";

// Test the pure logic extracted from AIService
// We test the regex patterns and formatting directly since the methods are private

function isGreetingOrCasual(prompt: string): boolean {
  const normalized = prompt.toLowerCase().trim();
  return /^(hi|hello|hey|yo|sup|what'?s up|howdy|hola|good (?:morning|afternoon|evening)|greetings|how are you|how'?s it going|what can you do|help|thanks|thank you|bye|goodbye|see you|cheers|nice|cool|ok|okay|sure|right)\b/i.test(
    normalized
  );
}

function formatDashboardSummary(output: Record<string, unknown>): string {
  const totalCustomers = (output.totalCustomers as number) ?? 0;
  const totalOrders = (output.totalOrders as number) ?? 0;
  const totalRevenue = (output.totalRevenue as number) ?? 0;
  const activeCampaigns = (output.activeCampaigns as number) ?? 0;
  const deliveryRate = (output.deliveryRate as number) ?? 0;
  const openRate = (output.openRate as number) ?? 0;
  const clickRate = (output.clickRate as number) ?? 0;
  const conversionRate = (output.conversionRate as number) ?? 0;

  const revenueFormatted =
    totalRevenue >= 1_000_000
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

function classifyIntent(prompt: string): string {
  const normalized = prompt.toLowerCase().trim();
  if (/why|fail|diagnos|wrong|drop.?off/.test(normalized)) {
    return "diagnoseCampaignFailure";
  }
  if (
    /segment|audience rule|find.*(?:customers|shoppers)|who (?:are|is)|customers? (?:who|that|in)|shoppers? (?:who|that|in)/.test(
      normalized
    )
  ) {
    return "generateSegmentRules";
  }
  if (/write|draft|copy|subject|message/.test(normalized)) {
    return "generateCampaignMessage";
  }
  if (/recommend|best audience|who should/.test(normalized)) {
    return "recommendAudience";
  }
  if (/campaign|performance|funnel/.test(normalized)) {
    return "getCampaignPerformance";
  }
  if (
    /dashboard|metric|overview|summary|how (?:is|are) (?:we|things|business)|what'?s (?:going|happening|up)/.test(
      normalized
    )
  ) {
    return "getDashboardMetrics";
  }
  return "getDashboardMetrics";
}

describe("AI greeting detection", () => {
  it("detects common greetings", () => {
    expect(isGreetingOrCasual("Hello")).toBe(true);
    expect(isGreetingOrCasual("Hi")).toBe(true);
    expect(isGreetingOrCasual("Hey")).toBe(true);
    expect(isGreetingOrCasual("hello")).toBe(true);
    expect(isGreetingOrCasual("HELLO")).toBe(true);
    expect(isGreetingOrCasual("Hello man")).toBe(true);
    expect(isGreetingOrCasual("Hi there")).toBe(true);
    expect(isGreetingOrCasual("Howdy partner")).toBe(true);
  });

  it("detects casual phrases", () => {
    expect(isGreetingOrCasual("Thanks")).toBe(true);
    expect(isGreetingOrCasual("Thank you")).toBe(true);
    expect(isGreetingOrCasual("Bye")).toBe(true);
    expect(isGreetingOrCasual("Goodbye")).toBe(true);
    expect(isGreetingOrCasual("What can you do")).toBe(true);
    expect(isGreetingOrCasual("Help")).toBe(true);
    expect(isGreetingOrCasual("Good morning")).toBe(true);
    expect(isGreetingOrCasual("Good evening")).toBe(true);
  });

  it("does NOT flag business questions as greetings", () => {
    expect(isGreetingOrCasual("Why did Summer Sale fail?")).toBe(false);
    expect(isGreetingOrCasual("Show me dashboard performance")).toBe(false);
    expect(isGreetingOrCasual("Find inactive VIP shoppers")).toBe(false);
    expect(isGreetingOrCasual("Write a campaign message")).toBe(false);
    expect(isGreetingOrCasual("Recommend an audience for summer sale")).toBe(
      false
    );
    expect(isGreetingOrCasual("How is our campaign performing")).toBe(false);
  });
});

describe("AI intent classification", () => {
  it("routes failure questions to diagnoseCampaignFailure", () => {
    expect(classifyIntent("Why did Summer Sale fail?")).toBe(
      "diagnoseCampaignFailure"
    );
    expect(classifyIntent("What went wrong with the campaign")).toBe(
      "diagnoseCampaignFailure"
    );
    expect(classifyIntent("Diagnose the drop-off in conversions")).toBe(
      "diagnoseCampaignFailure"
    );
  });

  it("routes segment questions to generateSegmentRules", () => {
    expect(classifyIntent("Find inactive VIP shoppers")).toBe(
      "generateSegmentRules"
    );
    expect(classifyIntent("Create a segment for high spenders")).toBe(
      "generateSegmentRules"
    );
    expect(classifyIntent("Find customers in Mumbai")).toBe(
      "generateSegmentRules"
    );
    expect(classifyIntent("Who are the top spenders")).toBe(
      "generateSegmentRules"
    );
    expect(classifyIntent("Customers who haven't ordered")).toBe(
      "generateSegmentRules"
    );
  });

  it("routes campaign questions to getCampaignPerformance", () => {
    expect(classifyIntent("How is my campaign performing")).toBe(
      "getCampaignPerformance"
    );
    expect(classifyIntent("Show campaign funnel")).toBe(
      "getCampaignPerformance"
    );
  });

  it("routes dashboard questions to getDashboardMetrics", () => {
    expect(classifyIntent("Show dashboard metrics")).toBe(
      "getDashboardMetrics"
    );
    expect(classifyIntent("What's the overview")).toBe("getDashboardMetrics");
    expect(classifyIntent("How are things going")).toBe("getDashboardMetrics");
  });

  it("defaults to getDashboardMetrics for unmatched input", () => {
    expect(classifyIntent("Something random")).toBe("getDashboardMetrics");
  });
});

describe("Dashboard summary formatting", () => {
  it("formats metrics into readable markdown", () => {
    const output = {
      totalCustomers: 1000,
      totalOrders: 5000,
      totalRevenue: 1290000,
      activeCampaigns: 3,
      deliveryRate: 95.5,
      openRate: 42.3,
      clickRate: 12.8,
      conversionRate: 5.2,
    };
    const result = formatDashboardSummary(output);

    expect(result).toContain("Dashboard Overview");
    expect(result).toContain("1,000");
    expect(result).toContain("5,000");
    expect(result).toContain("₹1.29M");
    expect(result).toContain("**3** active campaigns");
    expect(result).toContain("95.5%");
    expect(result).toContain("42.3%");
    expect(result).toContain("12.8%");
    expect(result).toContain("5.2%");
  });

  it("handles zero values gracefully", () => {
    const output = {
      totalCustomers: 0,
      totalOrders: 0,
      totalRevenue: 0,
      activeCampaigns: 0,
      deliveryRate: 0,
      openRate: 0,
      clickRate: 0,
      conversionRate: 0,
    };
    const result = formatDashboardSummary(output);

    expect(result).toContain("₹0.00");
    expect(result).toContain("**0** active campaigns");
  });

  it("formats revenue in thousands for mid-range", () => {
    const output = {
      totalCustomers: 100,
      totalOrders: 200,
      totalRevenue: 50000,
      activeCampaigns: 1,
      deliveryRate: 90,
      openRate: 50,
      clickRate: 20,
      conversionRate: 10,
    };
    const result = formatDashboardSummary(output);
    expect(result).toContain("₹50.0K");
    expect(result).toContain("**1** active campaign");
  });
});
