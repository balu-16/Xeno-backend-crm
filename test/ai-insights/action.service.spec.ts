import { describe, expect, it, vi, beforeEach } from "vitest";
import { NotFoundException, ConflictException } from "@nestjs/common";
import { InsightActionStatus, InsightActionType } from "@prisma/client";
import { ActionService } from "../../src/ai-insights/action.service";

// Mock toInputJson to pass through values
vi.mock("../common/json", () => ({
  toInputJson: (v: unknown) => JSON.parse(JSON.stringify(v)),
}));

function createMockPrisma() {
  return {
    aIInsight: {
      findUnique: vi.fn(),
    },
    aIInsightAction: {
      createMany: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    segment: {
      create: vi.fn(),
    },
    campaign: {
      create: vi.fn(),
    },
  };
}

function createMockSegmentCompiler() {
  return {
    validate: vi.fn((rules: unknown) => rules),
    count: vi.fn().mockResolvedValue(0),
  };
}

describe("ActionService", () => {
  let service: ActionService;
  let prisma: ReturnType<typeof createMockPrisma>;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new ActionService(prisma as any, createMockSegmentCompiler() as any);
  });

  describe("createActions", () => {
    it("creates actions from suggested actions on insight generation", async () => {
      prisma.aIInsight.findUnique.mockResolvedValue({ id: "insight-1" });
      prisma.aIInsightAction.createMany.mockResolvedValue({ count: 2 });
      prisma.aIInsightAction.findMany.mockResolvedValue([
        {
          id: "action-1",
          insightId: "insight-1",
          type: "GENERATE_SEGMENT",
          label: "Create Segment",
          description: "Auto segment",
          status: "GENERATED",
          metadata: null,
          executedResult: null,
          clickedAt: null,
          executedAt: null,
          createdAt: new Date(),
        },
        {
          id: "action-2",
          insightId: "insight-1",
          type: "CREATE_CAMPAIGN",
          label: "Launch Campaign",
          description: null,
          status: "GENERATED",
          metadata: { channel: "EMAIL" },
          executedResult: null,
          clickedAt: null,
          executedAt: null,
          createdAt: new Date(),
        },
      ]);

      const result = await service.createActions("insight-1", [
        { type: "GENERATE_SEGMENT", label: "Create Segment", description: "Auto segment" },
        { type: "CREATE_CAMPAIGN", label: "Launch Campaign", metadata: { channel: "EMAIL" } },
      ]);

      expect(prisma.aIInsightAction.createMany).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({
            insightId: "insight-1",
            type: "GENERATE_SEGMENT",
            label: "Create Segment",
          }),
          expect.objectContaining({
            insightId: "insight-1",
            type: "CREATE_CAMPAIGN",
            label: "Launch Campaign",
          }),
        ]),
      });
      expect(result).toHaveLength(2);
    });

    it("throws NotFoundException when insight does not exist", async () => {
      prisma.aIInsight.findUnique.mockResolvedValue(null);

      await expect(
        service.createActions("nonexistent", [{ type: "GENERATE_SEGMENT", label: "Test" }])
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("action lifecycle", () => {
    it("tracks action lifecycle: GENERATED -> CLICKED -> EXECUTED", async () => {
      const generatedAction = {
        id: "action-1",
        status: InsightActionStatus.GENERATED,
        insightId: "insight-1",
        type: InsightActionType.GENERATE_SEGMENT,
        label: "Create Segment",
        metadata: { segmentName: "AI Segment", rules: {} },
        insight: { id: "insight-1" },
      };

      const clickedAction = {
        ...generatedAction,
        status: InsightActionStatus.CLICKED,
        clickedAt: new Date(),
      };

      const executedAction = {
        ...generatedAction,
        status: InsightActionStatus.EXECUTED,
        executedAt: new Date(),
        executedResult: { segmentId: "seg-1", segmentName: "AI Segment" },
      };

      // Step 1: markClicked
      prisma.aIInsightAction.findUnique.mockResolvedValueOnce(generatedAction);
      prisma.aIInsightAction.update.mockResolvedValueOnce(clickedAction);

      const clickResult = await service.markClicked("action-1");
      expect(clickResult.status).toBe(InsightActionStatus.CLICKED);

      // Step 2: executeAction
      prisma.aIInsightAction.findUnique.mockResolvedValueOnce({
        ...clickedAction,
        status: InsightActionStatus.CLICKED,
      });
      prisma.segment.create.mockResolvedValue({ id: "seg-1", name: "AI Segment" });
      prisma.aIInsightAction.update.mockResolvedValueOnce(executedAction);

      const execResult = await service.executeAction("action-1", "user-1");
      expect(execResult.status).toBe(InsightActionStatus.EXECUTED);
    });

    it("throws ConflictException when marking a non-GENERATED action as clicked", async () => {
      prisma.aIInsightAction.findUnique.mockResolvedValue({
        id: "action-1",
        status: InsightActionStatus.CLICKED,
      });

      await expect(service.markClicked("action-1")).rejects.toThrow(ConflictException);
    });
  });

  describe("executeAction", () => {
    it("executes GENERATE_SEGMENT action and creates a segment", async () => {
      prisma.aIInsightAction.findUnique.mockResolvedValue({
        id: "action-1",
        insightId: "insight-1",
        type: InsightActionType.GENERATE_SEGMENT,
        status: InsightActionStatus.GENERATED,
        label: "Create Segment",
        description: null,
        metadata: { segmentName: "High Value Customers", rules: { conditions: [] } },
        insight: { id: "insight-1" },
      });

      prisma.segment.create.mockResolvedValue({
        id: "seg-123",
        name: "High Value Customers",
      });

      prisma.aIInsightAction.update.mockResolvedValue({
        id: "action-1",
        status: InsightActionStatus.EXECUTED,
        executedResult: { segmentId: "seg-123", segmentName: "High Value Customers" },
      });

      const result = await service.executeAction("action-1", "user-1");

      expect(prisma.segment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: "High Value Customers",
          description: expect.stringContaining("insight-1"),
        }),
      });
      expect(result.status).toBe(InsightActionStatus.EXECUTED);
    });

    it("executes CREATE_CAMPAIGN action and creates a campaign", async () => {
      prisma.aIInsightAction.findUnique.mockResolvedValue({
        id: "action-2",
        insightId: "insight-1",
        type: InsightActionType.CREATE_CAMPAIGN,
        status: InsightActionStatus.CLICKED,
        label: "Win-back Campaign",
        description: "Re-engage lost customers",
        metadata: {
          campaignName: "Win-back Holiday",
          segmentId: "seg-123",
          channel: "EMAIL",
          subject: "We miss you!",
          message: "Come back for 20% off",
        },
        insight: { id: "insight-1" },
      });

      prisma.campaign.create.mockResolvedValue({
        id: "camp-456",
        name: "Win-back Holiday",
      });

      prisma.aIInsightAction.update.mockResolvedValue({
        id: "action-2",
        status: InsightActionStatus.EXECUTED,
        executedResult: { campaignId: "camp-456", campaignName: "Win-back Holiday", status: "DRAFT" },
      });

      const result = await service.executeAction("action-2", "user-1");

      expect(prisma.campaign.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: "Win-back Holiday",
          segmentId: "seg-123",
          channel: "EMAIL",
        }),
      });
      expect(result.status).toBe(InsightActionStatus.EXECUTED);
    });

    it("prevents duplicate action execution when action is already EXECUTED", async () => {
      prisma.aIInsightAction.findUnique.mockResolvedValue({
        id: "action-1",
        status: InsightActionStatus.EXECUTED,
        insight: { id: "insight-1" },
      });

      await expect(service.executeAction("action-1", "user-1")).rejects.toThrow(
        ConflictException
      );
    });

    it("prevents duplicate action execution when action is already FAILED", async () => {
      prisma.aIInsightAction.findUnique.mockResolvedValue({
        id: "action-1",
        status: InsightActionStatus.FAILED,
        insight: { id: "insight-1" },
      });

      await expect(service.executeAction("action-1", "user-1")).rejects.toThrow(
        ConflictException
      );
    });
  });
});
