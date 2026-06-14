import { hash } from "argon2";
import {
  CampaignEventType,
  CampaignStatus,
  ChannelType,
  DeliveryStatus,
  Prisma,
  type PrismaClient
} from "@prisma/client";
import { randomUUID } from "node:crypto";
import { toInputJson } from "../common/json";

const cities = [
  "Mumbai",
  "Delhi",
  "Bengaluru",
  "Chennai",
  "Hyderabad",
  "Pune",
  "Kolkata",
  "Ahmedabad"
];

const firstNames = [
  "Aarav",
  "Aditi",
  "Arjun",
  "Diya",
  "Ishaan",
  "Kavya",
  "Mira",
  "Neel",
  "Priya",
  "Rohan",
  "Sara",
  "Vihaan"
];

const lastNames = [
  "Sharma",
  "Patel",
  "Mehta",
  "Iyer",
  "Kapoor",
  "Reddy",
  "Gupta",
  "Nair"
];

const segmentTemplates: Array<{
  name: string;
  rules: {
    operator: "AND" | "OR";
    conditions: Array<{
      field:
        | "totalSpent"
        | "orderCount"
        | "daysSinceLastOrder"
        | "city"
        | "emailEngagement";
      operator: ">" | ">=" | "<" | "<=" | "=" | "!=" | "contains";
      value: string | number;
    }>;
  };
}> = [
  {
    name: "Inactive VIP Shoppers",
    rules: {
      operator: "AND",
      conditions: [
        { field: "totalSpent", operator: ">", value: 500 },
        { field: "daysSinceLastOrder", operator: ">", value: 30 }
      ]
    }
  },
  {
    name: "Summer Sale Audience",
    rules: {
      operator: "AND",
      conditions: [
        { field: "orderCount", operator: ">", value: 0 },
        { field: "emailEngagement", operator: "<", value: 45 }
      ]
    }
  },
  {
    name: "High LTV Loyalists",
    rules: {
      operator: "AND",
      conditions: [
        { field: "totalSpent", operator: ">", value: 1000 },
        { field: "orderCount", operator: ">", value: 5 }
      ]
    }
  },
  {
    name: "Recent Buyers",
    rules: {
      operator: "AND",
      conditions: [
        { field: "daysSinceLastOrder", operator: "<=", value: 14 }
      ]
    }
  },
  {
    name: "Win-Back Targets",
    rules: {
      operator: "AND",
      conditions: [
        { field: "daysSinceLastOrder", operator: ">", value: 60 },
        { field: "totalSpent", operator: ">", value: 200 }
      ]
    }
  }
];

type SeedOptions = {
  adminEmail: string;
  adminPassword: string;
};

function dateDaysAgo(days: number, minuteOffset = 0): Date {
  return new Date(
    Date.now() - days * 24 * 60 * 60 * 1000 + minuteOffset * 60 * 1000
  );
}

async function createInBatches<T>(
  items: T[],
  batchSize: number,
  create: (batch: T[]) => Promise<unknown>
): Promise<void> {
  for (let index = 0; index < items.length; index += batchSize) {
    await create(items.slice(index, index + batchSize));
  }
}

