import { describe, expect, it, vi, beforeEach } from "vitest";
import { NotFoundException } from "@nestjs/common";
import { InsightStatus } from "@prisma/client";
import { InsightStoreService } from "../../src/ai-insights/insight-store.service";
import type { GeneratedInsight } from "../../src/ai-insights/generators/generator.interface";

// Mock toInputJson
vi.mock("../../common/json", () => ({
  toInputJson: (v: unknown) => JSON.parse(JSON.stringify(v)),
}));

function createMockPrisma() {
  return {
    aIInsight: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  };
}

function createMockQueues() {
  return {
    addInsightJob: vi.fn(),
  };
}

function makeGeneratedInsight(overrides: Partial<GeneratedInsight> = {}): GeneratedInsight {
  return {
    type: "REVENUE",
    fingerprint: "fp-revenue-001",
    title: "Revenue spike detected",
    summary: "Revenue increased 25% week-over-week",
    details: { change: 0.25, period: "7d" },
    recommendation: "Investigate top-performing channels",
    estimatedImpact: "+$15,000 this quarter",
    confidenceScore: 0.85,
    confidenceFactors: [
      { factor: "data_freshness", weight: 0.5, direction: "positive" },
      { factor: "sample_size", weight: 0.5, direction: "positive" },
    ],
    impactScore: 0.8,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    ...overrides,
  };
}

function makeInsightRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "insight-1",
    type: "REVENUE",
    priority: "HIGH",
    fingerprint: "fp-revenue-001",
    title: "Revenue spike detected",
    summary: "Revenue increased 25% week-over-week",
    details: { change: 0.25, period: "7d" },
    recommendation: "Investigate top-performing channels",
    estimatedImpact: "+$15,000 this quarter",
    confidenceScore: 0.85,
    confidenceFactors: [
      { factor: "data_freshness", weight: 0.5, direction: "positive" },
      { factor: "sample_size", weight: 0.5, direction: "positive" },
    ],
    impactScore: 0.8,
    priorityScore: 0.68,
    status: "ACTIVE",
    correlationId: null,
    generatedAt: new Date(),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    createdAt: new Date(),
    actions: [],
    outcomes: [],
    feedback: [],
    ...overrides,
  };
}

