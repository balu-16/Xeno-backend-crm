import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { NotFoundException } from "@nestjs/common";
import { InsightStoreService } from "../../src/ai-insights/insight-store.service";
import type { GeneratedInsight } from "../../src/ai-insights/generators/generator.interface";

function createMockPrisma() {
  return {
    aIInsight: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  } as any;
}

function createMockQueues() {
  return {
    addInsightJob: vi.fn(),
  } as any;
}

function makeGeneratedInsight(overrides: Partial<GeneratedInsight> = {}): GeneratedInsight {
  return {
    type: "REVENUE",
    fingerprint: "test-fingerprint-1",
    title: "Test Insight",
    summary: "A test insight summary",
    details: { key: "value" },
    recommendation: "Do something about it",
    estimatedImpact: "10% change",
    confidenceScore: 0.8,
    confidenceFactors: [
      { factor: "data_quality", weight: 0.5, direction: "positive" },
      { factor: "sample_size", weight: 0.5, direction: "positive" },
    ],
    impactScore: 0.7,
    expiresAt: new Date("2026-06-14T12:00:00Z"),
    ...overrides,
  };
}

function makeRecord(overrides: Record<string, any> = {}) {
  return {
    id: "record-1",
    type: "REVENUE",
    priority: "HIGH",
    fingerprint: "test-fingerprint-1",
    title: "Test Insight",
    summary: "A test insight summary",
    details: { key: "value" },
    recommendation: "Do something about it",
    estimatedImpact: "10% change",
    confidenceScore: 0.8,
    confidenceFactors: [
      { factor: "data_quality", weight: 0.5, direction: "positive" },
    ],
    impactScore: 0.7,
    priorityScore: 0.56,
    status: "ACTIVE",
    correlationId: null,
    generatedAt: new Date("2026-06-13T12:00:00Z"),
    expiresAt: new Date("2026-06-14T12:00:00Z"),
    createdAt: new Date("2026-06-13T12:00:00Z"),
    updatedAt: new Date("2026-06-13T12:00:00Z"),
    dismissedAt: null,
    completedAt: null,
    actions: [],
    outcomes: [],
    feedback: [],
    ...overrides,
  };
}

describe("InsightStoreService", () => {
  let service: InsightStoreService;
  let prisma: ReturnType<typeof createMockPrisma>;
  let queues: ReturnType<typeof createMockQueues>;

  beforeEach(() => {
    prisma = createMockPrisma();
    queues = createMockQueues();
    service = new InsightStoreService(prisma, queues);
  });

  describe("upsert", () => {
    it("creates a new insight when no existing record with same fingerprint", async () => {
      const insight = makeGeneratedInsight();
      const record = makeRecord();

      prisma.aIInsight.findFirst.mockResolvedValue(null);
      prisma.aIInsight.create.mockResolvedValue(record);

      const result = await service.upsert(insight);

      expect(prisma.aIInsight.findFirst).toHaveBeenCalledWith({
        where: {
          fingerprint: "test-fingerprint-1",
          status: "ACTIVE",
        },
      });
      expect(prisma.aIInsight.create).toHaveBeenCalled();
      expect(prisma.aIInsight.update).not.toHaveBeenCalled();
      expect(result.id).toBe("record-1");
      expect(result.fingerprint).toBe("test-fingerprint-1");
    });

    it("updates existing insight with same fingerprint (deduplication)", async () => {
      const insight = makeGeneratedInsight({
        title: "Updated Title",
        summary: "Updated summary",
      });
      const existingRecord = makeRecord({ id: "existing-1" });
      const updatedRecord = makeRecord({
        id: "existing-1",
        title: "Updated Title",
        summary: "Updated summary",
      });

      prisma.aIInsight.findFirst.mockResolvedValue(existingRecord);
      prisma.aIInsight.update.mockResolvedValue(updatedRecord);

      const result = await service.upsert(insight);

      expect(prisma.aIInsight.update).toHaveBeenCalledWith({
        where: { id: "existing-1" },
        data: expect.objectContaining({
          title: "Updated Title",
          summary: "Updated summary",
        }),
        include: { actions: true, outcomes: true, feedback: true },
      });
      expect(prisma.aIInsight.create).not.toHaveBeenCalled();
      expect(result.id).toBe("existing-1");
    });
  });

  describe("list", () => {
    it("lists insights with filters and pagination", async () => {
      const records = [makeRecord({ id: "r1" }), makeRecord({ id: "r2" })];

      prisma.aIInsight.findMany.mockResolvedValue(records);
      prisma.aIInsight.count.mockResolvedValue(2);

      const result = await service.list({
        type: "REVENUE",
        priority: undefined,
        status: "ACTIVE",
        page: 1,
        pageSize: 20,
      });

      expect(result.data).toHaveLength(2);
      expect(result.meta.total).toBe(2);
      expect(result.meta.page).toBe(1);
      expect(result.meta.pageSize).toBe(20);
      expect(result.meta.totalPages).toBe(1);

      expect(prisma.aIInsight.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { type: "REVENUE", status: "ACTIVE" },
          orderBy: { priorityScore: "desc" },
          skip: 0,
          take: 20,
        }),
      );
    });
  });

  describe("dismiss", () => {
    it("dismisses insight correctly by setting status to DISMISSED", async () => {
      const record = makeRecord({ id: "dismiss-1" });
      const dismissedRecord = makeRecord({
        id: "dismiss-1",
        status: "DISMISSED",
        dismissedAt: new Date("2026-06-13T12:00:00Z"),
      });

      prisma.aIInsight.findUnique.mockResolvedValue(record);
      prisma.aIInsight.update.mockResolvedValue(dismissedRecord);

      const result = await service.dismiss("dismiss-1");

      expect(prisma.aIInsight.update).toHaveBeenCalledWith({
        where: { id: "dismiss-1" },
        data: {
          status: "DISMISSED",
          dismissedAt: expect.any(Date),
        },
        include: { actions: true, outcomes: true, feedback: true },
      });
      expect(result.status).toBe("DISMISSED");
    });

    it("throws NotFoundException when dismissing a non-existent insight", async () => {
      prisma.aIInsight.findUnique.mockResolvedValue(null);

      await expect(service.dismiss("nonexistent")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("complete", () => {
    it("completes insight correctly by setting status to COMPLETED", async () => {
      const record = makeRecord({ id: "complete-1" });
      const completedRecord = makeRecord({
        id: "complete-1",
        status: "COMPLETED",
        completedAt: new Date("2026-06-13T12:00:00Z"),
      });

      prisma.aIInsight.findUnique.mockResolvedValue(record);
      prisma.aIInsight.update.mockResolvedValue(completedRecord);

      const result = await service.complete("complete-1");

      expect(prisma.aIInsight.update).toHaveBeenCalledWith({
        where: { id: "complete-1" },
        data: {
          status: "COMPLETED",
          completedAt: expect.any(Date),
        },
        include: { actions: true, outcomes: true, feedback: true },
      });
      expect(result.status).toBe("COMPLETED");
    });
  });
});