export async function seedDatabase(
  prisma: PrismaClient,
  options: SeedOptions
): Promise<{
  customers: number;
  orders: number;
  segments: number;
  campaigns: number;
  campaignEvents: number;
}> {
  await prisma.$executeRaw`TRUNCATE TABLE "ProcessingFailure", "AIToolExecution", "AIMessage", "AIConversation", "WebhookReceipt", "CampaignEvent", "CampaignLog", "CampaignAnalytics", "Campaign", "Segment", "Order", "Customer", "User", "CustomerLoginLog", "AdminLoginLog", "EmailVerification", "RefreshToken" CASCADE`;

  await prisma.user.create({
    data: {
      name: "Xeno Evaluator",
      email: options.adminEmail.toLowerCase(),
      passwordHash: await hash(options.adminPassword),
      role: "ADMIN",
      approvalStatus: "APPROVED"
    }
  });

  const tagOptions = ["vip", "inactive", "loyal", "new", "high-value", "frequent", "win-back", "engaged"];
  const customers = Array.from({ length: 1000 }, (_, index) => {
    const first = firstNames[index % firstNames.length] ?? "Xeno";
    const last =
      lastNames[Math.floor(index / firstNames.length) % lastNames.length] ??
      "Customer";
    // Assign 1-3 tags deterministically
    const customerTags: string[] = [];
    customerTags.push(tagOptions[index % tagOptions.length]!);
    if (index % 3 === 0) customerTags.push(tagOptions[(index + 2) % tagOptions.length]!);
    if (index % 5 === 0) customerTags.push(tagOptions[(index + 4) % tagOptions.length]!);
    return {
      id: randomUUID(),
      name: `${first} ${last} ${index + 1}`,
      email: `shopper${String(index + 1).padStart(4, "0")}@example.com`,
      phone: `+91${String(7000000000 + index).padStart(10, "0")}`,
      tags: customerTags,
      metadata: toInputJson({
        city: cities[index % cities.length],
        emailEngagement: (index * 17) % 101,
        preferredCategory: ["coffee", "fashion", "beauty", "electronics"][
          index % 4
        ]
      }),
      createdAt: dateDaysAgo(180 - (index % 180))
    };
  });
  await createInBatches(customers, 500, (batch) =>
    prisma.customer.createMany({ data: batch })
  );

  const orders = Array.from({ length: 5000 }, (_, index) => ({
    id: randomUUID(),
    customerId: customers[index % customers.length]!.id,
    amount: new Prisma.Decimal(20 + ((index * 37) % 480) + (index % 100) / 100),
    items: toInputJson([
      {
        sku: `SKU-${String((index % 120) + 1).padStart(3, "0")}`,
        quantity: (index % 3) + 1
      }
    ]),
    createdAt: dateDaysAgo(index % 120, index % 1440)
  }));
  await createInBatches(orders, 1000, (batch) =>
    prisma.order.createMany({ data: batch })
  );

  const segments = Array.from({ length: 20 }, (_, index) => {
    const template = segmentTemplates[index % segmentTemplates.length]!;
    return {
      id: randomUUID(),
      name: index < segmentTemplates.length ? template.name : `${template.name} ${index + 1}`,
      description: "Deterministic evaluator seed segment",
      rules: toInputJson(template.rules),
      createdAt: dateDaysAgo(30 - index)
    };
  });
  await prisma.segment.createMany({ data: segments });

  const campaignNames = [
    "Summer Sale",
    "VIP Early Access",
    "Cart Recovery",
    "Monsoon Essentials",
    "Loyalty Thank You",
    "New Arrival Drop",
    "Weekend Flash Deal",
    "Beauty Replenishment",
    "Coffee Lovers Club",
    "Festive Preview"
  ];
  const channels = [
    ChannelType.EMAIL,
    ChannelType.WHATSAPP,
    ChannelType.SMS,
    ChannelType.RCS
  ];
  const campaigns = campaignNames.map((name, index) => ({
    id: randomUUID(),
    name,
    segmentId: segments[index % segments.length]!.id,
    channel: channels[index % channels.length]!,
    status: CampaignStatus.COMPLETED,
    subject: `${name}: selected for you`,
    message: `Hi {{first_name}}, explore our ${name.toLowerCase()} collection today.`,
    audienceSizeSnapshot: 1000,
    launchedAt: dateDaysAgo(10 - index, 30),
    completedAt: dateDaysAgo(10 - index, 180),
    createdAt: dateDaysAgo(11 - index)
  }));
  await prisma.campaign.createMany({ data: campaigns });

  const deliveredCounts = [600, 989, 989, 989, 989, 989, 989, 989, 989, 988];
  const openedCounts = [120, 876, 876, 876, 876, 876, 876, 876, 876, 872];
  const clickedCounts = [15, 777, 776, 776, 776, 776, 776, 776, 776, 776];
  const convertedCounts = [2, 554, 554, 554, 554, 554, 554, 554, 554, 554];
  const failedCounts = [400, 12, 11, 11, 11, 11, 11, 11, 11, 11];

  const events: Prisma.CampaignEventCreateManyInput[] = [];
  const logs: Prisma.CampaignLogCreateManyInput[] = [];
  let attributedOrderIndex = 0;
  let eventMinute = 0;

  campaigns.forEach((campaign, campaignIndex) => {
    const baseDate = campaign.launchedAt;
    const correlationId = randomUUID();
    events.push(
      {
        eventId: randomUUID(),
        type: CampaignEventType.CampaignCreated,
        campaignId: campaign.id,
        correlationId,
        payload: toInputJson({ seeded: true }),
        occurredAt: new Date(baseDate.getTime() - 60 * 60 * 1000)
      },
      {
        eventId: randomUUID(),
        type: CampaignEventType.CampaignLaunched,
        campaignId: campaign.id,
        correlationId,
        payload: toInputJson({ audienceSize: 1000, seeded: true }),
        occurredAt: baseDate
      }
    );
    const delivered = deliveredCounts[campaignIndex]!;
    const opened = openedCounts[campaignIndex]!;
    const clicked = clickedCounts[campaignIndex]!;
    const converted = convertedCounts[campaignIndex]!;
    const failed = failedCounts[campaignIndex]!;
    customers.forEach((customer, customerIndex) => {
      const queuedAt = new Date(baseDate.getTime() + eventMinute++ * 10);
      const sentAt = new Date(queuedAt.getTime() + 30_000);
      events.push(
        {
          eventId: randomUUID(),
          type: CampaignEventType.MessageQueued,
          campaignId: campaign.id,
          customerId: customer.id,
          correlationId,
          payload: toInputJson({ channel: campaign.channel }),
          occurredAt: queuedAt
        },
        {
          eventId: randomUUID(),
          type: CampaignEventType.MessageSent,
          campaignId: campaign.id,
          customerId: customer.id,
          correlationId,
          payload: toInputJson({ channel: campaign.channel }),
          occurredAt: sentAt
        }
      );
      let status: DeliveryStatus = DeliveryStatus.SENT;
      let lastEventAt = sentAt;
      let attributedOrderId: string | undefined;
      if (customerIndex < delivered) {
        lastEventAt = new Date(sentAt.getTime() + 60_000);
        events.push({
          eventId: randomUUID(),
          type: CampaignEventType.MessageDelivered,
          campaignId: campaign.id,
          customerId: customer.id,
          correlationId,
          payload: toInputJson({ provider: "xeno-simulator" }),
          occurredAt: lastEventAt
        });
        status = DeliveryStatus.DELIVERED;
      }
      if (customerIndex < opened) {
        lastEventAt = new Date(sentAt.getTime() + 120_000);
        events.push({
          eventId: randomUUID(),
          type: CampaignEventType.MessageOpened,
          campaignId: campaign.id,
          customerId: customer.id,
          correlationId,
          payload: toInputJson({ device: "mobile" }),
          occurredAt: lastEventAt
        });
        status = DeliveryStatus.OPENED;
      }
      if (customerIndex < clicked) {
        lastEventAt = new Date(sentAt.getTime() + 180_000);
        events.push({
          eventId: randomUUID(),
          type: CampaignEventType.MessageClicked,
          campaignId: campaign.id,
          customerId: customer.id,
          correlationId,
          payload: toInputJson({ destination: "/offer" }),
          occurredAt: lastEventAt
        });
        status = DeliveryStatus.CLICKED;
      }
      if (customerIndex < converted) {
        lastEventAt = new Date(sentAt.getTime() + 240_000);
        attributedOrderId = orders[attributedOrderIndex]?.id;
        attributedOrderIndex += 1;
        events.push({
          eventId: randomUUID(),
          type: CampaignEventType.MessageConverted,
          campaignId: campaign.id,
          customerId: customer.id,
          correlationId,
          attributedOrderId,
          payload: toInputJson({ attributionWindow: "7d" }),
          occurredAt: lastEventAt
        });
        status = DeliveryStatus.CONVERTED;
      }
      if (
        customerIndex >= delivered &&
        customerIndex < delivered + failed
      ) {
        lastEventAt = new Date(sentAt.getTime() + 75_000);
        events.push({
          eventId: randomUUID(),
          type: CampaignEventType.MessageFailed,
          campaignId: campaign.id,
          customerId: customer.id,
          correlationId,
          payload: toInputJson({
            reason:
              campaignIndex === 0
                ? "Invalid or unreachable destination"
                : "Temporary provider service disruption"
          }),
          occurredAt: lastEventAt
        });
        status = DeliveryStatus.FAILED;
      }
      logs.push({
        campaignId: campaign.id,
        customerId: customer.id,
        status,
        lastEventAt,
        attributedOrderId,
        failureReason:
          status === DeliveryStatus.FAILED
            ? campaignIndex === 0
              ? "Invalid or unreachable destination"
              : "Temporary provider service disruption"
            : null
      });
    });
  });

  if (events.length < 49000 || events.length > 52000) {
    throw new Error(`Seed generated ${events.length} events, expected ~50000`);
  }
  await createInBatches(events, 2000, (batch) =>
    prisma.campaignEvent.createMany({ data: batch })
  );
  await createInBatches(logs, 2000, (batch) =>
    prisma.campaignLog.createMany({ data: batch })
  );

  const orderAmounts = new Map<string, number>(
    orders.map((order) => [order.id, Number(order.amount)] as const)
  );
  const analyticsRows = campaigns.map((campaign, index) => {
    const sent = 1000;
    const delivered = deliveredCounts[index]!;
    const opened = openedCounts[index]!;
    const clicked = clickedCounts[index]!;
    const converted = convertedCounts[index]!;
    const failed = failedCounts[index]!;
    const campaignLogs = logs.filter((log) => log.campaignId === campaign.id);
    const revenue = campaignLogs.reduce((sum, log) => {
      if (!log.attributedOrderId) {
        return sum;
      }
      return sum + (orderAmounts.get(log.attributedOrderId) ?? 0);
    }, 0);
    return {
      campaignId: campaign.id,
      totalAudience: 1000,
      totalQueued: 1000,
      totalSent: sent,
      totalDelivered: delivered,
      totalOpened: opened,
      totalClicked: clicked,
      totalConverted: converted,
      totalFailed: failed,
      deliveryRate: (delivered / sent) * 100,
      openRate: (opened / delivered) * 100,
      clickRate: (clicked / opened) * 100,
      conversionRate: clicked === 0 ? 0 : (converted / clicked) * 100,
      revenueAccrued: revenue
    };
  });
  await prisma.campaignAnalytics.createMany({ data: analyticsRows });

  const receiptTypes = new Set<CampaignEventType>([
    CampaignEventType.MessageDelivered,
    CampaignEventType.MessageOpened,
    CampaignEventType.MessageClicked,
    CampaignEventType.MessageConverted,
    CampaignEventType.MessageFailed
  ]);
  const recentDeliveryEvents = events
    .filter((event) => receiptTypes.has(event.type))
    .slice(-100);
  await prisma.webhookReceipt.createMany({
    data: recentDeliveryEvents.map((event) => ({
      eventId: event.eventId,
      campaignId: event.campaignId,
      customerId: event.customerId!,
      type: event.type,
      correlationId: event.correlationId,
      payload: event.payload,
      receivedAt: event.occurredAt,
      processedAt: event.occurredAt,
      attempts: 1
    }))
  });

  const conversation = await prisma.aIConversation.create({
    data: { title: "Why did Summer Sale fail?" }
  });
  await prisma.aIMessage.createMany({
    data: [
      {
        conversationId: conversation.id,
        role: "USER",
        content: "Why did Summer Sale fail?"
      },
      {
        conversationId: conversation.id,
        role: "ASSISTANT",
        content:
          "Summer Sale underperformed because delivery reached only 60%, then just 20% of delivered recipients opened the message. The recorded failure ledger shows 400 suppressed or invalid destinations. The largest opportunities are destination hygiene and audience/message fit.",
        grounding: toInputJson({
          tool: "diagnoseCampaignFailure",
          sources: [
            `Campaign:${campaigns[0]!.id}`,
            "CampaignAnalytics",
            "CampaignEvent",
            "CampaignLog"
          ]
        })
      }
    ]
  });

  // Seed customer login logs
  const userAgents = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit/605.1.15",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Safari/605.1.15",
    "Mozilla/5.0 (Linux; Android 14) Chrome/120.0"
  ];
  const ips = [
    "103.21.58.1", "49.36.128.4", "182.74.95.22", "14.139.82.7",
    "27.56.84.11", "117.204.43.8", "106.51.72.55", "42.108.42.15"
  ];

  const customerLoginLogs = customers.slice(0, 200).flatMap((customer) => {
    const logCount = 1 + Math.floor(Math.random() * 5);
    return Array.from({ length: logCount }, (_, i) => ({
      id: randomUUID(),
      customerId: customer.id,
      email: customer.email,
      ip: ips[i % ips.length]!,
      userAgent: userAgents[i % userAgents.length]!,
      loggedInAt: dateDaysAgo(Math.floor(Math.random() * 30), i * 60)
    }));
  });
  await createInBatches(customerLoginLogs, 500, (batch) =>
    prisma.customerLoginLog.createMany({ data: batch })
  );

  // Seed admin login logs for the evaluator user
  const adminUser = await prisma.user.findFirst({ where: { role: "ADMIN" } });
  if (adminUser) {
    const adminLoginLogs = Array.from({ length: 10 }, (_, i) => ({
      id: randomUUID(),
      userId: adminUser.id,
      email: adminUser.email,
      role: "ADMIN",
      ip: ips[i % ips.length]!,
      userAgent: userAgents[i % userAgents.length]!,
      loggedInAt: dateDaysAgo(i, i * 120)
    }));
    await prisma.adminLoginLog.createMany({ data: adminLoginLogs });
  }

  return {
    customers: customers.length,
    orders: orders.length,
    segments: segments.length,
    campaigns: campaigns.length,
    campaignEvents: events.length
  };
}