describe("AI Insights Integration Tests", () => {
  let store: InsightStoreService;
  let prisma: ReturnType<typeof createMockPrisma>;
  let queues: ReturnType<typeof createMockQueues>;

  beforeEach(() => {
    prisma = createMockPrisma();
    queues = createMockQueues();
    store = new InsightStoreService(prisma as any, queues as any);
  });

  describe("Full insight generation pipeline", () => {
    it("generates insight, stores it, and retrieves via API", async () => {
      const insight = makeGeneratedInsight();
      const record = makeInsightRecord();

      // No existing insight with this fingerprint
      prisma.aIInsight.findFirst.mockResolvedValue(null);
      prisma.aIInsight.create.mockResolvedValue(record);

      // Step 1: Upsert (generator -> store)
      const stored = await store.upsert(insight);

      expect(prisma.aIInsight.create).toHaveBeenCalled();
      expect(stored.id).toBe("insight-1");
      expect(stored.type).toBe("REVENUE");
      expect(stored.fingerprint).toBe("fp-revenue-001");

      // Step 2: Retrieve via get (API -> store)
      prisma.aIInsight.findUnique.mockResolvedValue(record);
      const retrieved = await store.get("insight-1");

      expect(retrieved.id).toBe("insight-1");
      expect(retrieved.title).toBe("Revenue spike detected");
    });
  });

  describe("Deduplication", () => {
    it("updates existing insight with same fingerprint instead of creating duplicate", async () => {
      const insight = makeGeneratedInsight();
      const existingRecord = makeInsightRecord({
        id: "existing-insight-1",
        fingerprint: "fp-revenue-001",
      });
      const updatedRecord = makeInsightRecord({
        id: "existing-insight-1",
        title: "Revenue spike detected - UPDATED",
        summary: "Revenue increased 30% week-over-week",
      });

      // Existing insight found with same fingerprint
      prisma.aIInsight.findFirst.mockResolvedValue(existingRecord);
      prisma.aIInsight.update.mockResolvedValue(updatedRecord);

      const result = await store.upsert(insight);

      expect(prisma.aIInsight.update).toHaveBeenCalledWith({
        where: { id: "existing-insight-1" },
        data: expect.objectContaining({
          fingerprint: "fp-revenue-001",
        }),
        include: { actions: true, outcomes: true, feedback: true },
      });
      expect(prisma.aIInsight.create).not.toHaveBeenCalled();
      expect(result.id).toBe("existing-insight-1");
    });
  });

  describe("Expiry", () => {
    it("expires stale insights and filters them from active queries", async () => {
      prisma.aIInsight.updateMany.mockResolvedValue({ count: 5 });
      prisma.aIInsight.deleteMany.mockResolvedValue({ count: 2 });

      const result = await store.expire();

      expect(result.expired).toBe(5);
      expect(result.deleted).toBe(2);

      // Verify updateMany was called with correct filter
      expect(prisma.aIInsight.updateMany).toHaveBeenCalledWith({
        where: {
          status: { in: [InsightStatus.ACTIVE, InsightStatus.DISMISSED] },
          expiresAt: expect.objectContaining({}), // lt: now
        },
        data: { status: InsightStatus.EXPIRED },
      });

      // Verify deleteMany was called for old expired insights
      expect(prisma.aIInsight.deleteMany).toHaveBeenCalledWith({
        where: {
          status: InsightStatus.EXPIRED,
          createdAt: expect.objectContaining({}),
        },
      });
    });

    it("returns zero counts when no insights need expiry", async () => {
      prisma.aIInsight.updateMany.mockResolvedValue({ count: 0 });
      prisma.aIInsight.deleteMany.mockResolvedValue({ count: 0 });

      const result = await store.expire();

      expect(result.expired).toBe(0);
      expect(result.deleted).toBe(0);
    });
  });

  describe("Dismiss/Complete lifecycle", () => {
    it("dismisses an insight and updates its status", async () => {
      const record = makeInsightRecord({
        id: "insight-1",
        status: "DISMISSED",
      });

      prisma.aIInsight.findUnique.mockResolvedValue(makeInsightRecord());
      prisma.aIInsight.update.mockResolvedValue(record);

      const result = await store.dismiss("insight-1");

      expect(result.status).toBe("DISMISSED");
      expect(prisma.aIInsight.update).toHaveBeenCalledWith({
        where: { id: "insight-1" },
        data: {
          status: InsightStatus.DISMISSED,
          dismissedAt: expect.any(Date),
        },
        include: { actions: true, outcomes: true, feedback: true },
      });
    });

    it("completes an insight and updates its status", async () => {
      const record = makeInsightRecord({
        id: "insight-1",
        status: "COMPLETED",
      });

      prisma.aIInsight.findUnique.mockResolvedValue(makeInsightRecord());
      prisma.aIInsight.update.mockResolvedValue(record);

      const result = await store.complete("insight-1");

      expect(result.status).toBe("COMPLETED");
      expect(prisma.aIInsight.update).toHaveBeenCalledWith({
        where: { id: "insight-1" },
        data: {
          status: InsightStatus.COMPLETED,
          completedAt: expect.any(Date),
        },
        include: { actions: true, outcomes: true, feedback: true },
      });
    });

    it("throws NotFoundException when dismissing a nonexistent insight", async () => {
      prisma.aIInsight.findUnique.mockResolvedValue(null);

      await expect(store.dismiss("nonexistent")).rejects.toThrow(NotFoundException);
    });
  });

  describe("API pagination and filtering", () => {
    it("returns paginated results with correct metadata", async () => {
      const records = Array.from({ length: 5 }, (_, i) =>
        makeInsightRecord({ id: `insight-${i + 1}`, priorityScore: 0.9 - i * 0.1 })
      );

      prisma.aIInsight.findMany.mockResolvedValue(records);
      prisma.aIInsight.count.mockResolvedValue(25);

      const result = await store.list({
        type: undefined,
        priority: undefined,
        status: "ACTIVE",
        page: 2,
        pageSize: 5,
      });

      expect(result.data).toHaveLength(5);
      expect(result.meta.total).toBe(25);
      expect(result.meta.page).toBe(2);
      expect(result.meta.pageSize).toBe(5);
      expect(result.meta.totalPages).toBe(5);

      expect(prisma.aIInsight.findMany).toHaveBeenCalledWith({
        where: { status: "ACTIVE" },
        orderBy: { priorityScore: "desc" },
        skip: 5,
        take: 5,
        include: { actions: true, outcomes: true, feedback: true },
      });
    });

    it("filters insights by type and priority", async () => {
      prisma.aIInsight.findMany.mockResolvedValue([]);
      prisma.aIInsight.count.mockResolvedValue(0);

      await store.list({
        type: "CHURN",
        priority: "CRITICAL",
        status: "ACTIVE",
        page: 1,
        pageSize: 20,
      });

      expect(prisma.aIInsight.findMany).toHaveBeenCalledWith({
        where: {
          type: "CHURN",
          priority: "CRITICAL",
          status: "ACTIVE",
        },
        orderBy: { priorityScore: "desc" },
        skip: 0,
        take: 20,
        include: { actions: true, outcomes: true, feedback: true },
      });
    });

    it("returns first page correctly with default pagination", async () => {
      const records = Array.from({ length: 20 }, (_, i) =>
        makeInsightRecord({ id: `insight-${i + 1}` })
      );

      prisma.aIInsight.findMany.mockResolvedValue(records);
      prisma.aIInsight.count.mockResolvedValue(20);

      const result = await store.list({
        status: "ACTIVE",
        page: 1,
        pageSize: 20,
      });

      expect(result.meta.page).toBe(1);
      expect(result.meta.totalPages).toBe(1);
      expect(result.data).toHaveLength(20);
    });
  });

  describe("Executive summary", () => {
    it("aggregates active insights into executive summary with trends", async () => {
      const activeInsights = [
        makeInsightRecord({
          id: "ins-1",
          type: "REVENUE",
          priority: "HIGH",
          priorityScore: 0.85,
          details: { change: 15 },
        }),
        makeInsightRecord({
          id: "ins-2",
          type: "CUSTOMER",
          priority: "CRITICAL",
          priorityScore: 0.9,
          details: { change: -5 },
        }),
        makeInsightRecord({
          id: "ins-3",
          type: "CAMPAIGN",
          priority: "MEDIUM",
          priorityScore: 0.5,
          details: { change: 3 },
        }),
      ];

      prisma.aIInsight.findMany.mockResolvedValue(activeInsights);

      const result = await store.executiveSummary();

      expect(result.revenue.trend).toBe("up");
      expect(result.revenue.change).toBe(15);
      expect(result.customerGrowth.change).toBe(-5);
      expect(result.executiveScore.factors.totalActive).toBe(3);
      expect(result.executiveScore.factors.critical).toBe(1);
      expect(result.risks).toHaveLength(2); // HIGH + CRITICAL
      expect(result.recommendedActions).toHaveLength(3);
    });

    it("handles empty active insights gracefully", async () => {
      prisma.aIInsight.findMany.mockResolvedValue([]);

      const result = await store.executiveSummary();

      expect(result.executiveScore.overallScore).toBe(0);
      expect(result.risks).toEqual([]);
      expect(result.recommendedActions).toEqual([]);
      expect(result.executiveScore.trend).toBe("improving");
    });
  });
});
